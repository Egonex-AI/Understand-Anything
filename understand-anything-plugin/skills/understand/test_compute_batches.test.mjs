import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'compute-batches.mjs');
const FIXTURES = resolve(__dirname, 'test/fixtures');

function runScript(projectRoot, extraArgs = []) {
  return spawnSync('node', [SCRIPT, projectRoot, ...extraArgs], {
    encoding: 'utf-8',
  });
}

function setupProject(fixtureName) {
  const root = mkdtempSync(join(tmpdir(), 'ua-cb-test-'));
  mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
  const fixturePath = join(FIXTURES, fixtureName);
  const dest = join(root, '.understand-anything', 'intermediate', 'scan-result.json');
  writeFileSync(dest, readFileSync(fixturePath, 'utf-8'));
  return root;
}

function readBatches(projectRoot) {
  const p = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}

describe('compute-batches.mjs — Louvain basic', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-3-cliques.json');
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('produces 3 batches for 3 disjoint cliques', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.algorithm).toBe('louvain');
    expect(batches.totalFiles).toBe(9);
    expect(batches.batches.length).toBe(3);
    expect(batches.schemaVersion).toBe(1);
    expect(batches.totalBatches).toBe(3);
    expect(batches.batches.map(b => b.batchIndex)).toEqual([1, 2, 3]);

    // Each batch should contain exactly one clique (3 files)
    for (const b of batches.batches) {
      expect(b.files.length).toBe(3);
      const dirs = new Set(b.files.map(f => f.path.split('/')[1]));
      expect(dirs.size).toBe(1); // all files in the batch share src/<dir>/
    }
  });

  it('produces deterministic output across runs', () => {
    const r1 = runScript(projectRoot);
    expect(r1.status).toBe(0);
    const json1 = readFileSync(
      join(projectRoot, '.understand-anything', 'intermediate', 'batches.json'),
      'utf-8',
    );

    const r2 = runScript(projectRoot);
    expect(r2.status).toBe(0);
    const json2 = readFileSync(
      join(projectRoot, '.understand-anything', 'intermediate', 'batches.json'),
      'utf-8',
    );

    expect(json1).toBe(json2);
  });
});

describe('compute-batches.mjs — size enforcement', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-large-community.json');
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('splits a 40-node clique into batches ≤ 35', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.algorithm).toBe('louvain');  // confirm fallback didn't fire
    expect(batches.totalFiles).toBe(40);
    expect(batches.batches.length).toBe(2);
    expect(batches.batches.map(b => b.files.length).sort()).toEqual([20, 20]);
    // Sum of all batch file counts equals total files
    const sum = batches.batches.reduce((acc, b) => acc + b.files.length, 0);
    expect(sum).toBe(40);
    // Warning was emitted to stderr
    expect(result.stderr).toMatch(/Warning: compute-batches: community size 40 > max 35/);
  });
});

describe('compute-batches.mjs — exports extraction', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('populates exports for code files via tree-sitter', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-exp-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'),
      'export function greet(name: string) { return "hi " + name; }\n' +
      'export class Greeter { greet(n: string) { return "hi " + n; } }\n');
    writeFileSync(join(root, 'src', 'b.ts'),
      'import { greet } from "./a";\nexport const helper = () => greet("world");\n');

    const scan = {
      name: 'exports-test',
      description: '',
      languages: ['typescript'],
      frameworks: [],
      files: [
        { path: 'src/a.ts', language: 'typescript', sizeLines: 2, fileCategory: 'code' },
        { path: 'src/b.ts', language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      ],
      totalFiles: 2, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: { 'src/a.ts': [], 'src/b.ts': ['src/a.ts'] },
    };
    writeFileSync(
      join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    expect(batches.exportsByPath).toBeDefined();
    expect(batches.exportsByPath['src/a.ts']).toEqual(
      expect.arrayContaining(['greet', 'Greeter']));
    expect(batches.exportsByPath['src/b.ts']).toEqual(
      expect.arrayContaining(['helper']));
  });

  it('emits warning when file is missing from disk (read error path)', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-exp-err-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
    // Note: NOT creating the file on disk — scan-result.json references it,
    // but the file doesn't exist, so the read branch fires.
    const scan = {
      name: 'missing-file-test',
      description: '',
      languages: ['typescript'],
      frameworks: [],
      files: [
        { path: 'src/missing.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' },
      ],
      totalFiles: 1, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: { 'src/missing.ts': [] },
    };
    writeFileSync(
      join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);  // script must still succeed
    expect(result.stderr).toMatch(
      /Warning: compute-batches: exports extraction failed for src\/missing\.ts \(read error:/);

    const batches = readBatches(root);
    expect(batches.exportsByPath['src/missing.ts']).toEqual([]);
  });
});

describe('compute-batches.mjs — non-code grouping', () => {
  let root;
  let batches;

  beforeEach(() => {
    root = setupProject('scan-result-non-code.json');
    const result = runScript(root);
    expect(result.status).toBe(0);
    batches = readBatches(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('Group A: bundles Dockerfile cluster per directory', () => {
    // Root-level cluster: Dockerfile + docker-compose.yml + .dockerignore → one batch
    const rootDockerBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'Dockerfile'));
    expect(rootDockerBatch).toBeDefined();
    const paths = rootDockerBatch.files.map(f => f.path).sort();
    expect(paths).toEqual(['.dockerignore', 'Dockerfile', 'docker-compose.yml']);

    // services/api cluster is a separate batch
    const apiDockerBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'services/api/Dockerfile'));
    expect(apiDockerBatch).toBeDefined();
    expect(apiDockerBatch).not.toBe(rootDockerBatch);
    expect(apiDockerBatch.files.map(f => f.path).sort()).toEqual([
      'services/api/Dockerfile', 'services/api/docker-compose.yml',
    ]);
  });

  it('Group B: .github/workflows/* all in one batch', () => {
    const wfBatch = batches.batches.find(b =>
      b.files.some(f => f.path.startsWith('.github/workflows/')));
    expect(wfBatch).toBeDefined();
    const wfPaths = wfBatch.files.map(f => f.path).filter(p => p.startsWith('.github/workflows/'));
    expect(wfPaths.sort()).toEqual([
      '.github/workflows/ci.yml', '.github/workflows/deploy.yml',
    ]);
  });

  it('Group C: .gitlab-ci.yml + .circleci/* in one batch', () => {
    const ciBatch = batches.batches.find(b =>
      b.files.some(f => f.path === '.gitlab-ci.yml'));
    expect(ciBatch).toBeDefined();
    const ciPaths = ciBatch.files.map(f => f.path).sort();
    expect(ciPaths).toEqual(['.circleci/config.yml', '.gitlab-ci.yml']);
  });

  it('Group D: SQL migrations under migrations/ in one batch', () => {
    const migBatch = batches.batches.find(b =>
      b.files.some(f => f.path.startsWith('migrations/')));
    expect(migBatch).toBeDefined();
    const migPaths = migBatch.files.map(f => f.path).filter(p => p.startsWith('migrations/'));
    expect(migPaths.sort()).toEqual([
      'migrations/001_init.sql', 'migrations/002_users.sql',
    ]);
  });

  it('non-code batch indices follow code batches', () => {
    const codeBatches = batches.batches.filter(b =>
      b.files.every(f => f.fileCategory === 'code'));
    const nonCodeBatches = batches.batches.filter(b =>
      b.files.some(f => f.fileCategory !== 'code'));
    expect(codeBatches.length).toBeGreaterThan(0);
    expect(nonCodeBatches.length).toBeGreaterThan(0);
    const maxCodeIdx = Math.max(...codeBatches.map(b => b.batchIndex));
    const minNonCodeIdx = Math.min(...nonCodeBatches.map(b => b.batchIndex));
    expect(minNonCodeIdx).toBeGreaterThan(maxCodeIdx);
  });
});

describe('compute-batches.mjs — Group E MAX_E split', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('splits 25 .md files under docs/ into [20, 5]', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-maxe-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });

    const files = [];
    const importMap = {};
    for (let i = 0; i < 25; i++) {
      const p = `docs/page${String(i).padStart(2, '0')}.md`;
      files.push({ path: p, language: 'markdown', sizeLines: 10, fileCategory: 'docs' });
      importMap[p] = [];
    }
    const scan = {
      name: 'maxe-test', description: '',
      languages: ['markdown'], frameworks: [],
      files, totalFiles: 25, filteredByIgnore: 0,
      estimatedComplexity: 'small', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    // All 25 docs/ files go through Group E with MAX_E = 20, split into [20, 5].
    const docsBatches = batches.batches.filter(b =>
      b.files.every(f => f.path.startsWith('docs/')));
    expect(docsBatches.length).toBe(2);
    const sizes = docsBatches.map(b => b.files.length).sort((a, b) => b - a);
    expect(sizes).toEqual([20, 5]);
  });
});

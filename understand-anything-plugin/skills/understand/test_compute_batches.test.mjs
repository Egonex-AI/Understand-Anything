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

describe('compute-batches.mjs — neighborMap + batchImportData', () => {
  let batches;
  let batchOf;  // path → batchIndex
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-3-cliques.json');
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);
    batches = readBatches(projectRoot);
    batchOf = new Map();
    for (const b of batches.batches) {
      for (const f of b.files) batchOf.set(f.path, b.batchIndex);
    }
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('batchImportData mirrors scan importMap per batch', () => {
    for (const b of batches.batches) {
      for (const f of b.files) {
        expect(b.batchImportData[f.path]).toBeDefined();
        expect(Array.isArray(b.batchImportData[f.path])).toBe(true);
      }
    }
    // src/auth/login.ts imports src/auth/session.ts and src/auth/tokens.ts
    const loginBatch = batches.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/login.ts'));
    expect(loginBatch.batchImportData['src/auth/login.ts'].sort()).toEqual([
      'src/auth/session.ts', 'src/auth/tokens.ts',
    ]);
  });

  it('neighborMap excludes same-batch files', () => {
    // The fixture's three cliques each go into one batch — all imports are
    // intra-batch, so no neighbor map should reference any same-batch file.
    for (const b of batches.batches) {
      const sameBatchPaths = new Set(b.files.map(f => f.path));
      for (const [, neighbors] of Object.entries(b.neighborMap)) {
        for (const n of neighbors) {
          expect(sameBatchPaths.has(n.path)).toBe(false);
        }
      }
    }
  });

  it('neighborMap entries carry symbols when target has exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-cb-nbr-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src', 'a'), { recursive: true });
    mkdirSync(join(root, 'src', 'b'), { recursive: true });

    // Cluster A: 3 tightly-imported files. a/core.ts exports symbols.
    writeFileSync(join(root, 'src', 'a', 'core.ts'),
      'export function findUser(id: string) { return null; }\nexport class User {}\n');
    writeFileSync(join(root, 'src', 'a', 'helper1.ts'),
      'import { findUser } from "./core";\nexport const h1 = () => findUser("x");\n');
    writeFileSync(join(root, 'src', 'a', 'helper2.ts'),
      'import { User } from "./core";\nimport { h1 } from "./helper1";\nexport const h2 = () => h1();\n');

    // Cluster B: 3 tightly-imported files. b/entry.ts has ONE cross-cluster import to a/core.ts.
    writeFileSync(join(root, 'src', 'b', 'entry.ts'),
      'import { findUser } from "../a/core";\nexport const entry = () => findUser("y");\n');
    writeFileSync(join(root, 'src', 'b', 'middle.ts'),
      'import { entry } from "./entry";\nexport const middle = () => entry();\n');
    writeFileSync(join(root, 'src', 'b', 'leaf.ts'),
      'import { middle } from "./middle";\nexport const leaf = () => middle();\n');

    const files = [
      { path: 'src/a/core.ts',    language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/a/helper1.ts', language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/a/helper2.ts', language: 'typescript', sizeLines: 3, fileCategory: 'code' },
      { path: 'src/b/entry.ts',   language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/middle.ts',  language: 'typescript', sizeLines: 2, fileCategory: 'code' },
      { path: 'src/b/leaf.ts',    language: 'typescript', sizeLines: 2, fileCategory: 'code' },
    ];
    const scan = {
      name: 't', description: '',
      languages: ['typescript'], frameworks: [],
      files,
      totalFiles: 6, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: {
        'src/a/core.ts': [],
        'src/a/helper1.ts': ['src/a/core.ts'],
        'src/a/helper2.ts': ['src/a/core.ts', 'src/a/helper1.ts'],
        'src/b/entry.ts': ['src/a/core.ts'],  // CROSS-CLUSTER
        'src/b/middle.ts': ['src/b/entry.ts'],
        'src/b/leaf.ts': ['src/b/middle.ts'],
      },
    };
    writeFileSync(
      join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const result = runScript(root);
    expect(result.status).toBe(0);
    const out = readBatches(root);

    // Expect 2 communities (cluster A and cluster B). Verify that some batch's
    // neighborMap entry references src/a/core.ts with its symbols.
    let sawSymbols = false;
    for (const batch of out.batches) {
      for (const [, neighbors] of Object.entries(batch.neighborMap)) {
        for (const n of neighbors) {
          if (n.path === 'src/a/core.ts') {
            expect(n.symbols).toEqual(expect.arrayContaining(['findUser', 'User']));
            sawSymbols = true;
          }
        }
      }
    }
    expect(sawSymbols).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('compute-batches.mjs — neighborMap truncation', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('truncates and warns when neighbors > 50', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-trunc-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
    // hub.ts imported by 60 other files
    const files = [{ path: 'src/hub.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' }];
    const importMap = { 'src/hub.ts': [] };
    for (let i = 0; i < 60; i++) {
      const p = `src/leaf${i}.ts`;
      files.push({ path: p, language: 'typescript', sizeLines: 1, fileCategory: 'code' });
      importMap[p] = ['src/hub.ts'];
    }
    const scan = {
      name: 't', description: '', languages: ['typescript'], frameworks: [],
      files, totalFiles: files.length, filteredByIgnore: 0,
      estimatedComplexity: 'moderate', importMap,
    };
    writeFileSync(
      join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));
    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /neighborMap for src\/hub\.ts has high 1-hop degree 60 — exceeds soft cap of 50/);
    const out = readBatches(root);
    // Find hub.ts and confirm its neighbor list capped at 50 (in whichever batch it landed)
    for (const b of out.batches) {
      const nbrs = b.neighborMap['src/hub.ts'];
      if (nbrs) expect(nbrs.length).toBeLessThanOrEqual(50);
    }
  });
});

describe('compute-batches.mjs — fallback', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('falls back to count-based when Louvain throws (env-injected mock)', () => {
    // We can't easily monkey-patch louvain mid-script in Vitest because the
    // script runs in a subprocess. Instead, set an env var the script honors:
    // UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW=1 → script throws inside its
    // Louvain branch, exercising the fallback path.
    root = setupProject('scan-result-3-cliques.json');
    const result = spawnSync('node',
      [SCRIPT, root],
      { encoding: 'utf-8', env: { ...process.env, UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW: '1' } },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      /Warning: compute-batches: Louvain failed.*falling back to count-based grouping/);
    const out = readBatches(root);
    expect(out.algorithm).toBe('count-fallback');
    expect(out.totalFiles).toBe(9);
    // Count-based: 12 files per batch → all 9 fit in one batch
    const codeBatchFileCount = out.batches
      .filter(b => b.files.every(f => f.fileCategory === 'code'))
      .reduce((sum, b) => sum + b.files.length, 0);
    expect(codeBatchFileCount).toBe(9);
  });
});

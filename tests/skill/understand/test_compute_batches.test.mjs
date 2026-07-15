import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/compute-batches.mjs');
const FIXTURES = resolve(__dirname, 'fixtures');

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

// Variant of setupProject that seeds the fixture into an arbitrary data
// directory name (`.ua` for fresh projects, `.understand-anything` for legacy).
function setupProjectInDir(fixtureName, dirName) {
  const root = mkdtempSync(join(tmpdir(), 'ua-cb-dir-test-'));
  mkdirSync(join(root, dirName, 'intermediate'), { recursive: true });
  const fixturePath = join(FIXTURES, fixtureName);
  writeFileSync(
    join(root, dirName, 'intermediate', 'scan-result.json'),
    readFileSync(fixturePath, 'utf-8'),
  );
  return root;
}

function readBatches(projectRoot) {
  const p = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function incrementalFileMeta(path) {
  return {
    path,
    language: 'typescript',
    sizeLines: 1,
    fileCategory: 'code',
  };
}

function setupIncrementalProject({
  inventoryPaths = ['src/existing.ts'],
  diskFiles = { 'src/existing.ts': 'export const existing = true;\n' },
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-cb-incremental-'));
  const dataDir = join(root, '.understand-anything');
  const intermediateDir = join(dataDir, 'intermediate');
  mkdirSync(intermediateDir, { recursive: true });

  for (const [path, content] of Object.entries(diskFiles)) {
    const absolutePath = join(root, ...path.split('/'));
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  const files = inventoryPaths.map(incrementalFileMeta);
  const scan = {
    name: 'incremental-structure-test',
    description: 'retained narrative',
    languages: ['typescript'],
    frameworks: ['vitest'],
    files,
    totalFiles: files.length,
    filteredByIgnore: 0,
    estimatedComplexity: 'small',
    importMap: Object.fromEntries(inventoryPaths.map(path => [path, []])),
  };
  const scanPath = join(intermediateDir, 'scan-result.json');
  writeFileSync(scanPath, `${JSON.stringify(scan, null, 2)}\n`);

  return {
    root,
    dataDir,
    scanPath,
    batchesPath: join(intermediateDir, 'batches.json'),
  };
}

function writeChangedList(project, lines) {
  const changedDir = join(project.dataDir, 'tmp');
  mkdirSync(changedDir, { recursive: true });
  const changedPath = join(changedDir, 'changed-files.txt');
  writeFileSync(changedPath, lines.join('\r\n'));
  return changedPath;
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

describe('compute-batches.mjs — merge-small', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = setupProject('scan-result-singletons.json');
  });

  afterEach(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('merges 100 isolated singletons into a small number of misc batches', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.totalFiles).toBe(100);

    // Without merge: 100 singletons → 100 batches.
    // With merge-small (MAX_MERGE_TARGET=25): ceil(100 / 25) = exactly 4 misc
    // batches. Pin the exact count — a loose >=4 && <=8 would mask off-by-one
    // regressions in the slice math (e.g., a stride miscalculation that
    // splintered the pool into 5-7 underfull buckets).
    expect(batches.batches.length).toBe(4);

    // All files accounted for
    const totalAssigned = batches.batches.reduce((sum, b) => sum + b.files.length, 0);
    expect(totalAssigned).toBe(100);

    // Bucket-fullness check: 100 singletons evenly divisible by
    // MAX_MERGE_TARGET=25, so every bucket must be exactly 25 — not just
    // ≤ 25. Drift toward [25, 25, 25, 24, 1] etc. would slip past a
    // ≤25 bound while indicating a stride bug.
    for (const b of batches.batches) {
      expect(b.files.length).toBe(25);
    }

    // Info: (not Warning:) — merge-small is a routine optimization, not a
    // fallback path. See compute-batches.mjs mergeSmallBatches WHY comment.
    expect(result.stderr).toMatch(
      /Info: compute-batches: merged \d+ small batches \(\d+ files\) into \d+ misc batches/);
    expect(result.stderr).not.toMatch(/Warning: compute-batches: merged \d+ small batches/);
  });

  it('preserves non-mergeable batches: Dockerfile cluster not pooled into misc', () => {
    // Dedicated fixture: 30 isolated TS singletons + 1 Dockerfile-only cluster.
    // Group A marks the Dockerfile batch mergeable=false; even though its size
    // (1) is below MIN_BATCH_SIZE=3, mergeSmallBatches must leave it intact.
    const altRoot = setupProject('scan-result-merge-respects-non-mergeable.json');
    try {
      const result = runScript(altRoot);
      expect(result.status).toBe(0);

      const out = readBatches(altRoot);
      expect(out.totalFiles).toBe(31);

      const dockerBatch = out.batches.find(b =>
        b.files.some(f => f.path === 'services/api/Dockerfile'));
      expect(dockerBatch).toBeDefined();
      // Standalone: exactly the Dockerfile, nothing pooled in alongside it.
      expect(dockerBatch.files.length).toBe(1);
      expect(dockerBatch.files[0].path).toBe('services/api/Dockerfile');

      // The TS singletons must still merge into at least one misc batch —
      // and that misc batch must NOT contain the Dockerfile.
      const miscBatches = out.batches.filter(b =>
        b.files.some(f => f.path.startsWith('src/leaf')));
      expect(miscBatches.length).toBeGreaterThanOrEqual(1);
      for (const m of miscBatches) {
        for (const f of m.files) {
          expect(f.path).not.toBe('services/api/Dockerfile');
        }
      }

      // Every TS singleton accounted for across the misc bucket(s).
      const tsInMisc = miscBatches.flatMap(b => b.files.map(f => f.path))
        .filter(p => p.startsWith('src/leaf'));
      expect(tsInMisc.length).toBe(30);
    } finally {
      rmSync(altRoot, { recursive: true, force: true });
    }
  });
});

describe('compute-batches.mjs — --changed-files', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('emits only changed files from retained batches with Windows-style changed-file paths', () => {
    root = setupProject('scan-result-3-cliques.json');
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    writeFileSync(join(root, 'src', 'auth', 'login.ts'), 'export const login = true;\n');
    writeFileSync(join(root, 'src', 'auth', 'tokens.ts'), 'export const tokens = true;\n');
    const changedPath = join(root, 'changed.txt');
    // Only two files in the auth clique are changed. Use CRLF plus one
    // backslash path to cover Windows git diff/path-list inputs.
    writeFileSync(changedPath, ['src\\auth\\login.ts', 'src/auth/tokens.ts'].join('\r\n'));

    const result = runScript(root, [`--changed-files=${changedPath}`]);
    expect(result.status).toBe(0);

    const out = readBatches(root);
    // Auth files are retained, but the unchanged auth file from the original
    // full-graph batch must not be analyzed in changed-files mode.
    const allPaths = out.batches.flatMap(b => b.files.map(f => f.path));
    expect(allPaths.sort()).toEqual(['src/auth/login.ts', 'src/auth/tokens.ts']);
    expect(allPaths).not.toContain('src/auth/session.ts');
    expect(allPaths).not.toContain('src/api/handlers.ts');
    expect(allPaths).not.toContain('src/db/users.ts');

    // neighborMap may still reference unchanged files (with their full-graph batchIndex)
    const loginBatch = out.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/login.ts'));
    expect(loginBatch).toBeDefined();
  });

  it('does not emit unchanged same-community files as analysis targets', () => {
    root = setupProject('scan-result-3-cliques.json');
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    writeFileSync(join(root, 'src', 'auth', 'login.ts'), 'export const login = true;\n');
    const changedPath = join(root, 'changed.txt');
    writeFileSync(changedPath, 'src/auth/login.ts\n');

    const result = runScript(root, [`--changed-files=${changedPath}`]);
    expect(result.status).toBe(0);

    const out = readBatches(root);
    expect(out.totalBatches).toBe(1);
    expect(out.batches).toHaveLength(1);

    const [batch] = out.batches;
    expect(batch.files.map(f => f.path)).toEqual(['src/auth/login.ts']);
    expect(Object.keys(batch.batchImportData)).toEqual(['src/auth/login.ts']);
    expect(batch.batchImportData['src/auth/login.ts'].sort()).toEqual([
      'src/auth/session.ts',
      'src/auth/tokens.ts',
    ]);
    expect((batch.neighborMap['src/auth/login.ts'] || []).map(n => n.path).sort()).toEqual([
      'src/auth/session.ts',
      'src/auth/tokens.ts',
    ]);
  });

  it('emits only changed files inside retained batches while preserving unchanged neighbor context', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cb-changed-nbr-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src', 'a'), { recursive: true });
    mkdirSync(join(root, 'src', 'b'), { recursive: true });

    writeFileSync(join(root, 'src', 'a', 'core.ts'),
      'export function findUser(id: string) { return null; }\nexport class User {}\n');
    writeFileSync(join(root, 'src', 'a', 'helper1.ts'),
      'import { findUser } from "./core";\nexport const h1 = () => findUser("x");\n');
    writeFileSync(join(root, 'src', 'a', 'helper2.ts'),
      'import { User } from "./core";\nimport { h1 } from "./helper1";\nexport const h2 = () => h1();\n');

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
      name: 'changed-neighbor-test', description: '',
      languages: ['typescript'], frameworks: [],
      files,
      totalFiles: 6, filteredByIgnore: 0, estimatedComplexity: 'small',
      importMap: {
        'src/a/core.ts': [],
        'src/a/helper1.ts': ['src/a/core.ts'],
        'src/a/helper2.ts': ['src/a/core.ts', 'src/a/helper1.ts'],
        'src/b/entry.ts': ['src/a/core.ts'],
        'src/b/middle.ts': ['src/b/entry.ts'],
        'src/b/leaf.ts': ['src/b/middle.ts'],
      },
    };
    writeFileSync(
      join(root, '.understand-anything', 'intermediate', 'scan-result.json'),
      JSON.stringify(scan));

    const changedPath = join(root, 'changed.txt');
    writeFileSync(changedPath, 'src/b/entry.ts\n');

    const result = runScript(root, [`--changed-files=${changedPath}`]);
    expect(result.status).toBe(0);

    const out = readBatches(root);
    expect(out.totalBatches).toBe(1);
    expect(out.batches).toHaveLength(1);

    const [batch] = out.batches;
    expect(batch.files.map(f => f.path)).toEqual(['src/b/entry.ts']);
    expect(Object.keys(batch.batchImportData)).toEqual(['src/b/entry.ts']);
    expect(Object.keys(batch.neighborMap)).toEqual(['src/b/entry.ts']);

    const neighbors = batch.neighborMap['src/b/entry.ts'];
    expect(neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'src/a/core.ts',
        symbols: expect.arrayContaining(['findUser', 'User']),
      }),
      expect.objectContaining({
        path: 'src/b/middle.ts',
        symbols: expect.arrayContaining(['middle']),
      }),
    ]));
    expect(neighbors.find(n => n.path === 'src/a/core.ts').batchIndex).not.toBe(batch.batchIndex);
    expect(neighbors.find(n => n.path === 'src/b/middle.ts').batchIndex).toBe(batch.batchIndex);
  });
});

describe('compute-batches.mjs — changed-file inventory refresh', () => {
  let project;
  const externalPaths = [];

  afterEach(() => {
    if (project?.root) rmSync(project.root, { recursive: true, force: true });
    for (const path of externalPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('refreshes stale inventory so a Windows-style added path enters the batch', () => {
    project = setupIncrementalProject({
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/added.ts': 'import { existing } from "./existing";\nexport const added = existing;\n',
      },
    });
    const changedPath = writeChangedList(project, ['src\\added.ts', '']);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/structural drift detected \(file added\); refreshing scan inventory/);
    expect(result.stderr).toMatch(/refresh-scan-result: files=2 added=1 removed=0 importEdges=1/);
    const scan = JSON.parse(readFileSync(project.scanPath, 'utf-8'));
    expect(scan.files.map(file => file.path)).toContain('src/added.ts');
    expect(scan.importMap['src/added.ts']).toEqual(['src/existing.ts']);
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual(['src/added.ts']);
    expect(out.batches.flatMap(batch => batch.files.map(file => file.path)))
      .toEqual(['src/added.ts']);
  });

  it('refreshes stale inventory so a deleted path is not batched', () => {
    project = setupIncrementalProject({
      inventoryPaths: ['src/existing.ts', 'src/deleted.ts'],
      diskFiles: { 'src/existing.ts': 'export const existing = true;\n' },
    });
    const changedPath = writeChangedList(project, ['src/deleted.ts']);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/structural drift detected \(file removed\); refreshing scan inventory/);
    const scan = JSON.parse(readFileSync(project.scanPath, 'utf-8'));
    expect(scan.files.map(file => file.path)).not.toContain('src/deleted.ts');
    expect(scan.importMap).not.toHaveProperty('src/deleted.ts');
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual(['src/deleted.ts']);
    expect(out.totalBatches).toBe(0);
    expect(out.batches).toEqual([]);
  });

  it('refreshes once for rename-old plus rename-new and analyzes only the new path', () => {
    project = setupIncrementalProject({
      inventoryPaths: ['src/existing.ts', 'src/original.ts'],
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/renamed.ts': 'export const renamed = true;\n',
      },
    });
    const changedPath = writeChangedList(project, ['src/original.ts', 'src/renamed.ts']);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    const scan = JSON.parse(readFileSync(project.scanPath, 'utf-8'));
    expect(scan.files.map(file => file.path).sort()).toEqual([
      'src/existing.ts',
      'src/renamed.ts',
    ]);
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual(['src/original.ts', 'src/renamed.ts']);
    expect(out.batches.flatMap(batch => batch.files.map(file => file.path)))
      .toEqual(['src/renamed.ts']);
  });

  it('keeps modified-only output deterministic without touching scan bytes or mtime', () => {
    project = setupIncrementalProject();
    const fixedTime = new Date('2024-01-02T03:04:05.000Z');
    utimesSync(project.scanPath, fixedTime, fixedTime);
    const beforeBytes = readFileSync(project.scanPath);
    const beforeMtime = statSync(project.scanPath).mtimeMs;
    const changedPath = writeChangedList(project, ['src/existing.ts']);

    const first = runScript(project.root, [`--changed-files=${changedPath}`]);
    const firstBatches = readFileSync(project.batchesPath, 'utf-8');
    const second = runScript(project.root, [`--changed-files=${changedPath}`]);
    const secondBatches = readFileSync(project.batchesPath, 'utf-8');

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stderr).not.toMatch(/refresh-scan-result:/);
    expect(second.stderr).not.toMatch(/refresh-scan-result:/);
    expect(secondBatches).toBe(firstBatches);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    expect(statSync(project.scanPath).mtimeMs).toBe(beforeMtime);
    const out = JSON.parse(secondBatches);
    expect(out.effectiveChangedFiles).toEqual(['src/existing.ts']);
  });

  it('does not refresh for an empty changed-file list', () => {
    project = setupIncrementalProject();
    const beforeBytes = readFileSync(project.scanPath);
    const beforeMtime = statSync(project.scanPath).mtimeMs;
    const changedPath = writeChangedList(project, []);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/refresh-scan-result:/);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    expect(statSync(project.scanPath).mtimeMs).toBe(beforeMtime);
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual([]);
    expect(out.totalBatches).toBe(0);
  });

  it('refreshes an added ignored path but finishes with zero analysis batches', () => {
    project = setupIncrementalProject({
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/ignored.ts': 'export const ignored = true;\n',
      },
    });
    writeFileSync(join(project.dataDir, '.understandignore'), 'src/ignored.ts\n');
    const changedPath = writeChangedList(project, ['src/ignored.ts']);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/refresh-scan-result:/);
    const scan = JSON.parse(readFileSync(project.scanPath, 'utf-8'));
    expect(scan.files.map(file => file.path)).not.toContain('src/ignored.ts');
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual(['src/ignored.ts']);
    expect(out.totalBatches).toBe(0);
  });

  it.each([
    ['root ignore file', '.understandignore'],
    ['active data-dir ignore file', '.understand-anything/.understandignore'],
  ])('forces deterministic refresh when the %s changes', (_label, ignorePath) => {
    project = setupIncrementalProject();
    const absoluteIgnorePath = join(project.root, ...ignorePath.split('/'));
    mkdirSync(dirname(absoluteIgnorePath), { recursive: true });
    writeFileSync(absoluteIgnorePath, '# changed ignore rules\n');
    const changedPath = writeChangedList(project, [ignorePath]);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/structural drift detected \(ignore rules changed\)/);
    expect(result.stderr).toMatch(/refresh-scan-result:/);
  });

  it.each([
    ['root ignore file', '.understandignore'],
    ['active data-dir ignore file', '.understand-anything/.understandignore'],
  ])('analyzes a file re-included by a changed %s', (_label, ignorePath) => {
    project = setupIncrementalProject({
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/hidden.ts': 'export const hidden = true;\n',
      },
    });
    const absoluteIgnorePath = join(project.root, ...ignorePath.split('/'));
    mkdirSync(dirname(absoluteIgnorePath), { recursive: true });
    writeFileSync(absoluteIgnorePath, '# src/hidden.ts is now re-included\n');
    const changedPath = writeChangedList(project, [ignorePath]);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    const scan = JSON.parse(readFileSync(project.scanPath, 'utf-8'));
    expect(scan.files.map(file => file.path)).toContain('src/hidden.ts');
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.batches.flatMap(batch => batch.files.map(file => file.path)))
      .toContain('src/hidden.ts');
    expect(out.effectiveChangedFiles).toEqual([ignorePath, 'src/hidden.ts'].sort());
  });

  it.each([
    ['root ignore file', '.understandignore'],
    ['active data-dir ignore file', '.understand-anything/.understandignore'],
  ])('exposes a file newly excluded by a changed %s for pruning', (_label, ignorePath) => {
    project = setupIncrementalProject({
      inventoryPaths: ['src/existing.ts', 'src/hidden.ts'],
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/hidden.ts': 'export const hidden = true;\n',
      },
    });
    const absoluteIgnorePath = join(project.root, ...ignorePath.split('/'));
    mkdirSync(dirname(absoluteIgnorePath), { recursive: true });
    writeFileSync(absoluteIgnorePath, 'src/hidden.ts\n');
    const changedPath = writeChangedList(project, [ignorePath]);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    const scan = JSON.parse(readFileSync(project.scanPath, 'utf-8'));
    expect(scan.files.map(file => file.path)).not.toContain('src/hidden.ts');
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual([ignorePath, 'src/hidden.ts'].sort());
    expect(out.batches.flatMap(batch => batch.files.map(file => file.path)))
      .not.toContain('src/hidden.ts');
  });

  it('does not refresh structural drift in full mode', () => {
    project = setupIncrementalProject({
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/added.ts': 'export const added = true;\n',
      },
    });
    const beforeBytes = readFileSync(project.scanPath);

    const result = runScript(project.root);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/refresh-scan-result:/);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.totalFiles).toBe(1);
    expect(out).not.toHaveProperty('effectiveChangedFiles');
  });

  it('fails closed without changing scan or writing batches when refresh fails', () => {
    project = setupIncrementalProject({
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        'src/added.ts': 'export const added = true;\n',
      },
    });
    const beforeBytes = readFileSync(project.scanPath);
    writeFileSync(join(project.dataDir, 'tmp'), 'blocks refresh temp directory\n');
    const changedDir = mkdtempSync(join(tmpdir(), 'ua-cb-changed-external-'));
    externalPaths.push(changedDir);
    const changedPath = join(changedDir, 'changed-files.txt');
    writeFileSync(changedPath, 'src/added.ts\n');

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refresh-scan-result\.mjs failed:/);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    expect(existsSync(project.batchesPath)).toBe(false);
  });

  it('rejects absolute, drive-relative, and parent traversal paths from drift detection', () => {
    project = setupIncrementalProject();
    const beforeBytes = readFileSync(project.scanPath);
    const changedPath = writeChangedList(project, [
      '../outside.ts',
      'C:\\outside.ts',
      '/absolute.ts',
      'src/../outside.ts',
    ]);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/refresh-scan-result:/);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    const out = JSON.parse(readFileSync(project.batchesPath, 'utf-8'));
    expect(out.effectiveChangedFiles).toEqual([]);
    expect(out.totalBatches).toBe(0);
  });

  it('fails closed before reading an inventoried path that resolves outside the project', () => {
    project = setupIncrementalProject({
      inventoryPaths: ['src/existing.ts', 'linked/outside.ts'],
    });
    const outsideDir = mkdtempSync(join(tmpdir(), 'ua-cb-outside-'));
    externalPaths.push(outsideDir);
    writeFileSync(join(outsideDir, 'outside.ts'), 'export const outside = true;\n');
    symlinkSync(outsideDir, join(project.root, 'linked'), 'junction');
    const beforeBytes = readFileSync(project.scanPath);
    const changedPath = writeChangedList(project, ['linked/outside.ts']);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/changed path resolves outside project root/);
    expect(result.stderr).not.toMatch(/refresh-scan-result:/);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    expect(existsSync(project.batchesPath)).toBe(false);
  });

  it.each([
    ['an added file', ['src/added.ts', 'linked/outside.ts'], true],
    ['an ignore-file change', ['.understandignore', 'linked/outside.ts'], false],
  ])('validates every changed path when %s appears before an outside junction', (
    _label,
    changedFiles,
    includeAddedFile,
  ) => {
    project = setupIncrementalProject({
      inventoryPaths: ['src/existing.ts', 'linked/outside.ts'],
      diskFiles: {
        'src/existing.ts': 'export const existing = true;\n',
        ...(includeAddedFile
          ? { 'src/added.ts': 'export const added = true;\n' }
          : {}),
      },
    });
    if (!includeAddedFile) {
      writeFileSync(join(project.root, '.understandignore'), '# changed ignore rules\n');
    }
    const outsideDir = mkdtempSync(join(tmpdir(), 'ua-cb-outside-late-'));
    externalPaths.push(outsideDir);
    writeFileSync(join(outsideDir, 'outside.ts'), 'export const outside = true;\n');
    symlinkSync(outsideDir, join(project.root, 'linked'), 'junction');
    const beforeBytes = readFileSync(project.scanPath);
    const changedPath = writeChangedList(project, changedFiles);

    const result = runScript(project.root, [`--changed-files=${changedPath}`]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/changed path resolves outside project root/);
    expect(result.stderr).not.toMatch(/refresh-scan-result:/);
    expect(readFileSync(project.scanPath)).toEqual(beforeBytes);
    expect(existsSync(project.batchesPath)).toBe(false);
  });

  it('fails closed when inspecting a changed path raises a non-missing stat error', () => {
    const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { isChangedPathFile } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
      const accessError = Object.assign(new Error('access denied'), { code: 'EACCES' });
      try {
        isChangedPathFile('not-disclosed', () => { throw accessError; });
        process.exitCode = 2;
      } catch (error) {
        process.stderr.write(error.message);
        process.exitCode = /changed path stat failed \\(EACCES\\)/.test(error.message) ? 0 : 1;
      }
    `], { encoding: 'utf-8' });

    expect(probe.status).toBe(0);
    expect(probe.stderr).toMatch(/changed path stat failed \(EACCES\)/);
  });

  it('does not disclose absolute paths when realpath inspection fails', () => {
    const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { resolveRealPathForContainment } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
      const realpathError = Object.assign(new Error('C:\\\\secret\\\\project'), { code: 'EIO' });
      try {
        resolveRealPathForContainment('C:\\\\secret\\\\project', 'changed path', () => {
          throw realpathError;
        });
        process.exitCode = 2;
      } catch (error) {
        process.stderr.write(error.message);
        process.exitCode = error.message === 'changed path realpath failed (EIO)' ? 0 : 1;
      }
    `], { encoding: 'utf-8' });

    expect(probe.status).toBe(0);
    expect(probe.stderr).toBe('changed path realpath failed (EIO)');
    expect(probe.stderr).not.toContain('secret');
  });
});

describe('compute-batches.mjs — data-dir resolution (.ua vs legacy)', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('fresh project reads scan-result from .ua/ and writes batches.json there', () => {
    root = setupProjectInDir('scan-result-3-cliques.json', '.ua');
    const result = runScript(root);
    expect(result.status).toBe(0);

    // Output landed in .ua/, and the legacy dir was never created.
    expect(existsSync(join(root, '.ua', 'intermediate', 'batches.json'))).toBe(true);
    expect(existsSync(join(root, '.understand-anything'))).toBe(false);

    const batches = JSON.parse(
      readFileSync(join(root, '.ua', 'intermediate', 'batches.json'), 'utf-8'),
    );
    expect(batches.totalFiles).toBe(9);
    expect(batches.batches.length).toBe(3);
  });

  it('legacy project keeps using .understand-anything/ (no migration)', () => {
    // Legacy-compat regression: an existing .understand-anything/ dir wins for
    // both read and write even though .ua/ is the new default.
    root = setupProjectInDir('scan-result-3-cliques.json', '.understand-anything');
    const result = runScript(root);
    expect(result.status).toBe(0);

    expect(existsSync(join(root, '.understand-anything', 'intermediate', 'batches.json'))).toBe(true);
    expect(existsSync(join(root, '.ua'))).toBe(false);
  });

  it('legacy dir wins when both .understand-anything/ and .ua/ exist', () => {
    root = setupProjectInDir('scan-result-3-cliques.json', '.understand-anything');
    // A stray empty .ua/ must not divert reads/writes away from the legacy dir.
    mkdirSync(join(root, '.ua', 'intermediate'), { recursive: true });

    const result = runScript(root);
    expect(result.status).toBe(0);

    expect(existsSync(join(root, '.understand-anything', 'intermediate', 'batches.json'))).toBe(true);
    expect(existsSync(join(root, '.ua', 'intermediate', 'batches.json'))).toBe(false);
  });
});

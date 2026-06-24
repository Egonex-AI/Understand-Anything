# Semantic Batching and Output Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All dispatched subagents must use `model="opus"`** (project convention).

**Goal:** Replace count-based file-analyzer batching with Louvain semantic batching (Phase 1.5), and add defensive output chunking in file-analyzer (60 nodes / 120 edges per part), so `/understand` stops hitting Bedrock OPUS output caps and produces better cross-batch semantic edge coverage. One PR.

**Architecture:** Add `compute-batches.mjs` (Phase 1.5) which runs Louvain on the import graph from `scan-result.json` and writes `batches.json` containing pre-built `batchImportData` + `neighborMap` (paths + exported symbols). file-analyzer reads neighborMap to confidently emit cross-batch edges, and self-splits its output into `batch-<i>-part-<k>.json` when above thresholds. `merge-batch-graphs.py` glob already accepts multi-part naming (no code change, only stderr report + missing-part warning).

**Tech Stack:** Node.js ≥22 + pnpm ≥10, `graphology` + `graphology-communities-louvain` (new deps), `@understand-anything/core` TreeSitterPlugin (existing), Vitest for `.mjs` tests, Python `unittest` for `merge-batch-graphs.py` tests.

**Source spec:** [`docs/superpowers/specs/2026-05-24-semantic-batching-and-output-chunking-design.md`](../specs/2026-05-24-semantic-batching-and-output-chunking-design.md)

**Branch:** `feat/semantic-batching-and-output-chunking` (already created).

---

## File Structure

**Create:**

- `understand-anything-plugin/skills/understand/compute-batches.mjs` — Phase 1.5 script
- `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs` — Vitest unit tests
- `understand-anything-plugin/skills/understand/test/fixtures/scan-result-3-cliques.json` — synthetic test fixture (3 disjoint import cliques)
- `understand-anything-plugin/skills/understand/test/fixtures/scan-result-large-community.json` — synthetic test fixture (50-node complete graph)
- `understand-anything-plugin/skills/understand/test/fixtures/scan-result-non-code.json` — synthetic test fixture (Dockerfile/CI/SQL groups)

**Modify:**

- `understand-anything-plugin/package.json` — add `graphology` + `graphology-communities-louvain` to `dependencies`
- `understand-anything-plugin/skills/understand/SKILL.md` — insert Phase 1.5; replace Phase 2 ANALYZE batching prose; replace Incremental update path
- `understand-anything-plugin/agents/file-analyzer.md` — add Cross-batch context (neighborMap) section; replace Writing Results with multi-part protocol
- `understand-anything-plugin/skills/understand/merge-batch-graphs.py` — multi-part stderr summary + missing-part warning
- `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py` — new `TestMultiPart` class
- `understand-anything-plugin/package.json`, `understand-anything-plugin/.claude-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.copilot-plugin/plugin.json` — version bump (Task 16)

---

## Task 1: Add graphology dependencies

**Files:**
- Modify: `understand-anything-plugin/package.json`

- [ ] **Step 1: Add deps to package.json**

Edit `understand-anything-plugin/package.json` `dependencies` block:

```json
{
  "name": "@understand-anything/skill",
  "version": "2.7.4",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@understand-anything/core": "workspace:*",
    "graphology": "^0.26.0",
    "graphology-communities-louvain": "^2.0.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Install**

Run from repo root:
```bash
pnpm install
```
Expected: lockfile updates with graphology + graphology-communities-louvain; no other version churn.

- [ ] **Step 3: Smoke test the imports work**

Run from `understand-anything-plugin/`:
```bash
node -e "import('graphology').then(m => { const G = m.default; const g = new G({type:'undirected'}); g.addNode('a'); g.addNode('b'); g.addEdge('a','b'); console.log('graphology ok, edges:', g.size); })"
node -e "Promise.all([import('graphology'), import('graphology-communities-louvain')]).then(([G,L]) => { const g = new G.default({type:'undirected'}); ['a','b','c'].forEach(n => g.addNode(n)); g.addEdge('a','b'); g.addEdge('b','c'); console.log('louvain ok:', JSON.stringify(L.default(g))); })"
```
Expected: prints `graphology ok, edges: 1` and `louvain ok: {...}` with community ids assigned.

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/package.json pnpm-lock.yaml
git commit -m "deps: add graphology + graphology-communities-louvain"
```

---

## Task 2: Prototype compute-batches.mjs (load + Louvain print)

This is the **feasibility prototype** — the spec gates the size-enforcement design on what real community sizes look like. Build the skeleton, then run it against a synthetic fixture (and optionally a real `scan-result.json` from this repo if one exists) before adding more code.

**Files:**
- Create: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Create: `understand-anything-plugin/skills/understand/test/fixtures/scan-result-3-cliques.json`

- [ ] **Step 1: Create test fixture (3 disjoint import cliques)**

Create `understand-anything-plugin/skills/understand/test/fixtures/scan-result-3-cliques.json`:

```json
{
  "name": "fixture-3-cliques",
  "description": "Three disjoint import cliques for Louvain testing",
  "languages": ["typescript"],
  "frameworks": [],
  "files": [
    {"path": "src/auth/login.ts", "language": "typescript", "sizeLines": 50, "fileCategory": "code"},
    {"path": "src/auth/session.ts", "language": "typescript", "sizeLines": 40, "fileCategory": "code"},
    {"path": "src/auth/tokens.ts", "language": "typescript", "sizeLines": 60, "fileCategory": "code"},
    {"path": "src/api/handlers.ts", "language": "typescript", "sizeLines": 80, "fileCategory": "code"},
    {"path": "src/api/middleware.ts", "language": "typescript", "sizeLines": 30, "fileCategory": "code"},
    {"path": "src/api/routes.ts", "language": "typescript", "sizeLines": 45, "fileCategory": "code"},
    {"path": "src/db/users.ts", "language": "typescript", "sizeLines": 70, "fileCategory": "code"},
    {"path": "src/db/queries.ts", "language": "typescript", "sizeLines": 55, "fileCategory": "code"},
    {"path": "src/db/migrations.ts", "language": "typescript", "sizeLines": 35, "fileCategory": "code"}
  ],
  "totalFiles": 9,
  "filteredByIgnore": 0,
  "estimatedComplexity": "small",
  "importMap": {
    "src/auth/login.ts": ["src/auth/session.ts", "src/auth/tokens.ts"],
    "src/auth/session.ts": ["src/auth/tokens.ts"],
    "src/auth/tokens.ts": [],
    "src/api/handlers.ts": ["src/api/middleware.ts", "src/api/routes.ts"],
    "src/api/middleware.ts": ["src/api/routes.ts"],
    "src/api/routes.ts": [],
    "src/db/users.ts": ["src/db/queries.ts", "src/db/migrations.ts"],
    "src/db/queries.ts": ["src/db/migrations.ts"],
    "src/db/migrations.ts": []
  }
}
```

- [ ] **Step 2: Write skeleton compute-batches.mjs (Louvain only, no neighborMap, no exports, no fallback)**

Create `understand-anything-plugin/skills/understand/compute-batches.mjs`:

```javascript
#!/usr/bin/env node
/**
 * compute-batches.mjs — Phase 1.5 of /understand
 *
 * Reads scan-result.json, runs Louvain community detection on the import
 * graph, and writes batches.json containing batches + neighborMap.
 *
 * Usage:
 *   node compute-batches.mjs <project-root> [--changed-files=<path>]
 *
 * Input:  <project-root>/.understand-anything/intermediate/scan-result.json
 * Output: <project-root>/.understand-anything/intermediate/batches.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

// ── Skeleton main: load → Louvain → print sizes ───────────────────────────
async function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write('Usage: node compute-batches.mjs <project-root> [--changed-files=<path>]\n');
    process.exit(1);
  }

  const scanPath = join(projectRoot, '.understand-anything', 'intermediate', 'scan-result.json');
  if (!existsSync(scanPath)) {
    process.stderr.write(`Error: scan-result.json not found at ${scanPath}\n`);
    process.exit(1);
  }

  const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
  const codeFiles = (scan.files || []).filter(f => f.fileCategory === 'code');
  const importMap = scan.importMap || {};

  process.stderr.write(`Loaded ${scan.files.length} files (${codeFiles.length} code).\n`);

  // Build undirected import graph
  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const f of codeFiles) g.addNode(f.path);
  for (const [src, targets] of Object.entries(importMap)) {
    if (!g.hasNode(src)) continue;
    for (const tgt of targets) {
      if (!g.hasNode(tgt) || src === tgt || g.hasEdge(src, tgt)) continue;
      g.addEdge(src, tgt);
    }
  }

  // Run Louvain
  const communities = louvain(g);  // { nodeId: communityId }

  // Print size distribution
  const sizeByCommunity = new Map();
  for (const [, cid] of Object.entries(communities)) {
    sizeByCommunity.set(cid, (sizeByCommunity.get(cid) || 0) + 1);
  }
  const sizes = [...sizeByCommunity.values()].sort((a, b) => b - a);
  process.stderr.write(
    `Louvain produced ${sizes.length} communities. Size distribution: [${sizes.join(', ')}]\n`,
  );
  process.stderr.write(
    `Max community size: ${sizes[0] ?? 0}, min: ${sizes.at(-1) ?? 0}, ` +
    `>35: ${sizes.filter(s => s > 35).length}, <5: ${sizes.filter(s => s < 5).length}\n`,
  );
}

// CLI entry guard (mirrors extract-structure.mjs pattern)
import { realpathSync } from 'node:fs';
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`compute-batches.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Run skeleton against the fixture**

Create a temporary scratch directory with the fixture in the expected layout:

```bash
mkdir -p /tmp/ua-prototype/.understand-anything/intermediate
cp understand-anything-plugin/skills/understand/test/fixtures/scan-result-3-cliques.json \
   /tmp/ua-prototype/.understand-anything/intermediate/scan-result.json
node understand-anything-plugin/skills/understand/compute-batches.mjs /tmp/ua-prototype
```

Expected stderr:
```
Loaded 9 files (9 code).
Louvain produced 3 communities. Size distribution: [3, 3, 3]
Max community size: 3, min: 3, >35: 0, <5: 3
```

(All 9 files split into 3 cliques of 3. All under min=5 — that's expected for the fixture; in the real plan we accept this and don't merge.)

- [ ] **Step 4: (Optional) Run against this repo's scan-result.json if it exists**

```bash
if [ -f .understand-anything/intermediate/scan-result.json ]; then
  node understand-anything-plugin/skills/understand/compute-batches.mjs "$(pwd)"
else
  echo "No real scan-result.json — skipping (fixture run is sufficient for prototype)."
fi
```

Record the output: if the real-repo run shows any community size > 35, implement edge-betweenness split in Task 4. Otherwise, Task 4 can be a minimal defensive WCC partition.

- [ ] **Step 5: Commit skeleton**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test/fixtures/scan-result-3-cliques.json
git commit -m "feat(compute-batches): skeleton — Louvain on import graph (prototype)"
```

---

## Task 3: Write Vitest harness + first Louvain unit test

**Files:**
- Create: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`

- [ ] **Step 1: Write failing test (Louvain produces 3 batches for 3 cliques)**

Create `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
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

  it('produces 3 batches for 3 disjoint cliques', () => {
    const result = runScript(projectRoot);
    expect(result.status).toBe(0);

    const batches = readBatches(projectRoot);
    expect(batches.algorithm).toBe('louvain');
    expect(batches.totalFiles).toBe(9);
    expect(batches.batches.length).toBe(3);

    // Each batch should contain exactly one clique (3 files)
    for (const b of batches.batches) {
      expect(b.files.length).toBe(3);
      const dirs = new Set(b.files.map(f => f.path.split('/')[1]));
      expect(dirs.size).toBe(1); // all files in the batch share src/<dir>/
    }
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "Louvain basic"
```

Expected: FAIL — `compute-batches.mjs` skeleton from Task 2 only prints to stderr, doesn't write `batches.json`. Test fails on `readBatches` → ENOENT.

- [ ] **Step 3: Make skeleton write batches.json**

Replace the trailing `process.stderr.write(...)` lines in `compute-batches.mjs` `main()` with the full minimal-batches output. Replace lines starting from `// Print size distribution` to end of `main()`:

```javascript
  // Group files by community id, sorted by largest first for stable assignment
  const filesByCommunity = new Map();
  for (const [path, cid] of Object.entries(communities)) {
    if (!filesByCommunity.has(cid)) filesByCommunity.set(cid, []);
    filesByCommunity.get(cid).push(path);
  }

  // Sort communities by size desc, then by min-path asc for determinism
  const sortedCommunities = [...filesByCommunity.entries()]
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      const minA = [...a[1]].sort()[0];
      const minB = [...b[1]].sort()[0];
      return minA.localeCompare(minB);
    });

  // Build per-batch file list with full file metadata from scan
  const fileMetaByPath = new Map(scan.files.map(f => [f.path, f]));
  const batches = sortedCommunities.map(([, paths], idx) => ({
    batchIndex: idx + 1,
    files: paths.sort().map(p => fileMetaByPath.get(p)),
    batchImportData: {},
    neighborMap: {},
  }));

  const output = {
    schemaVersion: 1,
    algorithm: 'louvain',
    totalFiles: scan.files.length,
    totalBatches: batches.length,
    batches,
  };

  const outPath = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  process.stderr.write(`Wrote ${batches.length} batches to ${outPath}\n`);
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "Louvain basic"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs
git commit -m "feat(compute-batches): emit batches.json with code communities"
```

---

## Task 4: Size enforcement — split oversized communities

If the Task 2 prototype run showed any community > 35 files, implement edge-betweenness split. Otherwise, implement a minimal weakly-connected-component (WCC) split as a defensive guard.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Modify: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`
- Create: `understand-anything-plugin/skills/understand/test/fixtures/scan-result-large-community.json`

- [ ] **Step 1: Create large-community fixture (40-node complete graph in one community)**

Create `understand-anything-plugin/skills/understand/test/fixtures/scan-result-large-community.json`. Build programmatically once and commit the JSON:

```bash
node -e "
const files = [];
const importMap = {};
for (let i = 0; i < 40; i++) {
  const p = 'src/big/f' + i + '.ts';
  files.push({ path: p, language: 'typescript', sizeLines: 50, fileCategory: 'code' });
  importMap[p] = [];
  // Every file imports every other — guarantees a single community of 40
  for (let j = 0; j < 40; j++) if (i !== j) importMap[p].push('src/big/f' + j + '.ts');
}
const out = {
  name: 'fixture-large-community',
  description: '40 files all importing each other — one community over the max=35 cap',
  languages: ['typescript'],
  frameworks: [],
  files,
  totalFiles: 40,
  filteredByIgnore: 0,
  estimatedComplexity: 'moderate',
  importMap,
};
console.log(JSON.stringify(out, null, 2));
" > understand-anything-plugin/skills/understand/test/fixtures/scan-result-large-community.json
```

- [ ] **Step 2: Write failing test (large community splits to ≤ 35)**

Append to `test_compute_batches.test.mjs`:

```javascript
describe('compute-batches.mjs — size enforcement', () => {
  it('splits a 40-node clique into batches ≤ 35', () => {
    const root = setupProject('scan-result-large-community.json');
    const result = runScript(root);
    expect(result.status).toBe(0);

    const batches = readBatches(root);
    expect(batches.totalFiles).toBe(40);
    for (const b of batches.batches) {
      expect(b.files.length).toBeLessThanOrEqual(35);
    }
    // Sum of all batch file counts equals total files
    const sum = batches.batches.reduce((acc, b) => acc + b.files.length, 0);
    expect(sum).toBe(40);
    // Warning was emitted to stderr
    expect(result.stderr).toMatch(/Warning: compute-batches: community size 40 > max 35/);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "size enforcement"
```

Expected: FAIL — at least one batch has 40 files; no warning emitted.

- [ ] **Step 4: Implement WCC-style split + warning**

In `compute-batches.mjs`, after the `const communities = louvain(g);` line and before grouping by community, insert size-enforcement logic. Replace the existing grouping block with:

```javascript
  // Group files by community id
  const filesByCommunity = new Map();
  for (const [path, cid] of Object.entries(communities)) {
    if (!filesByCommunity.has(cid)) filesByCommunity.set(cid, []);
    filesByCommunity.get(cid).push(path);
  }

  // Size enforcement: split any community > MAX_COMMUNITY_SIZE.
  // Strategy: deterministic alphabetical chunking within the oversize community.
  // Edge-betweenness would be more modularity-aware but adds dependency surface;
  // alphabetical chunking is deterministic, locality-preserving for co-located
  // files, and bounded by the cap. Each sub-community gets a fresh synthetic id.
  const MAX_COMMUNITY_SIZE = 35;
  const splitCommunities = new Map();
  let nextSyntheticId = 0;
  for (const [cid, paths] of filesByCommunity) {
    if (paths.length <= MAX_COMMUNITY_SIZE) {
      splitCommunities.set(cid, paths);
      continue;
    }
    process.stderr.write(
      `Warning: compute-batches: community size ${paths.length} > max ${MAX_COMMUNITY_SIZE} ` +
      `— splitting via alphabetical chunking — modularity may decrease\n`,
    );
    const sorted = [...paths].sort();
    const parts = Math.ceil(paths.length / MAX_COMMUNITY_SIZE);
    const perPart = Math.ceil(paths.length / parts);
    for (let i = 0; i < parts; i++) {
      const slice = sorted.slice(i * perPart, (i + 1) * perPart);
      const synthId = `__split_${cid}_${nextSyntheticId++}`;
      splitCommunities.set(synthId, slice);
    }
  }
```

Then update the `sortedCommunities` line to use `splitCommunities` instead of `filesByCommunity`:

```javascript
  const sortedCommunities = [...splitCommunities.entries()]
```

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "size enforcement"
```

Expected: PASS — 40 files split into 2 batches of 20 each, warning emitted.

- [ ] **Step 6: Run prior test too, expect still PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs \
        understand-anything-plugin/skills/understand/test/fixtures/scan-result-large-community.json
git commit -m "feat(compute-batches): split communities > 35 with visible warning"
```

---

## Task 5: Exports extraction via TreeSitterPlugin

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Modify: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`

- [ ] **Step 1: Write failing test (exports populated on real TS files)**

Add a fixture-on-disk test that writes real source files and points the fixture at them. Append to `test_compute_batches.test.mjs`:

```javascript
describe('compute-batches.mjs — exports extraction', () => {
  it('populates exports for code files via tree-sitter', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-cb-exp-'));
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
    // batches.json doesn't directly store exports — they live in neighborMap.
    // For this test, dig into the script's internal exports map by re-reading
    // it. Add an `exportsByPath` debug field to batches.json output (see impl).
    expect(batches.exportsByPath).toBeDefined();
    expect(batches.exportsByPath['src/a.ts']).toEqual(
      expect.arrayContaining(['greet', 'Greeter']));
    expect(batches.exportsByPath['src/b.ts']).toEqual(
      expect.arrayContaining(['helper']));
  });
});
```

(The `exportsByPath` debug field is a temporary affordance that we keep so future tasks can inspect exports without going through neighborMap. It's emitted in the script output but not consumed by Phase 2 — it's a side-channel for testing and observability.)

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "exports extraction"
```

Expected: FAIL — `batches.exportsByPath` is undefined.

- [ ] **Step 3: Add TreeSitterPlugin loader + exports loop**

In `compute-batches.mjs`, add core import dance at top of the file (after existing imports):

```javascript
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '../..');
const require = createRequire(resolve(PLUGIN_ROOT, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(PLUGIN_ROOT, 'packages/core/dist/index.js')).href);
}
const { TreeSitterPlugin, PluginRegistry, builtinLanguageConfigs, registerAllParsers } = core;
```

Then add an `extractExports(projectRoot, codeFiles)` function before `main()`:

```javascript
/**
 * For each code file, returns its top-level exported symbol names (functions,
 * classes, exported consts). Per-file errors are swallowed into [] with a
 * visible warning so a single bad file does not abort batching.
 *
 * Returns Map<path, string[]>.
 */
async function extractExports(projectRoot, codeFiles) {
  const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();
  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  const exportsByPath = new Map();
  for (const file of codeFiles) {
    const abs = join(projectRoot, file.path);
    let content;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: compute-batches: exports extraction failed for ${file.path} ` +
        `(read error: ${err.message}) — symbols=[] in neighborMap — ` +
        `cross-batch edges to this file limited to file-level\n`,
      );
      exportsByPath.set(file.path, []);
      continue;
    }
    try {
      const analysis = registry.analyzeFile(file.path, content);
      const names = (analysis?.exports || []).map(e => e.name).filter(Boolean);
      exportsByPath.set(file.path, names);
    } catch (err) {
      process.stderr.write(
        `Warning: compute-batches: exports extraction failed for ${file.path} ` +
        `(${err.message}) — symbols=[] in neighborMap — ` +
        `cross-batch edges to this file limited to file-level\n`,
      );
      exportsByPath.set(file.path, []);
    }
  }
  return exportsByPath;
}
```

In `main()`, after building `codeFiles` and before Louvain, call:

```javascript
  const exportsByPath = await extractExports(projectRoot, codeFiles);
```

In the output object, attach the debug field:

```javascript
  const output = {
    schemaVersion: 1,
    algorithm: 'louvain',
    totalFiles: scan.files.length,
    totalBatches: batches.length,
    exportsByPath: Object.fromEntries(exportsByPath),
    batches,
  };
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "exports extraction"
```

Expected: PASS.

- [ ] **Step 5: Run all tests, expect still PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs
git commit -m "feat(compute-batches): extract top-level exports via TreeSitter, warn on failure"
```

---

## Task 6: Non-code batching (Groups A-E)

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Modify: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`
- Create: `understand-anything-plugin/skills/understand/test/fixtures/scan-result-non-code.json`

- [ ] **Step 1: Create non-code fixture**

Create `understand-anything-plugin/skills/understand/test/fixtures/scan-result-non-code.json`:

```json
{
  "name": "fixture-non-code",
  "description": "Mix of non-code files exercising Groups A-E",
  "languages": ["typescript", "dockerfile", "yaml", "sql", "markdown"],
  "frameworks": [],
  "files": [
    {"path": "src/index.ts", "language": "typescript", "sizeLines": 10, "fileCategory": "code"},
    {"path": "Dockerfile", "language": "dockerfile", "sizeLines": 20, "fileCategory": "infra"},
    {"path": "docker-compose.yml", "language": "yaml", "sizeLines": 15, "fileCategory": "infra"},
    {"path": ".dockerignore", "language": "config", "sizeLines": 5, "fileCategory": "config"},
    {"path": "services/api/Dockerfile", "language": "dockerfile", "sizeLines": 18, "fileCategory": "infra"},
    {"path": "services/api/docker-compose.yml", "language": "yaml", "sizeLines": 12, "fileCategory": "infra"},
    {"path": ".github/workflows/ci.yml", "language": "yaml", "sizeLines": 30, "fileCategory": "infra"},
    {"path": ".github/workflows/deploy.yml", "language": "yaml", "sizeLines": 25, "fileCategory": "infra"},
    {"path": "migrations/001_init.sql", "language": "sql", "sizeLines": 40, "fileCategory": "data"},
    {"path": "migrations/002_users.sql", "language": "sql", "sizeLines": 20, "fileCategory": "data"},
    {"path": "docs/getting-started.md", "language": "markdown", "sizeLines": 100, "fileCategory": "docs"},
    {"path": "README.md", "language": "markdown", "sizeLines": 200, "fileCategory": "docs"}
  ],
  "totalFiles": 12,
  "filteredByIgnore": 0,
  "estimatedComplexity": "small",
  "importMap": {
    "src/index.ts": [],
    "Dockerfile": [], "docker-compose.yml": [], ".dockerignore": [],
    "services/api/Dockerfile": [], "services/api/docker-compose.yml": [],
    ".github/workflows/ci.yml": [], ".github/workflows/deploy.yml": [],
    "migrations/001_init.sql": [], "migrations/002_users.sql": [],
    "docs/getting-started.md": [], "README.md": []
  }
}
```

- [ ] **Step 2: Write failing tests for each non-code group**

Append to `test_compute_batches.test.mjs`:

```javascript
describe('compute-batches.mjs — non-code grouping', () => {
  let root;
  let batches;

  beforeEach(() => {
    root = setupProject('scan-result-non-code.json');
    const result = runScript(root);
    expect(result.status).toBe(0);
    batches = readBatches(root);
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
```

- [ ] **Step 3: Run tests, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "non-code grouping"
```

Expected: FAIL on all four (non-code files currently end up nowhere — they're not in `codeFiles`, not in any batch).

- [ ] **Step 4: Implement non-code grouping**

In `compute-batches.mjs`, add a `buildNonCodeBatches(nonCodeFiles, startIndex)` function before `main()`:

```javascript
/**
 * Build batches for non-code files per Groups A-E in the design spec.
 * Returns Array<{ files: FileMeta[] }> (without batchIndex — caller assigns).
 */
function buildNonCodeBatches(nonCodeFiles) {
  const byPath = new Map(nonCodeFiles.map(f => [f.path, f]));
  const consumed = new Set();
  const groups = [];

  const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const baseOf = p => p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;

  // Group A: per-directory Dockerfile clusters.
  const dirsWithDockerfile = new Set(
    [...byPath.keys()]
      .filter(p => baseOf(p) === 'Dockerfile')
      .map(dirOf),
  );
  for (const dir of dirsWithDockerfile) {
    const inDir = [...byPath.keys()].filter(p => dirOf(p) === dir);
    const cluster = inDir.filter(p => {
      const b = baseOf(p);
      return b === 'Dockerfile'
        || b === '.dockerignore'
        || b.startsWith('docker-compose.');
    });
    if (cluster.length) {
      groups.push({ files: cluster.map(p => byPath.get(p)) });
      cluster.forEach(p => consumed.add(p));
    }
  }

  // Group B: .github/workflows/*
  const ghWorkflows = [...byPath.keys()].filter(
    p => p.startsWith('.github/workflows/') && (p.endsWith('.yml') || p.endsWith('.yaml')),
  ).filter(p => !consumed.has(p));
  if (ghWorkflows.length) {
    groups.push({ files: ghWorkflows.map(p => byPath.get(p)) });
    ghWorkflows.forEach(p => consumed.add(p));
  }

  // Group C: .gitlab-ci.yml + .circleci/*
  const ciFiles = [...byPath.keys()].filter(
    p => (p === '.gitlab-ci.yml' || p.startsWith('.circleci/'))
      && !consumed.has(p),
  );
  if (ciFiles.length) {
    groups.push({ files: ciFiles.map(p => byPath.get(p)) });
    ciFiles.forEach(p => consumed.add(p));
  }

  // Group D: SQL migrations per migrations/ or migration/ directory
  const migrationDirs = new Set(
    [...byPath.keys()]
      .filter(p => p.endsWith('.sql'))
      .map(dirOf)
      .filter(d => /(^|\/)migrations?$/.test(d)),
  );
  for (const dir of migrationDirs) {
    const sqls = [...byPath.keys()]
      .filter(p => dirOf(p) === dir && p.endsWith('.sql') && !consumed.has(p))
      .sort();
    if (sqls.length) {
      groups.push({ files: sqls.map(p => byPath.get(p)) });
      sqls.forEach(p => consumed.add(p));
    }
  }

  // Group E: all remaining grouped by immediate parent dir, max 20 per batch
  const remainingByDir = new Map();
  for (const p of [...byPath.keys()].sort()) {
    if (consumed.has(p)) continue;
    const dir = dirOf(p);
    if (!remainingByDir.has(dir)) remainingByDir.set(dir, []);
    remainingByDir.get(dir).push(p);
  }
  const MAX_E = 20;
  for (const [, paths] of remainingByDir) {
    for (let i = 0; i < paths.length; i += MAX_E) {
      const slice = paths.slice(i, i + MAX_E);
      groups.push({ files: slice.map(p => byPath.get(p)) });
    }
  }

  return groups;
}
```

In `main()`, after `const codeFiles = ...` add:

```javascript
  const nonCodeFiles = (scan.files || []).filter(f => f.fileCategory !== 'code');
```

After the `sortedCommunities`/batches construction for code, build non-code batches and append:

```javascript
  // Assign code batchIndex first
  const codeBatchObjs = sortedCommunities.map(([, paths], idx) => ({
    batchIndex: idx + 1,
    files: paths.sort().map(p => fileMetaByPath.get(p)),
    batchImportData: {},
    neighborMap: {},
  }));

  // Append non-code batches after code
  const nonCodeGroups = buildNonCodeBatches(nonCodeFiles);
  const nonCodeBatchObjs = nonCodeGroups.map((g, i) => ({
    batchIndex: codeBatchObjs.length + i + 1,
    files: g.files,
    batchImportData: {},
    neighborMap: {},
  }));

  const batches = [...codeBatchObjs, ...nonCodeBatchObjs];
```

(Remove the old `const batches = sortedCommunities.map(...)` line — it's been replaced.)

- [ ] **Step 5: Run tests, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs \
        understand-anything-plugin/skills/understand/test/fixtures/scan-result-non-code.json
git commit -m "feat(compute-batches): non-code grouping Groups A-E"
```

---

## Task 7: batchImportData + neighborMap

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Modify: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`

- [ ] **Step 1: Write failing tests (batchImportData populated, neighborMap correct, excludes same-batch)**

Append to `test_compute_batches.test.mjs`:

```javascript
describe('compute-batches.mjs — neighborMap + batchImportData', () => {
  let batches;
  let batchOf;  // path → batchIndex

  beforeEach(() => {
    const root = setupProject('scan-result-3-cliques.json');
    const result = runScript(root);
    expect(result.status).toBe(0);
    batches = readBatches(root);
    batchOf = new Map();
    for (const b of batches.batches) {
      for (const f of b.files) batchOf.set(f.path, b.batchIndex);
    }
  });

  it('batchImportData mirrors scan importMap per batch', () => {
    for (const b of batches.batches) {
      for (const f of b.files) {
        expect(b.batchImportData[f.path]).toBeDefined();
        // each file's batchImportData should be an array (possibly empty)
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
      for (const [file, neighbors] of Object.entries(b.neighborMap)) {
        for (const n of neighbors) {
          expect(sameBatchPaths.has(n.path)).toBe(false);
        }
      }
    }
  });

  it('neighborMap entries carry symbols when target has exports', () => {
    // For a custom case where two cliques cross-import each other, ensure
    // the neighborMap entry includes the target's exported symbol names.
    // Build a custom fixture inline.
    const root = mkdtempSync(join(tmpdir(), 'ua-cb-nbr-'));
    mkdirSync(join(root, '.understand-anything', 'intermediate'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'),
      'export function findUser(id: string) { return null; }\nexport class User {}\n');
    writeFileSync(join(root, 'src', 'b.ts'),
      'import { findUser } from "./a";\nexport const wrap = () => findUser("x");\n');
    // To force a/b into different batches, add a third unrelated clique that
    // dominates one community; here we just rely on small graph behavior.
    const scan = {
      name: 't', description: '',
      languages: ['typescript'], frameworks: [],
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
    const out = readBatches(root);
    // If Louvain puts a and b in the same community, this test is degenerate.
    // We just assert: for every cross-batch neighbor entry that points to a.ts,
    // the symbols list includes findUser and User.
    for (const b of out.batches) {
      for (const [, neighbors] of Object.entries(b.neighborMap)) {
        for (const n of neighbors) {
          if (n.path === 'src/a.ts') {
            expect(n.symbols).toEqual(expect.arrayContaining(['findUser', 'User']));
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "neighborMap"
```

Expected: FAIL — `batchImportData` and `neighborMap` are currently empty `{}` on every batch.

- [ ] **Step 3: Implement batchImportData + neighborMap construction**

In `compute-batches.mjs`, before the final `output = {...}` write, add a populate step. Replace the `codeBatchObjs` + `nonCodeBatchObjs` construction with the following:

```javascript
  // Helper: lookup batchIndex by path (any batch — code or non-code)
  // Build it after we know batch assignments.
  function buildBatchOfMap(allBatches) {
    const m = new Map();
    for (const b of allBatches) {
      for (const f of b.files) m.set(f.path, b.batchIndex);
    }
    return m;
  }

  // First-pass: assemble files-only batches
  const codeBatchObjsBare = sortedCommunities.map(([, paths], idx) => ({
    batchIndex: idx + 1,
    files: paths.sort().map(p => fileMetaByPath.get(p)),
  }));
  const nonCodeGroups = buildNonCodeBatches(nonCodeFiles);
  const nonCodeBatchObjsBare = nonCodeGroups.map((g, i) => ({
    batchIndex: codeBatchObjsBare.length + i + 1,
    files: g.files,
  }));
  const bareBatches = [...codeBatchObjsBare, ...nonCodeBatchObjsBare];
  const batchOf = buildBatchOfMap(bareBatches);

  // Build reverse import map: target → [sources that import target]
  const reverseImportMap = new Map();
  for (const [src, targets] of Object.entries(importMap)) {
    for (const tgt of targets) {
      if (!reverseImportMap.has(tgt)) reverseImportMap.set(tgt, []);
      reverseImportMap.get(tgt).push(src);
    }
  }

  // Compute neighbor degree (number of import relations) per path, used for
  // truncation when neighborMap[file] has > MAX_NEIGHBORS entries.
  const NEIGHBOR_DEGREE = new Map();
  for (const f of codeFiles) {
    const outDeg = (importMap[f.path] || []).length;
    const inDeg = (reverseImportMap.get(f.path) || []).length;
    NEIGHBOR_DEGREE.set(f.path, outDeg + inDeg);
  }

  const MAX_NEIGHBORS = 50;

  // Second-pass: enrich each batch with batchImportData + neighborMap
  const batches = bareBatches.map(b => {
    const batchPaths = new Set(b.files.map(f => f.path));
    const batchImportData = {};
    const neighborMap = {};
    for (const f of b.files) {
      batchImportData[f.path] = (importMap[f.path] || []).slice();

      // 1-hop neighbors: imports out + imported-by in, excluding same batch.
      const outNeighbors = importMap[f.path] || [];
      const inNeighbors = reverseImportMap.get(f.path) || [];
      const all = new Set([...outNeighbors, ...inNeighbors]);
      const filtered = [...all].filter(p => batchOf.has(p) && !batchPaths.has(p));

      let kept = filtered.map(p => ({
        path: p,
        batchIndex: batchOf.get(p),
        symbols: exportsByPath.get(p) || [],
      }));

      if (kept.length > MAX_NEIGHBORS) {
        const original = kept.length;
        kept.sort((a, b2) => (NEIGHBOR_DEGREE.get(b2.path) || 0)
                            - (NEIGHBOR_DEGREE.get(a.path) || 0));
        kept = kept.slice(0, MAX_NEIGHBORS);
        process.stderr.write(
          `Warning: compute-batches: neighborMap for ${f.path} truncated from ` +
          `${original} to top ${MAX_NEIGHBORS} (by neighbor degree)\n`,
        );
      }

      if (kept.length) neighborMap[f.path] = kept;
    }
    return { batchIndex: b.batchIndex, files: b.files, batchImportData, neighborMap };
  });
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all PASS.

- [ ] **Step 5: Add neighborMap truncation test**

Append:

```javascript
describe('compute-batches.mjs — neighborMap truncation', () => {
  it('truncates and warns when neighbors > 50', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-cb-trunc-'));
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
    expect(result.stderr).toMatch(/neighborMap for src\/hub\.ts truncated from 60 to top 50/);
    const out = readBatches(root);
    // Find hub.ts and confirm its neighbor list capped at 50 (in whichever batch it landed)
    for (const b of out.batches) {
      const nbrs = b.neighborMap['src/hub.ts'];
      if (nbrs) expect(nbrs.length).toBeLessThanOrEqual(50);
    }
  });
});
```

- [ ] **Step 6: Run tests, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs
git commit -m "feat(compute-batches): batchImportData + neighborMap with truncation warning"
```

---

## Task 8: Fallback path + Louvain warning

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Modify: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`

- [ ] **Step 1: Write failing test (Louvain crash → fallback, warning emitted, batches still valid)**

Append to `test_compute_batches.test.mjs`:

```javascript
describe('compute-batches.mjs — fallback', () => {
  it('falls back to count-based when Louvain throws (env-injected mock)', () => {
    // We can't easily monkey-patch louvain mid-script in Vitest because the
    // script runs in a subprocess. Instead, set an env var the script honors:
    // UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW=1 → script throws inside its
    // Louvain branch, exercising the fallback path.
    const root = setupProject('scan-result-3-cliques.json');
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
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "fallback"
```

Expected: FAIL — no fallback path exists; script crashes or produces `algorithm: "louvain"`.

- [ ] **Step 3: Implement fallback**

In `compute-batches.mjs`, refactor the Louvain section into a function and wrap it in try/catch.

**Boundary explicitly:** the block to replace **starts** at `const g = new Graph({ type: 'undirected', allowSelfLoops: false });` and **ends** at the closing brace of the `for (const [cid, paths] of filesByCommunity) { ... }` size-enforcement loop (the loop introduced in Task 4 step 4). Do NOT replace the `const sortedCommunities = [...splitCommunities.entries()] ...` line that follows — it stays as-is and continues to work because the replacement still produces `splitCommunities`.

Add a `runLouvain(codeFiles, importMap)` function before `main()`:

```javascript
/**
 * Returns Map<path, communityId> via Louvain. May throw — caller must catch
 * and fall back if it does. Honors UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW=1
 * to allow tests to exercise the fallback path.
 */
function runLouvain(codeFiles, importMap) {
  if (process.env.UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW === '1') {
    throw new Error('forced throw for test');
  }
  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const f of codeFiles) g.addNode(f.path);
  for (const [src, targets] of Object.entries(importMap)) {
    if (!g.hasNode(src)) continue;
    for (const tgt of targets) {
      if (!g.hasNode(tgt) || src === tgt || g.hasEdge(src, tgt)) continue;
      g.addEdge(src, tgt);
    }
  }
  const cs = louvain(g);  // { nodeId: communityId }
  return new Map(Object.entries(cs));
}

/**
 * Returns Map<path, communityId> via alphabetical chunking of 12 files per
 * batch. Deterministic, used as fallback when Louvain fails.
 */
function countBasedAssignment(codeFiles, batchSize = 12) {
  const out = new Map();
  const sorted = [...codeFiles].map(f => f.path).sort();
  for (let i = 0; i < sorted.length; i++) {
    out.set(sorted[i], `count_${Math.floor(i / batchSize)}`);
  }
  return out;
}
```

In `main()`, replace the Louvain call + size-enforcement block with:

```javascript
  let algorithm = 'louvain';
  let perFileCommunity;
  try {
    perFileCommunity = runLouvain(codeFiles, importMap);
  } catch (err) {
    process.stderr.write(
      `Warning: compute-batches: Louvain failed (${err.message}) ` +
      `— falling back to count-based grouping (12 files/batch) ` +
      `— module semantic boundaries lost\n`,
    );
    perFileCommunity = countBasedAssignment(codeFiles, 12);
    algorithm = 'count-fallback';
  }

  // Group files by community id
  const filesByCommunity = new Map();
  for (const [path, cid] of perFileCommunity) {
    if (!filesByCommunity.has(cid)) filesByCommunity.set(cid, []);
    filesByCommunity.get(cid).push(path);
  }

  // Size enforcement only on louvain output. count-fallback already chunked.
  const MAX_COMMUNITY_SIZE = 35;
  const splitCommunities = new Map();
  let nextSyntheticId = 0;
  if (algorithm === 'louvain') {
    for (const [cid, paths] of filesByCommunity) {
      if (paths.length <= MAX_COMMUNITY_SIZE) {
        splitCommunities.set(cid, paths);
        continue;
      }
      process.stderr.write(
        `Warning: compute-batches: community size ${paths.length} > max ${MAX_COMMUNITY_SIZE} ` +
        `— splitting via alphabetical chunking — modularity may decrease\n`,
      );
      const sorted = [...paths].sort();
      const parts = Math.ceil(paths.length / MAX_COMMUNITY_SIZE);
      const perPart = Math.ceil(paths.length / parts);
      for (let i = 0; i < parts; i++) {
        const slice = sorted.slice(i * perPart, (i + 1) * perPart);
        const synthId = `__split_${cid}_${nextSyntheticId++}`;
        splitCommunities.set(synthId, slice);
      }
    }
  } else {
    for (const [cid, paths] of filesByCommunity) splitCommunities.set(cid, paths);
  }
```

And update the output object's `algorithm` field:

```javascript
  const output = {
    schemaVersion: 1,
    algorithm,
    totalFiles: scan.files.length,
    totalBatches: batches.length,
    exportsByPath: Object.fromEntries(exportsByPath),
    batches,
  };
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all PASS including new fallback test.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs
git commit -m "feat(compute-batches): count-based fallback with visible warning"
```

---

## Task 9: --changed-files mode

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Modify: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs`

- [ ] **Step 1: Write failing test**

Append:

```javascript
describe('compute-batches.mjs — --changed-files', () => {
  it('emits only batches containing changed files', () => {
    const root = setupProject('scan-result-3-cliques.json');
    const changedPath = join(root, 'changed.txt');
    // Only the auth clique is changed
    writeFileSync(changedPath, ['src/auth/login.ts', 'src/auth/tokens.ts'].join('\n'));

    const result = runScript(root, [`--changed-files=${changedPath}`]);
    expect(result.status).toBe(0);

    const out = readBatches(root);
    // Auth files are in batches; other cliques' batches must be omitted
    const allPaths = out.batches.flatMap(b => b.files.map(f => f.path));
    expect(allPaths).toContain('src/auth/login.ts');
    expect(allPaths).toContain('src/auth/tokens.ts');
    expect(allPaths).not.toContain('src/api/handlers.ts');
    expect(allPaths).not.toContain('src/db/users.ts');

    // neighborMap may still reference unchanged files (with their full-graph batchIndex)
    const loginBatch = out.batches.find(b =>
      b.files.some(f => f.path === 'src/auth/login.ts'));
    // No assertion on neighborMap content here — the auth clique is fully
    // changed, so neighborMap entries may be empty. The point is the script
    // doesn't crash and only emits relevant batches.
    expect(loginBatch).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs -t "changed-files"
```

Expected: FAIL — flag is unrecognized; output contains all batches.

- [ ] **Step 3: Implement --changed-files filtering**

In `compute-batches.mjs`, at the start of `main()`, after reading `projectRoot`:

```javascript
  let changedFiles = null;
  for (const arg of process.argv.slice(3)) {
    const m = arg.match(/^--changed-files=(.+)$/);
    if (m) {
      const p = m[1];
      const lines = readFileSync(p, 'utf-8')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      changedFiles = new Set(lines);
    }
  }
```

Just before writing the output (after `batches` is assembled), filter:

```javascript
  let finalBatches = batches;
  if (changedFiles) {
    finalBatches = batches.filter(b => b.files.some(f => changedFiles.has(f.path)));
    // batchIndex on filtered batches retains the full-graph assignment
    // (the design says neighborMap should still reference unchanged files'
    // full-graph batchIndex). No renumbering.
  }

  const output = {
    schemaVersion: 1,
    algorithm,
    totalFiles: scan.files.length,
    totalBatches: finalBatches.length,
    exportsByPath: Object.fromEntries(exportsByPath),
    batches: finalBatches,
  };
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-batches.mjs \
        understand-anything-plugin/skills/understand/test_compute_batches.test.mjs
git commit -m "feat(compute-batches): --changed-files mode for incremental updates"
```

---

## Task 10: file-analyzer.md — add Cross-batch context (neighborMap) section

**Files:**
- Modify: `understand-anything-plugin/agents/file-analyzer.md`

- [ ] **Step 1: Insert the new section**

In `understand-anything-plugin/agents/file-analyzer.md`, find the existing line:
```
### Step 1 — Prepare the input JSON
```

(This is at approximately line 32.)

After Step 1's closing code block (the bash heredoc that ends with `ENDJSON`), and **before** `### Step 2 — Execute the bundled extraction script`, insert a new sub-section. Use the Edit tool:

Old text (the boundary between Step 1 and Step 2):
```
ENDJSON
```

### Step 2 — Execute the bundled extraction script
```

New text:
```
ENDJSON
```

### Cross-batch context (neighborMap)

Your dispatch prompt includes a `neighborMap` — for each file in your batch, it lists project-internal neighbors in OTHER batches (files that import yours or that you import), with their exported symbols.

Use neighborMap as a confidence boost for cross-batch edges (`calls`, `related`, `inherits`, `implements` to nodes outside your batch):

- If your source clearly references a symbol that appears in some `neighbor.symbols`, emit the edge to `function:<neighbor.path>:<symbol>` or `class:<neighbor.path>:<symbol>` with confidence.
- If your source references a cross-batch symbol that is NOT in neighborMap (the project-scanner may not have extracted it), you may still emit the edge if you saw it explicitly in the imported file's surface — but prefer matching neighborMap symbols when available.
- Imports continue to use `batchImportData` (fully resolved), not neighborMap.

The merge script's dangling-edge dropper is the safety net for genuinely unresolvable targets.

### Step 2 — Execute the bundled extraction script
```

- [ ] **Step 2: Verify the section was inserted correctly**

```bash
grep -n "Cross-batch context (neighborMap)" understand-anything-plugin/agents/file-analyzer.md
grep -n "Step 1 — Prepare the input JSON" understand-anything-plugin/agents/file-analyzer.md
grep -n "Step 2 — Execute the bundled extraction script" understand-anything-plugin/agents/file-analyzer.md
```

Expected: all three lines exist, and the Cross-batch context line number is between Step 1's and Step 2's line numbers.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/agents/file-analyzer.md
git commit -m "docs(file-analyzer): add Cross-batch context (neighborMap) section"
```

---

## Task 11: file-analyzer.md — replace Writing Results with multi-part protocol

**Files:**
- Modify: `understand-anything-plugin/agents/file-analyzer.md`

- [ ] **Step 1: Replace the Writing Results section**

In `understand-anything-plugin/agents/file-analyzer.md`, find the existing block (at approximately lines 467-475):

Old text:
```
## Writing Results

After producing the JSON:

1. Write the JSON to: `<project-root>/.understand-anything/intermediate/batch-<batchIndex>.json`
2. The project root and batch index will be provided in your prompt.
3. Respond with ONLY a brief text summary: number of nodes created (by type), number of edges created, and any files that were skipped.

Do NOT include the full JSON in your text response.
```

New text:
```
## Writing Results — single or multi-part

**Step A — Compute totals.**
```
nodeCount = nodes.length
edgeCount = edges.length
```

**Step B — Decide split.**
- If `nodeCount ≤ 60` AND `edgeCount ≤ 120`: write ONE file to `.understand-anything/intermediate/batch-<batchIndex>.json`. Done. Skip to Step F.
- Otherwise: `parts = ceil(max(nodeCount / 60, edgeCount / 120))`.

**Step C — Partition.**
Sort files in your batch alphabetically by path. Chunk them sequentially into `parts` groups of size `ceil(N / parts)`. For each part:
- All nodes whose `filePath` is in this part's files (for non-file nodes like `module`/`concept`, use the file they belong to).
- All edges whose `source` is in this part's nodes (target may be anywhere — same part, different part of same batch, different batch).

**Step D — Write each part.**
Write part `k` (1-indexed) to `.understand-anything/intermediate/batch-<batchIndex>-part-<k>.json`. Each part is a valid GraphFragment: `{ "nodes": [...], "edges": [...] }`.

**Step E — Self-validate.**
For each file written, verify:
- Valid JSON.
- `nodes` array exists and is well-formed.
- For every edge: `source` and `target` both appear as either (a) a node `id` in this part's nodes, OR (b) a `file:<path>` reference where `<path>` is in `neighborMap` or `batchImportData`, OR (c) a `function:<path>:<symbol>` / `class:<path>:<symbol>` reference where `<symbol>` is in some `neighbor.symbols`.

If validation fails on a part, do NOT silently rebuild. Respond with an explicit error stating which part failed, which edge(s) failed validation, and why. The dispatching session can then retry.

**Step F — Respond.**
Respond with ONLY a brief text summary: parts written (1 or more), total nodes/edges across all parts, any files skipped. Do NOT include JSON content in the response.
```

- [ ] **Step 2: Verify**

```bash
grep -n "Writing Results — single or multi-part" understand-anything-plugin/agents/file-analyzer.md
grep -n "Step A — Compute totals" understand-anything-plugin/agents/file-analyzer.md
grep -n "Step F — Respond" understand-anything-plugin/agents/file-analyzer.md
# Confirm old prose is gone:
! grep -n "After producing the JSON:" understand-anything-plugin/agents/file-analyzer.md
```

Expected: first three exist, last `grep` returns non-zero (i.e. no match).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/agents/file-analyzer.md
git commit -m "docs(file-analyzer): replace Writing Results with multi-part output protocol"
```

---

## Task 12: SKILL.md — Phase 1.5 + Phase 2 rewrite + Incremental path rewrite

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Insert Phase 1.5 after Phase 1**

In `understand-anything-plugin/skills/understand/SKILL.md`, find the line:
```
## Phase 2 — ANALYZE
```

(At approximately line 278.)

Immediately before that line, insert the Phase 1.5 block. The boundary is the `---` separator above `## Phase 2 — ANALYZE`. Use the Edit tool to replace:

Old text (the separator + Phase 2 header):
```
---

## Phase 2 — ANALYZE
```

New text:
```
---

## Phase 1.5 — BATCH

Report: `[Phase 1.5/7] Computing semantic batches...`

Run the bundled batching script:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT
```

Reads `.understand-anything/intermediate/scan-result.json`, writes `.understand-anything/intermediate/batches.json`.

Capture stderr. Append any line starting with `Warning:` to `$PHASE_WARNINGS` for the final report.

If the script exits non-zero, the failure is hard — relay the full stderr to the user as a Phase 1.5 failure. Do not attempt to recover; the script's internal fallback (count-based) already handles recoverable issues. A non-zero exit means a fundamental problem (missing input file, malformed JSON, etc.).

---

## Phase 2 — ANALYZE
```

- [ ] **Step 2: Replace Phase 2 ANALYZE Full analysis path**

In SKILL.md, find the block starting `### Full analysis path` (at approximately line 280) and ending just before `### Incremental update path`.

Old text (the entire Full analysis path section — multi-paragraph; use Edit to replace from `### Full analysis path` through the line `Include the script's warnings in \`$PHASE_WARNINGS\` for the reviewer.`):

```
### Full analysis path

Batch the file list from Phase 1 into groups of **20-30 files each** (aim for ~25 files per batch for balanced sizes).

**Batching strategy for non-code files:**
- Group related non-code files together in the same batch when possible:
  - Dockerfile + docker-compose.yml + .dockerignore → same batch
  - SQL migration files → same batch (ordered by filename)
  - CI/CD config files (.github/workflows/*) → same batch
  - Documentation files (docs/*.md) → same batch
- This allows the file-analyzer to create cross-file edges (e.g., docker-compose `depends_on` Dockerfile)
- Non-code files can be mixed with code files in the same batch if batch sizes are small
- Each file's `fileCategory` from Phase 1 must be included in the batch file list

After batching, report the plan to the user:
> `[Phase 2/7] Analyzing files — <totalFiles> files in <totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **5 subagents concurrently** using parallel dispatch. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Before dispatching each batch, construct `batchImportData` from `$IMPORT_MAP`:
```json
batchImportData = {}
for each file in this batch:
  batchImportData[file.path] = $IMPORT_MAP[file.path] ?? []
```

Fill in batch-specific parameters below and dispatch:

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json`
>
> Pre-resolved import data for this batch (use this for all import edge creation — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

After ALL batches complete, report to the user: `Phase 2 complete. All <totalBatches> batches analyzed.`

Run the merge-and-normalize script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

This script reads all `batch-*.json` files from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place (the LLM systematically emits `test → production` because it sees the import only when analyzing the test file); semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings (`X.ts` ↔ `X.test.ts`, JS/TS `__tests__/` and `<dir>/test/` walk-out, Python in-package `tests/`, Go `_test.go` sibling, Maven/Gradle `src/test/...` ↔ `src/main/...`, .NET `<svc>/tests/` ↔ `<svc>/src/...` and `<App>.Tests/` ↔ `<App>/`). Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.
```

New text:
```
### Full analysis path

Load `.understand-anything/intermediate/batches.json` (produced by Phase 1.5). Iterate the `batches[]` array.

Report: `[Phase 2/7] Analyzing files — <totalFiles> files in <totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **5 subagents concurrently**. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Dispatch prompt template (fill in batch-specific values from `batches.json[i]`):

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Output: write to `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json` (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode, per Step B of your output protocol).
>
> Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON from batches.json[i].batchImportData>
> ```
>
> Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
> ```json
> <neighborMap JSON from batches.json[i].neighborMap>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

After ALL batches complete, report to the user: `Phase 2 complete. All <totalBatches> batches analyzed.`

Run the merge-and-normalize script bundled with this skill:
```bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
```

This script reads all `batch-*.json` files (including `batch-<i>-part-<k>.json` produced by file-analyzers that split their output) from `$PROJECT_ROOT/.understand-anything/intermediate/`, then in one pass:
- Combines all nodes and edges across batches
- Normalizes node IDs (strips double prefixes, project-name prefixes, adds missing prefixes)
- Normalizes complexity values (`low`→`simple`, `medium`→`moderate`, `high`→`complex`, etc.)
- Rewrites edge references to match corrected node IDs
- Deduplicates nodes by ID (keeps last occurrence) and edges by `(source, target, type)`
- Drops dangling edges referencing missing nodes
- Logs all corrections and dropped items to stderr

The merge script also runs a `tested_by` linker that canonicalizes test-coverage edges in two passes. **Pass 1** walks LLM-emitted `tested_by` edges and flips inverted ones in place; semantically broken edges (test↔test, prod↔prod, orphan endpoints) are dropped. **Pass 2** supplements with path-convention pairings. Production nodes that end up sourcing any `tested_by` edge get a `"tested"` tag. All resulting edges run `production → test`.

Output: `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`

Include the script's warnings in `$PHASE_WARNINGS` for the reviewer.
```

- [ ] **Step 3: Replace Incremental update path**

Find:
```
### Incremental update path

Use the changed files list from Phase 0. Batch and dispatch file-analyzer subagents using the same process as above (20-30 files per batch, up to 5 concurrent, with batchImportData constructed from $IMPORT_MAP), but only for changed files.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```
```

Replace with:
```
### Incremental update path

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

Run compute-batches with `--changed-files`:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

This produces a `batches.json` that contains only batches with changed files, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Then dispatch file-analyzer subagents per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```
```

- [ ] **Step 4: Verify**

```bash
grep -n "Phase 1.5 — BATCH" understand-anything-plugin/skills/understand/SKILL.md
grep -n "Load \`.understand-anything/intermediate/batches.json\`" understand-anything-plugin/skills/understand/SKILL.md
grep -n "compute-batches.mjs" understand-anything-plugin/skills/understand/SKILL.md
# Confirm old prose is gone (each command should print "OK: ... absent"):
if grep -q "groups of \*\*20-30 files each\*\*" understand-anything-plugin/skills/understand/SKILL.md; then echo "FAIL: old batching prose still present"; else echo "OK: old batching prose absent"; fi
if grep -qF "Dockerfile + docker-compose.yml + .dockerignore → same batch" understand-anything-plugin/skills/understand/SKILL.md; then echo "FAIL: old non-code prose still present"; else echo "OK: old non-code prose absent"; fi
```

Expected: first three exist (compute-batches.mjs should appear at least 3 times — Phase 1.5 + Incremental); both check commands print "OK: ... absent".

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(understand): introduce Phase 1.5 (compute-batches) and rewrite Phase 2 prose"
```

---

## Task 13: merge-batch-graphs.py — multi-part stderr report + missing-part warning

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`

- [ ] **Step 1: Replace the "Found N batch files:" report**

In `merge-batch-graphs.py`, find the block at approximately line 1026:

Old text:
```python
    print(f"Found {len(batch_files)} batch files:", file=sys.stderr)
```

New text:
```python
    # Group by logical batch index so the report distinguishes single-batch
    # files from multi-part file-analyzer outputs.
    from collections import defaultdict as _dd
    by_batch = _dd(list)
    for f in batch_files:
        m = re.match(r"batch-(\d+)(?:-part-(\d+))?\.json", f.name)
        if m:
            by_batch[int(m.group(1))].append((f.name, int(m.group(2)) if m.group(2) else None))

    logical_count = len(by_batch)
    multi_part = sum(1 for entries in by_batch.values() if len(entries) > 1)
    print(
        f"Found {len(batch_files)} batch files "
        f"({logical_count} logical batches, {multi_part} multi-part):",
        file=sys.stderr,
    )

    # Missing-part detection: for any logical batch with parts (len > 1), the
    # set of part numbers MUST be contiguous starting at 1. Gaps suggest a
    # truncated write — emit a visible warning so the user can investigate.
    for idx, entries in by_batch.items():
        part_nums = [p for (_n, p) in entries if p is not None]
        if not part_nums:
            continue
        present = set(part_nums)
        expected = set(range(1, max(part_nums) + 1))
        missing = sorted(expected - present)
        if missing:
            print(
                f"Warning: merge: batch {idx} has parts {sorted(present)} but "
                f"missing part {missing} — possible truncated write — "
                f"affected nodes/edges may be lost",
                file=sys.stderr,
            )
```

- [ ] **Step 2: Verify the file still parses**

```bash
python3 -c "import ast; ast.parse(open('understand-anything-plugin/skills/understand/merge-batch-graphs.py').read())" && echo "OK"
```

Expected: prints `OK`.

- [ ] **Step 3: Smoke-test the existing test suite still passes**

```bash
cd understand-anything-plugin/skills/understand && python3 -m unittest test_merge_batch_graphs.py -v 2>&1 | tail -20
```

Expected: all existing tests pass (we haven't broken anything).

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand/merge-batch-graphs.py
git commit -m "feat(merge-batch-graphs): multi-part aware stderr report + missing-part warning"
```

---

## Task 14: merge-batch-graphs.py — multi-part unit tests

**Files:**
- Modify: `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`

- [ ] **Step 1: Append TestMultiPart class**

Append to `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`:

```python


# ── Multi-part batch handling ─────────────────────────────────────────────


class TestMultiPart(unittest.TestCase):
    """End-to-end tests for batch-<i>-part-<k>.json input handling.

    These tests invoke merge-batch-graphs.py as a subprocess in a temp
    directory so we exercise the full path: glob → load → merge → write.
    """

    def setUp(self) -> None:
        import tempfile
        self.tmp = Path(tempfile.mkdtemp(prefix="ua-mbg-"))
        self.intermediate = self.tmp / ".understand-anything" / "intermediate"
        self.intermediate.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_batch(self, name: str, nodes: list, edges: list) -> None:
        import json as _j
        (self.intermediate / name).write_text(
            _j.dumps({"nodes": nodes, "edges": edges}),
            encoding="utf-8",
        )

    def _run_merge(self) -> tuple[int, str, dict]:
        import subprocess
        import json as _j
        result = subprocess.run(
            ["python3", str(_MODULE_PATH), str(self.tmp)],
            capture_output=True, text=True,
        )
        out_path = self.intermediate / "assembled-graph.json"
        assembled = _j.loads(out_path.read_text()) if out_path.exists() else {}
        return result.returncode, result.stderr, assembled

    def test_two_parts_of_one_logical_batch_merge(self) -> None:
        self._write_batch("batch-1-part-1.json",
            [_file_node("src/a.ts")],
            [{"source": "file:src/a.ts", "target": "file:src/b.ts",
              "type": "imports", "direction": "forward", "weight": 0.7}])
        self._write_batch("batch-1-part-2.json",
            [_file_node("src/b.ts")],
            [])
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids, {"file:src/a.ts", "file:src/b.ts"})
        # Cross-part edge survived
        edge_keys = {(e["source"], e["target"], e["type"]) for e in assembled["edges"]}
        self.assertIn(
            ("file:src/a.ts", "file:src/b.ts", "imports"), edge_keys)

    def test_three_parts_of_one_logical_batch_merge(self) -> None:
        for k, path in enumerate(["src/a.ts", "src/b.ts", "src/c.ts"], start=1):
            self._write_batch(f"batch-1-part-{k}.json",
                [_file_node(path)], [])
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids,
            {"file:src/a.ts", "file:src/b.ts", "file:src/c.ts"})

    def test_malformed_part_is_skipped_with_warning(self) -> None:
        (self.intermediate / "batch-1-part-1.json").write_text(
            "{ this is not valid json", encoding="utf-8")
        self._write_batch("batch-1-part-2.json",
            [_file_node("src/b.ts")], [])
        rc, stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        # The skip warning is from existing load_batch logic
        self.assertIn("skipping batch-1-part-1.json", stderr)
        # part-2 content still made it in
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids, {"file:src/b.ts"})

    def test_mixed_single_and_multi_part(self) -> None:
        self._write_batch("batch-1.json",
            [_file_node("src/single.ts")], [])
        self._write_batch("batch-2-part-1.json",
            [_file_node("src/multi-a.ts")], [])
        self._write_batch("batch-2-part-2.json",
            [_file_node("src/multi-b.ts")], [])
        self._write_batch("batch-3.json",
            [_file_node("src/another-single.ts")], [])
        rc, _stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        node_ids = {n["id"] for n in assembled["nodes"]}
        self.assertEqual(node_ids, {
            "file:src/single.ts", "file:src/multi-a.ts",
            "file:src/multi-b.ts", "file:src/another-single.ts",
        })

    def test_missing_part_emits_warning(self) -> None:
        # parts {2, 3} present, part-1 missing
        self._write_batch("batch-1-part-2.json",
            [_file_node("src/b.ts")], [])
        self._write_batch("batch-1-part-3.json",
            [_file_node("src/c.ts")], [])
        rc, stderr, assembled = self._run_merge()
        self.assertEqual(rc, 0)
        self.assertRegex(stderr,
            r"Warning: merge: batch 1 has parts \[2, 3\] but "
            r"missing part \[1\] — possible truncated write")

    def test_stderr_report_format(self) -> None:
        self._write_batch("batch-1.json", [_file_node("src/a.ts")], [])
        self._write_batch("batch-2-part-1.json", [_file_node("src/b.ts")], [])
        self._write_batch("batch-2-part-2.json", [_file_node("src/c.ts")], [])
        rc, stderr, _assembled = self._run_merge()
        self.assertEqual(rc, 0)
        # 3 files on disk, 2 logical batches, 1 multi-part
        self.assertIn(
            "Found 3 batch files (2 logical batches, 1 multi-part)", stderr)
```

- [ ] **Step 2: Run tests, expect PASS**

```bash
cd understand-anything-plugin/skills/understand && python3 -m unittest test_merge_batch_graphs.TestMultiPart -v
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
cd understand-anything-plugin/skills/understand && python3 -m unittest test_merge_batch_graphs -v 2>&1 | tail -5
```

Expected: all tests PASS (pre-existing + new).

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand/test_merge_batch_graphs.py
git commit -m "test(merge-batch-graphs): TestMultiPart for batch-i-part-k handling"
```

---

## Task 15: Integration acceptance gate (manual)

This task is a **gated manual checklist** — execute interactively, mark each item, do not auto-merge without all green.

**Files:** none (this is a verification step)

- [ ] **Step 1: Install + build clean**

```bash
pnpm install
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
```

Expected: all succeed.

- [ ] **Step 2: Sync local plugin into Claude Code's plugin cache for testing**

Per project's CLAUDE.md "Testing Local Plugin Changes" section. From repo root:

```bash
INSTALLED_VERSION=$(ls ~/.claude/plugins/cache/understand-anything/understand-anything/ | head -1)
echo "Installed version: $INSTALLED_VERSION"
rm -rf ~/.claude/plugins/cache/understand-anything/understand-anything/$INSTALLED_VERSION
cp -R ./understand-anything-plugin ~/.claude/plugins/cache/understand-anything/understand-anything/$INSTALLED_VERSION
```

- [ ] **Step 3: Start a fresh Claude Code session and run /understand --full on this repo**

In a fresh session in this repo's directory:
```
/understand --full
```

Expected during run:
- `[Phase 1.5/7] Computing semantic batches...` appears
- Phase 2 reports batch count from `batches.json` (not arbitrary count-based)
- At least one batch with > 60 nodes / > 120 edges triggers multi-part output (look in `.understand-anything/intermediate/` for any `batch-<i>-part-<k>.json` files)

Expected after run:
- `knowledge-graph.json` exists with reasonable node/edge counts compared to current main
- Dashboard renders normally
- Phase 7 final report's warnings section includes any compute-batches warnings IF they fired

- [ ] **Step 4: Sanity-check batches.json contents**

```bash
jq '.algorithm, .totalFiles, .totalBatches, (.batches | length), [.batches[].files | length]' \
  .understand-anything/intermediate/batches.json 2>/dev/null \
  || echo "batches.json was cleaned up by Phase 7 — re-run with /understand --full and inspect before Phase 7 cleanup, or check git diff for the script's behavior."
```

Note: Phase 7 cleans up `.understand-anything/intermediate/` so this is best inspected mid-run, not after.

- [ ] **Step 5: Run on a small repo (5-10 files) to verify fallback batch path**

```bash
mkdir -p /tmp/ua-smoke-small/src
cd /tmp/ua-smoke-small
git init && git commit --allow-empty -m init
echo 'export const a = 1;' > src/a.ts
echo 'export const b = 2;' > src/b.ts
echo 'export const c = 3;' > src/c.ts
echo '{"name":"smoke","version":"0.0.1"}' > package.json
git add . && git commit -m setup
```

Then `cd /tmp/ua-smoke-small` in a Claude Code session and run `/understand --full`. Expected: completes without errors, single small batch.

- [ ] **Step 6: Run on a ~100-file repo to validate the bug fix**

If you have a ~100-file repo handy (or use the largest test fixture from the project), run `/understand --full` and confirm no "output limit" errors appear, even on Bedrock OPUS.

If you do not have a suitable repo, document this in the PR description as a deferred manual verification step.

- [ ] **Step 7: Stage results**

This task does not commit anything — it's a verification gate. If Step 3 reveals bugs, go back to the relevant task and fix; otherwise proceed to Task 16.

---

## Task 16: Version bump in 5 files

Per project CLAUDE.md: when pushing to remote, bump version in **all five** files listed.

**Files:**
- Modify: `understand-anything-plugin/package.json`
- Modify: `understand-anything-plugin/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.cursor-plugin/plugin.json`
- Modify: `.copilot-plugin/plugin.json`

- [ ] **Step 1: Determine new version**

Current version is `2.7.4` (per `understand-anything-plugin/package.json` line 3). This PR adds a substantial feature (Phase 1.5 + multi-part output) — bump **minor**: `2.8.0`.

- [ ] **Step 2: Confirm all five files have the same current version**

```bash
grep -H '"version"' \
  understand-anything-plugin/package.json \
  understand-anything-plugin/.claude-plugin/plugin.json \
  .claude-plugin/plugin.json \
  .cursor-plugin/plugin.json \
  .copilot-plugin/plugin.json
```

Expected: all five print `"version": "2.7.4"` (or whatever the current version is — use that as the baseline). If they diverge, stop and reconcile with the user.

- [ ] **Step 3: Bump each file from `2.7.4` to `2.8.0`**

Use the Edit tool on each of the five files. For each, replace `"version": "2.7.4"` with `"version": "2.8.0"`.

- [ ] **Step 4: Verify all five updated**

```bash
grep -H '"version"' \
  understand-anything-plugin/package.json \
  understand-anything-plugin/.claude-plugin/plugin.json \
  .claude-plugin/plugin.json \
  .cursor-plugin/plugin.json \
  .copilot-plugin/plugin.json
```

Expected: all five print `"version": "2.8.0"`.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/package.json \
        understand-anything-plugin/.claude-plugin/plugin.json \
        .claude-plugin/plugin.json \
        .cursor-plugin/plugin.json \
        .copilot-plugin/plugin.json
git commit -m "chore: bump version to 2.8.0"
```

- [ ] **Step 6: Push branch and open PR**

```bash
git push -u origin feat/semantic-batching-and-output-chunking
gh pr create --title "feat(understand): semantic batching (Phase 1.5) + output chunking — fixes #159" --body "$(cat <<'EOF'
## Summary
- Replace count-based file-analyzer batching with Louvain community detection on the import graph (new Phase 1.5, deterministic `compute-batches.mjs` script).
- file-analyzer self-splits its output into `batch-<i>-part-<k>.json` when above 60 nodes / 120 edges per part (Bedrock OPUS output cap safety).
- Cross-batch neighbors (with their exported symbols) passed to file-analyzer via `neighborMap` so semantic edges like `calls` and `inherits` can be confidently emitted across batches.
- Every fallback path emits a visible `Warning:` line that bubbles to `$PHASE_WARNINGS` in the Phase 7 final report.
- merge-batch-graphs.py multi-part-aware stderr report + missing-part warning; glob/sort-key already accepted multi-part naming so no algorithmic change required there.

Fixes #159.

Design: `docs/superpowers/specs/2026-05-24-semantic-batching-and-output-chunking-design.md`
Plan: `docs/superpowers/plans/2026-05-24-semantic-batching-and-output-chunking-impl.md`

## Test plan
- [x] `pnpm install` (graphology + graphology-communities-louvain install cleanly)
- [x] `pnpm --filter @understand-anything/core build`
- [x] `pnpm --filter @understand-anything/skill exec vitest run skills/understand/test_compute_batches.test.mjs` — all green
- [x] `cd understand-anything-plugin/skills/understand && python3 -m unittest test_merge_batch_graphs -v` — all green
- [x] Run `/understand --full` on this repo — `batches.json` generated; multi-part triggered on at least one batch; assembled-graph node/edge counts within expected range vs current main; dashboard renders normally; Phase 7 warnings section includes any compute-batches warnings.
- [ ] (Deferred / external) Run on a ~100-file repo on Bedrock OPUS — confirm no "output limit" errors. Document any deferred verification in PR comments.
EOF
)"
```

Expected: PR URL returned.

---

## Implementation done. Final check before merge:

- [ ] All 16 tasks above complete with checkboxes ticked.
- [ ] Branch builds + tests green: `pnpm install && pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/skill exec vitest run skills/understand/ && cd understand-anything-plugin/skills/understand && python3 -m unittest test_merge_batch_graphs test_compute_batches 2>&1 | tail -10` (note: `test_compute_batches` is the Vitest tree, this just sanity-checks Python; the Vitest run is separate)
- [ ] No `try { ... } catch { /* silent */ }` or `except: pass` patterns added (grep your diff).
- [ ] Spec ↔ plan ↔ code alignment spot-checked: every Failure-mode warning string in the spec is asserted by at least one unit test.

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

import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

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

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * For each code file, returns its top-level exported symbol names (functions,
 * classes, exported consts). Per-file errors are swallowed into [] with a
 * visible warning so a single bad file does not abort batching.
 *
 * Returns Map<path, string[]>.
 */
async function extractExports(projectRoot, codeFiles) {
  let registry;
  try {
    const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
    const tsPlugin = new TreeSitterPlugin(tsConfigs);
    await tsPlugin.init();
    registry = new PluginRegistry();
    registry.register(tsPlugin);
    registerAllParsers(registry);
  } catch (err) {
    process.stderr.write(
      `Warning: compute-batches: tree-sitter init failed (${err.message}) ` +
      `— all symbols=[] in neighborMap — cross-batch edges limited to file-level\n`,
    );
    return new Map(codeFiles.map(f => [f.path, []]));
  }

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
        `(analyze error: ${err.message}) — symbols=[] in neighborMap — ` +
        `cross-batch edges to this file limited to file-level\n`,
      );
      exportsByPath.set(file.path, []);
    }
  }
  return exportsByPath;
}

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
  for (const dir of [...dirsWithDockerfile].sort()) {
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

  // Group D: SQL migrations per migrations/ or migration/ directory.
  // Defensive consumed.has check: no upstream group consumes SQL today, but
  // future Group additions could; keep the check for forward-compat.
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
  // Per design spec: max files per parent-dir batch for Group E.
  const MAX_E = 20;
  for (const [, paths] of remainingByDir) {
    for (let i = 0; i < paths.length; i += MAX_E) {
      const slice = paths.slice(i, i + MAX_E);
      groups.push({ files: slice.map(p => byPath.get(p)) });
    }
  }

  return groups;
}

/**
 * Build a lookup map from file path → batchIndex across all batches (code +
 * non-code). Used to resolve cross-batch neighbor references in neighborMap.
 */
function buildBatchOfMap(allBatches) {
  const m = new Map();
  for (const b of allBatches) {
    for (const f of b.files) m.set(f.path, b.batchIndex);
  }
  return m;
}

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
 * Returns Map<path, communityId> via alphabetical chunking of `batchSize`
 * files per batch. Deterministic, used as fallback when Louvain fails.
 */
function countBasedAssignment(codeFiles, batchSize = 12) {
  const out = new Map();
  const sorted = [...codeFiles].map(f => f.path).sort();
  for (let i = 0; i < sorted.length; i++) {
    out.set(sorted[i], `count_${Math.floor(i / batchSize)}`);
  }
  return out;
}

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
  const files = scan.files || [];
  const codeFiles = files.filter(f => f.fileCategory === 'code');
  const nonCodeFiles = files.filter(f => f.fileCategory !== 'code');
  const importMap = scan.importMap || {};

  process.stderr.write(`Loaded ${files.length} files (${codeFiles.length} code).\n`);

  const exportsByPath = await extractExports(projectRoot, codeFiles);

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

  // Sort communities by size desc, then by min-path asc for determinism
  const sortedCommunities = [...splitCommunities.entries()]
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      const minA = [...a[1]].sort()[0];
      const minB = [...b[1]].sort()[0];
      return minA.localeCompare(minB);
    });

  // Build per-batch file list with full file metadata from scan
  const fileMetaByPath = new Map(files.map(f => [f.path, f]));
  // Safe: every path in a community is a graph node, and graph nodes are a
  // subset of files (see addNode loop above). fileMetaByPath.get() can
  // never return undefined here.

  // First-pass: assemble bare batches (no batchImportData/neighborMap yet)
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
      // Note on truncation: we measure "popularity" by total raw 1-hop neighbor
      // count (rawCount), not kept.length. A widely-imported hub like a logger
      // module may have N>50 inbound imports but, after Louvain + size
      // enforcement, only some land in other batches — kept.length can be < 50
      // while the file is still a high-degree hub whose missing relationships
      // matter for downstream cross-batch edge confidence. Warning on rawCount
      // surfaces this; truncation on kept ensures the JSON stays bounded.
      const outNeighbors = importMap[f.path] || [];
      const inNeighbors = reverseImportMap.get(f.path) || [];
      const all = new Set([...outNeighbors, ...inNeighbors]);
      const rawCount = all.size;
      const filtered = [...all].filter(p => batchOf.has(p) && !batchPaths.has(p));

      let kept = filtered.map(p => ({
        path: p,
        batchIndex: batchOf.get(p),
        symbols: exportsByPath.get(p) || [],
      }));

      if (rawCount > MAX_NEIGHBORS) {
        kept.sort((a, b2) => (NEIGHBOR_DEGREE.get(b2.path) || 0)
                            - (NEIGHBOR_DEGREE.get(a.path) || 0)
                            || a.path.localeCompare(b2.path));  // deterministic tiebreak
        const beforeSlice = kept.length;
        kept = kept.slice(0, MAX_NEIGHBORS);
        process.stderr.write(
          `Warning: compute-batches: neighborMap for ${f.path} has high 1-hop degree ${rawCount} ` +
          `— exceeds soft cap of ${MAX_NEIGHBORS} — keeping top ${kept.length} cross-batch entries ` +
          `(${beforeSlice - kept.length} dropped by degree sort)\n`,
        );
      }

      if (kept.length) neighborMap[f.path] = kept;
    }
    return { batchIndex: b.batchIndex, files: b.files, batchImportData, neighborMap };
  });

  const output = {
    schemaVersion: 1,
    algorithm,
    totalFiles: scan.files.length,
    totalBatches: batches.length,
    exportsByPath: Object.fromEntries(exportsByPath),
    batches,
  };

  const outPath = join(projectRoot, '.understand-anything', 'intermediate', 'batches.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  const batchSizes = batches.map(b => b.files.length);
  const maxSize = batchSizes.length ? Math.max(...batchSizes) : 0;
  const minSize = batchSizes.length ? Math.min(...batchSizes) : 0;
  process.stderr.write(
    `Wrote ${batches.length} batches (sizes: max=${maxSize}, min=${minSize}) to ${outPath}\n`,
  );
}

// ---------------------------------------------------------------------------
// Run only when executed directly as a CLI; importing the module (e.g. from
// tests) must not trigger main().
//
// Canonicalize both sides through realpathSync. Node ESM resolves
// import.meta.url through symlinks but pathToFileURL(process.argv[1]) preserves
// them, so a raw equality check silently no-ops when the script is invoked via
// a symlinked plugin install path (the default in Claude Code / Copilot CLI
// caches). See GitHub issue #162.
// ---------------------------------------------------------------------------
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
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

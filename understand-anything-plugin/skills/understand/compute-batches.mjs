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
 * Input/output live under the project's data dir (`.ua/`, or legacy
 * `.understand-anything/` when that directory already exists — resolved by
 * core's resolveUaDir):
 *   Input:  <ua-dir>/intermediate/scan-result.json
 *   Output: <ua-dir>/intermediate/batches.json
 */

import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  main as refreshScanResult,
  readPendingInventoryJournal,
  readRetainedScanResult,
} from './refresh-scan-result.mjs';
import { collectProjectContext, collectProjectMembership } from './scan-project.mjs';

/**
 * Chunk size for parallel file I/O. Bounded so a 15k-file repo doesn't try
 * to open every descriptor at once (would hit `EMFILE`) while still keeping
 * libuv's worker-thread pool saturated. Empirically chosen to keep memory
 * around tens of MB even when the average file is ~10 KB.
 */
const IO_PARALLELISM = 64;

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '../..');
const require = createRequire(resolve(PLUGIN_ROOT, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(PLUGIN_ROOT, 'packages/core/dist/index.js')).href);
}
const { TreeSitterPlugin, PluginRegistry, builtinLanguageConfigs, registerAllParsers, resolveUaDir } = core;

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * For each code file, returns its top-level exported symbol names (functions,
 * classes, exported consts). Per-file errors are swallowed into [] with a
 * visible warning so a single bad file does not abort batching.
 *
 * Returns Map<path, string[]>.
 */
async function extractExports(projectRoot, codeFiles, verifiedRealPaths = null) {
  const readPaths = new Map();
  for (const file of codeFiles) {
    if (verifiedRealPaths && !verifiedRealPaths.has(file.path)) {
      throw new Error('verified project membership is missing an inventory path');
    }
    readPaths.set(file.path, verifiedRealPaths?.get(file.path) ?? join(projectRoot, file.path));
  }

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

  // I/O is parallelised in bounded chunks (libuv worker threads handle the
  // disk reads concurrently) while the actual tree-sitter parse stays on
  // the main thread, since web-tree-sitter is single-threaded WASM. For a
  // 15k-file iOS repo (#226), the sequential `readFileSync` loop dominated;
  // letting reads pipeline drops wall time roughly proportional to the
  // share of the loop spent waiting on disk.
  for (let start = 0; start < codeFiles.length; start += IO_PARALLELISM) {
    const slice = codeFiles.slice(start, start + IO_PARALLELISM);

    // Read every file in the slice concurrently. Errors per file are
    // captured in-place so a single bad file does not abort the chunk.
    const reads = await Promise.all(
      slice.map(async (file) => {
        const abs = readPaths.get(file.path);
        try {
          const content = await readFile(abs, 'utf-8');
          return { file, content, readError: null };
        } catch (err) {
          return { file, content: null, readError: err };
        }
      }),
    );

    // Serialise the CPU-bound tree-sitter work and the stderr warning emits
    // so log order remains identical to the previous sequential loop. This
    // also keeps existing fixture-comparison tests stable.
    for (const { file, content, readError } of reads) {
      if (readError) {
        process.stderr.write(
          `Warning: compute-batches: exports extraction failed for ${file.path} ` +
          `(read error: ${readError.message}) — symbols=[] in neighborMap — ` +
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
  }
  return exportsByPath;
}

/**
 * Build batches for non-code files per Groups A-E in the design spec.
 * Returns Array<{ files: FileMeta[], mergeable: boolean }> — caller assigns
 * batchIndex. `mergeable=false` for semantic Groups A-D (Dockerfile clusters,
 * .github/workflows, .gitlab-ci/.circleci, SQL migrations) preserves their
 * boundary intent across the merge-small pass; Group E (catch-all parent-dir
 * grouping) is `mergeable=true` so its tiny singletons can be pooled.
 */
function buildNonCodeBatches(nonCodeFiles) {
  const byPath = new Map(nonCodeFiles.map(f => [f.path, f]));
  const consumed = new Set();
  const groups = [];

  const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const baseOf = p => p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;

  // Hoist the path list once (it was re-materialized via [...byPath.keys()]
  // seven times below) and index paths by parent dir a single time. Groups A
  // and D previously re-filtered the full path list once per Dockerfile dir /
  // migration dir — O(dirs · N). On a many-service monorepo (one Dockerfile
  // per service) that was the dominant cost; the dir index makes those
  // lookups O(1). Output is byte-for-byte identical (verified).
  const allPaths = [...byPath.keys()];
  const pathsByDir = new Map();
  for (const p of allPaths) {
    const d = dirOf(p);
    let arr = pathsByDir.get(d);
    if (!arr) { arr = []; pathsByDir.set(d, arr); }
    arr.push(p);
  }

  // Group A: per-directory Dockerfile clusters.
  const dirsWithDockerfile = new Set();
  for (const p of allPaths) {
    if (baseOf(p) === 'Dockerfile') dirsWithDockerfile.add(dirOf(p));
  }
  for (const dir of [...dirsWithDockerfile].sort()) {
    const inDir = pathsByDir.get(dir) ?? [];
    const cluster = inDir.filter(p => {
      const b = baseOf(p);
      return b === 'Dockerfile'
        || b === '.dockerignore'
        || b.startsWith('docker-compose.');
    });
    if (cluster.length) {
      groups.push({ files: cluster.map(p => byPath.get(p)), mergeable: false });
      cluster.forEach(p => consumed.add(p));
    }
  }

  // Group B: .github/workflows/*
  const ghWorkflows = allPaths.filter(
    p => p.startsWith('.github/workflows/') && (p.endsWith('.yml') || p.endsWith('.yaml')),
  ).filter(p => !consumed.has(p));
  if (ghWorkflows.length) {
    groups.push({ files: ghWorkflows.map(p => byPath.get(p)), mergeable: false });
    ghWorkflows.forEach(p => consumed.add(p));
  }

  // Group C: .gitlab-ci.yml + .circleci/*
  const ciFiles = allPaths.filter(
    p => (p === '.gitlab-ci.yml' || p.startsWith('.circleci/'))
      && !consumed.has(p),
  );
  if (ciFiles.length) {
    groups.push({ files: ciFiles.map(p => byPath.get(p)), mergeable: false });
    ciFiles.forEach(p => consumed.add(p));
  }

  // Group D: SQL migrations per migrations/ or migration/ directory.
  // Defensive consumed.has check: no upstream group consumes SQL today, but
  // future Group additions could; keep the check for forward-compat.
  const migrationDirs = new Set();
  for (const p of allPaths) {
    if (p.endsWith('.sql')) {
      const d = dirOf(p);
      if (/(^|\/)migrations?$/.test(d)) migrationDirs.add(d);
    }
  }
  for (const dir of migrationDirs) {
    const sqls = (pathsByDir.get(dir) ?? [])
      .filter(p => p.endsWith('.sql') && !consumed.has(p))
      .sort();
    if (sqls.length) {
      groups.push({ files: sqls.map(p => byPath.get(p)), mergeable: false });
      sqls.forEach(p => consumed.add(p));
    }
  }

  // Group E: all remaining grouped by immediate parent dir, max 20 per batch
  const remainingByDir = new Map();
  for (const p of [...allPaths].sort()) {
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
      groups.push({ files: slice.map(p => byPath.get(p)), mergeable: true });
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

export function normalizeRelativePathForMatch(pathText, platform = process.platform) {
  const platformPath = platform === 'win32'
    ? pathText.replace(/\\/g, '/')
    : pathText;
  return platformPath
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
}

function resolveChangedProjectFile(projectRoot, normalizedPath) {
  if (
    !normalizedPath
    || normalizedPath.includes('\0')
    || isAbsolute(normalizedPath)
    || (
      process.platform === 'win32'
      && (win32.isAbsolute(normalizedPath) || /^[A-Za-z]:/.test(normalizedPath))
    )
  ) {
    return null;
  }

  const absolutePath = resolve(projectRoot, normalizedPath);
  const roundTrip = relative(projectRoot, absolutePath).split(sep).join('/');
  if (
    roundTrip !== normalizedPath
    || roundTrip === '..'
    || roundTrip.startsWith('../')
    || isAbsolute(roundTrip)
    || (process.platform === 'win32' && win32.isAbsolute(roundTrip))
  ) {
    return null;
  }
  return absolutePath;
}

function isReservedDataPath(path) {
  const [rootSegment] = path.split('/', 1);
  const comparable = process.platform === 'win32'
    ? rootSegment.toLowerCase()
    : rootSegment;
  return comparable === '.ua' || comparable === '.understand-anything';
}

function collectStrictInventoryPaths(projectRoot, scan) {
  if (!scan || !Array.isArray(scan.files)) {
    throw new Error('retained scan files must be an array');
  }

  const paths = new Set();
  for (const file of scan.files) {
    const path = file?.path;
    if (
      typeof path !== 'string'
      || path.length === 0
      || normalizeRelativePathForMatch(path) !== path
      || !resolveChangedProjectFile(projectRoot, path)
      || isReservedDataPath(path)
    ) {
      throw new Error(`invalid retained inventory path: ${path}`);
    }
    if (paths.has(path)) throw new Error(`duplicate retained inventory path: ${path}`);
    paths.add(path);
  }
  return paths;
}

function collectRetainedExcludePatterns(scan) {
  if (scan.excludePatterns === undefined) return [];
  if (
    !Array.isArray(scan.excludePatterns)
    || scan.excludePatterns.some(pattern => (
      typeof pattern !== 'string'
      || pattern.length === 0
      || pattern.trim() !== pattern
      || pattern.includes(',')
    ))
  ) {
    throw new Error(
      'retained scan excludePatterns must be an array of normalized non-empty strings',
    );
  }
  return scan.excludePatterns;
}

export function isChangedPathFile(absolutePath, stat = statSync) {
  try {
    return stat(absolutePath).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    const code = error?.code || 'UNKNOWN';
    throw new Error(`changed path stat failed (${code})`);
  }
}

export function resolveRealPathForContainment(
  absolutePath,
  label,
  resolveRealpath = realpathSync,
) {
  try {
    return resolveRealpath(absolutePath);
  } catch (error) {
    const code = error?.code || 'UNKNOWN';
    throw new Error(`${label} realpath failed (${code})`);
  }
}

function isWithinRealProjectRoot(realProjectRoot, absolutePath) {
  const realChangedPath = resolveRealPathForContainment(absolutePath, 'changed path');
  const realRelative = relative(realProjectRoot, realChangedPath).split(sep).join('/');
  return realRelative !== '..'
    && !realRelative.startsWith('../')
    && !isAbsolute(realRelative)
    && (process.platform !== 'win32' || !win32.isAbsolute(realRelative));
}

function validateChangedPathContainment(projectRoot, changedFiles) {
  const realProjectRoot = resolveRealPathForContainment(projectRoot, 'project root');
  for (const changedPath of changedFiles) {
    const absolutePath = resolveChangedProjectFile(projectRoot, changedPath);
    if (!absolutePath) continue;

    const existsOnDisk = isChangedPathFile(absolutePath);
    if (existsOnDisk && !isWithinRealProjectRoot(realProjectRoot, absolutePath)) {
      throw new Error('changed path resolves outside project root');
    }
  }
}

function validateRetainedInventoryContainment(projectRoot, inventoryPaths) {
  const realProjectRoot = resolveRealPathForContainment(projectRoot, 'project root');
  for (const inventoryPath of inventoryPaths) {
    const absolutePath = resolveChangedProjectFile(projectRoot, inventoryPath);
    if (!absolutePath || !isChangedPathFile(absolutePath)) continue;

    const realPath = resolveRealPathForContainment(
      absolutePath,
      'retained inventory path',
    );
    const realRelative = relative(realProjectRoot, realPath).split(sep).join('/');
    if (
      realRelative === '..'
      || realRelative.startsWith('../')
      || isAbsolute(realRelative)
      || (process.platform === 'win32' && win32.isAbsolute(realRelative))
    ) {
      throw new Error('retained inventory path resolves outside project root');
    }
    if (isReservedDataPath(realRelative)) {
      throw new Error('retained inventory path resolves into a reserved data root');
    }
  }
}

function compareMembership(inventoryPaths, currentPaths) {
  const removed = [...inventoryPaths].filter(path => !currentPaths.has(path));
  const added = [...currentPaths].filter(path => !inventoryPaths.has(path));
  return { removed, added };
}

function describeMembershipDrift(projectRoot, uaDir, changedFiles, delta) {
  const activeUaPath = relative(projectRoot, uaDir).split(sep).join('/');
  const activeIgnorePath = normalizeRelativePathForMatch(
    `${activeUaPath}/.understandignore`,
  );
  if (
    changedFiles.has('.understandignore')
    || changedFiles.has(activeIgnorePath)
  ) {
    return 'ignore rules changed';
  }
  return delta.removed.length > 0 ? 'file removed' : 'file added';
}

function refreshScanInventory(projectRoot, reason) {
  process.stderr.write(
    `Info: compute-batches: structural drift detected (${reason}); `
    + `refreshing scan inventory\n`,
  );
  try {
    refreshScanResult(projectRoot);
  } catch (error) {
    process.stderr.write(`refresh-scan-result.mjs failed: ${error.message}\n`);
    // Preserve the CLI contract previously produced by the refresh child.
    throw new Error('inventory refresh failed with status 1');
  }
}

/**
 * Returns Map<path, communityId> via Louvain. May throw — caller must catch
 * and fall back if it does. Honors UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW=1
 * to allow tests to exercise the fallback path.
 */
function runLouvain(codeFiles, importMap) {
  if (process.env.UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW === '1') {
    throw new Error('forced throw via UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW');
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

/**
 * Pool small mergeable batches into "misc" batches to reduce dispatch overhead.
 * Preserves semantic groupings (non-code Groups A-D, marked `mergeable=false`)
 * regardless of size; only merges code Louvain singletons / orphans and
 * Group E parent-dir batches that fall below MIN_BATCH_SIZE.
 *
 * On a 314-file microservices-demo run, vanilla Louvain produced 87 singleton
 * communities → 87 dispatch tasks of size 1. This pass collapses them into
 * ceil(N / MAX_MERGE_TARGET) misc batches, drastically cutting orchestration
 * overhead while leaving the high-modularity communities untouched.
 *
 * Returns the rewritten batch list with reassigned batchIndex (1-based,
 * keepers first preserving their relative order, misc batches appended).
 */
function mergeSmallBatches(bareBatches) {
  // MIN_BATCH_SIZE=3: below this, file-analyzer dispatch overhead (subagent
  // spin-up, prompt setup) dwarfs the per-file analysis cost — not worth a
  // standalone batch.
  const MIN_BATCH_SIZE = 3;
  // MAX_MERGE_TARGET=25: stays below MAX_COMMUNITY_SIZE=35 so the misc-batch
  // agent retains headroom for neighborMap context without overflowing.
  const MAX_MERGE_TARGET = 25;

  const keepers = [];
  const smallMergeable = [];
  for (const b of bareBatches) {
    if (b.mergeable && b.files.length < MIN_BATCH_SIZE) {
      smallMergeable.push(b);
    } else {
      keepers.push(b);
    }
  }

  if (smallMergeable.length === 0) {
    // Nothing to merge — strip mergeable flag and renumber for cleanliness.
    return keepers.map((b, i) => ({
      batchIndex: i + 1,
      files: b.files,
    }));
  }

  // Pool and sort deterministically by path so repeated runs match byte-for-byte.
  const pooledFiles = smallMergeable
    .flatMap(b => b.files)
    .sort((a, b) => a.path.localeCompare(b.path));

  const miscBatches = [];
  for (let i = 0; i < pooledFiles.length; i += MAX_MERGE_TARGET) {
    miscBatches.push({ files: pooledFiles.slice(i, i + MAX_MERGE_TARGET) });
  }

  // Use `Info:` rather than `Warning:` — singleton consolidation is a
  // routine optimization, not a fallback/degrade path. Per
  // [[feedback_visible_warnings]] only fallbacks should bubble as Warning:
  // to the Phase 7 final report. Real warnings would get drowned out if
  // every normal Louvain run with singletons (i.e. almost every run) added
  // a Warning: line.
  process.stderr.write(
    `Info: compute-batches: merged ${smallMergeable.length} small batches ` +
    `(${pooledFiles.length} files) into ${miscBatches.length} misc batches ` +
    `— singletons and orphans consolidated\n`,
  );

  const final = [...keepers, ...miscBatches];
  return final.map((b, i) => ({
    batchIndex: i + 1,
    files: b.files,
  }));
}

// ── Main: load → Louvain (or count-fallback) → enrich → write batches.json ─
async function main() {
  const projectRootArg = process.argv[2];
  if (!projectRootArg) {
    process.stderr.write('Usage: node compute-batches.mjs <project-root> [--changed-files=<path>]\n');
    process.exit(1);
  }
  const projectRoot = resolve(projectRootArg);

  let changedFiles = null;
  for (const arg of process.argv.slice(3)) {
    const m = arg.match(/^--changed-files=(.+)$/);
    if (m) {
      const p = m[1];
      let content;
      try {
        content = readFileSync(p, 'utf-8');
      } catch (err) {
        process.stderr.write(
          `Error: compute-batches: --changed-files path not readable: ${p} (${err.message})\n`,
        );
        process.exit(1);
      }
      const nulDelimited = content.includes('\0');
      const lines = content
        .split(nulDelimited ? '\0' : '\n')
        .map(line => normalizeRelativePathForMatch(nulDelimited ? line : line.trim()))
        .filter(Boolean);
      if (lines.some(line => !resolveChangedProjectFile(projectRoot, line))) {
        throw new Error('invalid changed path');
      }
      changedFiles = new Set(lines);
    }
  }

  const uaDir = resolveUaDir(projectRoot);
  let scan = readRetainedScanResult(projectRoot, uaDir);
  let effectiveChangedFiles = null;
  let verifiedRealPaths = null;
  let membership = null;
  if (changedFiles) {
    effectiveChangedFiles = new Set(changedFiles);
    const inventoryBeforeRefresh = collectStrictInventoryPaths(projectRoot, scan);
    validateChangedPathContainment(projectRoot, changedFiles);
    validateRetainedInventoryContainment(projectRoot, inventoryBeforeRefresh);
    const pendingJournal = readPendingInventoryJournal(
      projectRoot,
      uaDir,
      inventoryBeforeRefresh,
    );
    for (const path of pendingJournal?.paths ?? []) {
      effectiveChangedFiles.add(path);
    }
    const excludePatterns = collectRetainedExcludePatterns(scan);
    membership = collectProjectMembership(projectRoot, excludePatterns);
    if (membership.degraded) {
      throw new Error('current project membership is incomplete');
    }
    const currentPaths = new Set(membership.paths);
    verifiedRealPaths = membership.realPaths;
    const delta = compareMembership(inventoryBeforeRefresh, currentPaths);
    if (delta.removed.length > 0 || delta.added.length > 0) {
      const driftReason = describeMembershipDrift(
        projectRoot,
        uaDir,
        changedFiles,
        delta,
      );
      refreshScanInventory(projectRoot, driftReason);
      scan = readRetainedScanResult(projectRoot, uaDir);
      const inventoryAfterRefresh = collectStrictInventoryPaths(projectRoot, scan);
      const refreshedDelta = compareMembership(inventoryAfterRefresh, currentPaths);
      if (refreshedDelta.removed.length > 0 || refreshedDelta.added.length > 0) {
        throw new Error('refreshed inventory does not match current project membership');
      }
      const refreshedJournal = readPendingInventoryJournal(
        projectRoot,
        uaDir,
        inventoryAfterRefresh,
      );
      if (!refreshedJournal) {
        throw new Error('inventory refresh did not persist pending changes');
      }
      for (const path of refreshedJournal.paths) {
        effectiveChangedFiles.add(path);
      }
    }
  }
  if (effectiveChangedFiles?.size === 0) {
    const output = {
      schemaVersion: 1,
      algorithm: 'louvain',
      totalFiles: scan.files.length,
      totalBatches: 0,
      effectiveChangedFiles: [],
      exportsByPath: {},
      batches: [],
    };
    const outPath = join(uaDir, 'intermediate', 'batches.json');
    writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    process.stderr.write(`Wrote 0 batches (sizes: max=0, min=0) to ${outPath}\n`);
    return;
  }
  const projectContext = effectiveChangedFiles
    ? collectProjectContext(projectRoot, membership)
    : null;
  const files = scan.files || [];
  const codeFiles = files.filter(f => f.fileCategory === 'code');
  const nonCodeFiles = files.filter(f => f.fileCategory !== 'code');
  const importMap = scan.importMap || {};

  process.stderr.write(`Loaded ${files.length} files (${codeFiles.length} code).\n`);

  const exportsByPath = await extractExports(projectRoot, codeFiles, verifiedRealPaths);

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

  // First-pass: assemble bare batches (no batchImportData/neighborMap yet).
  // All Louvain communities are mergeable=true so the merge-small pass can
  // collapse singletons / 2-file orphans. Non-code groups carry per-group
  // mergeable flags from buildNonCodeBatches (false for semantic Groups A-D,
  // true for Group E catch-all).
  const codeBatchObjsBare = sortedCommunities.map(([, paths], idx) => ({
    batchIndex: idx + 1,
    files: paths.sort().map(p => fileMetaByPath.get(p)),
    mergeable: true,
  }));
  const nonCodeGroups = buildNonCodeBatches(nonCodeFiles);
  const nonCodeBatchObjsBare = nonCodeGroups.map((g, i) => ({
    batchIndex: codeBatchObjsBare.length + i + 1,
    files: g.files,
    mergeable: g.mergeable,
  }));
  const bareBatches = [...codeBatchObjsBare, ...nonCodeBatchObjsBare];
  const mergedBareBatches = mergeSmallBatches(bareBatches);
  const batchOf = buildBatchOfMap(mergedBareBatches);

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

  // Second-pass: enrich each batch with batchImportData + neighborMap.
  // `analysisFiles` is usually the full batch. In --changed-files mode, it is
  // the validated changed set plus any refreshed inventory membership delta,
  // while batchOf remains the full-graph lookup.
  const buildBatchPayload = (b, analysisFiles = b.files) => {
    const analysisPaths = new Set(analysisFiles.map(f => f.path));
    const batchImportData = {};
    const neighborMap = {};
    for (const f of analysisFiles) {
      batchImportData[f.path] = (importMap[f.path] || []).slice();

      // 1-hop neighbors: imports out + imported-by in, excluding files already
      // emitted for analysis in this payload.
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
      const filtered = [...all].filter(p => batchOf.has(p) && !analysisPaths.has(p));

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
    return { batchIndex: b.batchIndex, files: analysisFiles, batchImportData, neighborMap };
  };

  const finalBatches = effectiveChangedFiles
    ? mergedBareBatches
      .map(b => {
        const changedBatchFiles = b.files.filter(f =>
          effectiveChangedFiles.has(normalizeRelativePathForMatch(f.path)));
        if (changedBatchFiles.length === 0) return null;
        return buildBatchPayload(b, changedBatchFiles);
      })
      .filter(Boolean)
    : mergedBareBatches.map(b => buildBatchPayload(b));
  // batchIndex on filtered batches retains the full-graph assignment
  // (the design says neighborMap should still reference unchanged files'
  // full-graph batchIndex). No renumbering.

  // Note: under --changed-files mode, totalFiles is the FULL project file
  // count (unchanged from the input scan) while totalBatches reflects only
  // the filtered set written to disk. batchIndex values on the kept batches
  // preserve the full-graph assignment so neighborMap references resolve.
  const output = {
    schemaVersion: 1,
    algorithm,
    totalFiles: scan.files.length,
    totalBatches: finalBatches.length,
    ...(effectiveChangedFiles
      ? { effectiveChangedFiles: [...effectiveChangedFiles].sort() }
      : {}),
    ...(projectContext ? { projectContext } : {}),
    exportsByPath: Object.fromEntries(exportsByPath),
    batches: finalBatches,
  };

  const outPath = join(uaDir, 'intermediate', 'batches.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  const batchSizes = finalBatches.map(b => b.files.length);
  const maxSize = batchSizes.length ? Math.max(...batchSizes) : 0;
  const minSize = batchSizes.length ? Math.min(...batchSizes) : 0;
  process.stderr.write(
    `Wrote ${finalBatches.length} batches (sizes: max=${maxSize}, min=${minSize}) to ${outPath}\n`,
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

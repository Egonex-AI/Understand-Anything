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
  const importMap = scan.importMap || {};

  process.stderr.write(`Loaded ${files.length} files (${codeFiles.length} code).\n`);

  const exportsByPath = await extractExports(projectRoot, codeFiles);

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

  // Sort communities by size desc, then by min-path asc for determinism
  const sortedCommunities = [...splitCommunities.entries()]
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      const minA = [...a[1]].sort()[0];
      const minB = [...b[1]].sort()[0];
      return minA.localeCompare(minB);
    });

  // Build per-batch file list with full file metadata from scan
  const fileMetaByPath = new Map(scan.files.map(f => [f.path, f]));
  // Safe: every path in a community is a graph node, and graph nodes are a
  // subset of scan.files (see addNode loop above). fileMetaByPath.get() can
  // never return undefined here.
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

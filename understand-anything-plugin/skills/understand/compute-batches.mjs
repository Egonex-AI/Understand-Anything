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

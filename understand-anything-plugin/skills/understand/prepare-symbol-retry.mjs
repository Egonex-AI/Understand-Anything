#!/usr/bin/env node
/** Prepare exactly one targeted analyzer retry after the symbol gate fails. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  atomicWriteJson,
  getIntermediateDir,
  loadSymbolContext,
  normalizePath,
  readJson,
  symbolKind,
  validateIncrementalSymbols,
} from './validate-incremental-symbols.mjs';

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node prepare-symbol-retry.mjs <projectRoot>');
  const projectRoot = realpathSync(process.argv[2]);
  const intermediateDir = await getIntermediateDir(projectRoot);
  const { plan, baseline } = loadSymbolContext(projectRoot, intermediateDir);
  if (!['PARTIAL_UPDATE', 'ARCHITECTURE_UPDATE'].includes(plan.action)) {
    throw new Error('Symbol retry requires a partial or architecture incremental update');
  }
  const retryPath = join(intermediateDir, 'incremental-symbol-retry.json');
  if (existsSync(retryPath)) {
    const retry = readJson(retryPath);
    if (retry.baseCommit === plan.baseCommit && retry.headCommit === plan.headCommit && retry.attempt === 1) {
      throw new Error('Symbol retry already used for these commits; stop without advancing the baseline');
    }
  }
  // Do not trust an old report or a caller-supplied list of files to replace.
  const report = await validateIncrementalSymbols(projectRoot, { intermediateDir });
  if (report.ok || report.unresolvedFiles.length === 0) {
    throw new Error('No unresolved symbol files eligible for a targeted retry; inspect the symbol report');
  }
  const paths = new Set(report.unresolvedFiles);
  const changedFilesPath = join(intermediateDir, 'incremental-symbol-retry-files.json');
  const batchesPath = join(intermediateDir, 'incremental-symbol-retry-batches.json');
  atomicWriteJson(changedFilesPath, [...paths]);
  const skillDir = dirname(fileURLToPath(import.meta.url));
  const batching = spawnSync(process.execPath, [
    join(skillDir, 'compute-batches.mjs'), projectRoot,
    `--changed-files=${changedFilesPath}`, `--output=${batchesPath}`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (batching.stderr) process.stderr.write(batching.stderr);
  if (batching.status !== 0) throw new Error(`Retry batching failed: ${batching.error ?? batching.status}`);
  const batches = readJson(batchesPath).batches;
  const scheduled = batches.flatMap(batch => batch.files.map(file => file.path));
  if (JSON.stringify([...scheduled].sort()) !== JSON.stringify([...paths].sort())) {
    throw new Error('Retry batches do not cover exactly the affected files');
  }
  for (const batch of batches) {
    if (!Number.isInteger(batch.batchIndex) || batch.batchIndex < 1) throw new Error('Invalid retry batch index');
    const files = new Set(batch.files.map(file => file.path));
    batch.previousSymbols = baseline.files.filter(file => files.has(file.filePath)).flatMap(file =>
      file.nodes.filter(symbolKind).map(node => {
        const parents = new Set(file.edges.filter(edge => edge.type === 'contains' && edge.target === node.id)
          .map(edge => edge.source));
        const owners = file.nodes.filter(parent => parent.type === 'class' && parents.has(parent.id))
          .map(parent => parent.name);
        return {
          id: node.id, name: node.name, type: node.type, filePath: node.filePath,
          ...(node.lineRange ? { lineRange: node.lineRange } : {}),
          ...(owners.length ? { owners } : {}),
        };
      }),
    );
    batch.missingSymbols = report.files.filter(file => files.has(file.filePath));
  }
  const assembled = readJson(join(intermediateDir, 'assembled-graph.json'));
  const candidates = readJson(join(intermediateDir, 'incremental-edge-candidates.json'));
  if (candidates.baseCommit !== plan.baseCommit || candidates.headCommit !== plan.headCommit
    || !Array.isArray(candidates.edges)) throw new Error('Current edge candidates do not match the incremental plan; rerun merge');
  const removedIds = new Set(assembled.nodes.filter(node => paths.has(normalizePath(node.filePath)))
    .map(node => node.id));
  const retainedIds = new Set(assembled.nodes.filter(node => !removedIds.has(node.id)).map(node => node.id));
  const currentNodes = new Map(assembled.nodes.map(node => [node.id, node]));
  const previousIds = new Set(baseline.files.filter(file => paths.has(file.filePath))
    .flatMap(file => file.nodes.map(node => node.id)));
  const targetsAffectedFile = id => removedIds.has(id) || previousIds.has(id)
    || (typeof id === 'string' && [...paths].some(path => id.includes(`:${path}:`)));
  const sourceRemap = new Map(report.files.flatMap(file => file.replacements)
    .map(({ oldId, newId }) => [oldId, newId]));
  const inboundEdgeCandidates = [...assembled.edges, ...candidates.edges]
    .map(edge => ({ ...edge, source: currentNodes.has(edge.source) ? edge.source : sourceRemap.get(edge.source) ?? edge.source })).filter(edge =>
    retainedIds.has(edge.source) && targetsAffectedFile(edge.target));
  const contextPaths = new Set(paths);
  for (const edge of inboundEdgeCandidates) {
    for (const id of [edge.source, edge.target]) {
      if (currentNodes.has(id)) contextPaths.add(normalizePath(currentNodes.get(id).filePath));
    }
  }
  const retained = {
    nodes: assembled.nodes.filter(node => !removedIds.has(node.id)),
    // Defer inbound edges to the descriptor-bound manifest below. Re-merging
    // their bare IDs here could attach them to different symbols reusing IDs.
    edges: assembled.edges.filter(edge => retainedIds.has(edge.source) && retainedIds.has(edge.target)),
  };

  // Persist the attempt BEFORE mutating batches: a crash must not buy another
  // automatic retry. Only current merged contributions are compacted here;
  // no old symbol or semantic edge is copied back from the symbol baseline.
  atomicWriteJson(retryPath, {
    version: 1, baseCommit: plan.baseCommit, headCommit: plan.headCommit, attempt: 1,
    filesToReanalyze: [...paths], batches,
    inboundEdgeCandidates,
    currentFiles: [...contextPaths].map(filePath => {
      const nodes = assembled.nodes.filter(node => normalizePath(node.filePath) === filePath);
      const ids = new Set(nodes.map(node => node.id));
      return {
        filePath, nodes,
        edges: assembled.edges.filter(edge => edge.type === 'contains' && ids.has(edge.source) && ids.has(edge.target)),
      };
    }),
  });
  // Replace all numeric shards with one normalized retained contribution.
  // Merely overwriting the main batch leaves stale -part-* files capable of
  // masking a failed repair or resurrecting an obsolete node/edge.
  for (const name of readdirSync(intermediateDir)) {
    if (/^batch-\d+(?:-part-\d+)?\.json$/.test(name)) unlinkSync(join(intermediateDir, name));
  }
  atomicWriteJson(join(intermediateDir, 'batch-0.json'), retained);
  // Force another merge and regenerate any architecture/tour based on the
  // incomplete candidate. Keep the failure report for inspection.
  for (const name of ['assembled-graph.json', 'layers.json', 'tour.json']) {
    if (existsSync(join(intermediateDir, name))) unlinkSync(join(intermediateDir, name));
  }
  process.stdout.write(`Prepared symbol retry 1/1 for ${paths.size} file(s); dispatch batches from ${retryPath}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`prepare-symbol-retry.mjs failed: ${error.message}\n`);
  process.exitCode = 1;
}

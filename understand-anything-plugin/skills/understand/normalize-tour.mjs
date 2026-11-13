#!/usr/bin/env node
/**
 * Normalize the freshly built tour with the exact resolver the incremental
 * finalizer will apply at save time, so downstream steps (lesson dispatch in
 * particular) work against the tour that will actually be saved. A raw
 * "README.md" reference resolves to document:README.md here, not to a
 * dangling file:README.md produced by the hand-written conversion rule this
 * replaces.
 *
 * Usage: node normalize-tour.mjs <projectRoot>
 *
 * Reads  $UA_DIR/intermediate/assembled-graph.json (nodes, resolved like the finalizer)
 *        $UA_DIR/intermediate/tour.json (raw tour-builder output)
 * Writes $UA_DIR/intermediate/tour.normalized.json (atomically)
 *
 * Deterministic: same inputs plus the finalizer's normalizeTour always yield
 * the document the finalizer will embed in knowledge-graph.json.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { buildPathIndex, normalizeAssembled, normalizeTour } from './finalize-incremental.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { resolveUaDir } = core;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function atomicWriteJson(path, value) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, path);
  // Verify the durable target, not the temporary file.
  JSON.parse(readFileSync(path, 'utf-8'));
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('--')) {
  console.error('Usage: node normalize-tour.mjs <projectRoot>');
  process.exit(1);
}

const projectRoot = realpathSync(args[0]);
const uaDir = resolveUaDir(projectRoot);
const intermediateDir = join(uaDir, 'intermediate');
const graphPath = join(intermediateDir, 'assembled-graph.json');
const tourPath = join(intermediateDir, 'tour.json');

if (!existsSync(graphPath)) {
  console.error('normalize-tour.mjs failed: intermediate/assembled-graph.json is missing; run the merge phase first');
  process.exit(1);
}
if (!existsSync(tourPath)) {
  console.error('normalize-tour.mjs failed: intermediate/tour.json is missing; run tour-builder first');
  process.exit(1);
}

// Mirror the finalizer exactly: the same node normalization feeds the same
// pathIndex, so resolveNodeRef agrees on every reference at save time.
const assembled = normalizeAssembled(readJson(graphPath));
if (assembled.nodes.length === 0) {
  console.error('normalize-tour.mjs failed: assembled-graph.json has no usable nodes');
  process.exit(1);
}
const nodeIds = new Set(assembled.nodes.map(node => node.id));
const normalized = normalizeTour(readJson(tourPath), nodeIds, buildPathIndex(assembled.nodes));

atomicWriteJson(join(intermediateDir, 'tour.normalized.json'), normalized);
process.stdout.write(`Tour normalized: ${normalized.length} step(s) -> tour.normalized.json\n`);

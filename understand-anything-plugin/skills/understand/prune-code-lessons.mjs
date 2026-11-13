#!/usr/bin/env node
/**
 * Prune served code-lessons entries for files that no longer exist in the
 * saved knowledge graph. A PARTIAL_UPDATE can remove deleted or newly
 * ignored files from the graph while their source-derived lessons survive in
 * code-lessons.json — the viewer endpoint then keeps serving lessons for
 * paths the graph no longer knows about. Run this after a successful partial
 * save; surviving lessons are left untouched.
 *
 * Usage: node prune-code-lessons.mjs <projectRoot>
 *
 * Reads  $UA_DIR/knowledge-graph.json (file-level node filePaths form the
 *        legal key set — including table/endpoint nodes' filePaths, so a file
 *        that only has entity nodes left keeps its lesson)
 *        $UA_DIR/code-lessons.json (served lessons; missing -> silent no-op)
 * Writes $UA_DIR/code-lessons.json back only when at least one orphan entry
 *        was removed (atomic temp+rename).
 */

import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';

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

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)) return null;
  const platformPath = process.platform === 'win32' ? value.replaceAll('\\', '/') : value;
  const path = platformPath.replace(/^\.\//, '');
  if (!path || path.split('/').some(part => part === '..')) return null;
  return path;
}

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
  console.error('Usage: node prune-code-lessons.mjs <projectRoot>');
  process.exit(1);
}

const projectRoot = realpathSync(args[0]);
const uaDir = resolveUaDir(projectRoot);
const graphPath = join(uaDir, 'knowledge-graph.json');
const lessonsPath = join(uaDir, 'code-lessons.json');

// Silent no-ops: nothing served to prune, or no graph to prune against.
if (!existsSync(graphPath) || !existsSync(lessonsPath)) {
  process.exit(0);
}

const graph = readJson(graphPath);
const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];

// Lessons are keyed by relative file path; any node carrying a filePath keeps
// that path's lesson legal (whole-file nodes, plus table/endpoint entities).
const legalPaths = new Set();
for (const node of nodes) {
  const path = normalizeRelativePath(node?.filePath);
  if (path) legalPaths.add(path);
}

const lessons = readJson(lessonsPath);
const files = lessons && typeof lessons === 'object' && !Array.isArray(lessons)
  ? lessons.files
  : null;
if (!files || typeof files !== 'object' || Array.isArray(files)) {
  process.exit(0);
}

const kept = {};
let removed = 0;
for (const [filePath, entry] of Object.entries(files)) {
  const normalized = normalizeRelativePath(filePath);
  if (normalized && legalPaths.has(normalized)) {
    kept[filePath] = entry;
  } else {
    removed += 1;
  }
}

if (removed === 0) {
  process.stdout.write('Code lessons pruned: nothing to remove\n');
  process.exit(0);
}

atomicWriteJson(lessonsPath, { ...lessons, files: kept });
process.stdout.write(`Code lessons pruned: removed ${removed} orphaned entr${removed === 1 ? 'y' : 'ies'}\n`);

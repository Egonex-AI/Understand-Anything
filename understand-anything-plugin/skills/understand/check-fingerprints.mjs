#!/usr/bin/env node
/**
 * check-fingerprints.mjs
 *
 * Deterministic incremental change detection for auto-update Phase 1.
 * Compares the changed files against the stored fingerprint baseline
 * (fingerprints.json, written by build-fingerprints.mjs) using the SAME
 * tree-sitter extraction pipeline that built the baseline, then classifies
 * the update action via core's classifyUpdate().
 *
 * Replaces the LLM-written regex fingerprint-check script that
 * auto-update-prompt.md used to describe. That regex extraction
 * systematically disagreed with the tree-sitter baseline (different
 * function/import/export shapes), so changed files were almost never
 * classified COSMETIC — nearly every commit escalated to STRUCTURAL and
 * burned LLM tokens the "zero-token" path was designed to avoid.
 *
 * Usage:
 *   node check-fingerprints.mjs <input.json>
 *
 * Input JSON:
 *   {
 *     projectRoot: string,
 *     changedFilePaths: string[],   // project-relative, already ignore-filtered
 *     output?: string               // default: <ua-dir>/intermediate/change-analysis.json
 *   }
 *
 * Output JSON (change-analysis.json):
 *   {
 *     action: "SKIP" | "PARTIAL_UPDATE" | "ARCHITECTURE_UPDATE" | "FULL_UPDATE",
 *     filesToReanalyze: string[],
 *     rerunArchitecture: boolean,
 *     rerunTour: boolean,
 *     reason: string,
 *     fileChanges: [{ filePath, changeLevel, details }],
 *     newFiles: string[],
 *     deletedFiles: string[],
 *     structurallyChangedFiles: string[],
 *     cosmeticOnlyFiles: string[],
 *     unchangedFiles: string[],
 *     baselineMissing: boolean
 *   }
 *
 * Exit code: 0 on success (including a missing baseline, which degrades to
 * the conservative all-STRUCTURAL classification); non-zero on error.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// pathToFileURL() is required for Windows: dynamic import() of a raw
// "C:\..." path throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const {
  TreeSitterPlugin,
  PluginRegistry,
  builtinLanguageConfigs,
  registerAllParsers,
  analyzeChanges,
  classifyUpdate,
  loadFingerprints,
  loadGraph,
  resolveUaDir,
} = core;

const FILE_LEVEL_TYPES = new Set([
  'file', 'config', 'document', 'service', 'pipeline',
  'table', 'schema', 'resource', 'endpoint',
]);

async function main() {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    process.stderr.write('Usage: node check-fingerprints.mjs <input.json>\n');
    process.exit(1);
  }

  const { projectRoot, changedFilePaths, output } = JSON.parse(
    readFileSync(inputPath, 'utf-8'),
  );
  if (!projectRoot || !Array.isArray(changedFilePaths)) {
    throw new Error(
      'Invalid input: requires { projectRoot: string, changedFilePaths: string[] }',
    );
  }

  // Same registry construction as build-fingerprints.mjs so the comparison
  // uses the exact extraction pipeline that produced the baseline.
  const tsConfigs = builtinLanguageConfigs.filter((c) => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();
  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  let store = loadFingerprints(projectRoot);
  const baselineMissing = !store || !store.files || Object.keys(store.files).length === 0;
  if (baselineMissing) {
    // Conservative degrade: with no baseline every changed file is "new"
    // (STRUCTURAL). analyzeChanges against an empty store produces exactly
    // that, so we just synthesize one instead of special-casing below.
    process.stderr.write(
      'Warning: check-fingerprints: fingerprints.json missing or empty — ' +
      'treating all changed files as STRUCTURAL. Run /understand to rebuild ' +
      'the baseline.\n',
    );
    store = { version: '1.0.0', gitCommitHash: '', generatedAt: '', files: {} };
  }

  const analysis = analyzeChanges(projectRoot, changedFilePaths, store, registry);

  // Baseline for classifyUpdate: total graph size + known file paths (for
  // new/removed top-level directory detection).
  let totalFilesInGraph = Object.keys(store.files).length;
  let allKnownFiles = Object.keys(store.files);
  try {
    const graph = loadGraph(projectRoot, { validate: false });
    if (graph && Array.isArray(graph.nodes)) {
      const fileNodes = graph.nodes.filter((n) => FILE_LEVEL_TYPES.has(n.type));
      if (fileNodes.length > 0) {
        totalFilesInGraph = fileNodes.length;
        if (allKnownFiles.length === 0) {
          allKnownFiles = fileNodes.map((n) => n.filePath).filter(Boolean);
        }
      }
    }
  } catch {
    // Graph unreadable — fingerprint-store fallback above is sufficient.
  }

  const decision = classifyUpdate(analysis, totalFilesInGraph, allKnownFiles);

  const result = {
    ...decision,
    fileChanges: analysis.fileChanges,
    newFiles: analysis.newFiles,
    deletedFiles: analysis.deletedFiles,
    structurallyChangedFiles: analysis.structurallyChangedFiles,
    cosmeticOnlyFiles: analysis.cosmeticOnlyFiles,
    unchangedFiles: analysis.unchangedFiles,
    baselineMissing,
  };

  const outPath = output
    ? resolve(output)
    : join(resolveUaDir(projectRoot), 'intermediate', 'change-analysis.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

  process.stdout.write(
    `Change analysis: action=${decision.action} ` +
    `(${changedFilePaths.length} checked, ` +
    `${analysis.structurallyChangedFiles.length} structural, ` +
    `${analysis.cosmeticOnlyFiles.length} cosmetic, ` +
    `${analysis.newFiles.length} new, ${analysis.deletedFiles.length} deleted) ` +
    `— ${outPath}\n`,
  );
}

await main();

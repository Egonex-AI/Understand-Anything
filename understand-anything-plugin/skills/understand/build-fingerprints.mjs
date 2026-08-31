#!/usr/bin/env node
/**
 * build-fingerprints.mjs
 *
 * Builds the structural-fingerprint baseline used by auto-update's
 * incremental change detection. Runs once per /understand full rebuild
 * (Phase 7 step 2.5), generating fingerprints.json in the project's data dir
 * (`.ua/`, or legacy `.understand-anything/` — resolved by core's
 * saveFingerprints via resolveUaDir).
 *
 * Replaces the LLM-written fingerprint script that previously sat in
 * SKILL.md as a code example — that example had the wrong signature
 * for buildFingerprintStore() and never successfully produced a baseline,
 * which silently broke auto-update for every install (see issue #152).
 *
 * Usage:
 *   node build-fingerprints.mjs <input.json>
 *
 * Input JSON:
 *   { projectRoot: string, sourceFilePaths: string[], gitCommitHash: string }
 *
 * Writes: <projectRoot>/.ua/fingerprints.json (or legacy
 *   <projectRoot>/.understand-anything/fingerprints.json when that dir exists)
 * Exit code: 0 on success (including 0 files analyzed); non-zero on error.
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @understand-anything/core (matches extract-structure.mjs).
// pathToFileURL() is required for Windows: dynamic import() of a raw
// "C:\..." path throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
// ---------------------------------------------------------------------------
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
  buildFingerprintStoreAsync,
  saveFingerprints,
} = core;

async function main() {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    process.stderr.write('Usage: node build-fingerprints.mjs <input.json>\n');
    process.exit(1);
  }

  const { projectRoot, sourceFilePaths, gitCommitHash } = JSON.parse(
    readFileSync(inputPath, 'utf-8'),
  );

  if (!projectRoot || !Array.isArray(sourceFilePaths) || typeof gitCommitHash !== 'string') {
    throw new Error(
      'Invalid input: requires { projectRoot: string, sourceFilePaths: string[], gitCommitHash: string }',
    );
  }

  // Create tree-sitter plugin with all configs that have WASM grammars,
  // mirroring extract-structure.mjs so the baseline matches the comparison
  // logic used during auto-updates.
  const tsConfigs = builtinLanguageConfigs.filter((c) => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();

  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  // Use the async/parallel-I/O variant: for a multi-thousand-file repo the
  // wall time of the baseline-build step is dominated by sequential
  // readFileSync calls; pipelining drops it ~proportional to the disk-wait
  // share. The tree-sitter analysis still runs serially on the main thread
  // (web-tree-sitter is single-threaded WASM), so CPU work is unchanged.
  const store = await buildFingerprintStoreAsync(
    projectRoot,
    sourceFilePaths,
    registry,
    gitCommitHash,
  );
  saveFingerprints(projectRoot, store);

  const fileCount = Object.keys(store.files).length;
  process.stdout.write(`Fingerprints baseline: ${fileCount} files\n`);
}

await main();

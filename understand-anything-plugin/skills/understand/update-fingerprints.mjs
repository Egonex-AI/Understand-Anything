#!/usr/bin/env node
/**
 * update-fingerprints.mjs
 *
 * LOAD-PATCH-SAVE fingerprint update for auto-update Phase 3. Loads the FULL
 * fingerprint store, re-fingerprints only the given changed paths with the
 * same tree-sitter pipeline as build-fingerprints.mjs, removes deleted files,
 * and saves the full store back.
 *
 * Replaces the LLM-written patch script that auto-update-prompt.md used to
 * embed. That script treated fingerprints.json as a flat
 * { path: fingerprint } dict, but the real store shape (see core
 * fingerprint.ts FingerprintStore) nests per-file entries under `files`.
 * Patched entries therefore landed OUTSIDE `files`, so every re-analyzed
 * file looked "new" (no stored fingerprint) on the next auto-update and was
 * re-classified STRUCTURAL forever — the exact permanent-escalation spiral
 * of issue #152, burning tokens on every subsequent commit.
 *
 * Usage:
 *   node update-fingerprints.mjs <input.json>
 *
 * Input JSON:
 *   {
 *     projectRoot: string,
 *     changedFilePaths: string[],  // re-analyzed + deleted paths, project-relative
 *     gitCommitHash: string
 *   }
 *
 * Exit code: 0 on success. Non-zero when no baseline exists — a partial
 * baseline must never be written (it would reproduce issue #152); the
 * caller should re-baseline via /understand instead.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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
  extractFileFingerprint,
  contentHash,
  loadFingerprints,
  saveFingerprints,
} = core;

async function main() {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    process.stderr.write('Usage: node update-fingerprints.mjs <input.json>\n');
    process.exit(1);
  }

  const { projectRoot, changedFilePaths, gitCommitHash } = JSON.parse(
    readFileSync(inputPath, 'utf-8'),
  );
  if (!projectRoot || !Array.isArray(changedFilePaths) || typeof gitCommitHash !== 'string') {
    throw new Error(
      'Invalid input: requires { projectRoot: string, changedFilePaths: string[], gitCommitHash: string }',
    );
  }

  // 1. LOAD the full existing store. Refuse to proceed without one — writing
  //    a store containing only the changed files would clobber the baseline
  //    and force STRUCTURAL/FULL_UPDATE on every later commit (issue #152).
  const store = loadFingerprints(projectRoot);
  if (!store || !store.files || Object.keys(store.files).length === 0) {
    process.stderr.write(
      'Error: update-fingerprints: fingerprints.json missing, unreadable, or empty — ' +
      'refusing to write a partial baseline. Run /understand to re-baseline.\n',
    );
    process.exit(1);
  }
  const before = Object.keys(store.files).length;

  // Same registry construction as build-fingerprints.mjs.
  const tsConfigs = builtinLanguageConfigs.filter((c) => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();
  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  // 2. PATCH (file still exists) or REMOVE (file deleted) each changed path.
  let patched = 0;
  let removed = 0;
  for (const filePath of changedFilePaths) {
    const absolutePath = join(projectRoot, filePath);
    if (!existsSync(absolutePath)) {
      if (filePath in store.files) {
        delete store.files[filePath];
        removed++;
      }
      continue;
    }
    const content = readFileSync(absolutePath, 'utf-8');
    const analysis = registry.analyzeFile(filePath, content);
    store.files[filePath] = analysis
      ? extractFileFingerprint(filePath, content, analysis)
      : {
          // No tree-sitter support: content hash only (conservative) —
          // mirrors buildFingerprintStore's fallback.
          filePath,
          contentHash: contentHash(content),
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          totalLines: content.split('\n').length,
          hasStructuralAnalysis: false,
        };
    patched++;
  }

  // 3. SAVE the FULL store back (never just the patched subset).
  store.gitCommitHash = gitCommitHash;
  store.generatedAt = new Date().toISOString();
  saveFingerprints(projectRoot, store);

  process.stdout.write(
    `Fingerprints: ${before} → ${Object.keys(store.files).length} files ` +
    `(patched ${patched}, removed ${removed})\n`,
  );
}

await main();

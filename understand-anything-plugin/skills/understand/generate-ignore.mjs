#!/usr/bin/env node
/**
 * generate-ignore.mjs
 *
 * Writes a starter `.understand-anything/.understandignore` for the target
 * project by delegating to `generateStarterIgnoreFile` in
 * `@understand-anything/core`. Invoked from SKILL.md Phase 0.5; replaces the
 * inline `node -e "…"` block that previously duplicated the generator logic.
 *
 * Usage:
 *   node generate-ignore.mjs <projectRoot>
 *
 * Behaviour:
 *   - Exits 0 with a stderr notice if the target file already exists.
 *   - Creates `<projectRoot>/.understand-anything/` if missing.
 *   - Emits a one-line stderr summary on success.
 *
 * Mirrors the @understand-anything/core resolution dance used by
 * scan-project.mjs: workspace-linked package first, plugin-cache dist fallback.
 *
 * Plugin root resolution: prefer $PLUGIN_ROOT from the environment (set by
 * SKILL.md Phase 0 via its multi-candidate search) over the
 * `resolve(__dirname, '../..')` heuristic. The relative path breaks when
 * `skills/understand/` is copied into a runtime skills directory whose
 * parent is not the plugin checkout.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePluginRoot() {
  const envRoot = process.env.PLUGIN_ROOT;
  if (envRoot && existsSync(join(envRoot, 'package.json'))) {
    return envRoot;
  }
  return resolve(__dirname, '../..');
}

const pluginRoot = resolvePluginRoot();
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { generateStarterIgnoreFile } = core;

const projectRoot = resolve(process.argv[2] ?? process.cwd());
const outDir = join(projectRoot, '.understand-anything');
const outPath = join(outDir, '.understandignore');

if (existsSync(outPath)) {
  console.error(`generate-ignore: ${outPath} already exists — skipping`);
  process.exit(0);
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, generateStarterIgnoreFile(projectRoot));
console.error(`generate-ignore: wrote ${outPath}`);

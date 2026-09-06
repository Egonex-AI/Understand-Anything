#!/usr/bin/env node
/**
 * sync-skills.mjs — mirror the parent plugin's skills, agents, and built core
 * into this DSH bundle so the installed package is self-contained.
 *
 * The bundle ships:
 *   - `skills/`  — copied from `../skills/` (each skill's scripts derive
 *     `pluginRoot = resolve(__dirname, '../..')` = this bundle, then resolve
 *     `@understand-anything/core` from this bundle's `packages/core/`).
 *   - `agents/`  — copied from `../agents/`.
 *   - `packages/core/` — the built core (`dist/` + `package.json`).
 *   - `vendor/grammars/<tree-sitter-pkg>/` — the grammar WASM files the core loads
 *     via `require.resolve('<pkg>/<file>.wasm')`, shipped as minimal packages so
 *     the bundle does NOT depend on the native `tree-sitter-*` packages (which
 *     carry build scripts that pnpm refuses to run on `dsh plugin add`).
 *     npm strips any `node_modules/` from a packed tarball, so the grammars live
 *     under `vendor/grammars/` and the plugin links them into `node_modules/`
 *     when the profile boots (see lib/index.js).
 *
 * The core's remaining npm dependencies (web-tree-sitter, fuse.js, ignore,
 * yaml, zod) have no build scripts and are declared in this bundle's
 * package.json.
 *
 * Usage: node scripts/sync-skills.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleRoot = resolve(__dirname, '..');
const pluginRoot = resolve(bundleRoot, '..'); // understand-anything-plugin
const workspaceRoot = resolve(pluginRoot, '..'); // repo root

// Whole-directory mirrors.
const DIR_PAIRS = [
  [join(pluginRoot, 'skills'), join(bundleRoot, 'skills')],
  [join(pluginRoot, 'agents'), join(bundleRoot, 'agents')],
];

// Core ships only its built dist + manifest (no src, tests, or node_modules).
const coreSrc = join(pluginRoot, 'packages/core');
const coreDst = join(bundleRoot, 'packages/core');

// Grammar packages whose WASM files the core loads, mapped to the files shipped.
// `wasmFiles` lists every `.wasm` the core resolves from that package.
const GRAMMAR_WASM = {
  'tree-sitter-c': ['tree-sitter-c.wasm'],
  'tree-sitter-cpp': ['tree-sitter-cpp.wasm'],
  'tree-sitter-c-sharp': ['tree-sitter-c_sharp.wasm'],
  'tree-sitter-go': ['tree-sitter-go.wasm'],
  'tree-sitter-java': ['tree-sitter-java.wasm'],
  'tree-sitter-javascript': ['tree-sitter-javascript.wasm'],
  'tree-sitter-php': ['tree-sitter-php.wasm'],
  'tree-sitter-python': ['tree-sitter-python.wasm'],
  'tree-sitter-ruby': ['tree-sitter-ruby.wasm'],
  'tree-sitter-rust': ['tree-sitter-rust.wasm'],
  'tree-sitter-scala': ['tree-sitter-scala.wasm'],
  'tree-sitter-typescript': ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm'],
  '@tree-sitter-grammars/tree-sitter-kotlin': ['tree-sitter-kotlin.wasm'],
};

// Custom workspace WASM packages (not on npm) shipped under a resolvable path.
// These live at `packages/<dir>/<file>` in the parent plugin, not in .pnpm.
const CUSTOM_WASM = {
  '@understand-anything/tree-sitter-dart-wasm': {
    files: ['tree-sitter-dart.wasm'],
    srcDir: join(pluginRoot, 'packages/tree-sitter-dart-wasm'),
  },
  '@understand-anything/tree-sitter-swift-wasm': {
    files: ['tree-sitter-swift.wasm'],
    srcDir: join(pluginRoot, 'packages/tree-sitter-swift-wasm'),
  },
};

/** Find a grammar's installed package dir under the workspace's .pnpm store. */
function findInstalledPkg(pkgName) {
  const scope = pkgName.startsWith('@') ? pkgName.split('/')[0] : null;
  const name = scope ? pkgName.split('/')[1] : pkgName;
  const base = join(workspaceRoot, 'node_modules/.pnpm');
  if (!existsSync(base)) return null;
  const entries = readdirSync(base);
  const key = scope ? `${scope}+${name}@` : `${name}@`;
  const hit = entries.find((e) => e.startsWith(key));
  return hit ? join(base, hit, 'node_modules', ...(scope ? [scope, name] : [name])) : null;
}

for (const [src, dst] of DIR_PAIRS) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`synced ${src} -> ${dst}`);
}

// Core: copy package.json + dist/.
rmSync(coreDst, { recursive: true, force: true });
mkdirSync(join(coreDst, 'dist'), { recursive: true });
cpSync(join(coreSrc, 'package.json'), join(coreDst, 'package.json'));
cpSync(join(coreSrc, 'dist'), join(coreDst, 'dist'), { recursive: true });
console.log(`synced ${coreSrc} (package.json + dist) -> ${coreDst}`);

// Ship grammar WASM files under vendor/grammars (npm strips node_modules from
// tarballs, so the bundle ships the grammars here and the plugin links them
// into node_modules at boot time).
const grammarEntries = Object.entries(GRAMMAR_WASM).map(([name, files]) => [name, { files }]);
const customEntries = Object.entries(CUSTOM_WASM).map(([name, { files, srcDir }]) => [name, { files, srcDir }]);
for (const [pkgName, { files, srcDir }] of [...grammarEntries, ...customEntries]) {
  const dst = join(bundleRoot, 'vendor', 'grammars', ...pkgName.split('/'));
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const file of files) {
    const srcFile = srcDir ? join(srcDir, file) : join(findInstalledPkg(pkgName) ?? '', file);
    if (existsSync(srcFile)) {
      cpSync(srcFile, join(dst, file));
      console.log(`shipped ${pkgName}/${file}`);
    } else {
      console.warn(`WARN: ${pkgName}/${file} not found; skipping`);
    }
  }
  // Minimal package.json so a symlinked node_modules entry resolves.
  const pkgJson = {
    name: pkgName,
    version: '0.0.0',
    type: 'module',
    main: files[0],
    exports: Object.fromEntries(files.map((f) => [`./${f}`, `./${f}`])),
  };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dst, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
}
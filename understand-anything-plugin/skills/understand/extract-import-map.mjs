#!/usr/bin/env node
/**
 * extract-import-map.mjs
 *
 * Deterministic import resolution script for the project-scanner agent.
 * Uses PluginRegistry (TreeSitterPlugin + non-code parsers) from
 * @understand-anything/core to extract raw import paths via tree-sitter,
 * then applies language-specific resolution rules to map them to
 * project-internal file paths.
 *
 * Replaces the LLM-written prose import resolver in agents/project-scanner.md
 * (the prose previously described patterns by language; runtime LLMs produced
 * inconsistent, regex-only scripts with sparse coverage).
 *
 * Usage:
 *   node extract-import-map.mjs <input.json> <output.json>
 *
 * Input JSON:
 *   {
 *     projectRoot: <abs-path>,
 *     files: [{ path, language, fileCategory }, ...]
 *   }
 *
 * Output JSON:
 *   {
 *     scriptCompleted: true,
 *     stats: { filesScanned, filesWithImports, totalEdges },
 *     importMap: { <path>: [<resolvedPath>, ...], ... }
 *   }
 *
 * Logging: stderr only (stdout reserved for piped tools).
 * Per-file resilience: failures emit `Warning: extract-import-map: ...` and
 * set importMap[path] = [], they do not abort the script.
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @understand-anything/core
//
// Node ESM dynamic import() requires a file:// URL on Windows; passing a raw
// absolute path like "C:\..." throws ERR_UNSUPPORTED_ESM_URL_SCHEME because the
// loader parses "C:" as a URL scheme. Wrap both resolutions in pathToFileURL().
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  // Fallback: direct path for installed plugin cache layouts
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { TreeSitterPlugin, PluginRegistry, builtinLanguageConfigs, registerAllParsers } = core;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a project-relative path to forward slashes (POSIX). Project-scanner
 * always emits forward slashes; we re-normalize to keep this script
 * cross-platform.
 */
function toPosix(p) {
  return p.split(/[\\/]/).filter(Boolean).join('/');
}

/**
 * Join a directory with a relative segment, normalizing `.`/`..` segments and
 * returning a forward-slash POSIX path. Anchored at project root (no leading
 * slash). Returns '' if the path walks above the project root.
 */
function resolveRelative(dir, rel) {
  const parts = (dir ? dir.split('/').filter(Boolean) : []).concat(
    rel.split('/').filter(Boolean),
  );
  const stack = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return '';
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

/**
 * Return the directory portion of a project-relative path (no trailing slash,
 * '' for top-level files).
 */
function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

// ---------------------------------------------------------------------------
// Config loading
//
// Cached once at startup. Per-file resolvers consume these values; they MUST
// NOT re-read these files (a 1000-file project would otherwise re-parse the
// same config 1000 times).
// ---------------------------------------------------------------------------

/**
 * Load tsconfig.json from the project root and extract `compilerOptions.paths`
 * and `baseUrl`. Returns `{ baseUrl: string, paths: Map<string, string[]> }`.
 *
 * `paths` keys keep their trailing `*` wildcards intact (e.g. `"@/*"`); the
 * resolver matches them by prefix. Values are arrays because tsconfig allows
 * multiple targets per alias.
 *
 * Silently returns the empty default if tsconfig is missing or malformed —
 * tsconfig is optional and many JS-only projects don't have one.
 */
function loadTsConfig(projectRoot) {
  const candidatePath = join(projectRoot, 'tsconfig.json');
  const empty = { baseUrl: '.', paths: new Map() };
  if (!existsSync(candidatePath)) return empty;

  let raw;
  try {
    raw = readFileSync(candidatePath, 'utf-8');
  } catch {
    return empty;
  }

  // tsconfig.json often contains JSONC-style comments; strip line and block
  // comments before parsing. The strip is conservative — it does not run
  // inside strings, but tsconfig values are simple enough that a naive pass
  // works for >99% of real-world configs.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return empty;
  }

  const compilerOptions = parsed?.compilerOptions ?? {};
  const baseUrl = compilerOptions.baseUrl ?? '.';
  const paths = new Map();
  if (compilerOptions.paths && typeof compilerOptions.paths === 'object') {
    for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
      if (Array.isArray(targets)) {
        paths.set(alias, targets);
      }
    }
  }
  return { baseUrl, paths };
}

/**
 * Resolution context shared across all per-file resolver calls. Holds:
 *  - fileSet: Set<string> of every input file's posix path
 *  - tsConfig: parsed tsconfig.json (paths + baseUrl)
 *  - goModule: module path from go.mod (e.g. 'github.com/foo/bar')
 *  - phpAutoload: PSR-4 namespace -> directory map from composer.json
 *
 * Extra fields will be added as later resolvers come online. Build once;
 * pass everywhere.
 */
function buildResolutionContext(projectRoot, files) {
  const fileSet = new Set(files.map(f => toPosix(f.path)));
  const tsConfig = loadTsConfig(projectRoot);
  return {
    projectRoot,
    fileSet,
    tsConfig,
    // Filled in by later commits as more languages come online
    goModule: '',
    phpAutoload: new Map(),
  };
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript resolver
//
// Handles:
//   - Relative imports: `import x from './foo'` -> `<dir>/foo` + ext probes
//   - tsconfig path aliases: `import x from '@/foo'` -> `<baseUrl>/<target>/foo`
//
// `imp.source` from tree-sitter is the literal string content of the import
// path (no quotes). We don't need to redo the regex work — we just classify
// the source string and dispatch.
// ---------------------------------------------------------------------------

// Extensions probed when the import has no extension. The order mirrors the
// historical project-scanner prose so behavior matches existing fixtures.
const TS_EXT_PROBES = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
];

/**
 * Try ext probes against the file set for the given base path. Returns the
 * first matching project-relative path, or null. If the base path already has
 * a code extension AND exists in the file set, returns it directly.
 */
function probeWithExtensions(basePath, fileSet) {
  if (!basePath) return null;
  // Exact match (import already had an extension)
  if (fileSet.has(basePath)) return basePath;
  for (const ext of TS_EXT_PROBES) {
    const candidate = basePath + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a TypeScript / JavaScript import. Returns project-relative resolved
 * path or null. External packages return null.
 */
export function resolveTsJsImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src) return null;

  const importerDir = dirOf(toPosix(file.path));

  // Relative imports: ./foo, ../foo
  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet);
  }

  // tsconfig path aliases (e.g. "@/foo" with paths { "@/*": ["src/*"] })
  const { baseUrl, paths } = ctx.tsConfig;
  if (paths && paths.size > 0) {
    for (const [alias, targets] of paths) {
      const aliasMatch = matchTsAlias(alias, src);
      if (aliasMatch === null) continue;
      for (const target of targets) {
        const mapped = applyTsAlias(target, aliasMatch);
        // baseUrl is project-root-relative; '.', './', '' all mean the root.
        const baseDir = baseUrl === '.' || baseUrl === '' ? '' : toPosix(baseUrl);
        const candidate = baseDir
          ? posix.join(baseDir, mapped)
          : mapped;
        const probed = probeWithExtensions(candidate, ctx.fileSet);
        if (probed) return probed;
      }
    }
  }

  // Bare specifier with no leading `./`, no alias match -> external package.
  return null;
}

/**
 * Match an import against a tsconfig paths alias. Aliases use `*` as a single
 * wildcard, e.g. `"@/*"` matches `"@/foo/bar"` with the wildcard = "foo/bar".
 * Aliases without `*` must match exactly. Returns the wildcard content
 * (possibly '') on match, null on no match.
 */
function matchTsAlias(alias, src) {
  const starIdx = alias.indexOf('*');
  if (starIdx === -1) {
    return src === alias ? '' : null;
  }
  const prefix = alias.slice(0, starIdx);
  const suffix = alias.slice(starIdx + 1);
  if (!src.startsWith(prefix)) return null;
  if (!src.endsWith(suffix)) return null;
  // Avoid double-counting when prefix+suffix length exceeds src length
  if (src.length < prefix.length + suffix.length) return null;
  return src.slice(prefix.length, src.length - suffix.length);
}

/**
 * Substitute the wildcard content into a tsconfig target. Mirror of
 * matchTsAlias — if the target has no `*`, return it as-is (rare, but valid).
 */
function applyTsAlias(target, wildcard) {
  const starIdx = target.indexOf('*');
  if (starIdx === -1) return target;
  return target.slice(0, starIdx) + wildcard + target.slice(starIdx + 1);
}

/**
 * Tree-sitter's TS/JS extractor only records ES module `import` declarations.
 * CommonJS `require('./foo')` is treated as a generic call expression and
 * never enters `analysis.imports`, which would silently drop edges in
 * Node-style codebases. Patch coverage with a focused regex pass on the file
 * content — we only want literal string arguments, so the regex is narrow.
 *
 * Limitations (intentional):
 *   - Computed requires (`require(name)`) are external/dynamic — skipped.
 *   - Template-literal requires are unresolved.
 *   - String concatenation in the argument is unresolved.
 */
const REQUIRE_LITERAL_RE = /\brequire\(\s*(['"])([^'"`\n]+?)\1\s*\)/g;

function extractRequireSources(content) {
  const sources = [];
  let m;
  REQUIRE_LITERAL_RE.lastIndex = 0;
  while ((m = REQUIRE_LITERAL_RE.exec(content)) !== null) {
    sources.push(m[2]);
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Python resolver
//
// Tree-sitter's Python extractor emits one entry per import statement:
//   - `import a.b.c`          -> { source: 'a.b.c', specifiers: ['a.b.c'] }
//   - `from a.b.c import x,y` -> { source: 'a.b.c', specifiers: ['x','y'] }
//   - `from . import x`       -> { source: '', specifiers: ['x'] }
//   - `from .x import y`      -> { source: '.x', specifiers: ['y'] }
//   - `from ..pkg import y`   -> { source: '..pkg', specifiers: ['y'] }
//
// We can't tell relative from absolute by the source string alone — the dots
// could be a leading-dot relative source OR a literal `.` package separator.
// Python's lexical convention disambiguates: leading dots ALWAYS mean
// relative. Tree-sitter preserves leading dots verbatim in the source field,
// so we can dispatch on the prefix.
//
// Resolution rules:
//   1. Relative (starts with `.`): walk up parent dirs by leading-dot count,
//      then descend by the remaining dotted segments.
//   2. Absolute (no leading dot): try `a/b/c.py` then `a/b/c/__init__.py`
//      against the file set; resolve to the first match. If matched as a
//      package, additionally probe each specifier as a submodule
//      (`a/b/c/x.py`, `a/b/c/x/__init__.py`).
// ---------------------------------------------------------------------------

/**
 * Resolve a Python import. Unlike most resolvers this can produce multiple
 * matches (one for the package `__init__.py` plus one per submodule
 * specifier), so the signature differs: returns string[].
 *
 * Returns empty array for external/unresolved packages.
 */
export function resolvePythonImport(rawImport, specifiers, file, ctx) {
  if (typeof rawImport !== 'string') return [];
  const src = rawImport;
  const importerDir = dirOf(toPosix(file.path));

  // Count leading dots; the rest is a dotted module path
  let dots = 0;
  while (dots < src.length && src.charCodeAt(dots) === 0x2e /* '.' */) dots++;
  const tail = src.slice(dots);
  const tailSegments = tail ? tail.split('.').filter(Boolean) : [];

  if (dots > 0) {
    // Relative import. `from . import x` (dots=1, tail='') walks up zero
    // directories (sibling level); `from .. import x` walks up one.
    const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
    const dropLevels = dots - 1;
    if (dropLevels > importerParts.length) {
      // Walked above the project root — unresolvable
      return [];
    }
    const baseParts = importerParts.slice(0, importerParts.length - dropLevels);
    const moduleParts = baseParts.concat(tailSegments);
    return resolvePythonProbe(moduleParts, specifiers, ctx);
  }

  // Absolute. Walk through each successive prefix from longest to shortest.
  // This is necessary because `from a.b import c` should probe `a/b.py` first
  // (with c as a specifier), not just `a/b/c.py`. But we ALSO need to handle
  // the case where `a.b` is itself a module path (no specifier dimension at
  // all, as with bare `import a.b`).
  return resolvePythonProbe(tailSegments, specifiers, ctx);
}

/**
 * Given a fully-qualified module-path segment list (e.g. ['src','utils']),
 * probe the file set for `a/b/c.py` then `a/b/c/__init__.py`. On package
 * match, also probe each specifier as a submodule. Returns an array of
 * resolved project-relative paths (deduped by Set in caller).
 */
function resolvePythonProbe(moduleParts, specifiers, ctx) {
  if (moduleParts.length === 0) {
    // `from . import x` case: importer's package is the implicit module;
    // each x is a sibling module to probe directly.
    return [];
  }
  const base = moduleParts.join('/');
  const matches = [];

  const moduleFile = `${base}.py`;
  const packageInit = `${base}/__init__.py`;

  if (ctx.fileSet.has(moduleFile)) {
    matches.push(moduleFile);
    return matches; // No further probing on a leaf module file.
  }
  if (ctx.fileSet.has(packageInit)) {
    matches.push(packageInit);
    // Package match: probe each specifier as a submodule
    if (Array.isArray(specifiers)) {
      for (const spec of specifiers) {
        // Wildcard `*` and qualified specifiers (`Foo.bar`) skip; the
        // surface name is what tree-sitter records for `from pkg import x`.
        if (!spec || spec === '*' || spec.includes('.')) continue;
        const subFile = `${base}/${spec}.py`;
        const subInit = `${base}/${spec}/__init__.py`;
        if (ctx.fileSet.has(subFile)) matches.push(subFile);
        else if (ctx.fileSet.has(subInit)) matches.push(subInit);
      }
    }
    return matches;
  }

  // No match — external package.
  return [];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Languages recognized as "code" for resolver dispatch. Tree-sitter parses
 * these via the corresponding extractor; the dispatcher routes the import
 * source through the matching resolver.
 */
const TS_JS_LANGS = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'vue',
]);

/**
 * Dispatch a raw import to the language-specific resolver. Returns an array
 * of resolved project-relative paths (most resolvers produce 0 or 1; Python
 * can produce multiple when a `from pkg import a, b, c` resolves both the
 * package's `__init__.py` and each submodule).
 *
 * Per-resolver contract: never throw, never read disk (read once in main()).
 * Empty array means external/unresolved.
 */
function resolveImport(imp, file, ctx) {
  const lang = file.language;
  const src = imp.source;
  if (TS_JS_LANGS.has(lang)) {
    const out = resolveTsJsImport(src, file, ctx);
    return out ? [out] : [];
  }
  if (lang === 'python') {
    return resolvePythonImport(src, imp.specifiers, file, ctx);
  }
  // Other languages handled in later commits
  return [];
}

/**
 * Collect extra raw import sources that tree-sitter doesn't capture. Today
 * this is CommonJS require() literals for JS/TS files. Returns an array of
 * import-source strings to be passed through resolveImport().
 */
function extractExtraImportSources(file, content) {
  if (TS_JS_LANGS.has(file.language)) {
    return extractRequireSources(content);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node extract-import-map.mjs <input.json> <output.json>\n');
    process.exit(1);
  }

  const inputRaw = readFileSync(inputPath, 'utf-8');
  const input = JSON.parse(inputRaw);
  const { projectRoot, files } = input;

  if (!projectRoot || !Array.isArray(files)) {
    throw new Error('Invalid input: must contain projectRoot and files array');
  }

  // Create tree-sitter plugin with all configs that have WASM grammars
  const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();

  // Create registry and register tree-sitter + all non-code parsers
  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  // Build resolution context (cached configs)
  const ctx = buildResolutionContext(projectRoot, files);

  const importMap = {};
  let filesWithImports = 0;
  let totalEdges = 0;

  for (const file of files) {
    const path = toPosix(file.path);

    // Non-code files always get an empty array
    if (file.fileCategory !== 'code') {
      importMap[path] = [];
      continue;
    }

    const absolutePath = join(projectRoot, file.path);

    // Read file content (per-file resilience)
    let content;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: import resolution failed for ${path} ` +
        `(read error: ${err.message}) — importMap[${path}]=[]\n`,
      );
      importMap[path] = [];
      continue;
    }

    // Analyze + resolve
    let resolved;
    try {
      const analysis = registry.analyzeFile(file.path, content);
      const imports = analysis?.imports ?? [];
      const resolvedSet = new Set();
      for (const imp of imports) {
        const outs = resolveImport(imp, file, ctx);
        for (const out of outs) {
          if (out && ctx.fileSet.has(out)) {
            resolvedSet.add(out);
          }
        }
      }
      // Supplemental pass for sources tree-sitter doesn't capture (e.g. CJS
      // require() calls). Dedup with the set above so we don't double-count.
      for (const extra of extractExtraImportSources(file, content)) {
        // Synthesize a minimal `imp`-shaped object so the dispatcher sees
        // the same surface for both tree-sitter and supplemental sources.
        const outs = resolveImport({ source: extra, specifiers: [] }, file, ctx);
        for (const out of outs) {
          if (out && ctx.fileSet.has(out)) {
            resolvedSet.add(out);
          }
        }
      }
      resolved = [...resolvedSet].sort((a, b) => a.localeCompare(b));
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: import resolution failed for ${path} ` +
        `(analyze error: ${err.message}) — importMap[${path}]=[]\n`,
      );
      importMap[path] = [];
      continue;
    }

    importMap[path] = resolved;
    if (resolved.length > 0) {
      filesWithImports += 1;
      totalEdges += resolved.length;
    }
  }

  const output = {
    scriptCompleted: true,
    stats: {
      filesScanned: files.length,
      filesWithImports,
      totalEdges,
    },
    importMap,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }

  process.stderr.write(
    `extract-import-map: filesScanned=${files.length} ` +
    `filesWithImports=${filesWithImports} totalEdges=${totalEdges}\n`,
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
    process.stderr.write(`extract-import-map.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

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
 * Parse a single tsconfig.json file content and return
 * `{ baseUrl: string, paths: Map<string, string[]> }` or `null` if both the
 * comment-stripped and raw parses fail. Centralizes the "JSONC-then-raw"
 * fallback so callers can iterate many tsconfigs without duplicating the
 * try/catch ladder.
 *
 * Returning `null` (rather than throwing) lets the caller emit a Warning:
 * with the exact tsconfig path that failed; bubbling the error would
 * conceal which file was at fault when many tsconfigs are loaded.
 */
function parseTsConfigText(raw) {
  // tsconfig.json often contains JSONC-style comments; strip line and block
  // comments before parsing. The strip is naive (it doesn't honor string
  // contents), so we fall back to the raw text on failure.
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
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
 * Load every `tsconfig.json` discovered in the input file list and parse
 * each. Returns `Map<dirPath, { baseUrl, paths }>` keyed by the
 * project-relative POSIX directory containing the tsconfig (empty string
 * for a root-level tsconfig.json).
 *
 * `paths` keys keep their trailing `*` wildcards intact (e.g. `"@/*"`); the
 * resolver matches them by prefix. Values are arrays because tsconfig
 * allows multiple targets per alias.
 *
 * WHY plural: pnpm/yarn workspace monorepos commonly carry per-package
 * tsconfig.json files with package-scoped `paths` aliases. Loading only
 * the root tsconfig would (1) miss aliases defined in sub-packages and
 * (2) erroneously apply root aliases to files in sub-packages that
 * redefine them. Per-importer walk-up is the only correct behavior.
 *
 * Returns an empty map if no tsconfigs are found — many JS-only projects
 * have none, and relative imports still resolve without one. On parse
 * failure for a specific tsconfig, emits a Warning: pointing at the bad
 * file and skips it (the rest of the project keeps working).
 *
 * Parse strategy (per-file, in parseTsConfigText):
 *   1. Try the comment-stripped text (handles JSONC-style tsconfigs).
 *   2. If that fails, retry the ORIGINAL raw text — recovers the case
 *      where the stripper damaged a string literal containing `//`.
 *   3. If both fail, warn and skip — that tsconfig contributes no aliases.
 */
function loadTsConfigs(projectRoot, files) {
  const out = new Map();
  for (const f of files) {
    const p = toPosix(f.path);
    const base = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    if (base !== 'tsconfig.json') continue;
    const absPath = join(projectRoot, p);
    if (!existsSync(absPath)) continue;
    let raw;
    try {
      raw = readFileSync(absPath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: tsconfig.json at ${absPath} failed ` +
        `to read (${err.message}) — path aliases from this config will ` +
        `not be applied — relative imports unaffected\n`,
      );
      continue;
    }
    const parsed = parseTsConfigText(raw);
    if (!parsed) {
      process.stderr.write(
        `Warning: extract-import-map: tsconfig.json at ${absPath} failed ` +
        `to parse — path aliases from this config will not be applied ` +
        `— relative imports unaffected\n`,
      );
      continue;
    }
    out.set(dirOf(p), parsed);
  }
  return out;
}

/**
 * Load every `go.mod` discovered in the input file list and extract its
 * `module <name>` line. Returns `Map<dirPath, moduleName>` where `dirPath`
 * is the project-relative POSIX directory containing the go.mod (empty
 * string for a root-level go.mod).
 *
 * WHY plural: multi-service / multi-module repositories (e.g. Google's
 * microservices-demo) have one go.mod per service. The resolver dispatches
 * per importer by walking up to the nearest go.mod, so a single root-only
 * lookup misses every file that lives inside a sub-module.
 *
 * Files outside the discovered `files[]` are ignored — the project-scanner
 * is the single source of truth for what the user considers part of the
 * project. On read failure for a discovered go.mod we silently skip that
 * entry; the per-file resolver will surface the "no ancestor go.mod" warning
 * if it matters for any importer.
 *
 * Example go.mod:
 *   module github.com/foo/bar
 *   go 1.21
 *
 * The resolver uses each module's prefix to translate
 * `import "github.com/foo/bar/x"` into the project-internal `x/<file>.go`.
 */
function loadGoModules(projectRoot, files) {
  const out = new Map();
  for (const f of files) {
    const p = toPosix(f.path);
    const base = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    if (base !== 'go.mod') continue;
    const absPath = join(projectRoot, p);
    if (!existsSync(absPath)) continue;
    let raw;
    try {
      raw = readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }
    let moduleName = '';
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.replace(/\/\/.*$/, '').trim();
      if (!trimmed.startsWith('module ')) continue;
      moduleName = trimmed.slice('module '.length).trim();
      break;
    }
    if (!moduleName) continue;
    out.set(dirOf(p), moduleName);
  }
  return out;
}

/**
 * Walk up from `startDir` (project-relative POSIX, '' for project root)
 * and return the DEEPEST ancestor directory that exists as a key in
 * `configMap`, or undefined if no ancestor matches.
 *
 * Determinism: ancestors are inspected from deepest to shallowest, so the
 * deepest match is always picked. This matches the way TS/JS / PHP / Go
 * tools resolve nearest config in the wild ("nearest enclosing").
 *
 * Defensive note: if multiple distinct keys somehow share a depth (cannot
 * happen with proper directory paths, but a malformed input could), the
 * caller is expected to have normalized the keys. We do not re-sort here
 * because the iteration order is determined by depth alone.
 */
function findNearestConfigDir(startDir, configMap) {
  if (configMap.size === 0) return undefined;
  // Walk ancestors from the importer's directory up to the project root.
  // Slicing the parts array gives every prefix; we test each from longest
  // to shortest so the deepest match wins.
  const parts = startDir ? startDir.split('/').filter(Boolean) : [];
  for (let i = parts.length; i >= 0; i--) {
    const ancestor = parts.slice(0, i).join('/');
    if (configMap.has(ancestor)) return ancestor;
  }
  return undefined;
}

/**
 * Resolution context shared across all per-file resolver calls. Holds:
 *  - fileSet: Set<string> of every input file's posix path
 *  - tsConfigs: Map<dir, { baseUrl, paths }> from every tsconfig.json in
 *    `files[]`. Per-import resolution walks up from the importer to the
 *    nearest enclosing tsconfig.
 *  - goModules: Map<dir, moduleName> from every go.mod in `files[]`.
 *  - phpAutoloads: Map<dir, autoloadMap> from every composer.json in
 *    `files[]`. Resolved paths are anchored at the composer's directory.
 *  - goFilesByDir: Map<dir, string[]> of .go files per directory (built
 *    once so Go's package-level import dispatch doesn't re-scan the file
 *    set per import).
 *
 * Build once; pass everywhere.
 */
function buildResolutionContext(projectRoot, files) {
  const fileSet = new Set(files.map(f => toPosix(f.path)));
  const tsConfigs = loadTsConfigs(projectRoot, files);
  const goModules = loadGoModules(projectRoot, files);

  // Index .go files by their parent directory so the Go resolver can
  // expand a package-level import to all member .go files in O(1).
  const goFilesByDir = new Map();
  for (const f of files) {
    if (!f.path.endsWith('.go')) continue;
    const p = toPosix(f.path);
    const d = dirOf(p);
    if (!goFilesByDir.has(d)) goFilesByDir.set(d, []);
    goFilesByDir.get(d).push(p);
  }
  for (const arr of goFilesByDir.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }

  // Build per-extension suffix indices for dotted-FQN resolvers (Java,
  // Kotlin, C#). Indexed once; reused for every import dispatch.
  const javaIndex = buildSuffixIndex(files, p => p.endsWith('.java'));
  const kotlinIndex = buildSuffixIndex(files, p => p.endsWith('.kt'));
  const csIndex = buildSuffixIndex(files, p => p.endsWith('.cs'));

  const phpAutoloads = loadPhpAutoloads(projectRoot, files);

  return {
    projectRoot,
    fileSet,
    tsConfigs,
    goModules,
    goFilesByDir,
    javaIndex,
    kotlinIndex,
    csIndex,
    phpAutoloads,
    // Dedupe Sets for one-time-per-file warnings. Keyed by importer file
    // path. Mutated by resolvers.
    _warnedNoRustCrateRoot: new Set(),
    _warnedNoGoModule: new Set(),
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
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.mts', '/index.cts',
  '/index.js', '/index.jsx', '/index.mjs', '/index.cjs',
];

const RUNTIME_JS_SPECIFIER_PROBES = new Map([
  ['.js', ['.ts', '.tsx', '.js', '.jsx']],
  ['.jsx', ['.tsx', '.jsx']],
  ['.mjs', ['.mts', '.ts', '.mjs']],
  ['.cjs', ['.cts', '.ts', '.cjs']],
]);

function getRuntimeJsSpecifierExt(basePath) {
  for (const runtimeExt of RUNTIME_JS_SPECIFIER_PROBES.keys()) {
    if (basePath.endsWith(runtimeExt)) return runtimeExt;
  }
  return null;
}

function probeRuntimeJsSpecifier(basePath, runtimeExt, fileSet) {
  const sourceStem = basePath.slice(0, -runtimeExt.length);
  for (const sourceExt of RUNTIME_JS_SPECIFIER_PROBES.get(runtimeExt)) {
    const candidate = sourceStem + sourceExt;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Try ext probes against the file set for the given base path. Returns the
 * first matching project-relative path, or null. If the base path already has
 * a code extension AND exists in the file set, returns it directly.
 */
function probeWithExtensions(basePath, fileSet) {
  if (!basePath) return null;
  // Exact match (import already had an extension)
  if (fileSet.has(basePath)) return basePath;
  const runtimeExt = getRuntimeJsSpecifierExt(basePath);
  if (runtimeExt) return probeRuntimeJsSpecifier(basePath, runtimeExt, fileSet);
  for (const ext of TS_EXT_PROBES) {
    const candidate = basePath + ext;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve a TypeScript / JavaScript import. Returns project-relative resolved
 * path or null. External packages return null.
 *
 * Path-alias resolution walks up from the importer's directory to find the
 * nearest enclosing tsconfig.json (monorepo-friendly). `baseUrl`-relative
 * targets are anchored at THAT tsconfig's directory, matching the way the
 * TypeScript compiler resolves nested project configs.
 */
export function resolveTsJsImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return null;
  const src = rawImport.trim();
  if (!src) return null;

  const importerDir = dirOf(toPosix(file.path));

  // Relative imports: ./foo, ../foo — tsconfig has no bearing here.
  if (src.startsWith('./') || src.startsWith('../')) {
    const base = resolveRelative(importerDir, src);
    return probeWithExtensions(base, ctx.fileSet);
  }

  // tsconfig path aliases. Walk up from the importer to find the nearest
  // tsconfig.json; resolve targets relative to THAT tsconfig's directory.
  // Without the walk-up, a root tsconfig would either swallow aliases that
  // belong to a sub-package or fail to apply sub-package-defined aliases.
  const tsConfigDir = findNearestConfigDir(importerDir, ctx.tsConfigs);
  if (tsConfigDir !== undefined) {
    const tsConfig = ctx.tsConfigs.get(tsConfigDir);
    const { baseUrl, paths } = tsConfig;
    if (paths && paths.size > 0) {
      for (const [alias, targets] of paths) {
        const aliasMatch = matchTsAlias(alias, src);
        if (aliasMatch === null) continue;
        for (const target of targets) {
          const mapped = applyTsAlias(target, aliasMatch);
          // baseUrl is tsconfig-dir-relative; '.', './', '' all mean the
          // tsconfig's own directory. We anchor at tsConfigDir so a nested
          // tsconfig's `baseUrl: '.'` maps to its package, not project root.
          const normalizedBase = baseUrl === '.' || baseUrl === ''
            ? ''
            : toPosix(baseUrl);
          const relativeToConfig = normalizedBase
            ? posix.join(normalizedBase, mapped)
            : mapped;
          // posix.normalize strips a leading "./" left over when both
          // tsConfigDir and normalizedBase are empty (root tsconfig with
          // `"@/*": ["./*"]`, the create-next-app default). Without this the
          // candidate stays as "./foo" while ctx.fileSet stores "foo", and
          // probeWithExtensions silently drops every cross-module edge.
          const candidate = posix.normalize(
            tsConfigDir
              ? posix.join(tsConfigDir, relativeToConfig)
              : relativeToConfig,
          );
          // Defensive: tsconfig targets shouldn't escape the project root.
          if (candidate.startsWith('..')) continue;
          const probed = probeWithExtensions(candidate, ctx.fileSet);
          if (probed) return probed;
        }
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

/**
 * Strip JS/TS line and block comments before running text-pattern matchers.
 * Replaces with spaces (preserving offsets isn't critical here, but keeping
 * roughly the same length avoids surprising the matcher with collapsed
 * whitespace). Does not attempt to honor string contents — that's fine for
 * the narrow patterns we run (`require('...')`, etc.) because the same
 * comment-or-not heuristic applies uniformly to all matched literals.
 */
function stripJsLikeComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

function extractRequireSources(content) {
  const sources = [];
  let m;
  const stripped = stripJsLikeComments(content);
  REQUIRE_LITERAL_RE.lastIndex = 0;
  while ((m = REQUIRE_LITERAL_RE.exec(stripped)) !== null) {
    sources.push(m[2]);
  }
  return sources;
}

/**
 * Kotlin has no tree-sitter extractor in this project, so we collect its
 * import sources via a focused regex pass. Kotlin imports are syntactically
 * simple: one per line, `import x.y.Z` or `import x.y.Z as Alias` (or
 * `import x.y.*` for star imports). We capture the dotted FQN and let the
 * dotted resolver classify wildcards.
 *
 * The capture is a strict qualifiedName grammar — a leading identifier
 * followed by zero or more `.identifier` segments and an optional trailing
 * `.*` for star-imports. The looser `[\w.*]+` form previously here would
 * match pathological inputs like `import ...` or `import .foo`.
 */
const KOTLIN_IMPORT_RE =
  /^\s*import\s+(\w+(?:\.\w+)*(?:\.\*)?)(?:\s+as\s+\w+)?\s*$/gm;

function extractKotlinSources(content) {
  const sources = [];
  let m;
  KOTLIN_IMPORT_RE.lastIndex = 0;
  while ((m = KOTLIN_IMPORT_RE.exec(content)) !== null) {
    sources.push(m[1]);
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
//   2. Absolute (no leading dot): walk up from the importer's directory,
//      trying EACH ancestor as a candidate Python root. The first ancestor
//      under which probing succeeds wins. This matches how multi-service
//      Python repos work in practice — each service directory acts as its
//      own root for unqualified `import sibling` style imports
//      (e.g. microservices-demo's per-service grpc stubs).
//
//      We don't gate this on setup.py / pyproject.toml detection. The
//      probe itself IS the test of whether the ancestor is a candidate
//      root: an absent module just continues the walk. The closest
//      ancestor where the import resolves wins, which gives importer
//      scope precedence (sibling files override remote candidates).
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
    // Relative imports are anchored at the importer's package, so we do
    // NOT do the per-root walk-up here — leading dots already encode the
    // exact anchor.
    const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
    const dropLevels = dots - 1;
    if (dropLevels > importerParts.length) {
      // Walked above the project root — unresolvable
      return [];
    }
    const baseParts = importerParts.slice(0, importerParts.length - dropLevels);

    // `from .[..] import x, y` with no dotted tail — specifiers are siblings
    // at `baseParts`. Probe directly without requiring `<baseParts>/__init__.py`
    // to exist: PEP 328 implicit namespace packages are common in modern
    // Python (no `__init__.py`), and `resolvePythonProbe` would otherwise
    // gate specifier resolution on the package marker and drop these imports.
    if (tailSegments.length === 0) {
      if (!Array.isArray(specifiers) || specifiers.length === 0) return [];
      const base = baseParts.join('/');
      const matches = [];
      for (const spec of specifiers) {
        // Wildcard `*` and qualified specifiers (`Foo.bar`) skip; the
        // surface name is what tree-sitter records for `from . import x`.
        if (!spec || spec === '*' || spec.includes('.')) continue;
        const subFile = base ? `${base}/${spec}.py` : `${spec}.py`;
        const subInit = base ? `${base}/${spec}/__init__.py` : `${spec}/__init__.py`;
        if (ctx.fileSet.has(subFile)) matches.push(subFile);
        else if (ctx.fileSet.has(subInit)) matches.push(subInit);
      }
      return matches;
    }

    const moduleParts = baseParts.concat(tailSegments);
    return resolvePythonProbe(moduleParts, specifiers, ctx);
  }

  // Absolute import. Walk up from the importer's directory and try every
  // ancestor as a candidate Python root — the first one where probing
  // resolves anything wins. This handles the multi-service / multi-package
  // case where each service's directory acts as its own implicit
  // sys.path entry (e.g. `import demo_pb2_grpc` from
  // `src/emailservice/email_server.py` should resolve to
  // `src/emailservice/demo_pb2_grpc.py`, NOT fail because the file isn't
  // at `<projectRoot>/demo_pb2_grpc.py`).
  //
  // Importer-scope precedence (deepest ancestor first) means that when
  // the same module name exists in multiple services, each service's
  // file shadows the others — no cross-service edges.
  if (tailSegments.length === 0) {
    // `from . import x` is dots>0 only; reaching here means the source
    // was the empty string. Nothing to probe.
    return [];
  }

  const importerParts = importerDir ? importerDir.split('/').filter(Boolean) : [];
  for (let i = importerParts.length; i >= 0; i--) {
    const rootParts = importerParts.slice(0, i);
    const candidateModule = rootParts.concat(tailSegments);
    const matches = resolvePythonProbe(candidateModule, specifiers, ctx);
    if (matches.length > 0) return matches;
  }
  return [];
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
// Go resolver
//
// Tree-sitter's Go extractor emits the literal import path (without quotes).
// Resolution: walk up from the importer's directory to find the nearest
// enclosing `go.mod` (multi-module monorepos are the norm). Strip that
// module's prefix; the remainder maps to a directory RELATIVE TO THAT
// MODULE'S DIRECTORY in the project. Go imports are package-level (not
// file-level), so a single `import "github.com/foo/bar/util"` produces edges
// to every .go file inside that module's `util/`.
//
// Cross-module imports (`github.com/foo/bar/X` from a file under a module
// that declares `github.com/foo/baz`) are correctly classified as external —
// they refer to a different Go module, which from this module's perspective
// is a third-party dependency.
//
// Inputs:
//   - rawImport: 'github.com/foo/bar/util' (no quotes)
//   - file.path: importer's project-relative path
//   - ctx.goModules: Map<dir, moduleName> of every go.mod discovered.
//
// Result: array of every `<moduleDir>/util/*.go` path in the project
// (deduped by caller).
// ---------------------------------------------------------------------------

export function resolveGoImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return [];
  const src = rawImport.trim();
  if (!src) return [];

  const importerPath = toPosix(file.path);
  const importerDir = dirOf(importerPath);

  const nearestModuleDir = findNearestConfigDir(importerDir, ctx.goModules);
  if (nearestModuleDir === undefined) {
    // Warn once per importer file — a single .go file can import several
    // module-prefixed paths, so suppress duplicates.
    if (!ctx._warnedNoGoModule.has(importerPath)) {
      ctx._warnedNoGoModule.add(importerPath);
      process.stderr.write(
        `Warning: extract-import-map: Go file ${importerPath} has no ` +
        `ancestor go.mod — import ${src} unresolvable — module-prefix ` +
        `imports skipped\n`,
      );
    }
    return [];
  }

  const moduleName = ctx.goModules.get(nearestModuleDir);

  // Strip module prefix; require a `/` boundary so 'githubXcom...' does not
  // accidentally match 'github.com...'.
  let remainder;
  if (src === moduleName) {
    remainder = '';
  } else if (src.startsWith(moduleName + '/')) {
    remainder = src.slice(moduleName.length + 1);
  } else {
    // External package (stdlib, 3rd-party module, OR a different in-tree
    // module — the latter is intentional: from this module's perspective,
    // a sibling module is an external dependency).
    return [];
  }

  // Map to a directory in the project (POSIX style). Anchor at the module's
  // own directory, so a sub-module's `<module>/sub` resolves under that
  // module's tree rather than under project root.
  const subDir = toPosix(remainder);
  const targetDir = nearestModuleDir
    ? (subDir ? `${nearestModuleDir}/${subDir}` : nearestModuleDir)
    : subDir;
  const files = ctx.goFilesByDir.get(targetDir);
  return files ? [...files] : [];
}

// ---------------------------------------------------------------------------
// Dotted-package resolver (Java / Kotlin / C#)
//
// Shared logic: an import like `com.example.foo.Bar` maps to a file
// `**/com/example/foo/Bar.<ext>` in the project. Many JVM/CLR projects nest
// sources under `src/main/java/`, `src/main/kotlin/`, etc., so the resolver
// must search for any file whose suffix matches the dotted-path-as-file form.
//
// We pre-build an index: trailing-slash-suffix -> matching project paths.
// Indexing once is O(files * average_segments); per-import lookup is then
// effectively O(1) hash lookup + scan of the bucket.
// ---------------------------------------------------------------------------

/**
 * Build an index of all files for a given extension, keyed by their
 * "package-path suffix" form. For each file `src/main/java/com/x/Y.java`,
 * the index gets entries for every suffix that ends at a `/`:
 *   - 'com/x/Y.java'
 *   - 'x/Y.java'
 *   - 'Y.java'
 * keyed off each successively-shorter suffix.
 *
 * Using a Map<suffix, string[]> avoids per-import full table scans; a 50K-file
 * monorepo with deep package nesting still resolves O(1) per import.
 */
function buildSuffixIndex(files, extPredicate) {
  const idx = new Map();
  for (const f of files) {
    const p = toPosix(f.path);
    if (!extPredicate(p)) continue;
    // Generate every "directory-bounded suffix" of the path
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      if (!idx.has(suffix)) idx.set(suffix, []);
      idx.get(suffix).push(p);
    }
  }
  // Deterministic order within each bucket
  for (const arr of idx.values()) {
    arr.sort((a, b) => a.localeCompare(b));
  }
  return idx;
}

/**
 * Resolve a dotted-import to a file. `fqn` is the qualified name
 * (`com.example.Foo`); `ext` is the file extension to probe (`.java`,
 * `.kt`, `.cs`). Wildcards (e.g. `com.example.*`) and the trailing `*` in
 * Java's `com.example.*` are stripped before resolution — there is no good
 * single-file resolution for wildcards, so we drop them. (Tree-sitter
 * already exposes `*` as a specifier; the source field strips it.)
 *
 * Returns array (most cases: 0 or 1 match; multiple if the same suffix
 * appears in multiple source roots).
 */
function resolveDottedFqn(fqn, ext, suffixIndex) {
  if (!fqn || typeof fqn !== 'string') return [];
  // Strip trailing wildcard segments like `com.example.*`
  const trimmed = fqn.replace(/\.\*$/, '');
  if (!trimmed) return [];
  const filePart = trimmed.replace(/\./g, '/') + ext;
  const matches = suffixIndex.get(filePart);
  return matches ? [...matches] : [];
}

// ---------------------------------------------------------------------------
// Java resolver
// ---------------------------------------------------------------------------

export function resolveJavaImport(rawImport, _file, ctx) {
  return resolveDottedFqn(rawImport, '.java', ctx.javaIndex);
}

// ---------------------------------------------------------------------------
// Kotlin resolver
//
// Kotlin has no tree-sitter extractor in this project, so its import sources
// are collected via a focused regex pass in extractExtraImportSources(); the
// resolver itself is identical-shape to Java.
// ---------------------------------------------------------------------------

export function resolveKotlinImport(rawImport, _file, ctx) {
  return resolveDottedFqn(rawImport, '.kt', ctx.kotlinIndex);
}

// ---------------------------------------------------------------------------
// C# resolver
//
// C# `using Foo.Bar;` declarations are typically NAMESPACES, not files, and
// the C# convention is namespace = directory (loose). Tree-sitter's C#
// extractor captures these as imports with the dotted source. We probe the
// dotted path against the .cs index the same way Java/Kotlin do.
// ---------------------------------------------------------------------------

export function resolveCSharpImport(rawImport, _file, ctx) {
  return resolveDottedFqn(rawImport, '.cs', ctx.csIndex);
}

// ---------------------------------------------------------------------------
// Ruby resolver
//
// Two distinct Ruby import forms, with different resolution semantics:
//   - `require_relative 'foo'`  -> resolve against the importer's directory,
//                                  append .rb
//   - `require 'foo/bar'`       -> load-path probe: lib/foo/bar.rb,
//                                  app/foo/bar.rb, or foo/bar.rb (whichever
//                                  exists)
//
// Tree-sitter's Ruby extractor uses a single `imports` field for both forms
// and drops the method name, so we cannot tell them apart from the
// extractor output alone. Instead we use a regex pass on the file content,
// which preserves the method name as the discriminator.
//
// The two forms are unambiguous in source — both start with the method name
// followed by a quoted argument — so a focused regex is reliable.
// ---------------------------------------------------------------------------

const RUBY_REQUIRE_RE =
  /\b(require_relative|require)\s*\(?\s*(['"])([^'"`\n]+?)\2/g;

/**
 * Strip Ruby line comments (`# ...` to end of line) before running the
 * require regex. Ruby has no block comments at this scope (=begin/=end
 * exists but is rare; tree-sitter would normally handle that). Like the JS
 * stripper, this doesn't try to honor string contents — it's a heuristic.
 */
function stripRubyComments(content) {
  return content.replace(/#[^\n]*/g, '');
}

/**
 * Return [{ kind: 'relative'|'absolute', source }] for every require /
 * require_relative call in a Ruby file.
 */
function parseRubyImports(content) {
  const out = [];
  let m;
  const stripped = stripRubyComments(content);
  RUBY_REQUIRE_RE.lastIndex = 0;
  while ((m = RUBY_REQUIRE_RE.exec(stripped)) !== null) {
    out.push({
      kind: m[1] === 'require_relative' ? 'relative' : 'absolute',
      source: m[3],
    });
  }
  return out;
}

/**
 * Resolve a single Ruby require. Returns array (0 or 1 match).
 *
 * For require_relative: append `.rb` if missing, resolve against importer dir.
 * For require: probe lib/<src>.rb, app/<src>.rb, <src>.rb.
 */
export function resolveRubyImport({ kind, source }, file, ctx) {
  if (!source) return [];
  const importerDir = dirOf(toPosix(file.path));
  const withExt = source.endsWith('.rb') ? source : source + '.rb';

  if (kind === 'relative') {
    const base = resolveRelative(importerDir, withExt);
    return ctx.fileSet.has(base) ? [base] : [];
  }

  // Load-path probe order
  const probes = [`lib/${withExt}`, `app/${withExt}`, withExt];
  for (const p of probes) {
    if (ctx.fileSet.has(p)) return [p];
  }
  return [];
}

// ---------------------------------------------------------------------------
// PHP resolver
//
// PHP's `use Vendor\Pkg\Class;` is namespace-based. Composer's PSR-4
// autoload map (`composer.json` -> autoload.psr-4) declares which directory
// holds the files for each namespace prefix, e.g.:
//   { "App\\": "src/" }  means App\Foo\Bar lives at src/Foo/Bar.php
//
// Resolution:
//   1. Find the longest matching autoload prefix.
//   2. Strip that prefix from the FQN.
//   3. Translate backslashes to forward slashes.
//   4. Append `.php` and probe the file set.
//
// Imports whose namespace is not declared in any autoload entry are
// external — dropped.
// ---------------------------------------------------------------------------

/**
 * Parse a single composer.json content and return Map<namespacePrefix,
 * dir[]> or null if the JSON failed to parse. The returned dirs are
 * relative to the composer.json's own directory — NOT projectRoot —
 * matching how PSR-4 itself is specified.
 *
 * Returning `null` (rather than throwing) lets the caller emit a Warning:
 * with the exact composer.json path that failed; bubbling the error would
 * conceal which file was at fault when many composer.json files are loaded.
 */
function parseComposerAutoloadText(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const out = new Map();
  const psr4 = parsed?.autoload?.['psr-4'];
  if (!psr4 || typeof psr4 !== 'object') return out;
  for (const [prefix, target] of Object.entries(psr4)) {
    const targets = Array.isArray(target) ? target : [target];
    // Normalize each dir to posix, strip leading `./`, strip trailing `/`
    const normalized = targets
      .filter(t => typeof t === 'string')
      .map(t => toPosix(t).replace(/\/$/, ''));
    // Ensure non-empty prefixes end with a backslash so the
    // longest-prefix-match does not accidentally split mid-segment
    // ("App" vs "Application"). Preserve the empty prefix as-is — it's
    // Composer's fallback mapping (`"psr-4": {"": "src/"}`) and means
    // "any namespace resolves under this dir". Appending `\` would
    // convert it into a prefix that matches nothing.
    const normalizedPrefix = prefix === '' || prefix.endsWith('\\') ? prefix : prefix + '\\';
    out.set(normalizedPrefix, normalized);
  }
  return out;
}

/**
 * Load every `composer.json` discovered in the input file list and parse
 * each's `autoload.psr-4` section. Returns Map<dirPath, autoloadMap>
 * keyed by the project-relative POSIX directory containing the
 * composer.json (empty string for a root-level composer.json).
 *
 * WHY plural: Composer monorepos commonly stack a root composer.json over
 * per-package composer.json files (one of the two formal "monorepo"
 * patterns Composer documents — `wikimedia/composer-merge-plugin` and
 * `symplify/monorepo-builder` both ship this layout). Loading only the
 * root would miss package-scoped PSR-4 entries entirely.
 *
 * On parse failure for a specific composer.json, emits a Warning: pointing
 * at the bad file and skips it. The rest of the project's PHP imports keep
 * resolving via whichever composer.json files parsed cleanly.
 */
function loadPhpAutoloads(projectRoot, files) {
  const out = new Map();
  for (const f of files) {
    const p = toPosix(f.path);
    const base = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    if (base !== 'composer.json') continue;
    const absPath = join(projectRoot, p);
    if (!existsSync(absPath)) continue;
    let raw;
    try {
      raw = readFileSync(absPath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Warning: extract-import-map: composer.json at ${absPath} failed ` +
        `to read (${err.message}) — PSR-4 namespace mapping from this ` +
        `composer.json unavailable — PHP imports under this package ` +
        `will not resolve\n`,
      );
      continue;
    }
    const parsed = parseComposerAutoloadText(raw);
    if (parsed === null) {
      process.stderr.write(
        `Warning: extract-import-map: composer.json at ${absPath} failed ` +
        `to parse — PSR-4 namespace mapping unavailable — PHP imports ` +
        `under this package will not resolve\n`,
      );
      continue;
    }
    out.set(dirOf(p), parsed);
  }
  return out;
}

/**
 * Resolve a PHP `use` FQN against the autoload map of the importer's
 * nearest enclosing composer.json. Returns array (0 or 1 match — the first
 * dir in the PSR-4 target list that contains the file).
 *
 * Resolved paths are anchored at the composer.json's directory, NOT at
 * projectRoot, so a sub-package's `App\Foo\Bar` resolves to
 * `<package-dir>/src/Foo/Bar.php` rather than `<projectRoot>/src/...`.
 * This is what Composer's autoloader actually does on disk.
 */
export function resolvePhpImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return [];
  // Strip leading backslash if present (PHP allows `use \Foo\Bar;`)
  const fqn = rawImport.startsWith('\\') ? rawImport.slice(1) : rawImport;
  if (!fqn) return [];

  const importerDir = dirOf(toPosix(file.path));
  const composerDir = findNearestConfigDir(importerDir, ctx.phpAutoloads);
  if (composerDir === undefined) return [];
  const autoload = ctx.phpAutoloads.get(composerDir);
  if (!autoload || autoload.size === 0) return [];

  // Longest-prefix match across this composer.json's autoload entries.
  // Walk the map and pick the entry with the longest matching prefix, so
  // `Foo\Bar` does not match a prefix `F\` if `Foo\` is also present.
  // Use `null` as the sentinel rather than 0-length so the empty PSR-4
  // fallback prefix (`""` → `src/`) can win when nothing more specific
  // matches; otherwise `prefix.length > bestPrefix.length` would always
  // be `0 > 0 = false` for the empty prefix.
  let bestPrefix = null;
  let bestDirs = null;
  for (const [prefix, dirs] of autoload) {
    if (fqn.startsWith(prefix) && (bestPrefix === null || prefix.length > bestPrefix.length)) {
      bestPrefix = prefix;
      bestDirs = dirs;
    }
  }
  if (bestDirs === null) return [];

  // Drop the prefix (it covers the directory), translate `\` to `/`.
  const relative = fqn.slice(bestPrefix.length).replace(/\\/g, '/');
  if (!relative) return [];
  for (const dir of bestDirs) {
    // Anchor at the composer.json's own directory — PSR-4 paths are
    // composer-relative, not project-relative.
    const dirUnderComposer = dir
      ? (composerDir ? `${composerDir}/${dir}` : dir)
      : composerDir;
    const candidate = dirUnderComposer
      ? `${dirUnderComposer}/${relative}.php`
      : `${relative}.php`;
    if (ctx.fileSet.has(candidate)) return [candidate];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rust resolver
//
// Rust's module system is path-based but the import syntax is `use` rather
// than path strings. Tree-sitter emits sources like `crate::a::b::Item`,
// `super::a::Item`, `self::a`, or bare `std::collections::HashMap`. We map
// only those rooted at `crate::` or `super::` — bare paths are external
// crates.
//
// Resolution heuristics:
//   - `crate::a::b::*` -> probe `<crate-root>/a/b.rs`, then
//     `<crate-root>/a/b/mod.rs`. The crate root is `<package-dir>/src/`
//     (Cargo convention).
//   - `super::a::b::*` -> walk up one directory from the importer, then
//     descend; same .rs / mod.rs probes.
//   - `self::a::*` -> like `super::a::*` but without the walk-up.
//
// Rust uses won't always land on a file (an import like `crate::Foo` could
// refer to a struct re-exported through `mod.rs`); we accept that limitation.
//
// We also extract `mod x;` declarations via regex — these declare submodules
// to load and translate directly to `<importer-dir>/x.rs` or
// `<importer-dir>/x/mod.rs`.
// ---------------------------------------------------------------------------

/**
 * Try `<base>.rs` then `<base>/mod.rs` against the file set. Returns the
 * first match or null.
 */
function probeRustModule(base, fileSet) {
  if (!base) return null;
  if (fileSet.has(`${base}.rs`)) return `${base}.rs`;
  if (fileSet.has(`${base}/mod.rs`)) return `${base}/mod.rs`;
  return null;
}

/**
 * Find the "crate root" directory for a Rust importer. By Cargo convention,
 * this is the directory containing `src/lib.rs` or `src/main.rs`. For nested
 * workspaces, walk up from the importer until a `src/` ancestor is found.
 * Returns the path relative to project root, or null if not found.
 *
 * The loop walks every ancestor directory (including the root) and probes
 * `<ancestor>/src/lib.rs` and `<ancestor>/src/main.rs`. We don't need a
 * separate "candidate ends with src" branch — when the importer is itself
 * inside `src/`, the next iteration up reaches the package dir and the
 * `<package>/src/lib.rs` probe catches it.
 */
function findRustCrateSrc(importerDir, fileSet) {
  const parts = importerDir.split('/').filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const ancestor = parts.slice(0, i).join('/');
    const childSrc = ancestor ? `${ancestor}/src` : 'src';
    if (fileSet.has(`${childSrc}/lib.rs`) || fileSet.has(`${childSrc}/main.rs`)) {
      return childSrc;
    }
  }
  return null;
}

export function resolveRustImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return [];
  const src = rawImport.trim();
  if (!src) return [];

  const importerDir = dirOf(toPosix(file.path));
  const segments = src.split('::').filter(Boolean);
  if (segments.length === 0) return [];
  const head = segments[0];

  // External crates: anything not rooted at crate/super/self.
  if (head !== 'crate' && head !== 'super' && head !== 'self') return [];

  // Walk segments after the head to a base file path. We probe each
  // successive prefix from longest to shortest so that `crate::a::b::Item`
  // matches `a/b.rs` (with `Item` being a re-export inside) rather than
  // failing because `a/b/Item.rs` doesn't exist.
  let baseDir;
  if (head === 'crate') {
    const crateSrc = findRustCrateSrc(importerDir, ctx.fileSet);
    if (!crateSrc) {
      // Warn once per importer file (a single .rs file can have many
      // `use crate::...` statements; suppress duplicate warnings).
      const importerPath = toPosix(file.path);
      if (!ctx._warnedNoRustCrateRoot.has(importerPath)) {
        ctx._warnedNoRustCrateRoot.add(importerPath);
        process.stderr.write(
          `Warning: extract-import-map: Rust file ${importerPath} has ` +
          `'use crate::' but no crate root (src/lib.rs or src/main.rs) ` +
          `found — crate-relative imports unresolved\n`,
        );
      }
      return [];
    }
    baseDir = crateSrc;
  } else if (head === 'super') {
    // Walk up one directory from the importer
    const parts = importerDir.split('/').filter(Boolean);
    if (parts.length === 0) return [];
    baseDir = parts.slice(0, -1).join('/');
  } else {
    // self::
    baseDir = importerDir;
  }

  const rest = segments.slice(1);
  // Try each prefix length from longest -> shortest. The empty rest case
  // (e.g. bare `use crate;`) is unresolvable.
  for (let i = rest.length; i > 0; i--) {
    const prefix = rest.slice(0, i);
    const base = baseDir
      ? `${baseDir}/${prefix.join('/')}`
      : prefix.join('/');
    const match = probeRustModule(base, ctx.fileSet);
    if (match) return [match];
  }
  return [];
}

/**
 * Regex pass for Rust `mod x;` declarations. These are NOT captured by
 * tree-sitter's import field, but they declare a child module on disk that
 * follows the same `<dir>/x.rs` or `<dir>/x/mod.rs` convention.
 */
const RUST_MOD_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+(\w+)\s*;\s*$/gm;

function extractRustModSources(content) {
  const sources = [];
  let m;
  // Rust uses the same line + block comment syntax as JS/TS, so we can reuse
  // the same stripper. Without this, `// mod fake;` would phantom-register
  // a submodule that doesn't exist on disk.
  const stripped = stripJsLikeComments(content);
  RUST_MOD_RE.lastIndex = 0;
  while ((m = RUST_MOD_RE.exec(stripped)) !== null) {
    // Synthesize as a `self::<name>` source so the regular Rust resolver
    // handles it (probes the importer's directory).
    sources.push(`self::${m[1]}`);
  }
  return sources;
}

// ---------------------------------------------------------------------------
// C / C++ resolver
//
// Tree-sitter's cpp extractor exposes both quoted and angle-bracket includes
// as imports with `source` set to the bare filename (e.g. `foo.h`).
// Quoted includes resolve relative to the importer's directory; angle
// includes look in a system path. We can't tell quoted from angle from
// tree-sitter alone, but the resolution rules overlap enough that probing
// both yields the right answer most of the time:
//   1. <importer-dir>/<source>
//   2. include/<source>
//   3. src/<source>
//   4. <source> (project-root-relative)
//
// We probe in that order and take the first match. Multiple file extensions
// (.h, .hpp, .hxx, .cuh) are NOT auto-appended — #include carries the
// extension explicitly.
// ---------------------------------------------------------------------------

export function resolveCppImport(rawImport, file, ctx) {
  if (!rawImport || typeof rawImport !== 'string') return [];
  const src = toPosix(rawImport.trim());
  if (!src) return [];
  const importerDir = dirOf(toPosix(file.path));

  const candidates = [
    resolveRelative(importerDir, src),
    `include/${src}`,
    `src/${src}`,
    src,
  ];
  for (const c of candidates) {
    if (c && ctx.fileSet.has(c)) return [c];
  }
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
  if (lang === 'go') {
    return resolveGoImport(src, file, ctx);
  }
  if (lang === 'java') {
    return resolveJavaImport(src, file, ctx);
  }
  if (lang === 'kotlin') {
    return resolveKotlinImport(src, file, ctx);
  }
  if (lang === 'csharp') {
    return resolveCSharpImport(src, file, ctx);
  }
  if (lang === 'php') {
    return resolvePhpImport(src, file, ctx);
  }
  if (lang === 'rust') {
    return resolveRustImport(src, file, ctx);
  }
  if (lang === 'c' || lang === 'cpp') {
    return resolveCppImport(src, file, ctx);
  }
  // Ruby is handled via a dedicated pathway because its tree-sitter
  // extractor flattens require vs require_relative into a single field,
  // losing the discriminator the resolver needs.
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
  if (file.language === 'kotlin') {
    return extractKotlinSources(content);
  }
  if (file.language === 'rust') {
    // `mod x;` declarations aren't in tree-sitter's `imports` field, but they
    // declare submodules on disk that the rust resolver knows how to find.
    return extractRustModSources(content);
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

  // Create tree-sitter plugin with all configs that have WASM grammars.
  //
  // WHY graceful init: the most likely real-world failure mode is the WASM
  // loader failing to locate or fetch the grammar binaries (cache eviction,
  // restricted sandboxes, transient FS issues). When that happens, we still
  // want the script to complete — producing an empty importMap for every
  // code file — rather than crashing the whole project-scanner pipeline.
  // The structural graph will lose import edges, but all OTHER analysis
  // (file inventory, exports inferred from filenames, etc.) keeps working.
  let registry = null;
  let treeSitterReady = false;
  try {
    const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
    const tsPlugin = new TreeSitterPlugin(tsConfigs);
    await tsPlugin.init();
    registry = new PluginRegistry();
    registry.register(tsPlugin);
    registerAllParsers(registry);
    treeSitterReady = true;
  } catch (err) {
    process.stderr.write(
      `Warning: extract-import-map: tree-sitter init failed ` +
      `(${err.message}) — all importMap entries will be empty — ` +
      `structural graph will have no import edges\n`,
    );
  }

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

    // Tree-sitter init failed earlier — produce empty importMap entries for
    // every code file and skip the analysis path. The one-time warning was
    // already emitted at startup.
    if (!treeSitterReady) {
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
      const resolvedSet = new Set();

      // Ruby is the only language whose tree-sitter import field doesn't
      // preserve the require vs require_relative discriminator, so the
      // resolver needs the regex-parsed shape directly. All other tree-sitter
      // languages get analyzed once and dispatched normally.
      if (file.language === 'ruby') {
        for (const imp of parseRubyImports(content)) {
          for (const out of resolveRubyImport(imp, file, ctx)) {
            if (out && ctx.fileSet.has(out)) resolvedSet.add(out);
          }
        }
      } else {
        const analysis = registry.analyzeFile(file.path, content);
        const imports = analysis?.imports ?? [];
        for (const imp of imports) {
          const outs = resolveImport(imp, file, ctx);
          for (const out of outs) {
            if (out && ctx.fileSet.has(out)) {
              resolvedSet.add(out);
            }
          }
        }
        // Supplemental pass for sources tree-sitter doesn't capture (e.g.
        // CJS require() calls, Kotlin imports). Dedup via the same set.
        for (const extra of extractExtraImportSources(file, content)) {
          const outs = resolveImport({ source: extra, specifiers: [] }, file, ctx);
          for (const out of outs) {
            if (out && ctx.fileSet.has(out)) {
              resolvedSet.add(out);
            }
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

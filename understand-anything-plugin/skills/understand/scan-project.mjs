#!/usr/bin/env node
/**
 * scan-project.mjs
 *
 * Deterministic file enumeration + language/category detection for the
 * project-scanner agent. Replaces the LLM-written prose scanner that used to
 * (a) author a per-run Node.js script (`tmp/ua-project-scan.js`), (b) walk the
 * file tree, and (c) classify each file via lookup tables in LLM context — a
 * pure rule-lookup pass that was being billed at LLM rates and adding many
 * minutes of per-run latency on mid-sized monorepos.
 *
 * What the LLM still owns (Step A of project-scanner.md Phase 1):
 *   - Reading README + top-level manifests to synthesize `name`,
 *     `rawDescription`, `readmeHead`, `frameworks`, and the high-level
 *     `languages` narrative.
 *
 * What this script owns:
 *   - File enumeration (git ls-files preferred, recursive walk fallback)
 *   - `.understandignore` filtering (delegated to core's createIgnoreFilter)
 *   - Per-file language detection (extension + filename table)
 *   - Per-file category assignment (priority-ordered rules from
 *     project-scanner.md Step 4)
 *   - Line counting
 *   - Complexity estimation (project-scanner.md Step 7 thresholds)
 *
 * Usage:
 *   node scan-project.mjs <projectRoot> <outputPath>
 *
 * Output JSON (subset of what project-scanner.md Phase 1 expects — the LLM
 * agent merges this with Step A's narrative fields and Step C's importMap to
 * produce the final scan-result.json):
 *   {
 *     "scriptCompleted": true,
 *     "files": [{ "path": "...", "language": "...", "sizeLines": N, "fileCategory": "..." }, ...],
 *     "totalFiles": N,
 *     "filteredByIgnore": M,
 *     "estimatedComplexity": "small" | "moderate" | "large" | "very-large",
 *     "stats": { "filesScanned": N, "byCategory": {...}, "byLanguage": {...} }
 *   }
 *
 * Logging: stderr only (stdout reserved for piped tooling).
 * Per-file resilience: read/stat failures emit
 *   `Warning: scan-project: <path> — <reason> — file skipped from output`
 * to stderr and the file is dropped; the rest of the scan completes.
 *
 * Determinism: files are sorted by `path.localeCompare` before emission, and
 * the underlying enumeration is deterministic (git ls-files returns a stable
 * order; the fallback walker sorts each directory's entries).
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join, basename, extname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @understand-anything/core
//
// Two-step resolution: try the workspace-linked package first, fall back to
// the installed plugin cache layout. pathToFileURL() is required on Windows
// because dynamic import() of raw "C:\..." paths throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME (Node parses "C:" as a URL scheme).
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { createIgnoreFilter } = core;

// ---------------------------------------------------------------------------
// Language detection
//
// Mirrors the canonical extension list from
// understand-anything-plugin/packages/core/src/languages/configs/* and the
// project-scanner.md Step 3 table. Extensions are matched lowercase;
// filenames (Dockerfile, Makefile, etc.) are matched case-sensitively because
// the projects-in-the-wild use canonical capitalizations.
//
// Where the core configs and project-scanner.md diverge (rare), project-
// scanner.md wins because it is the user-facing contract.
// ---------------------------------------------------------------------------

/**
 * Extension -> language id. Lowercase keys; lookup is `.ext.toLowerCase()`.
 * Includes the legacy Step-3 mapping (.cfg/.ini/.env -> `config`) — note
 * that `config` is a language id here, not a category. Category routing
 * for these extensions is handled separately in CATEGORY_BY_EXT.
 */
const LANGUAGE_BY_EXT = Object.freeze({
  // TypeScript / JavaScript
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Python
  '.py': 'python',
  '.pyi': 'python',
  // Go / Rust / Java / Kotlin / C# / Swift / Lua
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-c',
  '.lua': 'lua',
  // Ruby / PHP
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.php': 'php',
  // C / C++
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  // Vue / Svelte (no tree-sitter extractor, but project-scanner contract
  // lists them as code languages — downstream import map will return [])
  '.vue': 'vue',
  '.svelte': 'svelte',
  // Shell / Batch / PowerShell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  // Markup / docs
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.rst': 'markdown',
  // Config / data
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.toml': 'toml',
  '.xml': 'xml',
  '.xsl': 'xml',
  '.xsd': 'xml',
  '.plist': 'xml',
  '.cfg': 'config',
  '.ini': 'config',
  '.env': 'config',
  // Data / schema
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.prisma': 'prisma',
  '.csv': 'csv',
  '.tsv': 'csv',
  // Infra
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  // JVM build files (categorized via filename-or-extension)
  '.gradle': 'gradle',
  // .NET project files (mapped to extension-derived ids; downstream
  // treats them as config — see CATEGORY_BY_EXT)
  '.csproj': 'csproj',
  '.sln': 'sln',
  '.properties': 'properties',
  '.mod': 'mod',
  '.sum': 'sum',
});

/**
 * Filename (no extension) -> language id. Compared case-sensitively against
 * basename(path). Includes the most common no-extension conventions; anything
 * NOT in this table with no extension falls back to `unknown`.
 *
 * Dockerfile.* variants (Dockerfile.dev, Dockerfile.prod) are handled by a
 * startsWith check in `detectLanguage()` so we don't have to enumerate every
 * possible suffix.
 */
const LANGUAGE_BY_FILENAME = Object.freeze({
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  makefile: 'makefile',
  Jenkinsfile: 'jenkinsfile',
  Procfile: 'procfile',
  Vagrantfile: 'vagrantfile',
});

/**
 * Detect the language of a file by its path. Lowercase extension lookup,
 * then no-extension filename lookup. Never returns null — falls back to
 * the lowercased extension (without dot) or 'unknown' if there is no
 * extension. Downstream consumers rely on this field always being a string
 * (see project-scanner.md Step 3 "Fallback" note).
 */
export function detectLanguage(filePath) {
  const base = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  // Dockerfile.dev, Dockerfile.prod, etc. — common variant form.
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) return 'dockerfile';

  // Dotfile names like .env, .env.local — path.extname returns '' for
  // single-segment dotfiles (e.g. '.env') and the SECOND segment for
  // compound dotfiles (e.g. '.local' for '.env.local'). Neither hits the
  // intended LANGUAGE_BY_EXT['.env'] mapping. Try the leading dotfile
  // portion first so `.env`, `.env.local`, `.env.production` all map.
  const dotKey = dotfileKey(base);
  if (dotKey && LANGUAGE_BY_EXT[dotKey]) return LANGUAGE_BY_EXT[dotKey];

  if (ext) {
    const byExt = LANGUAGE_BY_EXT[ext];
    if (byExt) return byExt;
    // Unknown extension → drop the leading dot, lowercase. Never null.
    return ext.slice(1);
  }

  // No-extension file — try filename table.
  const byFilename = LANGUAGE_BY_FILENAME[base];
  if (byFilename) return byFilename;

  return 'unknown';
}

/**
 * Extract the canonical dotfile "extension" from a basename, or null.
 *
 * `.env`          -> `.env`
 * `.env.local`    -> `.env`
 * `.bashrc`       -> `.bashrc`
 * `package.json`  -> null (not a dotfile)
 *
 * Used by both detectLanguage and detectCategory so dotfile-style configs
 * (e.g., `.env`, `.env.local`, `.env.production`) get their leading
 * segment treated as the implicit extension instead of falling through
 * to `unknown` / `code`.
 */
function dotfileKey(base) {
  if (!base.startsWith('.')) return null;
  const m = base.match(/^(\.[a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Category detection
//
// Implements the priority-ordered rules from project-scanner.md Step 4.
// Order matters: more specific rules must run before more general ones
// (e.g. `docker-compose.yml` is infra, not config).
//
// Categories: code | config | docs | infra | data | script | markup
// ---------------------------------------------------------------------------

/**
 * Extension -> category. Used only after the higher-priority path-based
 * checks (infra/docs exclusions) in `detectCategory()`. Plain extension
 * lookup is intentionally last-resort — many configs need their full path
 * inspected first.
 */
const CATEGORY_BY_EXT = Object.freeze({
  // docs
  '.md': 'docs',
  '.mdx': 'docs',
  '.rst': 'docs',
  '.txt': 'docs',
  '.text': 'docs',
  // config
  '.yaml': 'config',
  '.yml': 'config',
  '.json': 'config',
  '.jsonc': 'config',
  '.toml': 'config',
  '.xml': 'config',
  '.xsl': 'config',
  '.xsd': 'config',
  '.plist': 'config',
  '.cfg': 'config',
  '.ini': 'config',
  '.env': 'config',
  '.properties': 'config',
  '.csproj': 'config',
  '.sln': 'config',
  '.mod': 'config',
  '.sum': 'config',
  '.gradle': 'config',
  // infra
  '.tf': 'infra',
  '.tfvars': 'infra',
  // data
  '.sql': 'data',
  '.graphql': 'data',
  '.gql': 'data',
  '.proto': 'data',
  '.prisma': 'data',
  '.csv': 'data',
  '.tsv': 'data',
  // script
  '.sh': 'script',
  '.bash': 'script',
  '.zsh': 'script',
  '.ps1': 'script',
  '.psm1': 'script',
  '.psd1': 'script',
  '.bat': 'script',
  '.cmd': 'script',
  // markup
  '.html': 'markup',
  '.htm': 'markup',
  '.css': 'markup',
  '.scss': 'markup',
  '.sass': 'markup',
  '.less': 'markup',
});

/**
 * Filenames (no extension or full filename with extension) that always
 * map to `infra` regardless of their extension. Compared case-sensitively
 * against basename(path).
 */
const INFRA_FILENAMES = new Set([
  'Dockerfile',
  '.dockerignore',
  'Makefile',
  'GNUmakefile',
  'makefile',
  'Jenkinsfile',
  'Procfile',
  'Vagrantfile',
  '.gitlab-ci.yml',
]);

/**
 * Detect the project-scanner category for a file. Priority order matches
 * project-scanner.md Step 4 "Priority rule" — most specific wins.
 *
 * 1. LICENSE -> code (per the spec note "except LICENSE"). The Step-2
 *    exclusion table normally removes LICENSE, but if a project chooses to
 *    re-include it via `.understandignore` negation, it should NOT land in
 *    docs. We classify as `code` rather than inventing a new bucket.
 * 2. Filename-based infra (Dockerfile, Makefile, Jenkinsfile,
 *    docker-compose.*, Vagrantfile, Procfile, .gitlab-ci.yml,
 *    .dockerignore).
 * 3. Path-based infra (.github/workflows/, .circleci/, k8s/, kubernetes/,
 *    *.k8s.yml, *.k8s.yaml).
 * 4. Extension-based mapping (CATEGORY_BY_EXT).
 * 5. Fallback: `code` (matches the spec — "All other extensions").
 */
export function detectCategory(filePath) {
  const base = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const posix = filePath.split(sep).join('/');

  // Rule 1: LICENSE exception (project-scanner.md Step 4 table comment).
  if (base === 'LICENSE') return 'code';

  // Rule 2: infra by filename — Dockerfile + variants, Makefile,
  // Jenkinsfile, docker-compose.*, Procfile, Vagrantfile, .gitlab-ci.yml,
  // .dockerignore.
  if (INFRA_FILENAMES.has(base)) return 'infra';
  if (base === 'Dockerfile' || base.startsWith('Dockerfile.')) return 'infra';
  if (base.startsWith('docker-compose.')) return 'infra';
  if (base === 'compose.yml' || base === 'compose.yaml') return 'infra';

  // Rule 3: infra by path.
  if (posix.startsWith('.github/workflows/')) return 'infra';
  if (posix.startsWith('.circleci/')) return 'infra';
  // Match a `k8s/` or `kubernetes/` segment anywhere in the path.
  if (/(^|\/)(k8s|kubernetes)\//.test(posix)) return 'infra';
  // `*.k8s.yml` and `*.k8s.yaml` — Kubernetes-flavored YAML.
  if (/\.k8s\.(ya?ml)$/i.test(base)) return 'infra';

  // Rule 4: extension-based lookup.
  if (ext) {
    const byExt = CATEGORY_BY_EXT[ext];
    if (byExt) return byExt;
  }

  // Rule 4.5: dotfile-style configs (.env, .env.local, .env.production).
  // path.extname misses these — see dotfileKey docstring.
  const dotKey = dotfileKey(base);
  if (dotKey) {
    const byDot = CATEGORY_BY_EXT[dotKey];
    if (byDot) return byDot;
  }

  // Rule 5: filename-based config catch-all for no-extension config files
  // commonly seen in JVM/Go/.NET projects (covered above for infra but not
  // config). We don't enumerate every possible config filename here — that
  // gets handled by the language map's no-extension entries upstream.
  // Anything not matched falls through to `code`.
  return 'code';
}

// ---------------------------------------------------------------------------
// Complexity estimation (project-scanner.md Step 7)
// ---------------------------------------------------------------------------

/**
 * Map a total file count to a complexity tier. Thresholds are inclusive on
 * the lower bound:
 *   - small:      1-30
 *   - moderate:   31-150
 *   - large:      151-500
 *   - very-large: >500
 *
 * Edge case: 0 files maps to `small` (the lowest tier) so the field is
 * always set even on empty repos. Downstream consumers treat 0 files as
 * a sentinel for "nothing to analyze" via `totalFiles`, not complexity.
 */
export function estimateComplexity(totalFiles) {
  if (totalFiles <= 30) return 'small';
  if (totalFiles <= 150) return 'moderate';
  if (totalFiles <= 500) return 'large';
  return 'very-large';
}

// ---------------------------------------------------------------------------
// File enumeration
// ---------------------------------------------------------------------------

/**
 * Normalize a path to forward-slash POSIX. The project-scanner contract
 * emits POSIX paths; we re-normalize so the output is stable across
 * Windows/macOS/Linux.
 */
function toPosix(p) {
  return p.split(sep).join('/');
}

/**
 * Enumerate all files in `projectRoot` via `git ls-files`. Returns an
 * array of project-relative POSIX paths, or null if the directory is not
 * a git repository (or git is not installed). Caller falls back to the
 * recursive walker.
 *
 * Why git ls-files first: it respects the repo's `.gitignore`, handles
 * submodules sensibly, and gives a fast, deterministic listing. The walker
 * is a strict superset of what git would emit (no .gitignore awareness),
 * so the ignore filter has to do more work in the fallback path.
 */
function enumerateViaGit(projectRoot) {
  // -z = NUL-terminated output. Without it, `git ls-files` C-escapes non-ASCII
  // bytes in path names — paths containing emoji, accented characters, CJK
  // codepoints, etc. come back quoted with octal escapes (e.g.
  // `"30. \360\237\217\227 BD-CCER/file.md"` for a path containing 🏗️).
  // Those quoted-escaped strings then fail to round-trip back to real disk
  // paths in downstream consumers, so files in such directories are silently
  // dropped from the scan. The -z form emits raw bytes between NUL separators,
  // preserving every codepoint as-is. This is the same approach git itself
  // uses for `--null` everywhere downstream (xargs -0, etc.).
  const result = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024, // 256MB — huge monorepos can produce >10MB of paths
  });
  if (result.status !== 0 || !result.stdout) return null;
  // Each NUL-separated chunk is one path, project-relative, already POSIX on
  // all platforms because git emits forward slashes regardless of OS.
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(toPosix);
}

/**
 * Recursive directory walker — fallback when `git ls-files` is unavailable
 * (no git, not a repo, or git refused). Skips hard-coded "obviously bad"
 * directory names BEFORE invoking the ignore filter so we don't waste cycles
 * descending into `node_modules/` etc. on huge trees.
 *
 * Yields project-relative POSIX paths in directory-sorted order so the
 * output is deterministic without an extra sort pass.
 */
function enumerateViaWalk(projectRoot) {
  // Hard skip — these directories are universally non-source and skipping
  // at the walker level avoids materializing thousands of node_modules
  // paths before the ignore filter drops them. The ignore filter still
  // runs on everything else.
  const HARD_SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '__pycache__',
  ]);

  const out = [];

  function walk(absDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      process.stderr.write(
        `Warning: scan-project: ${toPosix(relative(projectRoot, absDir)) || '.'} ` +
        `— directory read failed (${err.message}) — subtree skipped\n`,
      );
      return;
    }
    // Sort deterministically by name; mix files and dirs together so the
    // final output (after the path sort) is identical regardless of
    // OS-specific readdir order.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (HARD_SKIP_DIRS.has(ent.name)) continue;
        walk(join(absDir, ent.name));
      } else if (ent.isFile()) {
        const rel = toPosix(relative(projectRoot, join(absDir, ent.name)));
        if (rel) out.push(rel);
      }
      // Symlinks intentionally ignored — git ls-files doesn't follow them
      // either, and following them is a classic recursion-bomb footgun.
    }
  }

  walk(projectRoot);
  return out;
}

/**
 * Enumerate all candidate files in `projectRoot`. Tries git ls-files first;
 * falls back to a recursive walk if git is unavailable or this is not a
 * repo. Returns an array of project-relative POSIX paths in unspecified
 * order — caller is responsible for sorting + filtering.
 */
function enumerateFiles(projectRoot) {
  const fromGit = enumerateViaGit(projectRoot);
  if (fromGit !== null) return fromGit;
  process.stderr.write(
    `scan-project: git ls-files unavailable — falling back to recursive walk\n`,
  );
  return enumerateViaWalk(projectRoot);
}

// ---------------------------------------------------------------------------
// Filter accounting
//
// The project-scanner.md contract requires `filteredByIgnore` to count files
// dropped *specifically* by user `.understandignore` patterns (the delta
// beyond what the hardcoded defaults would have removed). We accomplish this
// by building TWO filters:
//   - `defaultOnly`: defaults only, no user patterns
//   - `combined`: defaults + user patterns (createIgnoreFilter)
// and counting paths that the combined filter excludes but the defaults-only
// filter would have kept.
//
// Negation (`!pattern`) is correctly handled by the combined filter — a file
// re-included via `!` won't be in the combined-excluded set, so it WON'T be
// counted in filteredByIgnore (it's "kept", not "additionally filtered").
// ---------------------------------------------------------------------------

/**
 * Build a defaults-only IgnoreFilter — same patterns as createIgnoreFilter
 * would apply, minus any user .understandignore content. We synthesize this
 * via a temp directory with no .understandignore files so the core function
 * still drives the matcher. (Re-implementing the ignore-package wiring here
 * would risk subtle behavior drift from core's matcher.)
 */
function buildDefaultsOnlyFilter() {
  // Use the createIgnoreFilter with a path that we KNOW has no .understandignore.
  // `os.tmpdir()`-based fresh dir guarantees no user patterns leak in.
  // The directory doesn't need to exist on disk because createIgnoreFilter
  // only checks existsSync() before reading.
  const fakeProjectRoot = join(
    require('node:os').tmpdir(),
    `ua-scan-defaults-${process.pid}-${Date.now()}`,
  );
  return createIgnoreFilter(fakeProjectRoot);
}

/**
 * Determine whether `projectRoot` has any user .understandignore files.
 * When neither file exists, the combined and defaults-only filters are
 * identical, so we can skip the dual-filter accounting entirely.
 */
function hasUserIgnoreFile(projectRoot) {
  return (
    existsSync(join(projectRoot, '.understandignore'))
    || existsSync(join(projectRoot, '.understand-anything', '.understandignore'))
  );
}

// ---------------------------------------------------------------------------
// Line counting
// ---------------------------------------------------------------------------

/**
 * Count newline-delimited lines in a file. Returns the number of `\n`
 * characters; this matches `wc -l` semantics (which counts newlines, not
 * "lines of content"). Files without a trailing newline therefore report
 * one fewer than the visible line count — same behavior as wc.
 *
 * Per-file failure: emits a Warning: and returns null. Caller decides
 * whether to drop the file or keep it with sizeLines=0.
 */
function countLines(absPath, posixPath) {
  try {
    const buf = readFileSync(absPath);
    // Manual newline count beats split('\n').length on large files — no
    // intermediate array allocation. We count the `\n` byte (0x0a) directly.
    let count = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) count++;
    }
    return count;
  } catch (err) {
    process.stderr.write(
      `Warning: scan-project: ${posixPath} — line count failed ` +
      `(${err.message}) — file skipped from output\n`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , projectRoot, outputPath] = process.argv;
  if (!projectRoot || !outputPath) {
    process.stderr.write(
      'Usage: node scan-project.mjs <projectRoot> <outputPath>\n',
    );
    process.exit(1);
  }

  if (!existsSync(projectRoot)) {
    process.stderr.write(
      `scan-project.mjs failed: projectRoot does not exist: ${projectRoot}\n`,
    );
    process.exit(1);
  }
  const projectRootStat = statSync(projectRoot);
  if (!projectRootStat.isDirectory()) {
    process.stderr.write(
      `scan-project.mjs failed: projectRoot is not a directory: ${projectRoot}\n`,
    );
    process.exit(1);
  }

  // 1. Enumerate. Either git ls-files or recursive walk.
  const candidates = enumerateFiles(projectRoot);

  // 2. Filter via createIgnoreFilter (defaults + user .understandignore).
  //    Build a defaults-only filter in parallel to count user-driven drops.
  const combined = createIgnoreFilter(projectRoot);
  const userIgnoresPresent = hasUserIgnoreFile(projectRoot);
  const defaultsOnly = userIgnoresPresent ? buildDefaultsOnlyFilter() : combined;

  let filteredByIgnore = 0;
  const kept = [];
  for (const rel of candidates) {
    const isIgnoredCombined = combined.isIgnored(rel);
    if (!isIgnoredCombined) {
      kept.push(rel);
      continue;
    }
    // Dropped by combined filter. If defaults-only would have ALSO dropped
    // it, this is a baseline default drop — not counted. If defaults-only
    // would have KEPT it, this drop is attributable to the user's
    // .understandignore content.
    if (userIgnoresPresent && !defaultsOnly.isIgnored(rel)) {
      filteredByIgnore++;
    }
  }

  // 3. Per-file: language + category + line count.
  //    Drop files that fail line counting (per-file resilience).
  const fileEntries = [];
  for (const rel of kept) {
    const absPath = join(projectRoot, rel);
    // Stat first — git ls-files could include paths that vanished between
    // listing and processing; the walker shouldn't but defensive anyway.
    try {
      const st = statSync(absPath);
      if (!st.isFile()) {
        // Symlinks-to-dir, special files, etc. — skip silently. Not a
        // warning condition because git wouldn't have tracked it as a file.
        continue;
      }
    } catch (err) {
      process.stderr.write(
        `Warning: scan-project: ${rel} — stat failed (${err.message}) ` +
        `— file skipped from output\n`,
      );
      continue;
    }
    const sizeLines = countLines(absPath, rel);
    if (sizeLines === null) {
      // countLines already emitted the Warning: line.
      continue;
    }
    fileEntries.push({
      path: rel,
      language: detectLanguage(rel),
      sizeLines,
      fileCategory: detectCategory(rel),
    });
  }

  // 4. Determinism: sort by path.localeCompare.
  fileEntries.sort((a, b) => a.path.localeCompare(b.path));

  // 5. Stats.
  const byCategory = {};
  const byLanguage = {};
  for (const f of fileEntries) {
    byCategory[f.fileCategory] = (byCategory[f.fileCategory] || 0) + 1;
    byLanguage[f.language] = (byLanguage[f.language] || 0) + 1;
  }

  const estimatedComplexity = estimateComplexity(fileEntries.length);

  const output = {
    scriptCompleted: true,
    files: fileEntries,
    totalFiles: fileEntries.length,
    filteredByIgnore,
    estimatedComplexity,
    stats: {
      filesScanned: fileEntries.length,
      byCategory,
      byLanguage,
    },
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }

  process.stderr.write(
    `scan-project: filesScanned=${fileEntries.length} ` +
    `filteredByIgnore=${filteredByIgnore} ` +
    `complexity=${estimatedComplexity}\n`,
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
    process.stderr.write(`scan-project.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

// Default export of helpers for testability.
export default {
  detectLanguage,
  detectCategory,
  estimateComplexity,
};

import ignore, { type Ignore } from "ignore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Hardcoded default ignore patterns matching the project-scanner agent's
 * exclusion rules, plus bin/obj for .NET projects.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  // Dependency directories
  "node_modules/",
  ".git/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",

  // Build output
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".cache/",
  ".turbo/",
  "target/",
  "obj/",

  // Lock files
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",

  // Binary/asset files
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",

  // Generated files
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",

  // IDE/editor
  ".idea/",
  ".vscode/",

  // Misc
  "LICENSE",
  ".gitignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc*",
  "*.log",
];

export interface IgnoreFilter {
  /**
   * Returns true if the given path should be excluded from analysis.
   *
   * Accepts a root-relative path. Inputs are normalized before delegating to
   * ignore@7 (which throws on anything that isn't a clean `path.relative()`d
   * string): backslashes are converted to `/`, any leading `./` segments and
   * duplicate slashes are collapsed, and an empty path (the project root)
   * returns false. A path that escapes the root (`../...`) is treated as
   * not-ignored (returns false) rather than throwing.
   */
  isIgnored(relativePath: string): boolean;
}

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from .understandignore files.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. .understand-anything/.understandignore (if exists)
 * 3. .understandignore at project root (if exists)
 */
export function createIgnoreFilter(projectRoot: string): IgnoreFilter {
  const ig: Ignore = ignore();

  // Layer 1: hardcoded defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // Layer 2: .understand-anything/.understandignore
  const projectIgnorePath = join(projectRoot, ".understand-anything", ".understandignore");
  if (existsSync(projectIgnorePath)) {
    const content = readFileSync(projectIgnorePath, "utf-8");
    ig.add(content);
  }

  // Layer 3: .understandignore at project root
  const rootIgnorePath = join(projectRoot, ".understandignore");
  if (existsSync(rootIgnorePath)) {
    const content = readFileSync(rootIgnorePath, "utf-8");
    ig.add(content);
  }

  return {
    isIgnored(relativePath: string): boolean {
      if (!relativePath) return false;
      // ignore@7's ig.ignores() throws on any input that isn't a clean,
      // root-relative POSIX path, so normalize the shapes path.relative() can
      // produce before delegating. Production callers always pass
      // toPosix(relative(root, target)), but normalizing here keeps the
      // function total against the other shapes too.
      const normalized = relativePath
        .replace(/\\/g, "/") // Windows separators -> POSIX
        .replace(/^(\.\/)+/, "") // collapse one-or-more leading "./"
        .replace(/\/{2,}/g, "/") // collapse duplicate slash runs
        .replace(/^\/+/, ""); // drop any leading root slash
      if (!normalized) return false; // empty path == project root, not ignored
      // A path that escapes the root can't be under analysis; report not-ignored
      // instead of letting ig.ignores() throw on the "../" prefix.
      if (normalized === ".." || normalized.startsWith("../")) return false;
      return ig.ignores(normalized);
    },
  };
}

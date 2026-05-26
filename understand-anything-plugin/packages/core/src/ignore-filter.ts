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
  /** Returns true if the given relative path should be excluded from analysis. */
  isIgnored(relativePath: string): boolean;
}

/**
 * Optional knobs for createIgnoreFilter. Currently used to layer ad-hoc
 * patterns sourced from CLI flags (e.g. `/understand --exclude=<pattern>`)
 * on top of the persistent `.understandignore` rules.
 */
export interface CreateIgnoreFilterOptions {
  /**
   * Additional gitignore-style patterns appended after the user's
   * `.understandignore` files. Use the same syntax as `.understandignore`
   * (globs, `!` negation, trailing `/` for dirs). Empty/undefined leaves
   * behavior identical to the no-options form.
   */
  extraExclude?: string[];
}

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from .understandignore files.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. .understand-anything/.understandignore (if exists)
 * 3. .understandignore at project root (if exists)
 * 4. CLI `--exclude=<pattern>` patterns (from `options.extraExclude`)
 */
export function createIgnoreFilter(
  projectRoot: string,
  options?: CreateIgnoreFilterOptions,
): IgnoreFilter {
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

  // Layer 4: CLI --exclude patterns. Applied last so they can override
  // earlier layers (including default + user .understandignore) via `!`.
  if (options?.extraExclude && options.extraExclude.length > 0) {
    ig.add(options.extraExclude);
  }

  return {
    isIgnored(relativePath: string): boolean {
      return ig.ignores(relativePath);
    },
  };
}

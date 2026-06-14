import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_IGNORE_PATTERNS } from "./ignore-filter.js";

const HEADER = `# .understandignore — patterns for files/dirs to exclude from analysis
# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)
# Lines below are suggestions — uncomment to activate.
# Use ! prefix to force-include something excluded by defaults.
#
# Built-in defaults (always excluded unless negated):
#   node_modules/, .git/, dist/, build/, obj/, *.lock, *.min.js, etc.
#
`;

const DETECTABLE_DIRS = [
  { dir: "__tests__", pattern: "__tests__/" },
  { dir: "test", pattern: "test/" },
  { dir: "tests", pattern: "tests/" },
  { dir: "fixtures", pattern: "fixtures/" },
  { dir: "testdata", pattern: "testdata/" },
  { dir: "docs", pattern: "docs/" },
  { dir: "examples", pattern: "examples/" },
  { dir: "scripts", pattern: "scripts/" },
  { dir: "migrations", pattern: "migrations/" },
  { dir: ".storybook", pattern: ".storybook/" },
];

const GENERIC_SUGGESTIONS = [
  "*.test.*",
  "*.spec.*",
  "*.snap",
];

/**
 * Parses a .gitignore file and returns active patterns (no comments, no blanks).
 */
function parseGitignorePatterns(gitignorePath: string): string[] {
  if (!existsSync(gitignorePath)) return [];
  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"),
    );
}

/**
 * Returns true if a gitignore pattern is already covered by the hardcoded defaults.
 * Normalizes a leading root anchor and trailing slashes for comparison so that
 * anchored forms like `/node_modules` and `/dist/` match defaults `node_modules/`/`dist/`.
 */
function isCoveredByDefaults(pattern: string): boolean {
  const normalize = (p: string) => p.replace(/^\//, "").replace(/\/+$/, "");
  const normalized = normalize(pattern);
  return DEFAULT_IGNORE_PATTERNS.some((d) => normalize(d) === normalized);
}

/**
 * Generates a starter .understandignore file content by scanning the project
 * for common directories and reading .gitignore patterns.
 * All suggestions are commented out — this is a one-time generation.
 */
export function generateStarterIgnoreFile(projectRoot: string): string {
  const sections: string[] = [HEADER];

  // Section 1: patterns from .gitignore not already in defaults
  const gitignorePath = join(projectRoot, ".gitignore");
  const gitignorePatterns = parseGitignorePatterns(gitignorePath).filter(
    (p) => !isCoveredByDefaults(p),
  );

  if (gitignorePatterns.length > 0) {
    sections.push("# --- From .gitignore (uncomment to exclude) ---\n");
    for (const pattern of gitignorePatterns) {
      sections.push(`# ${pattern}`);
    }
    sections.push("");
  }

  // Section 2: detected directories
  const detected: string[] = [];
  for (const { dir, pattern } of DETECTABLE_DIRS) {
    if (existsSync(join(projectRoot, dir))) {
      detected.push(pattern);
    }
  }

  if (detected.length > 0) {
    sections.push("# --- Detected directories (uncomment to exclude) ---\n");
    for (const pattern of detected) {
      sections.push(`# ${pattern}`);
    }
    sections.push("");
  }

  // Section 3: generic test patterns
  sections.push("# --- Test file patterns (uncomment to exclude) ---\n");
  for (const pattern of GENERIC_SUGGESTIONS) {
    sections.push(`# ${pattern}`);
  }
  sections.push("");

  return sections.join("\n");
}

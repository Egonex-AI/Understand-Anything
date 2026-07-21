import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
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

// Directory names matched case-insensitively against the on-disk entry name.
// Mixes ecosystem conventions: __tests__ (JS), test/tests (multi), testdata
// (Go), .storybook (JS), PascalCase variants (UnitTests/IntegrationTests)
// commonly seen in C#/.NET projects, and benchmark dirs (bench/benchmarks)
// idiomatic to large C++ projects (LLVM, abseil, bitcoin, Catch2).
const EXACT_DIR_NAMES = [
  "__tests__",
  "test",
  "tests",
  "fixtures",
  "testdata",
  "docs",
  "examples",
  "scripts",
  "migrations",
  ".storybook",
  "unittests",
  "unittest",
  "integrationtests",
  "bench",
  "benchmark",
  "benchmarks",
  "benches",
];

// Directory-name suffixes matched case-insensitively via String.endsWith.
// Primarily intended for C# / .NET project-suffix conventions like Foo.Tests,
// Foo.UnitTests, Foo.IntegrationTests, but note the match is unanchored —
// e.g. a hypothetical `.storybook.tests` would also match. Suggestions stay
// commented-out so the user reviews before activating.
const SUFFIX_DIR_GLOBS = [
  ".tests",
  ".unittests",
  ".integrationtests",
];

// Test file patterns grouped by language. Emitted as commented suggestions
// with a sub-header per group.
const TEST_PATTERN_GROUPS: Array<{ label: string; patterns: string[] }> = [
  {
    label: "JS / TS",
    patterns: ["*.test.*", "*.spec.*", "*.snap"],
  },
  {
    label: "C# / .NET",
    patterns: [
      "**/*Tests.cs",
      "**/*Test.cs",
      "**/*Fixture.cs",
      "**/*.Tests.csproj",
    ],
  },
  {
    label: "Java / Kotlin",
    patterns: [
      "**/src/test/**",
      "**/*Test.java",
      "**/*IT.java",
      "**/*Spec.kt",
    ],
  },
  {
    label: "Go",
    patterns: ["**/*_test.go"],
  },
  {
    // Many C++ projects (abseil, Chromium, protobuf) interleave test files
    // with source rather than using a dedicated test/ dir — so file-pattern
    // exclusions matter more here than for languages where tests cluster.
    label: "C++",
    patterns: [
      "**/*_test.cc",
      "**/*_test.cpp",
      "**/*_test.cxx",
      "**/*Test.cc",
      "**/*Test.cpp",
      "**/*_unittest.cc",
      "**/*_unittest.cpp",
      "**/*_browsertest.cc",
      "**/*_benchmark.cc",
      "**/*Benchmark.cpp",
    ],
  },
  {
    // Python testing conventions are bimodal. Most projects (django,
    // flask, pandas, numpy) cluster tests inside a top-level tests/ dir,
    // where the existing directory rules already catch them. But Google-
    // style codebases (tensorflow, jax, some Meta libs) interleave
    // *_test.py directly alongside the module under test — e.g. tensor-
    // flow/python/ops/array_ops.py + array_ops_test.py — so file-pattern
    // rules add the majority of the token savings for that half of the
    // ecosystem.
    label: "Python",
    patterns: [
      "**/test_*.py",
      "**/*_test.py",
      "**/tests.py",
      "**/conftest.py",
    ],
  },
  {
    // Rust testing is bimodal, similar to Python. Library-scale crates
    // (ripgrep, alacritty, helix, cargo) keep unit tests inline in
    // `#[cfg(test)] mod tests { ... }` blocks that no file-pattern
    // rule can catch, so the group barely moves the needle for them.
    // Workspace monorepos (paritytech/polkadot-sdk, solana-labs/solana,
    // rust-lang/rust) colocate a `foo_test.rs` beside `foo.rs` at
    // scale — measurement showed *_test.rs alone accounts for the
    // majority of hits (232 files / −15% on polkadot-sdk analysed
    // budget). Integration tests already live under tests/ and Cargo
    // benches under benches/ (both dir-covered), so the file globs
    // here target the colocated shape specifically.
    label: "Rust",
    patterns: [
      "**/tests.rs",
      "**/test_*.rs",
      "**/*_test.rs",
      "**/bench_*.rs",
      "**/*_bench.rs",
    ],
  },
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
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Returns true if a gitignore pattern is already covered by the hardcoded defaults.
 * Normalizes trailing slashes for comparison.
 */
function isCoveredByDefaults(pattern: string): boolean {
  const normalize = (p: string) => p.replace(/\/+$/, "");
  const normalized = normalize(pattern);
  return DEFAULT_IGNORE_PATTERNS.some((d) => normalize(d) === normalized);
}

/**
 * Detects directories under projectRoot that match either an exact name
 * (case-insensitive) in EXACT_DIR_NAMES or end with one of SUFFIX_DIR_GLOBS.
 * Returns patterns using the directory's actual on-disk casing.
 */
function detectDirectories(projectRoot: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(projectRoot, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const lower = entry.name.toLowerCase();
    if (EXACT_DIR_NAMES.includes(lower)) {
      matches.push(`${entry.name}/`);
      continue;
    }
    if (SUFFIX_DIR_GLOBS.some((suffix) => lower.endsWith(suffix))) {
      matches.push(`${entry.name}/`);
    }
  }
  return matches;
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

  // Section 2: detected directories (case-insensitive + suffix-glob)
  const detected = detectDirectories(projectRoot);
  if (detected.length > 0) {
    sections.push("# --- Detected directories (uncomment to exclude) ---\n");
    for (const pattern of detected) {
      sections.push(`# ${pattern}`);
    }
    sections.push("");
  }

  // Section 3: test file patterns, grouped by language
  sections.push("# --- Test file patterns (uncomment to exclude) ---\n");
  for (const group of TEST_PATTERN_GROUPS) {
    sections.push(`# ${group.label}`);
    for (const pattern of group.patterns) {
      sections.push(`# ${pattern}`);
    }
  }
  sections.push("");

  return sections.join("\n");
}

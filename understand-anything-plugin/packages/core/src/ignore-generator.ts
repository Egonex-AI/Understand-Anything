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
  "spec",
];

// Directory-name suffixes matched case-insensitively via String.endsWith.
// Covers C# / .NET project-suffix conventions (Foo.Tests, Foo.UnitTests,
// Foo.IntegrationTests) and Xcode target conventions (MyAppTests,
// MyAppUITests) in one rule — the dotted C# forms all end in "tests", so
// they need no separate entries.
//
// The match is deliberately unanchored, which means a production directory
// ending in "tests"/"specs" (Contests/, Protests/) also matches. That is
// safe *here* in a way the equivalent file-glob is not: this list only ever
// runs against directories that actually exist on disk (see
// detectDirectories), and the result is emitted commented-out under the
// directory's real name — so a repo with a genuine Contests/ dir sees a
// literal `# Contests/` line it can decline to uncomment. A speculative
// `**/*Tests/**` glob offers the user no such signal.
const SUFFIX_DIR_GLOBS = [
  "tests",
  "specs",
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
  {
    // Ruby clusters tests aggressively, matching the C++ shape rather
    // than Rust's inline convention. Measurement across 10 major Ruby
    // repos (rails, discourse, homebrew, jekyll, fastlane, rubocop,
    // ruby, liquid, kamal, rspec-rails) showed a 51% weighted-total
    // reduction — the highest of any language group. Almost all of
    // that comes from the newly-added `spec/` dir rule (RSpec's home);
    // the file globs below add another 5 pp on top by catching
    // `*_spec.rb` in gem-repo `lib/` trees, Minitest files that leak
    // outside `test/` in Rails engines, and the ubiquitous
    // `spec_helper.rb` / `test_helper.rb` / `rails_helper.rb` bootstrap
    // trio. Hero projects: rubocop (67%), discourse (60%, −5.53M tok).
    label: "Ruby",
    patterns: [
      "**/*_spec.rb",
      "**/*_test.rb",
      "**/test_*.rb",
      "**/spec_helper.rb",
      "**/test_helper.rb",
      "**/rails_helper.rb",
    ],
  },
  {
    // Swift patterns are scoped to test *directories*, not file
    // suffixes, because the runtime matcher (the `ignore` package in
    // ignore-filter.ts) runs with its default `ignorecase: true`. Under
    // case-insensitive matching a bare `**/*Test.swift` also swallows
    // production names like Contest.swift, Latest.swift, Backtest.swift
    // and Protest.swift; `**/*Tests.swift` catches Contests.swift, and
    // `**/*Spec.swift` catches Inspec.swift. That is not recoverable by
    // writing the glob more carefully — `ignore` compiles patterns to a
    // RegExp with the `i` flag, so a `[Tt]` character class buys nothing.
    // Since these starter lines are meant to be uncommented by users,
    // silently dropping real source is the worst failure mode available,
    // so the file-suffix form was abandoned.
    //
    // The globs below use *exact* directory names rather than a `*Tests`
    // suffix, so they carry no false-positive risk at all: Contests/ and
    // Protests/ do not match. They cover SPM's `Tests/` and Quick's
    // `Specs/` at any depth, including nested module layouts like
    // Modules/Feature/Tests/ that `detectDirectories()` cannot see (it
    // enumerates only direct children of projectRoot).
    //
    // Xcode's target-suffix convention (`MyAppTests/`, `MyAppUITests/`)
    // is deliberately NOT handled here. It is handled by the "tests"
    // entry in SUFFIX_DIR_GLOBS instead, which only fires for directories
    // observed on disk and emits them under their real name — see the
    // note there for why that is the safe place for suffix matching.
    // The residual gap is a *nested* Xcode-style dir (Modules/Feature/
    // FeatureTests/), which neither rule reaches. That is an accepted
    // miss: under-matching costs tokens, over-matching silently drops
    // source, and only one of those is a correctness bug.
    //
    // NOTE: token-savings measurement still to be redone for this
    // directory-scoped shape — the earlier file-suffix figures do not
    // carry over and have been removed rather than restated.
    label: "Swift",
    patterns: [
      "**/Tests/**/*.swift",
      "**/Specs/**/*.swift",
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

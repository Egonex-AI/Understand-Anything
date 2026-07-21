import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateStarterIgnoreFile } from "../ignore-generator";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("generateStarterIgnoreFile", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ignore-gen-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("includes a header comment explaining the file", () => {
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain(".understandignore");
    expect(content).toContain("same as .gitignore");
    expect(content).toContain("Built-in defaults");
  });

  it("all suggestions are commented out", () => {
    mkdirSync(join(testDir, "__tests__"), { recursive: true });
    mkdirSync(join(testDir, "docs"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(lines).toHaveLength(0);
  });

  it("suggests __tests__ when directory exists", () => {
    mkdirSync(join(testDir, "__tests__"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# __tests__/");
  });

  it("suggests docs when directory exists", () => {
    mkdirSync(join(testDir, "docs"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# docs/");
  });

  it("suggests test and tests when they exist", () => {
    mkdirSync(join(testDir, "test"), { recursive: true });
    mkdirSync(join(testDir, "tests"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# test/");
    expect(content).toContain("# tests/");
  });

  it("suggests fixtures when directory exists", () => {
    mkdirSync(join(testDir, "fixtures"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# fixtures/");
  });

  it("suggests examples when directory exists", () => {
    mkdirSync(join(testDir, "examples"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# examples/");
  });

  it("suggests .storybook when directory exists", () => {
    mkdirSync(join(testDir, ".storybook"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# .storybook/");
  });

  it("suggests migrations when directory exists", () => {
    mkdirSync(join(testDir, "migrations"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# migrations/");
  });

  it("suggests scripts when directory exists", () => {
    mkdirSync(join(testDir, "scripts"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# scripts/");
  });

  it("always includes generic test file suggestions", () => {
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# *.snap");
    expect(content).toContain("# *.test.*");
    expect(content).toContain("# *.spec.*");
  });

  it("does not suggest directories that don't exist", () => {
    const content = generateStarterIgnoreFile(testDir);
    expect(content).not.toContain("# __tests__/");
    expect(content).not.toContain("# .storybook/");
    expect(content).not.toContain("# fixtures/");
  });

  describe("multi-language test directory detection", () => {
    it("suggests PascalCase Tests/ via case-insensitive match", () => {
      mkdirSync(join(testDir, "Tests"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      // On-disk casing is preserved in the suggestion.
      expect(content).toContain("# Tests/");
    });

    it("suggests UnitTests/ via case-insensitive match", () => {
      mkdirSync(join(testDir, "UnitTests"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# UnitTests/");
    });

    it("suggests IntegrationTests/ via case-insensitive match", () => {
      mkdirSync(join(testDir, "IntegrationTests"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# IntegrationTests/");
    });

    it("suggests C# project-suffix .Tests/ directories", () => {
      mkdirSync(join(testDir, "MyApp.Tests"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# MyApp.Tests/");
    });

    it("suggests C# project-suffix .UnitTests/ directories", () => {
      mkdirSync(join(testDir, "MyApp.UnitTests"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# MyApp.UnitTests/");
    });

    it("suggests C# project-suffix .IntegrationTests/ directories", () => {
      mkdirSync(join(testDir, "MyApp.IntegrationTests"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# MyApp.IntegrationTests/");
    });

    it("ignores files that happen to share a detected name", () => {
      writeFileSync(join(testDir, "tests"), "not a directory");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).not.toContain("# tests/");
    });

    it("suggests singular unittest/ (mongo-style)", () => {
      mkdirSync(join(testDir, "unittest"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# unittest/");
    });

    it("suggests benchmark/ directories", () => {
      mkdirSync(join(testDir, "benchmark"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# benchmark/");
    });

    it("suggests benchmarks/ directories", () => {
      mkdirSync(join(testDir, "benchmarks"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# benchmarks/");
    });

    it("suggests bench/ directories", () => {
      mkdirSync(join(testDir, "bench"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# bench/");
    });

    it("suggests benches/ directories (Cargo convention)", () => {
      mkdirSync(join(testDir, "benches"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# benches/");
    });

    it("suggests spec/ directories (RSpec convention)", () => {
      mkdirSync(join(testDir, "spec"), { recursive: true });
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# spec/");
    });
  });

  describe("language-grouped test file patterns", () => {
    it("includes C# / .NET test file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# C# / .NET");
      expect(content).toContain("# **/*Tests.cs");
      expect(content).toContain("# **/*Test.cs");
      expect(content).toContain("# **/*Fixture.cs");
      expect(content).toContain("# **/*.Tests.csproj");
    });

    it("includes Java / Kotlin test file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# Java / Kotlin");
      expect(content).toContain("# **/*Test.java");
      expect(content).toContain("# **/*IT.java");
      expect(content).toContain("# **/*Spec.kt");
      expect(content).toContain("# **/src/test/**");
    });

    it("includes Go test file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# Go");
      expect(content).toContain("# **/*_test.go");
    });

    it("includes C++ test file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# C++");
      // gtest-style snake_case suffix (abseil / protobuf / grpc / mongo).
      expect(content).toContain("# **/*_test.cc");
      expect(content).toContain("# **/*_test.cpp");
      expect(content).toContain("# **/*_test.cxx");
      // PascalCase suffix (folly, LLVM unittests).
      expect(content).toContain("# **/*Test.cc");
      expect(content).toContain("# **/*Test.cpp");
      // Chromium / protobuf / Electron idiom.
      expect(content).toContain("# **/*_unittest.cc");
      expect(content).toContain("# **/*_unittest.cpp");
      expect(content).toContain("# **/*_browsertest.cc");
      // Benchmarks frequently co-located with source.
      expect(content).toContain("# **/*_benchmark.cc");
      expect(content).toContain("# **/*Benchmark.cpp");
    });

    it("includes Python pytest / unittest file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# Python");
      // pytest / unittest default discovery — file must start with test_.
      expect(content).toContain("# **/test_*.py");
      // Alternate convention used by tensorflow, google-style, etc.
      expect(content).toContain("# **/*_test.py");
    });

    it("includes Django's single-file tests.py convention", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# **/tests.py");
    });

    it("includes pytest conftest.py convention", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# **/conftest.py");
    });

    it("includes Rust tests.rs per-module extraction convention", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# Rust");
      // Rust Book ch. 11.3 pattern — extracted sibling test module.
      expect(content).toContain("# **/tests.rs");
    });

    it("includes Rust workspace-style *_test.rs and test_*.rs conventions", () => {
      const content = generateStarterIgnoreFile(testDir);
      // Dominant in large workspaces (polkadot-sdk, rust-lang/rust,
      // solana-labs/solana) where tests colocate with source rather
      // than living inside inline `#[cfg(test)] mod tests`.
      expect(content).toContain("# **/test_*.rs");
      expect(content).toContain("# **/*_test.rs");
    });

    it("includes Rust criterion / test::Bencher file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      // Defensive: most Cargo benches live under `benches/` (covered by
      // the dir rule) but a small fraction of workspaces name benchmark
      // files with these prefixes/suffixes outside that directory.
      expect(content).toContain("# **/bench_*.rs");
      expect(content).toContain("# **/*_bench.rs");
    });

    it("includes Ruby RSpec + Minitest file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# Ruby");
      // RSpec — dominant in Rails-adjacent projects (discourse, homebrew).
      expect(content).toContain("# **/*_spec.rb");
      // Minitest — Rails core default (rails/rails, activerecord).
      expect(content).toContain("# **/*_test.rb");
      expect(content).toContain("# **/test_*.rb");
    });

    it("includes Ruby test-harness helper file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      // Bootstrapping / configuration files loaded by RSpec + Minitest;
      // conventionally under spec/ or test/ but sometimes referenced
      // from elsewhere via `require_relative`.
      expect(content).toContain("# **/spec_helper.rb");
      expect(content).toContain("# **/test_helper.rb");
      expect(content).toContain("# **/rails_helper.rb");
    });

    it("includes Swift XCTest / Swift Testing file patterns", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# Swift");
      // Dominant Apple convention — one <ClassName>Tests.swift per unit.
      expect(content).toContain("# **/*Tests.swift");
      // Singular variant seen in some older codebases.
      expect(content).toContain("# **/*Test.swift");
    });

    it("includes Swift Quick/Nimble BDD *Spec.swift files", () => {
      const content = generateStarterIgnoreFile(testDir);
      // Quick is the Swift RSpec-equivalent — dominant in codebases that
      // adopted BDD styling before Swift Testing shipped.
      expect(content).toContain("# **/*Spec.swift");
    });

    it("groups patterns under the JS / TS sub-header", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# JS / TS");
    });

    it("emits language groups in stable order: JS, C#, Java, Go, C++, Python, Rust, Ruby, Swift", () => {
      const content = generateStarterIgnoreFile(testDir);
      const jsIdx = content.indexOf("# JS / TS");
      const csIdx = content.indexOf("# C# / .NET");
      const javaIdx = content.indexOf("# Java / Kotlin");
      const goIdx = content.indexOf("# Go");
      const cppIdx = content.indexOf("# C++");
      const pyIdx = content.indexOf("# Python");
      const rustIdx = content.indexOf("# Rust");
      const rubyIdx = content.indexOf("# Ruby");
      const swiftIdx = content.indexOf("# Swift");
      expect(jsIdx).toBeGreaterThan(-1);
      expect(csIdx).toBeGreaterThan(jsIdx);
      expect(javaIdx).toBeGreaterThan(csIdx);
      expect(goIdx).toBeGreaterThan(javaIdx);
      expect(cppIdx).toBeGreaterThan(goIdx);
      expect(pyIdx).toBeGreaterThan(cppIdx);
      expect(rustIdx).toBeGreaterThan(pyIdx);
      expect(rubyIdx).toBeGreaterThan(rustIdx);
      expect(swiftIdx).toBeGreaterThan(rubyIdx);
    });

    it("keeps all suggestions commented even with no detected dirs and no .gitignore", () => {
      const content = generateStarterIgnoreFile(testDir);
      const uncommented = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      expect(uncommented).toHaveLength(0);
    });

    it("ignores a file whose name would match a suffix-glob", () => {
      writeFileSync(join(testDir, "MyApp.Tests"), "not a directory");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).not.toContain("# MyApp.Tests/");
    });
  });

  describe(".gitignore integration", () => {
    it("includes .gitignore patterns not covered by defaults", () => {
      writeFileSync(join(testDir, ".gitignore"), ".env\nsecrets/\n*.pyc\n");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("From .gitignore");
      expect(content).toContain("# .env");
      expect(content).toContain("# secrets/");
      expect(content).toContain("# *.pyc");
    });

    it("excludes .gitignore patterns already in defaults", () => {
      writeFileSync(join(testDir, ".gitignore"), "node_modules/\ndist/\n.env\n");
      const content = generateStarterIgnoreFile(testDir);
      // .env is not in defaults, should appear
      expect(content).toContain("# .env");
      // node_modules/ and dist/ are in defaults, should not appear in .gitignore section
      const gitignoreSection = content.split("From .gitignore")[1]?.split("---")[0] ?? "";
      expect(gitignoreSection).not.toContain("node_modules");
      expect(gitignoreSection).not.toContain("dist");
    });

    it("skips .gitignore comments and blank lines", () => {
      writeFileSync(join(testDir, ".gitignore"), "# a comment\n\n.env\n  \n");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# .env");
      // Should not include the original comment as a pattern
      const gitignoreSection = content.split("From .gitignore")[1]?.split("---")[0] ?? "";
      expect(gitignoreSection).not.toContain("a comment");
    });

    it("handles .gitignore with trailing-slash normalization for defaults", () => {
      // "dist" without trailing slash should still match "dist/" default
      writeFileSync(join(testDir, ".gitignore"), "dist\ncoverage\n.env\n");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("From .gitignore");
      // Extract lines between the .gitignore header and the next section header
      const lines = content.split("\n");
      const headerIdx = lines.findIndex((l) => l.includes("From .gitignore"));
      const nextSectionIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith("# ---"));
      const sectionLines = lines.slice(headerIdx + 1, nextSectionIdx === -1 ? undefined : nextSectionIdx);
      const patterns = sectionLines.filter((l) => l.startsWith("# ") && !l.startsWith("# ---")).map((l) => l.slice(2));
      expect(patterns).toContain(".env");
      expect(patterns).not.toContain("dist");
      expect(patterns).not.toContain("coverage");
    });

    it("omits .gitignore section when no .gitignore exists", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).not.toContain("From .gitignore");
    });

    it("omits .gitignore section when all patterns are covered by defaults", () => {
      writeFileSync(join(testDir, ".gitignore"), "node_modules/\ndist/\n*.lock\n");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).not.toContain("From .gitignore");
    });

    it("all .gitignore suggestions are commented out", () => {
      writeFileSync(join(testDir, ".gitignore"), ".env\nsecrets/\n*.pyc\n");
      const content = generateStarterIgnoreFile(testDir);
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      expect(lines).toHaveLength(0);
    });
  });
});

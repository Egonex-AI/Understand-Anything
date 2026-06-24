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

    it("groups patterns under the JS / TS sub-header", () => {
      const content = generateStarterIgnoreFile(testDir);
      expect(content).toContain("# JS / TS");
    });

    it("emits language groups in stable order: JS, C#, Java, Go", () => {
      const content = generateStarterIgnoreFile(testDir);
      const jsIdx = content.indexOf("# JS / TS");
      const csIdx = content.indexOf("# C# / .NET");
      const javaIdx = content.indexOf("# Java / Kotlin");
      const goIdx = content.indexOf("# Go");
      expect(jsIdx).toBeGreaterThan(-1);
      expect(csIdx).toBeGreaterThan(jsIdx);
      expect(javaIdx).toBeGreaterThan(csIdx);
      expect(goIdx).toBeGreaterThan(javaIdx);
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

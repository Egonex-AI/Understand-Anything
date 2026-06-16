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

    it("treats anchored .gitignore patterns as covered by defaults", () => {
      writeFileSync(join(testDir, ".gitignore"), "/node_modules\n/dist\n.env\n");
      const content = generateStarterIgnoreFile(testDir);
      // Extract the pattern lines under the .gitignore section (between its
      // header and the next "# ---" section header).
      const lines = content.split("\n");
      const headerIdx = lines.findIndex((l) => l.includes("From .gitignore"));
      // Guard: if the section were fully deduped, findIndex returns -1 and the
      // slice below would silently scan from the top of the file (masking a
      // regression). Assert the section is actually present before slicing.
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      const nextSectionIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith("# ---"));
      const sectionLines = lines.slice(headerIdx + 1, nextSectionIdx === -1 ? undefined : nextSectionIdx);
      const patterns = sectionLines
        .filter((l) => l.startsWith("# ") && !l.startsWith("# ---"))
        .map((l) => l.slice(2));
      // /node_modules and /dist are anchored forms of defaults node_modules/ and dist/.
      expect(patterns).not.toContain("/node_modules"); // fails today: '# /node_modules' is present
      expect(patterns).not.toContain("/dist"); // fails today: '# /dist' is present
      expect(patterns).toContain(".env"); // still suggested
    });

    it("treats **/ and ./ anchor variants as covered by defaults", () => {
      writeFileSync(
        join(testDir, ".gitignore"),
        "**/node_modules\n**/build/\n./dist/\n.env\n",
      );
      const content = generateStarterIgnoreFile(testDir);
      const lines = content.split("\n");
      const headerIdx = lines.findIndex((l) => l.includes("From .gitignore"));
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      const nextSectionIdx = lines.findIndex((l, i) => i > headerIdx && l.startsWith("# ---"));
      const sectionLines = lines.slice(headerIdx + 1, nextSectionIdx === -1 ? undefined : nextSectionIdx);
      const patterns = sectionLines
        .filter((l) => l.startsWith("# ") && !l.startsWith("# ---"))
        .map((l) => l.slice(2));
      // **/node_modules, **/build/, and ./dist/ are anchor variants of defaults.
      expect(patterns).not.toContain("**/node_modules");
      expect(patterns).not.toContain("**/build/");
      expect(patterns).not.toContain("./dist/");
      // A non-default pattern still survives.
      expect(patterns).toContain(".env");
    });

    it("does not suggest .gitignore negation (!) patterns", () => {
      writeFileSync(join(testDir, ".gitignore"), "build/\n!build/keep.txt\n.env\n");
      const content = generateStarterIgnoreFile(testDir);
      expect(content).not.toContain("!build/keep.txt"); // fails today: '# !build/keep.txt' is emitted
      expect(content).toContain("# .env");
    });
  });
});

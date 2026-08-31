import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIgnoreFilter, DEFAULT_IGNORE_PATTERNS } from "../ignore-filter";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("IgnoreFilter", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ignore-filter-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, ".understand-anything"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("DEFAULT_IGNORE_PATTERNS", () => {
    it("contains node_modules", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain("node_modules/");
    });

    it("contains .git", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain(".git/");
    });

    it("contains obj for .NET", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain("obj/");
    });

    it("does not contain bin (used by Node/Ruby CLI launchers)", () => {
      expect(DEFAULT_IGNORE_PATTERNS).not.toContain("bin/");
    });

    it("contains build output directories", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain("dist/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("build/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("out/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("coverage/");
    });
  });

  describe("createIgnoreFilter with no user file", () => {
    it("ignores files matching default patterns", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("node_modules/foo/bar.js")).toBe(true);
      expect(filter.isIgnored("dist/index.js")).toBe(true);
      expect(filter.isIgnored(".git/config")).toBe(true);
      expect(filter.isIgnored("obj/Release/net8.0/app.dll")).toBe(true);
    });

    it("does not ignore source files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
      expect(filter.isIgnored("README.md")).toBe(false);
      expect(filter.isIgnored("package.json")).toBe(false);
    });

    it("ignores lock files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("pnpm-lock.yaml")).toBe(true);
      expect(filter.isIgnored("package-lock.json")).toBe(true);
      expect(filter.isIgnored("yarn.lock")).toBe(true);
    });

    it("ignores binary/asset files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("logo.png")).toBe(true);
      expect(filter.isIgnored("font.woff2")).toBe(true);
      expect(filter.isIgnored("doc.pdf")).toBe(true);
    });

    it("ignores generated files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("bundle.min.js")).toBe(true);
      expect(filter.isIgnored("style.min.css")).toBe(true);
      expect(filter.isIgnored("source.map")).toBe(true);
    });

    it("ignores IDE directories", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored(".idea/workspace.xml")).toBe(true);
      expect(filter.isIgnored(".vscode/settings.json")).toBe(true);
    });

    it("does not throw on './'-prefixed paths and matches correctly", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("./dist/index.js")).toBe(true);
      expect(filter.isIgnored("./src/index.ts")).toBe(false);
    });

    it("treats the empty relative path (project root) as not ignored", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("")).toBe(false);
    });

    it("does not throw on the input shapes that ignore@7 rejects", () => {
      const filter = createIgnoreFilter(testDir);
      // These are the previously-throwing inputs from the PR body. The whole
      // point of the fix is that they return a boolean rather than throw.
      expect(() => filter.isIgnored("")).not.toThrow();
      expect(() => filter.isIgnored("./")).not.toThrow();
      expect(() => filter.isIgnored("./dist/index.js")).not.toThrow();
      expect(() => filter.isIgnored("././foo.log")).not.toThrow();
      expect(() => filter.isIgnored(".//foo.log")).not.toThrow();
      expect(() => filter.isIgnored("../escapes/root.ts")).not.toThrow();
      expect(() => filter.isIgnored("dist\\index.js")).not.toThrow();
      expect(() => filter.isIgnored(".\\dist\\index.js")).not.toThrow();
    });

    it("treats a bare './' (trim-to-empty / project root) as not ignored", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("./")).toBe(false);
    });

    it("collapses repeated leading './' and duplicate slash runs", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("././dist/index.js")).toBe(true);
      expect(filter.isIgnored(".//dist/index.js")).toBe(true);
      expect(filter.isIgnored("./src//index.ts")).toBe(false);
    });

    it("normalizes Windows backslash separators", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("dist\\index.js")).toBe(true);
      expect(filter.isIgnored(".\\dist\\index.js")).toBe(true);
      expect(filter.isIgnored("src\\index.ts")).toBe(false);
    });

    it("treats out-of-root '../' paths as not ignored instead of throwing", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("../foo")).toBe(false);
      expect(filter.isIgnored("..")).toBe(false);
      expect(filter.isIgnored("..\\foo")).toBe(false);
    });
  });

  describe("createIgnoreFilter with user .understandignore", () => {
    it("reads patterns from .understand-anything/.understandignore", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "# Exclude tests\n__tests__/\n*.test.ts\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("__tests__/foo.test.ts")).toBe(true);
      expect(filter.isIgnored("src/utils.test.ts")).toBe(true);
      expect(filter.isIgnored("src/utils.ts")).toBe(false);
    });

    it("reads patterns from project root .understandignore", () => {
      writeFileSync(
        join(testDir, ".understandignore"),
        "docs/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("docs/README.md")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });

    it("handles # comments and blank lines", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "# This is a comment\n\n\nfixtures/\n\n# Another comment\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("fixtures/data.json")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });

    it("supports ! negation to override defaults", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "!dist/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("dist/index.js")).toBe(false);
    });

    it("supports ** recursive matching", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "**/snapshots/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("src/components/snapshots/Button.snap")).toBe(true);
      expect(filter.isIgnored("snapshots/foo.snap")).toBe(true);
    });

    it("merges .understand-anything/ and root .understandignore", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "__tests__/\n"
      );
      writeFileSync(
        join(testDir, ".understandignore"),
        "fixtures/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("__tests__/foo.ts")).toBe(true);
      expect(filter.isIgnored("fixtures/data.json")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });
  });

  describe("createIgnoreFilter with CLI --exclude patterns", () => {
    it("applies CLI exclude patterns alongside defaults", () => {
      const filter = createIgnoreFilter(testDir, ["tests/", "e2e/"]);
      expect(filter.isIgnored("tests/foo.test.ts")).toBe(true);
      expect(filter.isIgnored("e2e/smoke.spec.ts")).toBe(true);
      // Defaults still apply
      expect(filter.isIgnored("node_modules/foo.js")).toBe(true);
      expect(filter.isIgnored("dist/bundle.js")).toBe(true);
      // Non-excluded source files pass through
      expect(filter.isIgnored("src/index.ts")).toBe(false);
      expect(filter.isIgnored("README.md")).toBe(false);
    });

    it("CLI patterns have highest priority over .understandignore files", () => {
      // .understandignore says to include docs/
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "!docs/\n"
      );
      // CLI --exclude says to exclude docs/
      const filter = createIgnoreFilter(testDir, ["docs/"]);
      // CLI patterns are added last, so they override the ! negation from .understandignore
      expect(filter.isIgnored("docs/README.md")).toBe(true);
    });

    it("CLI ! negation can re-include files excluded by defaults", () => {
      // CLI says to include dist/ even though defaults exclude it
      const filter = createIgnoreFilter(testDir, ["!dist/"]);
      expect(filter.isIgnored("dist/bundle.js")).toBe(false);
      // Other defaults still apply
      expect(filter.isIgnored("node_modules/foo.js")).toBe(true);
    });

    it("CLI patterns combined with .understandignore files all apply", () => {
      writeFileSync(
        join(testDir, ".understandignore"),
        "fixtures/\n"
      );
      const filter = createIgnoreFilter(testDir, ["e2e/"]);
      expect(filter.isIgnored("fixtures/data.json")).toBe(true);
      expect(filter.isIgnored("e2e/smoke.spec.ts")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });

    it("empty CLI patterns array has no effect", () => {
      const filter = createIgnoreFilter(testDir, []);
      expect(filter.isIgnored("node_modules/foo.js")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
      expect(filter.isIgnored("docs/README.md")).toBe(false);
    });
  });
});

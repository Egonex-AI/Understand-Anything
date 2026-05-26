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

  describe("createIgnoreFilter with extraExclude option", () => {
    it("excludes files matching CLI patterns", () => {
      const filter = createIgnoreFilter(testDir, {
        extraExclude: ["**/*.test.ts", "scratch/"],
      });
      expect(filter.isIgnored("src/utils.test.ts")).toBe(true);
      expect(filter.isIgnored("packages/a/src/foo.test.ts")).toBe(true);
      expect(filter.isIgnored("scratch/notes.md")).toBe(true);
      // Source files and the matcher's own helper files stay in.
      expect(filter.isIgnored("src/utils.ts")).toBe(false);
      expect(filter.isIgnored("README.md")).toBe(false);
    });

    it("CLI exclude stacks with .understandignore", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "fixtures/\n"
      );
      const filter = createIgnoreFilter(testDir, {
        extraExclude: ["docs/"],
      });
      // Both the persisted rule and the CLI rule are active.
      expect(filter.isIgnored("fixtures/data.json")).toBe(true);
      expect(filter.isIgnored("docs/guide.md")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });

    it("empty extraExclude does not change behavior", () => {
      const baseline = createIgnoreFilter(testDir);
      const filter = createIgnoreFilter(testDir, { extraExclude: [] });
      const probes = [
        "src/index.ts",
        "node_modules/foo/bar.js",
        "dist/index.js",
        "README.md",
        "package-lock.json",
      ];
      for (const p of probes) {
        expect(filter.isIgnored(p)).toBe(baseline.isIgnored(p));
      }
    });

    it("does not affect behavior when options is undefined", () => {
      const explicit = createIgnoreFilter(testDir, undefined);
      const implicit = createIgnoreFilter(testDir);
      const probes = [
        "src/index.ts",
        "node_modules/foo/bar.js",
        "dist/index.js",
        ".idea/workspace.xml",
      ];
      for (const p of probes) {
        expect(explicit.isIgnored(p)).toBe(implicit.isIgnored(p));
      }
    });

    it("CLI exclude applied after .understandignore can be overridden by ! negation in .understandignore", () => {
      // Layer order: defaults -> .understand-anything/.understandignore ->
      // .understandignore -> extraExclude. Patterns appended later win,
      // including over `!` negations. Document the precedence so users
      // know `--exclude` is the final word.
      writeFileSync(
        join(testDir, ".understandignore"),
        "!keep.log\n"
      );
      const filter = createIgnoreFilter(testDir, {
        extraExclude: ["keep.log"],
      });
      // The CLI exclude wins because it is the final layer.
      expect(filter.isIgnored("keep.log")).toBe(true);
    });

    it("supports ! negation inside extraExclude to re-include defaults-excluded files", () => {
      // Symmetric test: `--exclude=!dist/` should re-include dist/ that the
      // hardcoded defaults would otherwise drop. Useful when CI users want
      // to override defaults without committing a `.understandignore`.
      const filter = createIgnoreFilter(testDir, {
        extraExclude: ["!dist/"],
      });
      expect(filter.isIgnored("dist/index.js")).toBe(false);
    });
  });
});

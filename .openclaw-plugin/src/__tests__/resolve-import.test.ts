import { describe, expect, it } from "vitest";
import { resolveImportTarget } from "../pipeline.js";

describe("resolveImportTarget", () => {
  const known = new Set([
    "src/main.ts",
    "src/util.ts",
    "src/components/Button.tsx",
    "src/lib/index.ts",
    "scripts/run.mjs",
    "pkg/mod.py",
  ]);

  it("resolves a TS-ESM .js specifier to the .ts file on disk (regression: util.js.ts)", () => {
    expect(resolveImportTarget("src/main.ts", "./util.js", known)).toBe("src/util.ts");
  });

  it("resolves an extensionless specifier by trying known extensions", () => {
    expect(resolveImportTarget("src/main.ts", "./util", known)).toBe("src/util.ts");
    expect(resolveImportTarget("src/main.ts", "./components/Button", known)).toBe("src/components/Button.tsx");
  });

  it("resolves a directory import to its index file", () => {
    expect(resolveImportTarget("src/main.ts", "./lib", known)).toBe("src/lib/index.ts");
  });

  it("resolves an exact-match specifier as written", () => {
    expect(resolveImportTarget("scripts/other.mjs", "./run.mjs", known)).toBe("scripts/run.mjs");
  });

  it("resolves ../ traversal", () => {
    expect(resolveImportTarget("src/components/Button.tsx", "../util.js", known)).toBe("src/util.ts");
  });

  it("skips bare package imports", () => {
    expect(resolveImportTarget("src/main.ts", "react", known)).toBeNull();
    expect(resolveImportTarget("src/main.ts", "@scope/pkg", known)).toBeNull();
  });

  it("returns null for unresolvable relative imports", () => {
    expect(resolveImportTarget("src/main.ts", "./missing.js", known)).toBeNull();
  });
});

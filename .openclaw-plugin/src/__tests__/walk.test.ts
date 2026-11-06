import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkProject } from "../walk.js";

const noopIgnoreFilter = { isIgnored: () => false };

const dirsToClean: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length) {
    const dir = dirsToClean.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("walkProject", () => {
  it("lists ordinary files under root", () => {
    const root = makeTmpDir("ua-walk-basic-");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "// a");
    writeFileSync(join(root, "README.md"), "# readme");

    const results = walkProject(root, noopIgnoreFilter).sort();
    expect(results).toEqual(["README.md", "src/a.ts"]);
  });

  it("does not follow a symlink that escapes the project root (security: allowlist bypass)", () => {
    const root = makeTmpDir("ua-walk-root-");
    const outside = makeTmpDir("ua-walk-outside-");
    writeFileSync(join(outside, "secret.ts"), "// should never be read");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "// a");
    symlinkSync(outside, join(root, "src", "escape"), "dir");

    const results = walkProject(root, noopIgnoreFilter).sort();
    expect(results).toEqual(["src/a.ts"]);
    expect(results.some((r) => r.includes("secret"))).toBe(false);
  });

  it("does not infinite-loop on a symlink cycle (crash risk: unbounded recursion)", () => {
    const root = makeTmpDir("ua-walk-cycle-");
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "a", "file.ts"), "// a");
    // a/loop -> root (cycle back to an ancestor)
    symlinkSync(root, join(root, "a", "loop"), "dir");

    const results = walkProject(root, noopIgnoreFilter).sort();
    expect(results).toEqual(["a/file.ts"]);
  });

  it("does not follow a symlink cycle pointing at itself", () => {
    const root = makeTmpDir("ua-walk-self-cycle-");
    writeFileSync(join(root, "real.ts"), "// real");
    symlinkSync(root, join(root, "self"), "dir");

    const results = walkProject(root, noopIgnoreFilter).sort();
    expect(results).toEqual(["real.ts"]);
  });
});

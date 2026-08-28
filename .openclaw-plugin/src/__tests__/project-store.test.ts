import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../project-store.js";

const dirsToClean: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length) rmSync(dirsToClean.pop()!, { recursive: true, force: true });
});

describe("ProjectStore", () => {
  it("lists config-declared projects and rejects adding when allowAddProject is false", async () => {
    const configRoot = makeTmpDir("ua-store-config-");
    const stateDir = makeTmpDir("ua-store-state-");
    const store = new ProjectStore({ configProjects: [configRoot], allowAddProject: false, stateDir });

    expect(store.list()).toEqual([configRoot]);
    expect(store.canAddProject()).toBe(false);

    const result = await store.addProject("/some/other/path");
    expect("error" in result).toBe(true);
    expect(store.list()).toEqual([configRoot]); // unchanged
  });

  it("adds a local path project and persists it across a fresh store instance", async () => {
    const configRoot = makeTmpDir("ua-store-config-");
    const stateDir = makeTmpDir("ua-store-state-");
    const newProject = makeTmpDir("ua-store-newproj-");

    const store = new ProjectStore({ configProjects: [configRoot], allowAddProject: true, stateDir });
    const result = await store.addProject(newProject);

    expect(result).toEqual({ root: newProject });
    expect(store.list()).toEqual([configRoot, newProject]);

    // A fresh store reading the same state dir should pick up the persisted addition.
    const reloaded = new ProjectStore({ configProjects: [configRoot], allowAddProject: true, stateDir });
    expect(reloaded.list()).toEqual([configRoot, newProject]);
  });

  it("rejects a local path that doesn't exist", async () => {
    const stateDir = makeTmpDir("ua-store-state-");
    const store = new ProjectStore({ configProjects: [], allowAddProject: true, stateDir });

    const result = await store.addProject("/definitely/not/a/real/path/xyz123");
    expect("error" in result).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it("does not add a duplicate when the same path is added twice", async () => {
    const stateDir = makeTmpDir("ua-store-state-");
    const project = makeTmpDir("ua-store-dup-");
    const store = new ProjectStore({ configProjects: [], allowAddProject: true, stateDir });

    await store.addProject(project);
    await store.addProject(project);

    expect(store.list()).toEqual([project]);
  });

  it("does not treat a github.com-shaped local directory name as a clone target", async () => {
    // Regression guard: only a real https://github.com/... or git@github.com:...
    // URL should trigger a clone. A bare "owner/repo"-looking string must be
    // rejected as a local path (not silently attempted as a clone) since it's
    // ambiguous with a genuine relative path and we don't want surprise network calls.
    const stateDir = makeTmpDir("ua-store-state-");
    const store = new ProjectStore({ configProjects: [], allowAddProject: true, stateDir });

    const result = await store.addProject("owner/repo");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/not an existing local directory/);
    }
  });

  it("rejects non-github git URLs and file:// URLs (would otherwise let git clone read arbitrary paths)", async () => {
    const stateDir = makeTmpDir("ua-store-state-");
    const store = new ProjectStore({ configProjects: [], allowAddProject: true, stateDir });

    for (const bad of ["file:///etc/passwd", "https://gitlab.com/owner/repo", "git://example.com/repo.git"]) {
      const result = await store.addProject(bad);
      expect("error" in result).toBe(true);
    }
  });
});

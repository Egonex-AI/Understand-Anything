import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveDiffOverlay, loadDiffOverlay } from "../persistence/index.js";
import type { DiffOverlay } from "../types.js";

const testRoot = join(tmpdir(), "ua-diff-overlay-persist-test");

const overlay: DiffOverlay = {
  version: "1.0.0",
  baseBranch: "main",
  generatedAt: "2026-04-01T00:00:00.000Z",
  changedFiles: ["src/auth.ts"],
  changedNodeIds: ["file:src/auth.ts"],
  affectedNodeIds: ["file:src/session.ts"],
};

describe("diff overlay persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads a diff overlay", () => {
    saveDiffOverlay(testRoot, overlay);
    const loaded = loadDiffOverlay(testRoot);
    expect(loaded).not.toBeNull();
    expect(loaded!.changedNodeIds).toEqual(["file:src/auth.ts"]);
    expect(loaded!.affectedNodeIds).toEqual(["file:src/session.ts"]);
    expect(loaded!.baseBranch).toBe("main");
  });

  it("returns null when no diff overlay exists", () => {
    expect(loadDiffOverlay(testRoot)).toBeNull();
  });

  it("saves to diff-overlay.json, alongside but distinct from knowledge-graph.json", () => {
    saveDiffOverlay(testRoot, overlay);
    expect(existsSync(join(testRoot, ".ua", "diff-overlay.json"))).toBe(true);
    expect(existsSync(join(testRoot, ".ua", "knowledge-graph.json"))).toBe(false);
  });

  it("sanitizes absolute changedFiles paths to stay relative to projectRoot", () => {
    const absoluteOverlay: DiffOverlay = {
      ...overlay,
      changedFiles: [join(testRoot, "src", "auth.ts")],
    };
    saveDiffOverlay(testRoot, absoluteOverlay);
    const loaded = loadDiffOverlay(testRoot);
    expect(loaded!.changedFiles).toEqual(["src/auth.ts"]);
  });

  it("returns null (not throw) on a corrupt diff-overlay.json", () => {
    mkdirSync(join(testRoot, ".ua"), { recursive: true });
    writeFileSync(join(testRoot, ".ua", "diff-overlay.json"), "not json", "utf-8");
    expect(loadDiffOverlay(testRoot)).toBeNull();
  });
});

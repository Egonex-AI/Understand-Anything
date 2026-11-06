import { describe, it, expect } from "vitest";
import { computeDiffOverlay } from "../diff-overlay.js";
import type { KnowledgeGraph } from "../types.js";

function makeGraph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: { name: "p", languages: ["typescript"], frameworks: [], description: "d", analyzedAt: "2026-01-01T00:00:00.000Z", gitCommitHash: "x" },
    nodes: [
      { id: "file:auth.ts", type: "file", name: "auth.ts", filePath: "auth.ts", summary: "Auth.", tags: [], complexity: "moderate" },
      { id: "function:auth.ts:login", type: "function", name: "login", filePath: "auth.ts", summary: "Login fn.", tags: [], complexity: "moderate" },
      { id: "file:session.ts", type: "file", name: "session.ts", filePath: "session.ts", summary: "Sessions, imports auth.", tags: [], complexity: "simple" },
      { id: "file:unrelated.ts", type: "file", name: "unrelated.ts", filePath: "unrelated.ts", summary: "Nothing to do with auth.", tags: [], complexity: "simple" },
    ],
    edges: [
      // session.ts imports auth.ts -> session.ts should be "affected" when auth.ts changes
      { source: "file:session.ts", target: "file:auth.ts", type: "imports", direction: "forward", weight: 0.7 },
    ],
    layers: [],
    tour: [],
  };
}

describe("computeDiffOverlay", () => {
  it("maps changed files to both file and function/class nodes defined in them", () => {
    const overlay = computeDiffOverlay(makeGraph(), ["auth.ts"]);
    expect(overlay.changedNodeIds.sort()).toEqual(["file:auth.ts", "function:auth.ts:login"]);
  });

  it("finds affected nodes via 1-hop edges in either direction, excluding changed nodes themselves", () => {
    const overlay = computeDiffOverlay(makeGraph(), ["auth.ts"]);
    expect(overlay.affectedNodeIds).toEqual(["file:session.ts"]);
    expect(overlay.affectedNodeIds).not.toContain("file:auth.ts");
  });

  it("does not flag unrelated files as affected", () => {
    const overlay = computeDiffOverlay(makeGraph(), ["auth.ts"]);
    expect(overlay.affectedNodeIds).not.toContain("file:unrelated.ts");
  });

  it("returns empty changed/affected sets for a file not present in the graph", () => {
    const overlay = computeDiffOverlay(makeGraph(), ["does-not-exist.ts"]);
    expect(overlay.changedNodeIds).toEqual([]);
    expect(overlay.affectedNodeIds).toEqual([]);
  });

  it("includes baseBranch when provided, omits it when not", () => {
    const withBranch = computeDiffOverlay(makeGraph(), ["auth.ts"], "main");
    expect(withBranch.baseBranch).toBe("main");

    const withoutBranch = computeDiffOverlay(makeGraph(), ["auth.ts"]);
    expect(withoutBranch.baseBranch).toBeUndefined();
  });

  it("preserves the changedFiles list verbatim and stamps a generatedAt timestamp", () => {
    const overlay = computeDiffOverlay(makeGraph(), ["auth.ts", "does-not-exist.ts"]);
    expect(overlay.changedFiles).toEqual(["auth.ts", "does-not-exist.ts"]);
    expect(typeof overlay.generatedAt).toBe("string");
    expect(new Date(overlay.generatedAt).toString()).not.toBe("Invalid Date");
  });
});

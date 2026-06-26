import { describe, it, expect } from "vitest";
import { deriveContainerLevel } from "../containers";
import type { GraphNode, GraphEdge } from "@understand-anything/core/types";

// ---------------------------------------------------------------------------
// deriveContainerLevel — recursive path-based derivation
// ---------------------------------------------------------------------------

const n = (id: string, filePath?: string): GraphNode =>
  ({ id, type: "file", name: id, summary: "", tags: [], complexity: "simple", filePath } as GraphNode);
const noEdges: GraphEdge[] = [];

describe("deriveContainerLevel", () => {
  it("groups by next segment beyond prefix and detects leaves", () => {
    const nodes = [
      n("a", "repo/src/pages/Home.tsx"),
      n("b", "repo/src/pages/About.tsx"),
      n("c", "repo/src/components/Btn.tsx"),
      n("d", "repo/src/App.tsx"),            // sits directly under src -> leaf at top
    ];
    const lvl = deriveContainerLevel(nodes, noEdges, "repo");
    const names = lvl.containers.map((c) => c.name).sort();
    expect(names).toEqual(["components", "pages"]);   // src is transparent
    const pages = lvl.containers.find((c) => c.name === "pages")!;
    expect(pages.id).toBe("container:repo/src/pages");
    expect(pages.prefix).toBe("repo/src/pages");
    expect(pages.nodeIds.sort()).toEqual(["a", "b"]);
    expect(lvl.leaves).toContain("d");                // App.tsx is a leaf here
  });

  it("descends a level when given a deeper prefix", () => {
    const nodes = [n("a", "repo/src/pages/Home.tsx"), n("b", "repo/src/pages/About.tsx")];
    const lvl = deriveContainerLevel(nodes, noEdges, "repo/src/pages");
    expect(lvl.containers).toHaveLength(0);
    expect(lvl.leaves.sort()).toEqual(["a", "b"]);    // both files directly in pages
  });

  it("collapses single-child folder chains into one container", () => {
    const nodes = [n("a", "repo/a/b/c/X.ts"), n("b", "repo/a/b/c/Y.ts")];
    const lvl = deriveContainerLevel(nodes, noEdges, "repo");
    expect(lvl.containers).toHaveLength(1);
    expect(lvl.containers[0].name).toBe("a/b/c");      // collapsed chain
    expect(lvl.containers[0].prefix).toBe("repo/a/b/c");
  });

  it("treats nodes without filePath as leaves", () => {
    const nodes = [n("a", "repo/src/pages/Home.tsx"), n("x")];
    const lvl = deriveContainerLevel(nodes, noEdges, "repo");
    expect(lvl.leaves).toContain("x");
  });

  it("falls back to community ONLY at layer root when no folders separate", () => {
    const nodes = [n("a"), n("b"), n("c")]; // no filePaths at all
    const lvl = deriveContainerLevel(nodes, noEdges, "");
    expect(lvl.containers.every((c) => c.strategy === "community")).toBe(true);
  });
});

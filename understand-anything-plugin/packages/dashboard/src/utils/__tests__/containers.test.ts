import { describe, it, expect } from "vitest";
import { deriveContainers, deriveContainerLevel } from "../containers";
import type { GraphNode, GraphEdge } from "@understand-anything/core/types";

function node(id: string, filePath?: string): GraphNode {
  return {
    id,
    type: "file",
    name: id,
    filePath,
    summary: "",
    complexity: "simple",
    tags: [],
  } as GraphNode;
}

describe("deriveContainers — folder strategy", () => {
  it("groups nodes by first folder segment after LCP", () => {
    const nodes = [
      node("a", "src/auth/login.go"),
      node("b", "src/auth/oauth.go"),
      node("c", "src/cart/cart.go"),
      node("d", "src/cart/checkout.go"),
    ];
    const { containers, ungrouped } = deriveContainers(nodes, []);
    expect(ungrouped).toEqual([]);
    expect(containers).toHaveLength(2);
    const names = containers.map((c) => c.name).sort();
    expect(names).toEqual(["auth", "cart"]);
    const auth = containers.find((c) => c.name === "auth")!;
    expect(auth.strategy).toBe("folder");
    expect(auth.nodeIds.sort()).toEqual(["a", "b"]);
  });

  it("strips deep LCP", () => {
    const nodes = [
      node("a", "monorepo/backend/src/auth/login.go"),
      node("b", "monorepo/backend/src/cart/cart.go"),
    ];
    const { containers } = deriveContainers(nodes, []);
    const names = containers.map((c) => c.name).sort();
    expect(names).toEqual(["auth", "cart"]);
  });

  it("collapses nested folders into the first segment", () => {
    const nodes = [
      node("a", "auth/handlers/oauth.go"),
      node("b", "auth/services/token.go"),
      node("c", "cart/cart.go"),
    ];
    const { containers } = deriveContainers(nodes, []);
    expect(containers.find((c) => c.name === "auth")?.nodeIds.sort()).toEqual(["a", "b"]);
  });

  it("places nodes without filePath in '~' container", () => {
    const nodes = [
      node("a", "auth/login.go"),
      node("b", "auth/oauth.go"),
      node("c"),
      node("d"),
    ];
    const { containers } = deriveContainers(nodes, []);
    expect(containers.find((c) => c.name === "~")?.nodeIds.sort()).toEqual(["c", "d"]);
  });

  it("suppresses single-child containers (single child becomes ungrouped)", () => {
    const nodes = [
      node("a", "auth/login.go"),
      node("b", "auth/oauth.go"),
      node("c", "cart/cart.go"),
    ];
    const { containers, ungrouped } = deriveContainers(nodes, []);
    // 'cart' has only 1 child → suppressed
    expect(containers.find((c) => c.name === "cart")).toBeUndefined();
    expect(ungrouped).toContain("c");
    // 'auth' kept
    expect(containers.find((c) => c.name === "auth")?.nodeIds.sort()).toEqual(["a", "b"]);
  });

  it("returns flat (no containers) when total nodes < 8", () => {
    const nodes = [
      node("a", "auth/x.go"),
      node("b", "cart/y.go"),
      node("c", "logs/z.go"),
    ];
    const { containers, ungrouped } = deriveContainers(nodes, []);
    expect(containers).toHaveLength(0);
    expect(ungrouped.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("deriveContainers — community fallback", () => {
  it("falls back to communities when only one folder present", () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      node(`n${i}`, `services/n${i}.go`),
    );
    // Two clusters of 5 nodes; densely connected within, no edges between
    const edges: GraphEdge[] = [];
    for (const i of [0, 1, 2, 3, 4]) {
      for (const j of [0, 1, 2, 3, 4]) {
        if (i !== j) edges.push({ source: `n${i}`, target: `n${j}`, type: "calls" } as GraphEdge);
      }
    }
    for (const i of [5, 6, 7, 8, 9]) {
      for (const j of [5, 6, 7, 8, 9]) {
        if (i !== j) edges.push({ source: `n${i}`, target: `n${j}`, type: "calls" } as GraphEdge);
      }
    }
    const { containers } = deriveContainers(nodes, edges);
    expect(containers.length).toBeGreaterThanOrEqual(2);
    for (const c of containers) {
      expect(c.strategy).toBe("community");
      expect(c.name).toMatch(/^Cluster [A-Z]$/);
    }
  });

  it("falls back when one folder holds > 70%", () => {
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => node(`big${i}`, `big/file${i}.go`)),
      node("a", "small1/a.go"),
      node("b", "small2/b.go"),
    ];
    const { containers, ungrouped } = deriveContainers(nodes, []);
    // Folder strategy would have produced a 'big' container with 8 children.
    // Community fallback (no edges) gives each node its own community → all
    // single-child → all suppressed. The non-vacuous evidence the fallback
    // path was taken: NO folder-strategy 'big' container survives.
    expect(containers.find((c) => c.strategy === "folder" && c.name === "big")).toBeUndefined();
    expect(ungrouped.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// deriveContainerLevel — new recursive path-based derivation
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

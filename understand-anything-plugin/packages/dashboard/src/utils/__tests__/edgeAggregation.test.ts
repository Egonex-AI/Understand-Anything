import { describe, it, expect } from "vitest";
import { aggregateContainerEdges, aggregateLayerEdges, computePortals } from "../edgeAggregation";
import type { GraphEdge, EdgeType, KnowledgeGraph, Layer } from "@understand-anything/core/types";

const ce = (source: string, target: string, type: EdgeType = "calls"): GraphEdge => ({
  source,
  target,
  type,
  direction: "forward",
  weight: 1,
});

function makeGraph(layers: Layer[], edges: GraphEdge[]): KnowledgeGraph {
  return {
    version: "1.0",
    project: { name: "test", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes: [],
    edges,
    layers,
    tour: [],
  };
}

describe("aggregateContainerEdges", () => {
  it("returns empty arrays for empty input", () => {
    const r = aggregateContainerEdges([], new Map());
    expect(r.intraContainer).toEqual([]);
    expect(r.interContainerAggregated).toEqual([]);
  });

  it("preserves intra-container edges as-is", () => {
    const m = new Map([
      ["a", "auth"],
      ["b", "auth"],
    ]);
    const r = aggregateContainerEdges([ce("a", "b")], m);
    expect(r.intraContainer).toHaveLength(1);
    expect(r.interContainerAggregated).toEqual([]);
  });

  it("merges multiple same-direction inter edges into one", () => {
    const m = new Map([
      ["a", "auth"],
      ["b", "auth"],
      ["c", "cart"],
      ["d", "cart"],
    ]);
    const edges = [ce("a", "c"), ce("a", "d"), ce("b", "c", "imports")];
    const r = aggregateContainerEdges(edges, m);
    expect(r.interContainerAggregated).toHaveLength(1);
    const agg = r.interContainerAggregated[0];
    expect(agg.sourceContainerId).toBe("auth");
    expect(agg.targetContainerId).toBe("cart");
    expect(agg.count).toBe(3);
    expect(agg.edgeTypes.sort()).toEqual(["calls", "imports"]);
  });

  it("treats opposite directions as separate aggregated edges", () => {
    const m = new Map([
      ["a", "auth"],
      ["c", "cart"],
    ]);
    const r = aggregateContainerEdges([ce("a", "c"), ce("c", "a")], m);
    expect(r.interContainerAggregated).toHaveLength(2);
    const dirs = r.interContainerAggregated.map(
      (e) => `${e.sourceContainerId}→${e.targetContainerId}`,
    );
    expect(dirs.sort()).toEqual(["auth→cart", "cart→auth"]);
  });

  it("ignores edges whose endpoints have no container mapping", () => {
    const m = new Map([["a", "auth"]]);
    const r = aggregateContainerEdges([ce("a", "z")], m);
    expect(r.intraContainer).toEqual([]);
    expect(r.interContainerAggregated).toEqual([]);
  });

  it("does not collide when container ids contain the separator character", () => {
    // Pre-fix: key was `${sc} ${tc}` so `("x y", "z")` and `("x", "y z")`
    // would both map to `"x y z"`. Length-prefix on source prevents this.
    const m = new Map([
      ["a", "x y"],
      ["b", "z"],
      ["c", "x"],
      ["d", "y z"],
    ]);
    const r = aggregateContainerEdges([ce("a", "b"), ce("c", "d")], m);
    expect(r.interContainerAggregated).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// aggregateLayerEdges
// ---------------------------------------------------------------------------
describe("aggregateLayerEdges", () => {
  const layers: Layer[] = [
    { id: "layer:presentation", name: "Presentation", description: "", nodeIds: ["p1", "p2"] },
    { id: "layer:api", name: "API", description: "", nodeIds: ["a1"] },
    { id: "layer:services", name: "Services", description: "", nodeIds: ["s1"] },
  ];

  it("returns empty array for no cross-layer edges", () => {
    const g = makeGraph(layers, [ce("p1", "p2")]);
    expect(aggregateLayerEdges(g)).toEqual([]);
  });

  it("normalizes edge direction to architectural order (top→bottom)", () => {
    // Edge from services (index 2) to presentation (index 0) should be
    // normalized to presentation→services.
    const g = makeGraph(layers, [ce("s1", "p1")]);
    const result = aggregateLayerEdges(g);
    expect(result).toHaveLength(1);
    expect(result[0].sourceLayerId).toBe("layer:presentation");
    expect(result[0].targetLayerId).toBe("layer:services");
  });

  it("merges bidirectional edges into one aggregated edge", () => {
    const g = makeGraph(layers, [ce("p1", "a1"), ce("a1", "p1")]);
    const result = aggregateLayerEdges(g);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
    expect(result[0].sourceLayerId).toBe("layer:presentation");
    expect(result[0].targetLayerId).toBe("layer:api");
  });

  it("collects multiple edge types", () => {
    const g = makeGraph(layers, [
      ce("p1", "a1", "calls"),
      ce("p1", "a1", "imports"),
    ]);
    const result = aggregateLayerEdges(g);
    expect(result).toHaveLength(1);
    expect(result[0].edgeTypes.sort()).toEqual(["calls", "imports"]);
  });

  it("ignores intra-layer edges", () => {
    const g = makeGraph(layers, [ce("p1", "p2"), ce("a1", "a1")]);
    expect(aggregateLayerEdges(g)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computePortals
// ---------------------------------------------------------------------------
describe("computePortals", () => {
  const layers: Layer[] = [
    { id: "layer:presentation", name: "Presentation", description: "", nodeIds: ["p1"] },
    { id: "layer:api", name: "API", description: "", nodeIds: ["a1"] },
    { id: "layer:services", name: "Services", description: "", nodeIds: ["s1"] },
  ];

  it("finds connected layers regardless of edge direction", () => {
    // Edge from services→presentation (reverse architectural order)
    const g = makeGraph(layers, [ce("s1", "p1")]);
    const portals = computePortals(g, "layer:presentation");
    expect(portals).toHaveLength(1);
    expect(portals[0].layerId).toBe("layer:services");
    expect(portals[0].connectionCount).toBe(1);
  });

  it("returns empty for isolated layer", () => {
    const g = makeGraph(layers, [ce("p1", "a1")]);
    const portals = computePortals(g, "layer:services");
    expect(portals).toEqual([]);
  });

  it("counts connections from precomputed aggregation", () => {
    const g = makeGraph(layers, [
      ce("p1", "a1"),
      ce("p1", "a1", "imports"),
      ce("p1", "s1"),
    ]);
    const agg = aggregateLayerEdges(g);
    const portals = computePortals(g, "layer:presentation", agg);
    expect(portals).toHaveLength(2);
    const apiPortal = portals.find((p) => p.layerId === "layer:api");
    expect(apiPortal?.connectionCount).toBe(2);
  });
});

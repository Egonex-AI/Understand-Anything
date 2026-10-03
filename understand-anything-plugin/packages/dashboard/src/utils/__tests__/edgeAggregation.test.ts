import { describe, it, expect } from "vitest";
import {
  aggregateContainerEdges,
  aggregateLayerEdges,
  computePortals,
} from "../edgeAggregation";
import type {
  GraphEdge,
  EdgeType,
  KnowledgeGraph,
  Layer,
} from "@understand-anything/core/types";

const ce = (source: string, target: string, type: EdgeType = "calls"): GraphEdge => ({
  source,
  target,
  type,
  direction: "forward",
  weight: 1,
});

const makeGraph = (layers: Layer[], edges: GraphEdge[]): KnowledgeGraph => ({
  version: "1.0.0",
  project: {
    name: "test",
    languages: [],
    frameworks: [],
    description: "",
    analyzedAt: "",
    gitCommitHash: "",
  },
  nodes: [],
  edges,
  layers,
  tour: [],
});

const layer = (id: string, nodeIds: string[]): Layer => ({
  id,
  name: id,
  description: "",
  nodeIds,
});

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

describe("aggregateLayerEdges / computePortals", () => {
  it("does not collide when layer ids contain the '|' separator character", () => {
    // Pre-fix: key was `${a}|${b}` so the sorted pair ("x|y","z") -> "x|y|z"
    // and the sorted pair ("x","y|z") -> "x|y|z" both map to one key,
    // silently dropping one layer-edge. Length-prefixing the first id fixes it.
    const graph = makeGraph(
      [
        layer("x|y", ["a"]),
        layer("z", ["b"]),
        layer("x", ["c"]),
        layer("y|z", ["d"]),
      ],
      [ce("a", "b"), ce("c", "d")],
    );

    expect(aggregateLayerEdges(graph)).toHaveLength(2);

    const portals = computePortals(graph, "x");
    expect(portals).toHaveLength(1);
    expect(portals[0].layerId).toBe("y|z");
    expect(portals[0].connectionCount).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { computeLayerStats } from "../layerStats";
import type { GraphNode, Layer } from "@understand-anything/core/types";

function node(
  id: string,
  complexity: GraphNode["complexity"] = "simple",
): GraphNode {
  return {
    id,
    type: "file",
    name: id,
    summary: "",
    complexity,
    tags: [],
  } as GraphNode;
}

function layer(id: string, nodeIds: string[]): Layer {
  return {
    id,
    name: id,
    description: "",
    nodeIds,
  };
}

function indexById(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

describe("computeLayerStats", () => {
  it("counts only nodes that resolve in nodesById", () => {
    const nodes = [node("a", "simple"), node("b", "moderate"), node("c", "complex")];
    const l = layer("L", ["a", "b", "c", "ghost"]);
    const stats = computeLayerStats(l, indexById(nodes));
    expect(stats.resolvedCount).toBe(3);
  });

  it("returns 'simple' when no complexity passes the 30% threshold", () => {
    // 1 complex out of 4 = 25% — under threshold.
    const nodes = [
      node("a", "simple"),
      node("b", "simple"),
      node("c", "simple"),
      node("d", "complex"),
    ];
    const stats = computeLayerStats(layer("L", ["a", "b", "c", "d"]), indexById(nodes));
    expect(stats.aggregateComplexity).toBe("simple");
  });

  it("returns 'complex' when complex count strictly exceeds 30%", () => {
    // 4 complex out of 10 = 40% — over threshold.
    const nodes = Array.from({ length: 10 }, (_, i) =>
      node(`n${i}`, i < 4 ? "complex" : "simple"),
    );
    const stats = computeLayerStats(
      layer("L", nodes.map((n) => n.id)),
      indexById(nodes),
    );
    expect(stats.aggregateComplexity).toBe("complex");
  });

  it("prefers 'complex' over 'moderate' when both clear the threshold", () => {
    // 4 complex + 4 moderate out of 10 — complex wins via the order of checks
    // in the prior implementation; this test pins that behavior.
    const nodes = Array.from({ length: 10 }, (_, i) =>
      node(`n${i}`, i < 4 ? "complex" : i < 8 ? "moderate" : "simple"),
    );
    const stats = computeLayerStats(
      layer("L", nodes.map((n) => n.id)),
      indexById(nodes),
    );
    expect(stats.aggregateComplexity).toBe("complex");
  });

  it("returns 'moderate' when only the moderate count clears the threshold", () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      node(`n${i}`, i < 4 ? "moderate" : "simple"),
    );
    const stats = computeLayerStats(
      layer("L", nodes.map((n) => n.id)),
      indexById(nodes),
    );
    expect(stats.aggregateComplexity).toBe("moderate");
  });

  it("treats an empty layer as 'simple' with resolvedCount 0", () => {
    const stats = computeLayerStats(layer("L", []), indexById([]));
    expect(stats.resolvedCount).toBe(0);
    expect(stats.aggregateComplexity).toBe("simple");
  });

  it("aggregates a 100-layer / 100-nodes-per-layer graph in under 50ms (#102 regression guard)", () => {
    // The pre-fix path ran graph.nodes.filter((n) => layer.nodeIds.includes(n.id))
    // per layer — O(N × K × L) — and locally took ~150ms for this shape under
    // node 22. The new path is O(N + Σ K_i). Loose budget so CI variance
    // doesn't flake; the pre-fix path would blow past it by 2-10×.
    const nodes: GraphNode[] = [];
    const layers: Layer[] = [];
    for (let li = 0; li < 100; li++) {
      const ids: string[] = [];
      for (let ni = 0; ni < 100; ni++) {
        const id = `n-${li}-${ni}`;
        nodes.push(node(id, ((li + ni) % 3 === 0 ? "complex" : (li + ni) % 3 === 1 ? "moderate" : "simple")));
        ids.push(id);
      }
      layers.push(layer(`L${li}`, ids));
    }
    const byId = indexById(nodes);

    const t0 = performance.now();
    for (const l of layers) computeLayerStats(l, byId);
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(50);
  });
});

import { describe, it, expect } from "vitest";
import { traverseNeighbors } from "./graph-traversal.js";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../types.js";

function makeGraph(nodes: string[], edges: Array<[string, string, string]>): KnowledgeGraph {
  return {
    version: "1",
    project: { name: "test", languages: ["ts"], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes: nodes.map((id) => ({
      id,
      type: "function" as const,
      name: id,
      summary: "",
      tags: [],
      complexity: "simple" as const,
    })),
    edges: edges.map(([source, target, type]) => ({
      source,
      target,
      type: type as GraphEdge["type"],
      direction: "forward" as const,
      weight: 0.8,
    })),
    layers: [],
    tour: [],
  };
}

describe("traverseNeighbors", () => {
  it("finds direct neighbors (depth 1)", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["B", "C", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId)).toEqual(["B"]);
    expect(results[0].depth).toBe(1);
  });

  it("finds transitive neighbors (depth 2)", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["B", "C", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 2);
    expect(results.map((r) => r.nodeId)).toEqual(["B", "C"]);
    expect(results.find((r) => r.nodeId === "C")!.depth).toBe(2);
  });

  it("handles cycles without infinite loop", () => {
    const graph = makeGraph(["A", "B"], [["A", "B", "calls"], ["B", "A", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 5);
    expect(results.map((r) => r.nodeId)).toEqual(["B"]);
  });

  it("filters by edge type", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["A", "C", "injects"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId)).toEqual(["B"]);
  });

  it("supports multiple edge types", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["A", "C", "injects"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls", "injects"], 1);
    expect(results.map((r) => r.nodeId).sort()).toEqual(["B", "C"]);
  });

  it("supports inbound direction", () => {
    const graph = makeGraph(["A", "B", "C"], [["B", "A", "calls"], ["C", "A", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "inbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId).sort()).toEqual(["B", "C"]);
  });

  it("supports both direction", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "B", "calls"], ["C", "A", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "both", ["calls"], 1);
    expect(results.map((r) => r.nodeId).sort()).toEqual(["B", "C"]);
  });

  it("returns empty for isolated node", () => {
    const graph = makeGraph(["A", "B"], []);
    const results = traverseNeighbors(graph, ["A"], "both", ["calls"], 3);
    expect(results).toEqual([]);
  });

  it("handles multiple center nodes", () => {
    const graph = makeGraph(["A", "B", "C"], [["A", "C", "calls"], ["B", "C", "calls"]]);
    const results = traverseNeighbors(graph, ["A", "B"], "outbound", ["calls"], 1);
    expect(results.map((r) => r.nodeId)).toEqual(["C"]);
  });

  it("returns empty array when maxDepth is 0", () => {
    const graph = makeGraph(["A", "B"], [["A", "B", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", ["calls"], 0);
    expect(results).toEqual([]);
  });

  it("returns empty array when edgeTypes is empty", () => {
    const graph = makeGraph(["A", "B"], [["A", "B", "calls"]]);
    const results = traverseNeighbors(graph, ["A"], "outbound", [], 2);
    expect(results).toEqual([]);
  });
});

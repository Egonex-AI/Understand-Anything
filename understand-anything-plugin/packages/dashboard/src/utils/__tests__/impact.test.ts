import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { dependencyOf } from "../dependencies";
import { computeImpact } from "../impact";

function node(id: string, filePath?: string, type: GraphNode["type"] = "file"): GraphNode {
  return { id, type, name: id.split(":").pop() ?? id, filePath, summary: "", tags: [], complexity: "simple" };
}

function edge(source: string, target: string, type: GraphEdge["type"] = "imports"): GraphEdge {
  return { source, target, type, direction: "forward", weight: 1 };
}

type G = Pick<KnowledgeGraph, "nodes" | "edges" | "layers">;

// ui → service → db, plus a function inside db called from a ui function.
const graph: G = {
  nodes: [
    node("ui", "src/ui/App.tsx"),
    node("ui-fn", "src/ui/App.tsx", "function"),
    node("svc", "src/service/users.ts"),
    node("db", "src/db/client.ts"),
    node("db-fn", "src/db/client.ts", "function"),
    node("test", "tests/db.test.ts"),
    node("cfg", "config/db.toml", "config"),
    node("doc", "README.md", "document"),
  ],
  edges: [
    edge("ui", "ui-fn", "contains"),
    edge("db", "db-fn", "contains"),
    edge("ui", "svc"),
    edge("svc", "db"),
    edge("ui-fn", "db-fn", "calls"),
    edge("db", "test", "tested_by"),
    edge("cfg", "db", "configures"),
    edge("doc", "ui", "related"),
  ],
  layers: [
    { id: "layer:ui", name: "UI", description: "", nodeIds: ["ui"] },
    { id: "layer:data", name: "Data Access", description: "", nodeIds: ["db"] },
    { id: "layer:service", name: "Service", description: "", nodeIds: ["svc"] },
  ],
};

describe("dependencyOf", () => {
  it("knows which end depends on which", () => {
    expect(dependencyOf(edge("a", "b"))).toEqual({ dependent: "a", dependency: "b" });
    expect(dependencyOf(edge("a", "t", "tested_by"))).toEqual({ dependent: "t", dependency: "a" });
    expect(dependencyOf(edge("c", "x", "configures"))).toEqual({ dependent: "x", dependency: "c" });
    expect(dependencyOf(edge("a", "b", "contains"))).toBeNull();
    expect(dependencyOf(edge("a", "b", "related"))).toBeNull();
    expect(dependencyOf(edge("a", "a"))).toBeNull();
  });
});

describe("computeImpact", () => {
  it("walks reverse dependencies breadth-first with shortest depth", () => {
    const r = computeImpact(graph, "db");
    expect(Object.fromEntries(r.depths)).toEqual({ svc: 1, test: 1, "ui-fn": 1, ui: 1 });
    expect(r.byDepth).toEqual([["svc", "test", "ui", "ui-fn"]]);
    expect(r.truncated).toBe(false);
  });

  it("counts the root's children as the root and lifts functions to files", () => {
    // Only db-fn's caller (ui-fn) depends on db-fn; its file ui comes along.
    const r = computeImpact(graph, "db-fn");
    expect(Object.fromEntries(r.depths)).toEqual({ "ui-fn": 1, ui: 1 });
  });

  it("follows chains, respects maxDepth and ignores associative edges", () => {
    const chain: G = {
      nodes: ["a", "b", "c", "d"].map((id) => node(id)),
      edges: [edge("b", "a"), edge("c", "b"), edge("d", "c"), edge("a", "d", "similar_to")],
      layers: [],
    };
    expect(Object.fromEntries(computeImpact(chain, "a").depths)).toEqual({ b: 1, c: 2, d: 3 });
    expect(Object.fromEntries(computeImpact(chain, "a", { maxDepth: 2 }).depths)).toEqual({ b: 1, c: 2 });
    expect(computeImpact(chain, "d").depths.size).toBe(0);
  });

  it("survives cycles and caps the result", () => {
    const cyc: G = {
      nodes: ["a", "b", "c"].map((id) => node(id)),
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      layers: [],
    };
    expect(Object.fromEntries(computeImpact(cyc, "a").depths)).toEqual({ c: 1, b: 2 });
    const capped = computeImpact(cyc, "a", { maxNodes: 1 });
    expect(capped.depths.size).toBe(1);
    expect(capped.truncated).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { fileChildren } from "../fileChildren";
import type { GraphNode, GraphEdge } from "@understand-anything/core/types";

const fn = (id: string): GraphNode => ({ id, type: "function", name: id, summary: "", tags: [], complexity: "simple" } as GraphNode);
const file = (id: string): GraphNode => ({ id, type: "file", name: id, summary: "", tags: [], complexity: "simple" } as GraphNode);

it("returns contained function/class nodes for a file", () => {
  const f = file("file:x.ts");
  const a = fn("function:x.ts:a");
  const b = fn("function:x.ts:b");
  const map = new Map([[f.id, f], [a.id, a], [b.id, b]]);
  const edges: GraphEdge[] = [
    { source: f.id, target: a.id, type: "contains", direction: "forward", weight: 1 },
    { source: f.id, target: b.id, type: "contains", direction: "forward", weight: 1 },
  ];
  expect(fileChildren(f.id, edges, map).map((x) => x.id).sort()).toEqual([a.id, b.id]);
});

it("returns [] when no children or missing nodes (no throw)", () => {
  expect(fileChildren("file:none", [], new Map())).toEqual([]);
});

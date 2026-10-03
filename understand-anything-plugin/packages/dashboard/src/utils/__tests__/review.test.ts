import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { buildReviewMarkdown, diffFingerprint, orderForReview } from "../review";

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

describe("review order", () => {
  it("puts dependencies first and children after their file", () => {
    const order = orderForReview(graph, ["ui", "svc", "db", "db-fn"]);
    expect(order).toEqual(["db", "db-fn", "svc", "ui"]);
  });

  it("is stable on cycles and ignores unknown ids", () => {
    const cyc: G = {
      nodes: [node("a", "a.ts"), node("b", "b.ts")],
      edges: [edge("a", "b"), edge("b", "a")],
      layers: [],
    };
    expect(orderForReview(cyc, ["b", "a", "zzz"])).toEqual(["a", "b"]);
  });

  it("fingerprints the changed set independent of order", () => {
    expect(diffFingerprint(["a", "b"])).toBe(diffFingerprint(["b", "a", "a"]));
    expect(diffFingerprint(["a"])).not.toBe(diffFingerprint(["b"]));
  });

  it("builds a Markdown checklist", () => {
    const md = buildReviewMarkdown(
      "demo",
      [
        { node: { name: "client.ts", filePath: "src/db/client.ts", type: "file" }, entry: { reviewed: true, comment: "ok\nsecond" } },
        { node: { name: "App.tsx", filePath: "src/ui/App.tsx", type: "file" }, entry: undefined },
      ],
      { title: "Review summary", progress: "{done}/{total} reviewed", comment: "Comment" },
    );
    expect(md).toBe(
      [
        "## Review summary — demo",
        "",
        "1/2 reviewed",
        "",
        "- [x] `client.ts` (src/db/client.ts) · file",
        "  - Comment: ok",
        "    second",
        "- [ ] `App.tsx` (src/ui/App.tsx) · file",
        "",
      ].join("\n"),
    );
  });
});

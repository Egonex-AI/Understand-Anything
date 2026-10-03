import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { heatLevel, hotspotLevels, topHotspots, type HotspotsReport } from "../hotspots";

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

describe("hotspots", () => {
  const report: HotspotsReport = {
    available: true,
    days: 90,
    commitCount: 30,
    truncated: false,
    maxCommits: 20,
    files: {
      "src/db/client.ts": { commits: 20, lastChanged: "2026-09-01T00:00:00Z", authors: 3 },
      "src/ui/App.tsx": { commits: 1, lastChanged: "2026-09-02T00:00:00Z", authors: 1 },
      "README.md": { commits: 1, lastChanged: "2026-08-01T00:00:00Z", authors: 1 },
    },
  };

  it("buckets on a log scale", () => {
    expect(heatLevel(0, 20)).toBe(0);
    expect(heatLevel(20, 20)).toBe(5);
    expect(heatLevel(1, 20)).toBe(2);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it("maps file churn onto file and function nodes", () => {
    const levels = hotspotLevels(graph.nodes, report);
    expect(levels.get("db")).toBe(5);
    expect(levels.get("db-fn")).toBe(5);
    expect(levels.get("ui")).toBe(2);
    expect(levels.has("svc")).toBe(false);
  });

  it("ranks busiest, then most recent", () => {
    expect(topHotspots(report, 2).map((h) => h.path)).toEqual(["src/db/client.ts", "src/ui/App.tsx"]);
  });
});

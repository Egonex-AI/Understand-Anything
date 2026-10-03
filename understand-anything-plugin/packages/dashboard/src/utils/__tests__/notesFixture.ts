import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import type { AnnotationMap } from "../annotatedNodes";

function node(id: string, name: string, type: GraphNode["type"], extra: Partial<GraphNode> = {}): GraphNode {
  return { id, name, type, summary: `${name} summary.`, tags: [], complexity: "simple", ...extra };
}

function edge(source: string, target: string, type: GraphEdge["type"]): GraphEdge {
  return { source, target, type, direction: "forward", weight: 1 };
}

/**
 * api.ts (layer API) imports db.ts (layer Data) and util.ts (layer API);
 * api.ts contains handler(); a second "handler" lives in other.ts.
 */
export function notesGraph(): KnowledgeGraph {
  return {
    version: "1",
    project: {
      name: "Demo",
      languages: ["typescript"],
      frameworks: [],
      description: "A demo project.",
      analyzedAt: "2026-01-01T00:00:00Z",
      gitCommitHash: "abc",
    },
    nodes: [
      node("file:src/api.ts", "api.ts", "file", { filePath: "src/api.ts" }),
      node("file:src/util.ts", "util.ts", "file", { filePath: "src/util.ts" }),
      node("file:src/db.ts", "db.ts", "file", { filePath: "src/db.ts" }),
      node("fn:src/api.ts:handler", "handler", "function", { filePath: "src/api.ts", lineRange: [10, 20] }),
      node("file:src/other.ts", "other.ts", "file", { filePath: "src/other.ts" }),
      node("fn:src/other.ts:handler", "handler", "function", { filePath: "src/other.ts", lineRange: [3, 3] }),
    ],
    edges: [
      edge("file:src/api.ts", "file:src/db.ts", "imports"),
      edge("file:src/api.ts", "file:src/util.ts", "imports"),
      edge("file:src/api.ts", "fn:src/api.ts:handler", "contains"),
      edge("file:src/other.ts", "fn:src/other.ts:handler", "contains"),
    ],
    layers: [
      { id: "layer:api", name: "API", description: "", nodeIds: ["file:src/api.ts", "file:src/util.ts", "file:src/other.ts"] },
      { id: "layer:data", name: "Data", description: "", nodeIds: ["file:src/db.ts"] },
    ],
    tour: [],
  };
}

export function notesAnnotations(): AnnotationMap {
  return {
    "file:src/api.ts": { tags: ["entry point"], note: "Starts **here**.", updatedAt: "2026-03-01T00:00:00Z" },
    "file:src/util.ts": { tags: ["helpers"], note: "", updatedAt: "2026-03-03T00:00:00Z" },
    "file:src/db.ts": { tags: [], note: "Talks to Postgres.", updatedAt: "2026-03-02T00:00:00Z" },
    "fn:src/api.ts:handler": {
      tags: ["Entry Point"],
      note: "Main handler.",
      updatedAt: "2026-03-04T00:00:00Z",
      lines: { "15": "validate input\nhere", "12": "auth check", "x": "ignored", "13": "  " },
    },
    "fn:src/other.ts:handler": { tags: [], note: "Other handler.", updatedAt: "2026-03-05T00:00:00Z" },
    "file:gone.ts": { tags: ["stale"], note: "Node no longer exists.", updatedAt: "2026-03-06T00:00:00Z" },
  };
}

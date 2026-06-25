import type { GraphNode, GraphEdge } from "@understand-anything/core/types";

const CHILD_TYPES = new Set(["function", "class", "endpoint", "table", "schema"]);

export function fileChildren(
  fileNodeId: string,
  edges: GraphEdge[],
  nodeById: Map<string, GraphNode>
): GraphNode[] {
  const out: GraphNode[] = [];
  for (const e of edges) {
    if (e.type !== "contains" || e.source !== fileNodeId) continue;
    const child = nodeById.get(e.target);
    if (child && CHILD_TYPES.has(child.type)) out.push(child);
  }
  return out;
}

import type { KnowledgeGraph } from "../types.js";

export interface TraversalResult {
  nodeId: string;
  depth: number;
  edge: { source: string; target: string; type: string };
}

/**
 * BFS traversal of a knowledge graph starting from one or more center nodes.
 *
 * @param graph       The knowledge graph to traverse
 * @param centerIds   Starting node IDs (multi-source BFS)
 * @param direction   "inbound" | "outbound" | "both" — which edge direction to follow
 * @param edgeTypes   Only follow edges whose type is in this set
 * @param maxDepth    Maximum hop depth (1 = direct neighbors only)
 * @returns           Flat array of reachable nodes with their depth and the edge that reached them
 */
export function traverseNeighbors(
  graph: KnowledgeGraph,
  centerIds: string[],
  direction: "inbound" | "outbound" | "both",
  edgeTypes: string[],
  maxDepth: number,
): TraversalResult[] {
  const edgeTypeSet = new Set(edgeTypes);
  const centerSet = new Set(centerIds);
  const results: TraversalResult[] = [];
  const expanded = new Set<string>(centerIds);
  let frontier = [...centerIds];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (!edgeTypeSet.has(edge.type)) continue;

        let neighborId: string | null = null;

        if (edge.source === currentId && direction !== "inbound") {
          neighborId = edge.target;
        } else if (edge.target === currentId && direction !== "outbound") {
          neighborId = edge.source;
        }

        if (!neighborId || centerSet.has(neighborId) || expanded.has(neighborId)) continue;

        results.push({
          nodeId: neighborId,
          depth,
          edge: { source: edge.source, target: edge.target, type: edge.type },
        });

        expanded.add(neighborId);
        nextFrontier.push(neighborId);
      }
    }
    frontier = nextFrontier;
  }

  return results;
}

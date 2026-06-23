import type { GraphNode, Layer } from "@understand-anything/core/types";

export type Complexity = "simple" | "moderate" | "complex";

export interface LayerStats {
  /** Number of layer.nodeIds that resolve to a node in the graph. */
  resolvedCount: number;
  /** Aggregate label for the cluster card; matches the prior 30% threshold. */
  aggregateComplexity: Complexity;
}

/**
 * O(layer.nodeIds.length) summary of a layer's complexity composition.
 *
 * Replaces the prior `graph.nodes.filter((n) => layer.nodeIds.includes(n.id))`
 * pass in `useOverviewGraph`, which was O(N × K) per layer and went
 * super-linear once a project had a few thousand nodes spread across many
 * layers (#102: 4.8 MB graph froze on overview render).
 */
export function computeLayerStats(
  layer: Layer,
  nodesById: Map<string, GraphNode>,
): LayerStats {
  const counts: Record<Complexity, number> = { simple: 0, moderate: 0, complex: 0 };
  let resolved = 0;
  for (const nid of layer.nodeIds) {
    const node = nodesById.get(nid);
    if (!node) continue;
    resolved++;
    counts[node.complexity]++;
  }
  const aggregateComplexity: Complexity =
    counts.complex > resolved * 0.3
      ? "complex"
      : counts.moderate > resolved * 0.3
        ? "moderate"
        : "simple";
  return { resolvedCount: resolved, aggregateComplexity };
}

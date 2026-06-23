import type { GraphNode, GraphEdge } from "@understand-anything/core/types";
import type { FilterState, NodeType, Complexity, EdgeCategory } from "../store";
import { EDGE_CATEGORY_MAP } from "../store";

/**
 * Filter nodes based on active filters.
 *
 * Pass `nodeIdToLayerIds` from the store (precomputed once on `setGraph`)
 * so the layer-membership check is O(1) per node. The previous shape took
 * `Layer[]` and ran `layer.nodeIds.includes(node.id)` per node-per-layer,
 * which was O(N × L × K) and dominated export time on large graphs (#102).
 *
 * Membership semantics are any-layer-wins, matching the prior shape: a
 * node in L1 and L2 with only L2 selected passes. The store's other
 * index, `nodeIdToLayerId`, is first-wins and is for navigation, not
 * filtering — using it here would silently drop multi-layer nodes whose
 * first declared layer isn't selected.
 */
export function filterNodes(
  nodes: GraphNode[],
  nodeIdToLayerIds: Map<string, Set<string>>,
  filters: FilterState,
): GraphNode[] {
  const hasLayerFilter = filters.layerIds.size > 0;
  return nodes.filter((node) => {
    // Filter by node type
    if (!filters.nodeTypes.has(node.type as NodeType)) {
      return false;
    }

    // Filter by complexity
    if (node.complexity && !filters.complexities.has(node.complexity as Complexity)) {
      return false;
    }

    // Filter by layer (if any layers are selected)
    if (hasLayerFilter) {
      const layerIds = nodeIdToLayerIds.get(node.id);
      if (!layerIds) return false;
      let inSelected = false;
      for (const lid of layerIds) {
        if (filters.layerIds.has(lid)) {
          inSelected = true;
          break;
        }
      }
      if (!inSelected) return false;
    }

    return true;
  });
}

/**
 * Filter edges based on visible nodes and active edge category filters
 */
export function filterEdges(
  edges: GraphEdge[],
  visibleNodeIds: Set<string>,
  filters: FilterState,
): GraphEdge[] {
  return edges.filter((edge) => {
    // Only keep edges between visible nodes
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      return false;
    }

    // Filter by edge category
    const edgeCategory = getEdgeCategory(edge.type);
    if (edgeCategory && !filters.edgeCategories.has(edgeCategory)) {
      return false;
    }

    return true;
  });
}

/**
 * Determine which category an edge type belongs to
 */
function getEdgeCategory(edgeType: string): EdgeCategory | null {
  for (const [category, types] of Object.entries(EDGE_CATEGORY_MAP)) {
    if (types.includes(edgeType)) {
      return category as EdgeCategory;
    }
  }
  return null;
}

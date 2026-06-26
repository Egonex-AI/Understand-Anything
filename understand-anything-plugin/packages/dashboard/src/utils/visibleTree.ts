import type { GraphNode, GraphEdge } from "@understand-anything/core/types";
import { deriveContainerLevel } from "./containers";

export interface VisibleNode {
  id: string;
  kind: "cluster" | "node";
  name: string;
  parentId: string | null;
  childCount: number;
  expanded: boolean;
  graphNode?: GraphNode;
}

export interface VisibleTree {
  nodes: VisibleNode[];
  visibleAtomOf: Map<string, string>;
}

export function buildVisibleTree(args: {
  scopeNodes: GraphNode[];
  edges: GraphEdge[];
  rootPrefix: string;
  expanded: Set<string>;
  fileChildrenOf: (fileId: string) => GraphNode[];
}): VisibleTree {
  const { scopeNodes, edges, rootPrefix, expanded, fileChildrenOf } = args;
  const nodes: VisibleNode[] = [];
  const visibleAtomOf = new Map<string, string>();
  const visitedPrefixes = new Set<string>();

  function recurse(
    nodesAtLevel: GraphNode[],
    prefix: string,
    parentId: string | null,
    depth: number,
  ): void {
    // Depth / cycle guard
    if (depth > 16 || visitedPrefixes.has(prefix)) {
      console.warn("[visibleTree] depth/cycle guard at", prefix);
      for (const n of nodesAtLevel) {
        nodes.push({
          id: n.id,
          kind: "node",
          name: n.name ?? n.filePath?.split("/").pop() ?? n.id,
          parentId,
          childCount: 0,
          expanded: false,
          graphNode: n,
        });
        visibleAtomOf.set(n.id, n.id);
      }
      return;
    }
    visitedPrefixes.add(prefix);

    const level = deriveContainerLevel(nodesAtLevel, edges, prefix);

    // Clusters
    for (const c of level.containers) {
      nodes.push({
        id: c.id,
        kind: "cluster",
        name: c.name,
        parentId,
        childCount: c.nodeIds.length,
        expanded: expanded.has(c.id),
      });

      if (expanded.has(c.id)) {
        const next = scopeNodes.filter((n) => c.nodeIds.includes(n.id));
        recurse(next, c.prefix, c.id, depth + 1);
      } else {
        for (const id of c.nodeIds) {
          visibleAtomOf.set(id, c.id);
        }
      }
    }

    // Leaves (file nodes)
    for (const leafId of level.leaves) {
      const node = nodesAtLevel.find((n) => n.id === leafId);
      if (!node) continue;
      const filePath = node.filePath;
      const isFileExpanded = filePath ? expanded.has(`file:${filePath}`) : false;
      nodes.push({
        id: leafId,
        kind: "node",
        name: node.name ?? filePath?.split("/").pop() ?? leafId,
        parentId,
        childCount: 0,
        expanded: isFileExpanded,
        graphNode: node,
      });
      visibleAtomOf.set(leafId, leafId);

      if (isFileExpanded) {
        for (const fn of fileChildrenOf(leafId)) {
          nodes.push({
            id: fn.id,
            kind: "node",
            name: fn.name ?? fn.filePath?.split("/").pop() ?? fn.id,
            parentId: leafId,
            childCount: 0,
            expanded: false,
            graphNode: fn,
          });
          visibleAtomOf.set(fn.id, fn.id);
        }
      }
    }
  }

  recurse(scopeNodes, rootPrefix, null, 0);
  return { nodes, visibleAtomOf };
}

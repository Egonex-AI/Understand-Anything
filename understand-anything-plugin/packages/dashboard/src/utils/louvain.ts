import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphEdge } from "@understand-anything/core/types";

/**
 * Run Louvain community detection over the provided node set and the
 * subset of edges whose endpoints are both in the set. Returns a map of
 * nodeId → communityId.
 *
 * graphology-communities-louvain v2 already gives each disconnected node
 * its own community id, but the contract isn't documented. The
 * post-Louvain reassignment loop below is defensive: if a future version
 * starts returning -1 (or omits a node, which the `?? -1` catches) for
 * unmatched nodes, we'll still hand back unique ids rather than letting
 * them collapse into a single cluster.
 */
export function detectCommunities(
  nodeIds: string[],
  edges: GraphEdge[],
): Map<string, number> {
  const ids = new Set(nodeIds);
  const g = new Graph({ type: "undirected", multi: false });
  for (const id of nodeIds) g.addNode(id);
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    if (e.source === e.target) continue;
    if (g.hasEdge(e.source, e.target)) continue;
    g.addEdge(e.source, e.target);
  }
  // graphology-communities-louvain returns Record<nodeId, communityId>
  const result = louvain(g) as Record<string, number>;
  const map = new Map<string, number>();
  for (const id of nodeIds) {
    map.set(id, result[id] ?? -1);
  }
  // Defensive: reassign any -1 sentinels to unique ids past the max.
  // See the JSDoc on detectCommunities for why this is kept despite the
  // current library already producing unique ids for disconnected nodes.
  let next =
    Math.max(...Array.from(map.values()).filter((v) => v >= 0), -1) + 1;
  for (const [id, c] of map) {
    if (c === -1) {
      map.set(id, next++);
    }
  }
  return map;
}

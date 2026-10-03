import type { KnowledgeGraph } from "@understand-anything/core/types";
import { containsParents, dependencyOf, selfAndAncestors } from "./dependencies";

export interface ImpactResult {
  rootId: string;
  /** Impacted node id → hop distance from the root (≥ 1). Excludes the root and its own children. */
  depths: Map<string, number>;
  /** Impacted ids grouped by depth: index 0 holds depth 1. */
  byDepth: string[][];
  /** True when the traversal stopped at `maxNodes`. */
  truncated: boolean;
}

/**
 * Everything that transitively depends on `rootId` — the blast radius of
 * changing it — via reverse dependency edges, breadth-first so each node
 * gets its shortest distance.
 *
 * Containment is folded in both ways: the root's own children count as the
 * root (a caller of a function inside a changed file is impacted), and an
 * impacted function or class drags its containing file along at the same
 * depth (so file-level views light up too).
 */
export function computeImpact(
  graph: Pick<KnowledgeGraph, "nodes" | "edges">,
  rootId: string,
  { maxDepth = Infinity, maxNodes = 5000 }: { maxDepth?: number; maxNodes?: number } = {},
): ImpactResult {
  const dependentsOf = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type === "contains") {
      const list = children.get(e.source);
      if (list) list.push(e.target);
      else children.set(e.source, [e.target]);
      continue;
    }
    const dep = dependencyOf(e);
    if (!dep) continue;
    const list = dependentsOf.get(dep.dependency);
    if (list) list.push(dep.dependent);
    else dependentsOf.set(dep.dependency, [dep.dependent]);
  }
  const parents = containsParents(graph);

  // Depth 0: the root and everything it contains.
  const seeds = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of children.get(id) ?? []) {
      if (!seeds.has(child)) {
        seeds.add(child);
        stack.push(child);
      }
    }
  }

  const depths = new Map<string, number>();
  let frontier = [...seeds];
  let depth = 0;
  let truncated = false;
  while (frontier.length > 0 && depth < maxDepth && !truncated) {
    depth++;
    const next: string[] = [];
    for (const id of frontier) {
      for (const dependent of dependentsOf.get(id) ?? []) {
        for (const hit of selfAndAncestors(dependent, parents)) {
          if (seeds.has(hit) || depths.has(hit)) continue;
          if (depths.size >= maxNodes) {
            truncated = true;
            break;
          }
          depths.set(hit, depth);
          next.push(hit);
        }
      }
    }
    frontier = next;
  }

  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const byDepth: string[][] = [];
  for (const [id, d] of depths) (byDepth[d - 1] ??= []).push(id);
  const label = (id: string) => nodesById.get(id)?.name ?? id;
  for (const group of byDepth) group?.sort((a, b) => label(a).localeCompare(label(b)));
  return { rootId, depths, byDepth: byDepth.map((g) => g ?? []), truncated };
}

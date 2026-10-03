import type { GraphEdge, KnowledgeGraph } from "@understand-anything/core/types";

/**
 * Which end of an edge depends on the other — shared by impact analysis,
 * architecture rules and the PR review order so all three agree.
 *
 * "A imports B": A (source) depends on B (target). A few edge types point
 * the other way: "X tested_by T" and "C configures X" mean T and X are the
 * ones affected when the other end changes. Purely associative edges
 * (contains, related, similar_to, domain/knowledge links…) carry no
 * dependency and are ignored.
 */
const SOURCE_DEPENDS_ON_TARGET: ReadonlySet<string> = new Set([
  "imports",
  "exports",
  "inherits",
  "implements",
  "calls",
  "subscribes",
  "publishes",
  "middleware",
  "reads_from",
  "writes_to",
  "transforms",
  "validates",
  "depends_on",
  "serves",
  "routes",
  "migrates",
  "documents",
  "instance_of",
  "variant_of",
  "uses_token",
]);

const TARGET_DEPENDS_ON_SOURCE: ReadonlySet<string> = new Set(["tested_by", "configures"]);

export function dependencyOf(
  edge: Pick<GraphEdge, "source" | "target" | "type">,
): { dependent: string; dependency: string } | null {
  if (edge.source === edge.target) return null;
  if (SOURCE_DEPENDS_ON_TARGET.has(edge.type)) return { dependent: edge.source, dependency: edge.target };
  if (TARGET_DEPENDS_ON_SOURCE.has(edge.type)) return { dependent: edge.target, dependency: edge.source };
  return null;
}

/** child id → parent id along `contains` edges (first parent wins). */
export function containsParents(graph: Pick<KnowledgeGraph, "edges">): Map<string, string> {
  const parents = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type === "contains" && !parents.has(e.target)) parents.set(e.target, e.source);
  }
  return parents;
}

/** The node itself followed by its `contains` ancestors (cycle-safe). */
export function selfAndAncestors(id: string, parents: Map<string, string>): string[] {
  const out = [id];
  const seen = new Set(out);
  let cur = parents.get(id);
  while (cur !== undefined && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parents.get(cur);
  }
  return out;
}

/** Stable key for highlighting a drawn edge. */
export function edgeKey(source: string, target: string): string {
  return `${source}→${target}`;
}

import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

/**
 * Shared helpers for features built on the user's annotations (personal tour,
 * notes export). Pure — no store or DOM access — so they're unit-testable.
 */

/** A node annotation as these features read it. `lines` (line → note) is optional. */
export interface AnnotationLike {
  tags: string[];
  note: string;
  updatedAt: string;
  lines?: Record<string, string>;
}

export type AnnotationMap = Record<string, AnnotationLike>;

/** "graph" = layer order, dependencies first; "recent"/"oldest" = by note update time. */
export type AnnotatedOrder = "graph" | "recent" | "oldest";

/** Line notes with non-empty text, sorted by line number. */
export function lineNotes(a: AnnotationLike | undefined): Array<{ line: number; note: string }> {
  if (!a?.lines || typeof a.lines !== "object") return [];
  return Object.entries(a.lines)
    .map(([line, note]) => ({ line: Number(line), note: typeof note === "string" ? note.trim() : "" }))
    .filter((l) => Number.isFinite(l.line) && l.note)
    .sort((x, y) => x.line - y.line);
}

/** True when the annotation carries anything worth showing. */
export function hasContent(a: AnnotationLike | undefined): boolean {
  if (!a) return false;
  return a.tags.length > 0 || a.note.trim() !== "" || lineNotes(a).length > 0;
}

/** Every personal tag in use, de-duplicated case-insensitively, sorted. */
export function collectTags(annotations: AnnotationMap): string[] {
  const byKey = new Map<string, string>();
  for (const a of Object.values(annotations)) {
    for (const tag of a.tags ?? []) {
      const key = tag.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, tag);
    }
  }
  return [...byKey.values()].sort((x, y) => x.localeCompare(y));
}

function hasTag(a: AnnotationLike, tag: string): boolean {
  const key = tag.toLowerCase();
  return a.tags.some((t) => t.toLowerCase() === key);
}

/** Edge types where the source needs the target (target is read first in "graph" order). */
const DEPENDENCY_EDGES = new Set<string>([
  "imports", "calls", "inherits", "implements", "depends_on", "reads_from",
  "subscribes", "middleware", "uses_token", "instance_of", "variant_of", "builds_on", "cites",
]);
/** Edge types where the source comes first (parent before child). */
const PARENT_EDGES = new Set<string>(["contains", "contains_flow", "flow_step", "documents", "configures"]);

/** Layer position for each node id; nodes outside any layer inherit their containing file's. */
function layerIndexes(graph: KnowledgeGraph): Map<string, number> {
  const index = new Map<string, number>();
  graph.layers.forEach((layer, i) => {
    for (const id of layer.nodeIds) if (!index.has(id)) index.set(id, i);
  });
  for (const edge of graph.edges) {
    if (edge.type === "contains" && !index.has(edge.target) && index.has(edge.source)) {
      index.set(edge.target, index.get(edge.source)!);
    }
  }
  return index;
}

/**
 * Topological order of `ids` (dependencies before dependents, parents before
 * children) restricted to the edges among them; ties and cycles fall back to
 * the incoming order.
 */
function dependencyOrder(ids: string[], edges: GraphEdge[]): string[] {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const after = new Map<string, Set<string>>(); // before → nodes that must come after it
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const link = (before: string, later: string) => {
    if (before === later || !pos.has(before) || !pos.has(later)) return;
    let set = after.get(before);
    if (!set) after.set(before, (set = new Set()));
    if (set.has(later)) return;
    set.add(later);
    indegree.set(later, indegree.get(later)! + 1);
  };
  for (const e of edges) {
    if (DEPENDENCY_EDGES.has(e.type)) link(e.target, e.source);
    else if (PARENT_EDGES.has(e.type)) link(e.source, e.target);
  }
  const result: string[] = [];
  const done = new Set<string>();
  while (result.length < ids.length) {
    // Smallest original position among ready nodes; if a cycle blocks, take the smallest remaining.
    let pick: string | undefined;
    for (const id of ids) {
      if (!done.has(id) && indegree.get(id) === 0) { pick = id; break; }
    }
    pick ??= ids.find((id) => !done.has(id))!;
    done.add(pick);
    result.push(pick);
    for (const later of after.get(pick) ?? []) indegree.set(later, indegree.get(later)! - 1);
  }
  return result;
}

/**
 * Annotated node ids that still exist in the graph, optionally restricted to
 * one personal tag, in the requested order.
 */
export function orderAnnotatedNodes(
  graph: KnowledgeGraph,
  annotations: AnnotationMap,
  opts: { order?: AnnotatedOrder; tag?: string | null } = {},
): string[] {
  const order = opts.order ?? "graph";
  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const ids = Object.keys(annotations).filter((id) => {
    const a = annotations[id];
    return nodeIndex.has(id) && hasContent(a) && (!opts.tag || hasTag(a, opts.tag));
  });

  if (order !== "graph") {
    const sign = order === "recent" ? -1 : 1;
    return ids.sort((x, y) => {
      const tx = Date.parse(annotations[x].updatedAt) || 0;
      const ty = Date.parse(annotations[y].updatedAt) || 0;
      return (tx - ty) * sign || nodeIndex.get(x)! - nodeIndex.get(y)!;
    });
  }

  const layer = layerIndexes(graph);
  const rank = (id: string) => layer.get(id) ?? Number.MAX_SAFE_INTEGER;
  ids.sort((x, y) => rank(x) - rank(y) || nodeIndex.get(x)! - nodeIndex.get(y)!);
  // Topological order within each layer group.
  const out: string[] = [];
  let start = 0;
  while (start < ids.length) {
    let end = start;
    while (end < ids.length && rank(ids[end]) === rank(ids[start])) end++;
    out.push(...dependencyOrder(ids.slice(start, end), graph.edges));
    start = end;
  }
  return out;
}

/** The file node containing `node` (via a `contains` edge or a matching filePath), if any. */
export function containingFile(graph: KnowledgeGraph, node: GraphNode): GraphNode | undefined {
  if (node.type === "file") return undefined;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    if (e.type === "contains" && e.target === node.id) {
      const parent = byId.get(e.source);
      if (parent?.type === "file") return parent;
    }
  }
  if (!node.filePath) return undefined;
  return graph.nodes.find((n) => n.type === "file" && n.filePath === node.filePath);
}

export interface AnnotatedLink {
  /** The other annotated node. */
  id: string;
  type: string;
  /** "out" = this node → other (e.g. this imports other); "in" = other → this. */
  dir: "out" | "in";
}

/** Graph edges between annotated nodes, per node, de-duplicated. */
export function annotatedLinks(graph: KnowledgeGraph, ids: Iterable<string>): Map<string, AnnotatedLink[]> {
  const set = new Set(ids);
  const links = new Map<string, AnnotatedLink[]>();
  const seen = new Set<string>();
  const add = (from: string, link: AnnotatedLink) => {
    const key = `${from}\u0000${link.id}\u0000${link.type}\u0000${link.dir}`;
    if (seen.has(key)) return;
    seen.add(key);
    let list = links.get(from);
    if (!list) links.set(from, (list = []));
    list.push(link);
  };
  for (const e of graph.edges) {
    if (e.source === e.target || !set.has(e.source) || !set.has(e.target)) continue;
    add(e.source, { id: e.target, type: e.type, dir: "out" });
    add(e.target, { id: e.source, type: e.type, dir: "in" });
  }
  return links;
}

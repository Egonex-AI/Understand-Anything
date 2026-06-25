import type { GraphEdge } from "@understand-anything/core/types";

function lift(path: string | undefined, visible: string[]): string | null {
  if (!path) return null;
  let best: string | null = null;
  for (const v of visible) {
    if (path === v || path.startsWith(v + "/") || path.startsWith(v)) {
      if (!best || v.length > best.length) best = v;
    }
  }
  return best;
}

export function aggregateEdges(
  edges: GraphEdge[],
  nodeToPath: Map<string, string>,
  visiblePrefixes: string[],
): { source: string; target: string; count: number }[] {
  const counts = new Map<string, { source: string; target: string; count: number }>();
  for (const e of edges) {
    const s = lift(nodeToPath.get(String(e.source)), visiblePrefixes);
    const t = lift(nodeToPath.get(String(e.target)), visiblePrefixes);
    if (!s || !t || s === t) continue;
    const k = `${s}|${t}`;
    const cur = counts.get(k);
    if (cur) cur.count++; else counts.set(k, { source: s, target: t, count: 1 });
  }
  return [...counts.values()];
}

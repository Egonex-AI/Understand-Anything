import type { GraphEdge } from "@understand-anything/core/types";

export interface VisibleEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  types: string[];
}

export function aggregateVisibleEdges(
  edges: GraphEdge[],
  visibleAtomOf: Map<string, string>,
): VisibleEdge[] {
  const buckets = new Map<string, VisibleEdge>();
  const order: string[] = [];

  for (const edge of edges) {
    const s = visibleAtomOf.get(String(edge.source));
    const t = visibleAtomOf.get(String(edge.target));
    if (!s || !t || s === t) continue;

    // ponytail: length-prefix prevents ids containing "|" from colliding
    const key = `${s.length}:${s}|${t}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { id: "ve:" + key, source: s, target: t, count: 0, types: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.count++;
    if (!bucket.types.includes(edge.type)) bucket.types.push(edge.type);
  }

  return order.map((k) => buckets.get(k)!);
}

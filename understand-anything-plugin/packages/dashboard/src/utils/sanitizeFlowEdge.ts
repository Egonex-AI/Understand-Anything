import type { Edge } from "@xyflow/react";

/**
 * Values we treat as "no handle specified" so React Flow falls back to the
 * node's default handle / center.
 *
 * - `null` / `undefined`: missing field, often introduced by upstream loaders
 *   that round-trip an edge object and reset unset handles to `null`.
 * - `"null"` / `"undefined"`: the literal strings, which sneak in when
 *   an upstream tool stringifies a missing value (e.g. `String(null)`) or
 *   when a graph JSON has a `sourceHandle: "null"` field that survived
 *   schema stripping. See issue #330: when these reach React Flow it logs
 *   `Couldn't create edge for source handle id: "null"` and the rendering
 *   loop hangs trying to re-resolve the missing handle every frame.
 * - `""`: empty string, treated the same as missing.
 */
const INVALID_HANDLE_VALUES = new Set<string>(["null", "undefined", ""]);

/**
 * Return true when `value` should be considered "no handle id" and stripped
 * from a React Flow edge before render.
 */
export function isInvalidHandleValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return INVALID_HANDLE_VALUES.has(value);
}

/**
 * Normalise a React Flow edge so it never carries a bogus `sourceHandle` /
 * `targetHandle`. When the field is present but holds `null`, `undefined`,
 * `""`, `"null"`, or `"undefined"`, we delete the field entirely so React
 * Flow's handle lookup picks the node's first (default) handle. This avoids
 * the `error008` warning loop that freezes the dashboard when a user clicks
 * a search result whose target layer renders edges that point at a node
 * with no matching handle id (issue #330).
 *
 * The function returns the original edge reference when no change is needed
 * so memoised React Flow renders still see referential equality.
 */
export function sanitizeFlowEdge<E extends Edge>(edge: E): E {
  const hasInvalidSource =
    "sourceHandle" in edge && isInvalidHandleValue(edge.sourceHandle);
  const hasInvalidTarget =
    "targetHandle" in edge && isInvalidHandleValue(edge.targetHandle);
  if (!hasInvalidSource && !hasInvalidTarget) return edge;

  const cleaned: Record<string, unknown> = { ...edge };
  if (hasInvalidSource) delete cleaned.sourceHandle;
  if (hasInvalidTarget) delete cleaned.targetHandle;
  return cleaned as E;
}

/** Convenience wrapper for an array of edges. */
export function sanitizeFlowEdges<E extends Edge>(edges: E[]): E[] {
  let mutated = false;
  const out: E[] = new Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const next = sanitizeFlowEdge(edges[i]);
    if (next !== edges[i]) mutated = true;
    out[i] = next;
  }
  return mutated ? out : edges;
}

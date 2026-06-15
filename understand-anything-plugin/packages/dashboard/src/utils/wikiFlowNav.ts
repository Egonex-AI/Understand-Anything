export type WikiPageType = "service" | "domain" | "overview" | "architecture" | "cross-domain" | "endpoint" | "feature-graph";

export interface WikiTarget {
  type: WikiPageType;
  id: string;
  service?: string;
  fragment?: string;
}

/**
 * Normalize a flow id from index.json into a DOM-safe fragment.
 * Handles both "wiki:flow:xxx" and "flow:xxx" and bare "xxx" formats,
 * always producing "flow:xxx".
 */
export function flowFragmentFromId(id: string): string {
  return `flow:${id.replace(/^(?:wiki:)?flow:/, "")}`;
}

/**
 * Compare two wiki navigation targets by page identity only (type/id/service),
 * ignoring fragment. Used to decide whether a fetch is needed.
 */
export function isSameWikiPage(
  a: { type: WikiPageType; id: string; service?: string; fragment?: string },
  b: { type: WikiPageType; id: string; service?: string; fragment?: string },
): boolean {
  return a.type === b.type && a.id === b.id && a.service === b.service;
}

/**
 * Compare two wiki navigation targets for equality, including fragment.
 * Used to decide whether to update wikiActivePage on navigation.
 */
export function isSameWikiTarget(
  a: { type: WikiPageType; id: string; service?: string; fragment?: string },
  b: { type: WikiPageType; id: string; service?: string; fragment?: string },
): boolean {
  return isSameWikiPage(a, b) && a.fragment === b.fragment;
}

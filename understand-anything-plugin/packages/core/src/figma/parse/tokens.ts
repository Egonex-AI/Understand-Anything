import type { GraphNode, GraphEdge, FigmaMeta } from "../../types.js";
import type { FigmaDocument, FigmaNode, FigmaStyles } from "../source/types.js";

const STYLE_KIND: Record<string, NonNullable<FigmaMeta["tokenKind"]>> = {
  FILL: "color", TEXT: "type", EFFECT: "effect", GRID: "grid",
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function extractTokens(
  doc: FigmaDocument,
  styles: FigmaStyles,
  structuralNodes: GraphNode[],
  fileKey: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const tokenByStyleKey = new Map<string, string>();

  // Only published styles/variables become token nodes (bounded set).
  for (const s of styles.meta?.styles ?? []) {
    const kind = STYLE_KIND[s.style_type] ?? "color";
    const id = `token:${kind}:${slug(s.name)}`;
    if (!tokenByStyleKey.has(s.key)) tokenByStyleKey.set(s.key, id);
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id, type: "token", name: s.name, summary: s.name,
        tags: ["token", kind], complexity: "simple",
        figmaMeta: { fileKey, tokenKind: kind },
      });
    }
  }

  const graphIdByFigmaId = new Map<string, string>();
  for (const n of structuralNodes) {
    if (n.figmaMeta?.nodeId) graphIdByFigmaId.set(n.figmaMeta.nodeId, n.id);
  }

  const usesSeen = new Set<string>();
  function walk(n: FigmaNode, nearestConsumerId: string | undefined) {
    // Styles (fills/text/effect/grid) are usually applied to nested leaf
    // layers (TEXT/RECTANGLE/…), not to the shallow structural node itself.
    // Attribute a styled node's token usage to the nearest structural
    // ancestor (screen/component/componentSet/instance/page) so real consumer
    // relationships aren't dropped when the styled layer isn't itself a node.
    const consumerId = graphIdByFigmaId.get(n.id) ?? nearestConsumerId;
    if (consumerId && n.styles) {
      for (const localStyleId of Object.values(n.styles)) {
        // node.styles values are file-local style ids (e.g. "2:10") that
        // index the document's top-level styles map, while token nodes are
        // keyed by the global published key from /files/:key/styles. Bridge
        // local id → published key; fall back to a direct match for sources
        // that don't provide the top-level map.
        const styleKey = doc.styles?.[localStyleId]?.key ?? localStyleId;
        const tokenId = tokenByStyleKey.get(styleKey);
        if (tokenId) {
          const dedupe = `${consumerId}|${tokenId}`;
          if (!usesSeen.has(dedupe)) {
            usesSeen.add(dedupe);
            edges.push({ source: consumerId, target: tokenId, type: "uses_token", direction: "forward", weight: 0.5 });
          }
        }
      }
    }
    for (const c of n.children ?? []) walk(c, consumerId);
  }
  walk(doc.document, undefined);

  return { nodes, edges };
}

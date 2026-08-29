import type { GraphNode } from "../types.js";

/**
 * Set `figmaMeta.thumbnailUrl` on screen nodes from a Figma image-render map
 * (Figma nodeId → pre-signed image URL). Mutates matching nodes in place and
 * returns how many were updated.
 *
 * Shared by figma-scan.mjs: the normal scan sets thumbnails on freshly parsed
 * nodes, and the UP_TO_DATE path re-renders and refreshes the existing graph's
 * thumbnails — the URLs are pre-signed and expire after a few hours, so a
 * re-run must refresh them or the dashboard shows broken sidebar previews.
 */
export function applyScreenThumbnails(
  nodes: GraphNode[],
  images: Record<string, string>,
): number {
  let updated = 0;
  for (const n of nodes) {
    if (n.type !== "screen") continue;
    const figmaId = n.figmaMeta?.nodeId;
    if (!figmaId || !n.figmaMeta) continue;
    const url = images[figmaId];
    if (url) {
      n.figmaMeta.thumbnailUrl = url;
      updated++;
    }
  }
  return updated;
}

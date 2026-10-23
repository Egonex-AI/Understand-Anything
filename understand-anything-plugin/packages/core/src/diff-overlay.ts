import type { DiffOverlay, KnowledgeGraph } from "./types.js";

/**
 * Maps a set of changed file paths onto an already-analyzed knowledge graph:
 * finds the nodes defined in those files (file nodes plus any function/class
 * nodes whose `filePath` matches, since graph-builder stamps the same
 * filePath on both), then walks one hop of edges in both directions to find
 * the blast radius — what imports/calls the changed nodes, and what they in
 * turn import/call. Pure and deterministic; no LLM involved.
 *
 * `changedFiles` should be paths relative to the project root, matching how
 * node.filePath is stored (see persistence's sanitiseFilePath).
 */
export function computeDiffOverlay(
  graph: KnowledgeGraph,
  changedFiles: string[],
  baseBranch?: string,
): DiffOverlay {
  const changedFileSet = new Set(changedFiles);

  const changedNodeIds = graph.nodes
    .filter((n) => typeof n.filePath === "string" && changedFileSet.has(n.filePath))
    .map((n) => n.id);
  const changedNodeIdSet = new Set(changedNodeIds);

  const affectedNodeIdSet = new Set<string>();
  for (const edge of graph.edges) {
    if (changedNodeIdSet.has(edge.source) && !changedNodeIdSet.has(edge.target)) {
      affectedNodeIdSet.add(edge.target);
    }
    if (changedNodeIdSet.has(edge.target) && !changedNodeIdSet.has(edge.source)) {
      affectedNodeIdSet.add(edge.source);
    }
  }

  return {
    version: "1.0.0",
    ...(baseBranch ? { baseBranch } : {}),
    generatedAt: new Date().toISOString(),
    changedFiles,
    changedNodeIds,
    affectedNodeIds: [...affectedNodeIdSet],
  };
}

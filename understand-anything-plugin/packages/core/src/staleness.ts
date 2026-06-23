import { execFileSync } from "child_process";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "./types.js";

export interface StalenessResult {
  stale: boolean;
  changedFiles: string[];
}

/**
 * Get the list of files that changed between a given commit and HEAD.
 * Returns an empty array if there are no changes or if git encounters an error.
 */
export function getChangedFiles(
  projectDir: string,
  lastCommitHash: string,
): string[] {
  try {
    const output = execFileSync('git', ['diff', `${lastCommitHash}..HEAD`, '--name-only'], {
      cwd: projectDir,
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Check whether the knowledge graph is stale relative to the current HEAD.
 */
export function isStale(
  projectDir: string,
  lastCommitHash: string,
): StalenessResult {
  const changedFiles = getChangedFiles(projectDir, lastCommitHash);
  return {
    stale: changedFiles.length > 0,
    changedFiles,
  };
}

/**
 * Merge new analysis results into an existing knowledge graph.
 *
 * 1. Remove old nodes belonging to changed files (matched by filePath).
 * 2. Remove old edges where the SOURCE or TARGET node belongs to a changed file.
 * 3. Add new nodes and edges.
 * 4. Update project.gitCommitHash and project.analyzedAt.
 * 5. Return the merged graph.
 */
export function mergeGraphUpdate(
  existingGraph: KnowledgeGraph,
  changedFilePaths: string[],
  newNodes: GraphNode[],
  newEdges: GraphEdge[],
  newCommitHash: string,
): KnowledgeGraph {
  const changedSet = new Set(changedFilePaths);

  // Collect IDs of nodes that belong to changed files (will be removed)
  const removedNodeIds = new Set(
    existingGraph.nodes
      .filter((node) => node.filePath !== undefined && changedSet.has(node.filePath))
      .map((node) => node.id),
  );

  // Keep nodes that don't belong to changed files
  const retainedNodes = existingGraph.nodes.filter(
    (node) => !removedNodeIds.has(node.id),
  );

  // Keep edges whose source or target node is not in the removed set
  const retainedEdges = existingGraph.edges.filter(
    (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
  );

  return {
    ...existingGraph,
    project: {
      ...existingGraph.project,
      gitCommitHash: newCommitHash,
      analyzedAt: new Date().toISOString(),
    },
    nodes: [...retainedNodes, ...newNodes],
    edges: [...retainedEdges, ...newEdges],
  };
}

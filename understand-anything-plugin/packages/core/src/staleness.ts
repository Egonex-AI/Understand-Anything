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
    // -z makes git emit NUL-terminated, unquoted paths. Without it git
    // C-quotes any path containing non-ASCII bytes (e.g. `uni-café.txt`
    // becomes `"uni-caf\303\251.txt"`), which never matches the stored
    // filePath and silently skips incremental updates for that file.
    //
    // This parser assumes --name-only, where each NUL-terminated token is a
    // single path. Do NOT switch to --name-status or -M/-C without rewriting
    // this: under -z those modes emit multi-token entries (e.g. a rename is
    // `R100\0old\0new\0`), and naive splitting would treat the status prefix
    // and the old path as bogus changed files.
    const output = execFileSync('git', ['diff', `${lastCommitHash}..HEAD`, '--name-only', '-z'], {
      cwd: projectDir,
      encoding: "utf-8",
    });
    // Split on NUL only. git -z preserves raw path bytes (including any
    // leading/trailing whitespace), so we must NOT trim tokens. The final
    // NUL produces an empty trailing token, dropped by the length filter.
    return output.split("\0").filter((line) => line.length > 0);
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

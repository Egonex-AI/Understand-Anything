import { execFile, execFileSync } from "child_process";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "./types.js";

export interface StalenessResult {
  stale: boolean;
  changedFiles: string[];
}

export type GraphFreshnessRelation = "behind" | "ahead" | "diverged";

export type GraphFreshnessUnknownReason =
  | "missing-graph-commit"
  | "git-head-unavailable"
  | "graph-commit-unavailable"
  | "git-command-timeout"
  | "freshness-request-failed";

export type GraphFreshnessResult =
  | {
      status: "fresh";
      graphCommitHash: string;
      headCommitHash: string;
      changedFileCount: 0;
      changedFiles: [];
      commitsBehind: 0;
      commitsAhead: 0;
      lastAnalyzedAt?: string;
    }
  | {
      status: "dirty";
      graphCommitHash: string;
      headCommitHash: string;
      changedFileCount: number;
      changedFiles: string[];
      commitsBehind: 0;
      commitsAhead: 0;
      lastAnalyzedAt?: string;
    }
  | {
      status: "stale";
      relation: GraphFreshnessRelation;
      graphCommitHash: string;
      headCommitHash: string;
      changedFileCount: number;
      changedFiles: string[];
      commitsBehind: number;
      commitsAhead: number;
      lastAnalyzedAt?: string;
    }
  | {
      status: "unknown";
      reason: GraphFreshnessUnknownReason;
      graphCommitHash?: string;
      headCommitHash?: string;
      lastAnalyzedAt?: string;
    };

export interface GraphFreshnessInput {
  graphCommitHash?: string | null;
  lastAnalyzedAt?: string;
}

interface ProjectGitSnapshot {
  projectDir: string;
  repoRoot: string;
  headCommitHash: string;
  dirtyFiles: string[];
}

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const PROJECT_PATHSPEC = [
  "--",
  ".",
  ":(exclude).understand-anything",
  ":(exclude).understand-anything/**",
  ":(exclude).ua",
  ":(exclude).ua/**",
] as const;

class GitCommandError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly timedOut: boolean,
  ) {
    super(timedOut ? "Git command timed out" : "Git command failed");
  }
}

function runGit(projectDir: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: projectDir,
        encoding: null,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(
            new GitCommandError(
              typeof error.code === "number" ? error.code : null,
              error.killed === true && error.signal !== null,
            ),
          );
          return;
        }

        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

function parseScalar(output: Buffer): string {
  return output.toString("utf8").trim();
}

function parseNulDelimitedPaths(output: Buffer): string[] {
  const value = output.toString("utf8");
  if (value.length === 0) return [];

  const paths = value.split("\0");
  if (paths.at(-1) === "") paths.pop();
  return paths.filter((path) => path.length > 0);
}

function uniqueSortedPaths(...pathGroups: string[][]): string[] {
  return [...new Set(pathGroups.flat())].sort();
}

function optionalAnalysisTime(
  input: GraphFreshnessInput,
): Pick<GraphFreshnessInput, "lastAnalyzedAt"> {
  return input.lastAnalyzedAt === undefined
    ? {}
    : { lastAnalyzedAt: input.lastAnalyzedAt };
}

function unknownReason(error: unknown, fallback: GraphFreshnessUnknownReason) {
  return error instanceof GitCommandError && error.timedOut
    ? "git-command-timeout"
    : fallback;
}

async function createProjectGitSnapshot(
  projectDir: string,
): Promise<ProjectGitSnapshot> {
  const repoRoot = parseScalar(
    await runGit(projectDir, ["rev-parse", "--show-toplevel"]),
  );
  const headCommitHash = parseScalar(
    await runGit(projectDir, ["rev-parse", "HEAD"]),
  );
  const [staged, unstaged, untracked] = await Promise.all([
    runGit(projectDir, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--relative",
      ...PROJECT_PATHSPEC,
    ]),
    runGit(projectDir, [
      "diff",
      "--name-only",
      "-z",
      "--relative",
      ...PROJECT_PATHSPEC,
    ]),
    runGit(projectDir, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      ...PROJECT_PATHSPEC,
    ]),
  ]);

  return {
    projectDir,
    repoRoot,
    headCommitHash,
    dirtyFiles: uniqueSortedPaths(
      parseNulDelimitedPaths(staged),
      parseNulDelimitedPaths(unstaged),
      parseNulDelimitedPaths(untracked),
    ),
  };
}

async function isAncestor(
  projectDir: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await runGit(projectDir, [
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);
    return true;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return false;
    throw error;
  }
}

async function evaluateGraphFreshness(
  snapshot: ProjectGitSnapshot,
  input: GraphFreshnessInput,
  requestedGraphCommitHash: string,
): Promise<GraphFreshnessResult> {
  let graphCommitHash: string;
  try {
    graphCommitHash = parseScalar(
      await runGit(snapshot.projectDir, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${requestedGraphCommitHash}^{commit}`,
      ]),
    );
  } catch (error) {
    return {
      status: "unknown",
      reason: unknownReason(error, "graph-commit-unavailable"),
      graphCommitHash: requestedGraphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      ...optionalAnalysisTime(input),
    };
  }

  let committedFiles: string[];
  try {
    committedFiles = parseNulDelimitedPaths(
      await runGit(snapshot.projectDir, [
        "diff",
        "--name-only",
        "-z",
        "--relative",
        graphCommitHash,
        snapshot.headCommitHash,
        ...PROJECT_PATHSPEC,
      ]),
    );
  } catch (error) {
    return {
      status: "unknown",
      reason: unknownReason(error, "graph-commit-unavailable"),
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      ...optionalAnalysisTime(input),
    };
  }

  if (committedFiles.length === 0) {
    if (snapshot.dirtyFiles.length > 0) {
      return {
        status: "dirty",
        graphCommitHash,
        headCommitHash: snapshot.headCommitHash,
        changedFileCount: snapshot.dirtyFiles.length,
        changedFiles: snapshot.dirtyFiles,
        commitsBehind: 0,
        commitsAhead: 0,
        ...optionalAnalysisTime(input),
      };
    }

    return {
      status: "fresh",
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      changedFileCount: 0,
      changedFiles: [],
      commitsBehind: 0,
      commitsAhead: 0,
      ...optionalAnalysisTime(input),
    };
  }

  try {
    const [countsOutput, graphIsAncestor, headIsAncestor] = await Promise.all([
      runGit(snapshot.projectDir, [
        "rev-list",
        "--left-right",
        "--count",
        `${graphCommitHash}...${snapshot.headCommitHash}`,
        ...PROJECT_PATHSPEC,
      ]),
      isAncestor(
        snapshot.projectDir,
        graphCommitHash,
        snapshot.headCommitHash,
      ),
      isAncestor(
        snapshot.projectDir,
        snapshot.headCommitHash,
        graphCommitHash,
      ),
    ]);
    const [commitsAhead, commitsBehind] = parseScalar(countsOutput)
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10));

    if (
      !Number.isFinite(commitsAhead) ||
      !Number.isFinite(commitsBehind) ||
      commitsAhead < 0 ||
      commitsBehind < 0
    ) {
      throw new GitCommandError(null, false);
    }

    const relation: GraphFreshnessRelation = graphIsAncestor
      ? "behind"
      : headIsAncestor
        ? "ahead"
        : "diverged";
    const changedFiles = uniqueSortedPaths(
      committedFiles,
      snapshot.dirtyFiles,
    );

    return {
      status: "stale",
      relation,
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      changedFileCount: changedFiles.length,
      changedFiles,
      commitsBehind,
      commitsAhead,
      ...optionalAnalysisTime(input),
    };
  } catch (error) {
    return {
      status: "unknown",
      reason: unknownReason(error, "graph-commit-unavailable"),
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      ...optionalAnalysisTime(input),
    };
  }
}

function parseChangedFiles(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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
    const output = execFileSync("git", ["diff", `${lastCommitHash}..HEAD`, "--name-only"], {
      cwd: projectDir,
      encoding: "utf-8",
    });
    return parseChangedFiles(output);
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
 * Describe the freshness of multiple persisted graphs against one Git snapshot.
 */
export async function getGraphFreshnessBatch<T extends string>(
  projectDir: string,
  inputs: Record<T, GraphFreshnessInput>,
): Promise<Record<T, GraphFreshnessResult>> {
  const entries = Object.entries(inputs) as [T, GraphFreshnessInput][];
  const results = {} as Record<T, GraphFreshnessResult>;
  const comparableEntries: [T, GraphFreshnessInput, string][] = [];

  for (const [key, input] of entries) {
    const graphCommitHash = input.graphCommitHash?.trim();
    if (!graphCommitHash) {
      results[key] = {
        status: "unknown",
        reason: "missing-graph-commit",
        ...optionalAnalysisTime(input),
      };
      continue;
    }
    comparableEntries.push([key, input, graphCommitHash]);
  }

  if (comparableEntries.length === 0) return results;

  let snapshot: ProjectGitSnapshot;
  try {
    snapshot = await createProjectGitSnapshot(projectDir);
  } catch (error) {
    const reason = unknownReason(error, "git-head-unavailable");
    for (const [key, input, graphCommitHash] of comparableEntries) {
      results[key] = {
        status: "unknown",
        reason,
        graphCommitHash,
        ...optionalAnalysisTime(input),
      };
    }
    return results;
  }

  await Promise.all(
    comparableEntries.map(async ([key, input, graphCommitHash]) => {
      results[key] = await evaluateGraphFreshness(
        snapshot,
        input,
        graphCommitHash,
      );
    }),
  );

  return results;
}

/**
 * Describe whether a persisted graph can still be trusted for the project.
 *
 * Unknown is intentionally distinct from fresh: if Git metadata cannot be
 * read, callers should warn softly rather than imply the graph is current.
 */
export async function getGraphFreshness(
  projectDir: string,
  input: GraphFreshnessInput,
): Promise<GraphFreshnessResult> {
  const results = await getGraphFreshnessBatch(projectDir, { graph: input });
  return results.graph;
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

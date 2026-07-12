import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computeDiffOverlay, parseTourGenerationResponse, type DiffOverlay, type GraphNode, type KnowledgeGraph, type TourStep } from "@understand-anything/core";
import type { LlmCaller } from "./llm.js";

const execFileAsync = promisify(execFile);
const DIFF_TIMEOUT_MS = 30_000;

export interface ChangedFilesResult {
  changedFiles: string[];
  baseBranch: string;
}

/**
 * Resolves the changed-files list the same way understand-diff (the skill)
 * does: a specific PR number takes priority (via `gh pr diff`, since the
 * gateway host is assumed to already be `gh`-authenticated the same way it
 * is for the rest of this project's PR workflow), otherwise a base branch
 * comparison (`git diff <base>...HEAD`), falling back to uncommitted
 * working-tree changes if the repo isn't currently ahead of the base.
 */
export async function getChangedFiles(
  projectRoot: string,
  opts: { prNumber?: number; baseBranch?: string } = {},
): Promise<ChangedFilesResult> {
  if (opts.prNumber !== undefined) {
    const { stdout } = await execFileAsync("gh", ["pr", "diff", String(opts.prNumber), "--name-only"], {
      cwd: projectRoot,
      timeout: DIFF_TIMEOUT_MS,
    });
    return { changedFiles: splitLines(stdout), baseBranch: `PR #${opts.prNumber}` };
  }

  const baseBranch = opts.baseBranch ?? (await detectDefaultBranch(projectRoot));

  try {
    const { stdout } = await execFileAsync("git", ["diff", `${baseBranch}...HEAD`, "--name-only"], {
      cwd: projectRoot,
      timeout: DIFF_TIMEOUT_MS,
    });
    const changedFiles = splitLines(stdout);
    if (changedFiles.length > 0) return { changedFiles, baseBranch };
  } catch {
    // Falls through to uncommitted-changes diff below — e.g. baseBranch doesn't exist locally.
  }

  const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd: projectRoot, timeout: DIFF_TIMEOUT_MS });
  return { changedFiles: splitLines(stdout), baseBranch: "working tree" };
}

async function detectDefaultBranch(projectRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd: projectRoot,
      timeout: DIFF_TIMEOUT_MS,
    });
    return stdout.trim().replace(/^refs\/remotes\/origin\//, "");
  } catch {
    return "main";
  }
}

function splitLines(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter(Boolean);
}

const PR_TOUR_SYSTEM_PROMPT =
  "You are helping a developer understand what a pull request changed and why it matters. Always respond with a " +
  'single valid JSON object shaped { "steps": [{ "order": number, "title": string, "description": string, ' +
  '"nodeIds": string[] }] } and nothing else.';

// Bounds on how many nodes get listed in the prompt, independent of max_tokens: a diff touching
// dozens of nodes would otherwise blow the output budget just describing the input, since every
// listed node is fair game for the model to narrate. Large diffs get a truncated, still-grounded
// list rather than an unbounded one — the model is told explicitly how many were omitted.
const MAX_CHANGED_NODES_IN_PROMPT = 40;
const MAX_AFFECTED_NODES_IN_PROMPT = 20;
const PR_TOUR_MAX_TOKENS = 8000;

function buildPrTourPrompt(graph: KnowledgeGraph, overlay: DiffOverlay, changed: GraphNode[], affected: GraphNode[]): string {
  const changedShown = changed.slice(0, MAX_CHANGED_NODES_IN_PROMPT);
  const affectedShown = affected.slice(0, MAX_AFFECTED_NODES_IN_PROMPT);
  const changedOmitted = changed.length - changedShown.length;
  const affectedOmitted = affected.length - affectedShown.length;

  const changedList = changedShown.map((n) => `  - ${n.id} [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary}`).join("\n");
  const affectedList = affectedShown.map((n) => `  - ${n.id} [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary}`).join("\n");

  return `Project: ${graph.project.name}
Description: ${graph.project.description}

Diff source: ${overlay.baseBranch ?? "unknown"}
Changed files: ${overlay.changedFiles.join(", ")}

Directly changed nodes:
${changedList || "  (none matched in the graph)"}
${changedOmitted > 0 ? `  ...and ${changedOmitted} more changed node(s), omitted for brevity — summarize the overall pattern rather than every node.\n` : ""}
Downstream/upstream affected nodes (1-hop blast radius, not directly changed):
${affectedList || "  (none)"}
${affectedOmitted > 0 ? `  ...and ${affectedOmitted} more affected node(s), omitted for brevity.\n` : ""}
Create a walkthrough (3-8 steps) explaining this change to a reviewer: what changed, why it likely matters, and what
the blast radius means for the rest of the system. Every nodeId you reference must come from the two lists above —
do not invent new ones, and clearly note which step's nodes are "changed" vs. "affected" in the description text.
${changedOmitted + affectedOmitted > 0 ? "Since some nodes were omitted above, favor grouping/summarizing over listing every individual node.\n" : ""}Return a JSON object with a "steps" array; each step has "order" (starting at 1), "title", "description", and
"nodeIds" (a subset of the nodes listed above).`;
}

export interface PrWalkthroughResult {
  overlay: DiffOverlay;
  steps: TourStep[];
  error?: string;
}

/**
 * Full PR/diff understanding pipeline: resolve changed files, compute the
 * blast-radius overlay against the already-analyzed graph (core's
 * computeDiffOverlay — pure, no LLM), then ask the model to narrate a
 * walkthrough grounded in only the changed + affected nodes.
 */
export async function generatePrWalkthrough(
  graph: KnowledgeGraph,
  changedFiles: string[],
  baseBranch: string,
  llmCall: LlmCaller,
): Promise<PrWalkthroughResult> {
  const overlay = computeDiffOverlay(graph, changedFiles, baseBranch);

  if (overlay.changedNodeIds.length === 0) {
    return {
      overlay,
      steps: [],
      error: "None of the changed files matched any node in the analyzed graph — the project may need re-analysis to pick up these files.",
    };
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const changed = overlay.changedNodeIds.map((id) => byId.get(id)).filter((n): n is GraphNode => n !== undefined);
  const affected = overlay.affectedNodeIds.map((id) => byId.get(id)).filter((n): n is GraphNode => n !== undefined);

  const prompt = buildPrTourPrompt(graph, overlay, changed, affected);
  const response = await llmCall(PR_TOUR_SYSTEM_PROMPT, prompt, PR_TOUR_MAX_TOKENS);
  const steps = parseTourGenerationResponse(response);

  if (steps.length === 0) {
    return { overlay, steps: [], error: "Could not generate a walkthrough from the model's response." };
  }
  return { overlay, steps };
}

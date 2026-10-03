import {
  generateHeuristicTour,
  parseTourGenerationResponse,
  type GraphNode,
  type KnowledgeGraph,
  type TourStep,
} from "@understand-anything/core";
import type { LlmCaller } from "./llm.js";

const REVIEW_TOUR_SYSTEM_PROMPT =
  "You are a senior engineer preparing a code-review walkthrough for a teammate. Always respond with a single " +
  'valid JSON object shaped { "steps": [{ "order": number, "title": string, "description": string, "nodeIds": string[] }] } and nothing else.';

const COMPLEXITY_WEIGHT: Record<GraphNode["complexity"], number> = { simple: 0, moderate: 1, complex: 2 };
const DEFAULT_REVIEW_LIMIT = 12;

/**
 * Free, deterministic module-walkthrough tour — no LLM call. Populates the
 * standard `graph.tour` field, so upstream's existing Learn persona /
 * LearnPanel UI works with zero changes; this is the only tour kind the
 * stock dashboard knows how to play.
 */
export function generateModuleTour(graph: KnowledgeGraph): TourStep[] {
  return generateHeuristicTour(graph);
}

/**
 * Ranks code nodes by review risk: complexity plus how central the node is
 * in the dependency graph (total in+out edge degree) — files that are both
 * complex and heavily depended-on/depending-on are exactly what a reviewer
 * should look at first, in the absence of test-coverage or churn data.
 */
export function rankNodesForReview(graph: KnowledgeGraph, limit = DEFAULT_REVIEW_LIMIT): GraphNode[] {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  return graph.nodes
    .filter((n) => n.type !== "concept")
    .map((n) => ({ node: n, score: COMPLEXITY_WEIGHT[n.complexity] * 2 + (degree.get(n.id) ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.node);
}

function buildReviewTourPrompt(graph: KnowledgeGraph, ranked: GraphNode[]): string {
  const nodeList = ranked
    .map((n) => `  - ${n.id} [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary} (complexity: ${n.complexity})`)
    .join("\n");

  return `Project: ${graph.project.name}
Description: ${graph.project.description}

The following nodes were flagged as highest review priority (complexity + how central they are in the dependency graph):
${nodeList}

Create a short, ordered code-review walkthrough (3-8 steps) that groups these nodes sensibly and explains, for each
step, WHY a reviewer should care (risk, blast radius, tricky logic) — not just what the code does. Every nodeId you
reference must come from the list above. Return a JSON object with a "steps" array; each step has "order" (starting
at 1), "title", "description" (2-3 sentences focused on review risk), and "nodeIds" (a subset of the list above).`;
}

/**
 * LLM-narrated code-review tour: one call, grounded only in the top-ranked
 * risk nodes (not the whole graph) to keep prompt size and cost bounded.
 * Returns an empty array (no tour) if the project has no code nodes at all.
 */
export async function generateCodeReviewTour(graph: KnowledgeGraph, llmCall: LlmCaller): Promise<TourStep[]> {
  const ranked = rankNodesForReview(graph);
  if (ranked.length === 0) return [];

  const prompt = buildReviewTourPrompt(graph, ranked);
  const response = await llmCall(REVIEW_TOUR_SYSTEM_PROMPT, prompt, 2000);
  return parseTourGenerationResponse(response);
}

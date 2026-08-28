import { parseTourGenerationResponse, type GraphNode, type KnowledgeGraph, type TourStep } from "@understand-anything/core";
import type { LlmCaller } from "./llm.js";

const CUSTOM_TOUR_SYSTEM_PROMPT =
  "You are building a custom guided-tour walkthrough of a codebase for a developer, based on their specific " +
  'request and a set of nodes they selected in the knowledge graph. Always respond with a single valid JSON ' +
  'object shaped { "steps": [{ "order": number, "title": string, "description": string, "nodeIds": string[] }] } ' +
  "and nothing else.";

const MAX_CUSTOM_TOUR_NODES = 40;

function buildCustomTourPrompt(graph: KnowledgeGraph, nodes: GraphNode[], userPrompt: string): string {
  const nodeList = nodes
    .map((n) => `  - ${n.id} [${n.type}] ${n.name}${n.filePath ? ` (${n.filePath})` : ""}: ${n.summary}`)
    .join("\n");

  return `Project: ${graph.project.name}
Description: ${graph.project.description}

The developer selected these nodes and asked for a custom tour:
${nodeList}

Developer's request: "${userPrompt}"

Create an ordered walkthrough (steps) that satisfies the request, using ONLY the nodes listed above. Every nodeId
you reference must come from that list — do not invent new ones. Return a JSON object with a "steps" array; each
step has "order" (starting at 1), "title", "description" (2-3 sentences addressing the request), and "nodeIds"
(a subset of the list above relevant to that step).`;
}

export interface CustomTourResult {
  steps: TourStep[];
  error?: string;
}

/**
 * Generates a tour scoped to a user-selected set of nodes plus a free-text
 * prompt — e.g. "explain how these fit together" or "walk me through the
 * auth flow" over whatever the user selected in the graph. Unlike the
 * automatic module/code-review tours, this is entirely driven by what the
 * developer picked and asked for.
 */
export async function generateCustomTour(
  graph: KnowledgeGraph,
  nodeIds: string[],
  userPrompt: string,
  llmCall: LlmCaller,
): Promise<CustomTourResult> {
  if (nodeIds.length === 0) return { steps: [], error: "No nodes selected." };
  if (!userPrompt.trim()) return { steps: [], error: "Prompt is empty." };

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = nodeIds
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => n !== undefined)
    .slice(0, MAX_CUSTOM_TOUR_NODES);

  if (nodes.length === 0) return { steps: [], error: "None of the selected node ids were found in the graph." };

  const prompt = buildCustomTourPrompt(graph, nodes, userPrompt);
  const response = await llmCall(CUSTOM_TOUR_SYSTEM_PROMPT, prompt, 2000);
  const steps = parseTourGenerationResponse(response);
  if (steps.length === 0) return { steps: [], error: "Could not generate a tour from the model's response." };
  return { steps };
}

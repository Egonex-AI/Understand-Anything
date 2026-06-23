import type { KnowledgeGraph } from "@understand-anything/core";
import { buildChatContext, formatContextForPrompt } from "./context-builder.js";

/**
 * Build a complete chat prompt by combining knowledge graph context
 * with a system instruction for answering codebase questions.
 */
export function buildChatPrompt(
  graph: KnowledgeGraph,
  query: string,
): string {
  const context = buildChatContext(graph, query);
  const formattedContext = formatContextForPrompt(context);

  return [
    "You are a knowledgeable assistant that answers questions about a software codebase.",
    "Use the following knowledge graph context to inform your answer.",
    "Reference specific files, functions, classes, and relationships from the graph.",
    "If layers are present, explain which architectural layer(s) are relevant.",
    "Be concise but thorough — link concepts to actual code locations.",
    "",
    "---",
    "",
    formattedContext,
    "---",
    "",
    `**User question:** ${query}`,
  ].join("\n");
}

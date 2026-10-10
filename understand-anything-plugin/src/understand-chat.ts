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
  const MAX_CONTEXT_CHARS = 2000;
  const truncatedContext = formattedContext.length > MAX_CONTEXT_CHARS
    ? formattedContext.slice(0, MAX_CONTEXT_CHARS) + "\n...[truncated]"
    : formattedContext;

  return [
    "You are a knowledgeable assistant that answers questions about a software codebase.",
    "Use the following knowledge graph context to inform your answer.",
    "Reference specific files, functions, classes, and relationships from the graph.",
    "If layers are present, explain which architectural layer(s) are relevant.",
    "Be concise but thorough — link concepts to actual code locations.",
    "",
    "---",
    "",
    truncatedContext,
    "---",
    "",
    `**User question:** ${query}`,
  ].join("\n");
}

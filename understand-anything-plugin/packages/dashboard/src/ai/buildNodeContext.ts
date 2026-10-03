import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

/** Keep prompts bounded no matter how big the file is. */
const MAX_SOURCE_LINES = 400;
const MAX_SOURCE_CHARS = 40_000;
const MAX_NEIGHBORS = 25;
const CONTEXT_PADDING = 15;

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
};

export interface NodeContextInput {
  graph: KnowledgeGraph;
  node: GraphNode;
  /** Full file text, when the source endpoint could provide it. */
  source?: string | null;
  userNote?: string;
  userTags?: string[];
  localeKey: string;
}

/** Pick the slice of a file worth sending: the node's range (padded) or the file head. */
export function sourceExcerpt(source: string, lineRange?: [number, number]): { text: string; startLine: number; truncated: boolean } {
  const lines = source.split(/\r\n|\n|\r/);
  let start = 1;
  let end = Math.min(lines.length, MAX_SOURCE_LINES);
  if (lineRange) {
    start = Math.max(1, lineRange[0] - CONTEXT_PADDING);
    end = Math.min(lines.length, Math.max(lineRange[1] + CONTEXT_PADDING, start), start + MAX_SOURCE_LINES - 1);
  }
  let text = lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(5)}  ${l}`)
    .join("\n");
  let truncated = end < lines.length || start > 1;
  if (text.length > MAX_SOURCE_CHARS) {
    text = text.slice(0, MAX_SOURCE_CHARS);
    truncated = true;
  }
  return { text, startLine: start, truncated };
}

export function buildSystemPrompt(localeKey: string): string {
  const language = LANGUAGE_NAMES[localeKey] ?? "English";
  return [
    "You are a senior engineer helping a developer understand an unfamiliar codebase through an interactive knowledge-graph dashboard.",
    "Each conversation is about one graph node (a file, function, class, …). You receive its analyzer summary, its relationships, and source code with line numbers.",
    "Ground every claim in that context and cite file paths with line numbers (e.g. src/auth.ts:42). When the context is not enough to answer, say what is missing instead of guessing.",
    "Prefer clear explanations over restating code. Use Markdown; keep code blocks short.",
    `Answer in ${language} unless the user writes in another language.`,
  ].join("\n");
}

/** The context block sent as the first part of the first user message. */
export function buildNodeContext({ graph, node, source, userNote, userTags }: NodeContextInput): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  parts.push(`# Project\n${graph.project.name}${graph.project.description ? ` — ${graph.project.description}` : ""}`);

  const header = [`# Node: ${node.name}`, `- type: ${node.type}`, `- complexity: ${node.complexity}`];
  if (node.filePath) header.push(`- file: ${node.filePath}${node.lineRange ? `:${node.lineRange[0]}-${node.lineRange[1]}` : ""}`);
  if (node.tags.length) header.push(`- tags: ${node.tags.join(", ")}`);
  if (userTags?.length) header.push(`- my tags: ${userTags.join(", ")}`);
  header.push(`- summary: ${node.summary}`);
  if (node.languageNotes) header.push(`- language notes: ${node.languageNotes}`);
  parts.push(header.join("\n"));
  if (userNote?.trim()) parts.push(`# My notes on this node\n${userNote.trim()}`);

  const rel: string[] = [];
  for (const e of graph.edges) {
    if (rel.length >= MAX_NEIGHBORS) break;
    if (e.source !== node.id && e.target !== node.id) continue;
    const outgoing = e.source === node.id;
    const other = byId.get(outgoing ? e.target : e.source);
    if (!other) continue;
    const where = other.filePath ? ` (${other.filePath})` : "";
    rel.push(`- ${outgoing ? "→" : "←"} ${e.type} ${other.type} ${other.name}${where}: ${other.summary.slice(0, 160)}`);
  }
  if (rel.length) parts.push(`# Relationships (→ outgoing, ← incoming)\n${rel.join("\n")}`);

  if (source) {
    const { text, truncated } = sourceExcerpt(source, node.lineRange);
    parts.push(`# Source${truncated ? " (excerpt)" : ""} — ${node.filePath}\n\`\`\`\n${text}\n\`\`\``);
  }
  return parts.join("\n\n");
}

import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadGraph, SearchEngine, type GraphNode, type KnowledgeGraph } from "@understand-anything/core";
import type { LlmCaller } from "./llm.js";

const MAX_MATCHES = 8;
const MAX_SNIPPET_FILES = 3;
const MAX_SNIPPET_CHARS = 4000;
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

const ASK_SYSTEM_PROMPT =
  "You are answering a developer's question about a specific codebase. Use ONLY the context provided " +
  "below — project description, matched knowledge-graph nodes, and source snippets. If the context doesn't " +
  "contain enough information to answer confidently, say so plainly rather than guessing. Cite the relevant " +
  "file paths in your answer where helpful. Respond in plain text (light markdown is fine), not JSON.";

export interface AskResult {
  answer: string;
  citedNodes: Array<{ id: string; name: string; type: string; filePath?: string }>;
}

function safeReadSnippet(projectRoot: string, filePath: string): string | null {
  try {
    const abs = resolve(projectRoot, filePath);
    const rel = relative(projectRoot, abs);
    if (rel.startsWith("..") || rel === "") return null; // stay inside the project
    const stat = statSync(abs);
    if (!stat.isFile() || stat.size > MAX_SOURCE_FILE_BYTES) return null;
    const buffer = readFileSync(abs);
    if (buffer.includes(0)) return null; // binary
    return buffer.toString("utf8").slice(0, MAX_SNIPPET_CHARS);
  } catch {
    return null;
  }
}

function nodeContext(n: GraphNode): string {
  const parts = [`[${n.type}] ${n.name}`];
  if (n.filePath) parts.push(`(${n.filePath})`);
  if (n.summary) parts.push(`— ${n.summary}`);
  if (n.tags?.length) parts.push(`tags: ${n.tags.join(", ")}`);
  return parts.join(" ");
}

/**
 * Answers a free-form question about a project's already-analyzed codebase,
 * grounded in the persisted knowledge graph rather than the raw source tree —
 * this is what lets the dashboard's Ask panel work without re-scanning the
 * project on every question. Mirrors upstream's /understand-chat skill, just
 * reachable from the browser instead of a CLI.
 *
 * `selectedNodeIds` (from the dashboard's shared node-selection discovery —
 * see selection.js) are always included as grounding context, ahead of and
 * independent from whatever the free-text question happens to match via
 * SearchEngine — otherwise a question asked while looking at a specific file
 * silently ignores that the user is looking at it (see custom-tour's
 * nodeIds-scoped generation, which already treats an explicit selection as
 * authoritative; Ask previously had no equivalent).
 */
export async function askAboutProject(
  projectRoot: string,
  question: string,
  llmCall: LlmCaller,
  selectedNodeIds: string[] = [],
): Promise<AskResult> {
  const graph: KnowledgeGraph | null = loadGraph(projectRoot, { validate: false });
  if (!graph) {
    return {
      answer: "This project hasn't been analyzed yet — run understand_analyze_project first.",
      citedNodes: [],
    };
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const selectedNodes = selectedNodeIds
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => n !== undefined);
  const selectedIdSet = new Set(selectedNodes.map((n) => n.id));

  const engine = new SearchEngine(graph.nodes);
  const searchMatches = engine
    .search(question, { limit: MAX_MATCHES })
    .map((r) => byId.get(r.nodeId))
    .filter((n): n is GraphNode => n !== undefined && !selectedIdSet.has(n.id));

  const snippets: string[] = [];
  let snippetCount = 0;
  for (const n of [...selectedNodes, ...searchMatches]) {
    if (snippetCount >= MAX_SNIPPET_FILES || !n.filePath) continue;
    const content = safeReadSnippet(projectRoot, n.filePath);
    if (content) {
      snippets.push(`--- ${n.filePath} ---\n${content}`);
      snippetCount++;
    }
  }

  const prompt = `Project: ${graph.project.name}
Description: ${graph.project.description}
Languages: ${graph.project.languages.join(", ")}
Frameworks: ${graph.project.frameworks.join(", ")}

${selectedNodes.length ? `The developer currently has these node(s) selected/focused in the dashboard — treat them as the primary subject of the question unless the question clearly points elsewhere:\n${selectedNodes.map(nodeContext).join("\n")}\n\n` : ""}Matched knowledge-graph nodes for this question:
${searchMatches.map(nodeContext).join("\n") || (selectedNodes.length ? "(no additional strong matches beyond the selection above)" : "(no strong matches — answer from project description alone if possible)")}

${snippets.length ? `Source snippets:\n${snippets.join("\n\n")}\n\n` : ""}Question: ${question}`;

  const answer = await llmCall(ASK_SYSTEM_PROMPT, prompt, 1500);

  const citedNodes = [...selectedNodes, ...searchMatches];
  return {
    answer,
    citedNodes: citedNodes.map((n) => ({ id: n.id, name: n.name, type: n.type, ...(n.filePath ? { filePath: n.filePath } : {}) })),
  };
}

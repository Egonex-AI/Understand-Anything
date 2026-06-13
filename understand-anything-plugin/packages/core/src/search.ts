import MiniSearch from "minisearch";
import type { GraphNode } from "./types.js";

export interface SearchResult {
  nodeId: string;
  score: number; // 0 = perfect match, 1 = worst match
}

export interface SearchOptions {
  types?: GraphNode["type"][];
  limit?: number;
}

function coreTokenize(text: string): string[] {
  if (!text.trim()) return [];

  const tokens: string[] = [];

  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:,;()[\]{}'"]+/);

  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower.length >= 2 && /^[\x00-\x7F]+$/.test(lower)) {
      tokens.push(lower);
    }
  }

  const numbers = text.match(/\d{2,}/g);
  if (numbers) {
    for (const num of numbers) {
      tokens.push(num);
    }
  }

  return tokens;
}

const MINI_SEARCH_OPTIONS = {
  fields: ["name", "tags", "summary", "knowledgeMeta.content", "languageNotes"],
  storeFields: ["name", "type", "id"],
  tokenize: coreTokenize,
};

const SEARCH_BOOST: Record<string, number> = {
  name: 0.3,
  tags: 0.2,
  summary: 0.2,
  "knowledgeMeta.content": 0.2,
  languageNotes: 0.1,
};

export class SearchEngine {
  private miniSearch: MiniSearch;
  private nodes: GraphNode[];

  constructor(nodes: GraphNode[]) {
    this.nodes = nodes;
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS);
    this.miniSearch.addAll(
      nodes.map((n) => ({
        ...n,
        tags: (n.tags ?? []).join(" "),
        "knowledgeMeta.content": n.knowledgeMeta?.content ?? "",
        languageNotes: n.languageNotes ?? "",
      })),
    );
  }

  search(query: string, options?: SearchOptions): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = options?.limit ?? 50;

    const filter =
      options?.types && options.types.length > 0
        ? (doc: Record<string, unknown>) =>
            options.types!.includes(doc.type as GraphNode["type"])
        : undefined;

    const results = this.miniSearch.search(trimmed, {
      filter,
      boost: SEARCH_BOOST,
      prefix: true,
      fuzzy: 0.2,
    });

    // Normalize scores to 0-1 range (0 = perfect match, 1 = worst)
    const maxScore = results.length > 0 ? results[0].score : 1;

    return results.slice(0, limit).map((r) => ({
      nodeId: String(r.id),
      score: maxScore > 0 ? 1 - (r.score / maxScore) : 0,
    }));
  }

  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
    this.miniSearch = new MiniSearch(MINI_SEARCH_OPTIONS);
    this.miniSearch.addAll(
      nodes.map((n) => ({
        ...n,
        tags: (n.tags ?? []).join(" "),
        "knowledgeMeta.content": n.knowledgeMeta?.content ?? "",
        languageNotes: n.languageNotes ?? "",
      })),
    );
  }
}

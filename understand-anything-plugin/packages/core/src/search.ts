import Fuse, { type IFuseOptions } from "fuse.js";
import type { GraphNode } from "./types.js";

export interface SearchResult {
  nodeId: string;
  score: number; // 0 = perfect match, 1 = worst match
}

export interface SearchOptions {
  types?: GraphNode["type"][];
  limit?: number;
}

/**
 * Folds the Turkish dotted/dotless I pair before Fuse's own lowercasing.
 *
 * Locale-independent `toLowerCase()` maps "I" → "i" (not "ı") and "İ" → "i̇"
 * (i + combining dot, two code points), so a Turkish summary containing "IŞIK"
 * never matches a typed "ışık", and "İstek" matches "istek" only weakly.
 * "ı" and "İ" occur only in Turkic languages, so this is a no-op elsewhere.
 */
export function foldDottedI(value: string): string {
  return value.replace(/ı/g, "i").replace(/İ/g, "I");
}

const FUSE_OPTIONS: IFuseOptions<GraphNode> = {
  getFn: (node, path) => {
    const value = Fuse.config.getFn(node, path);
    if (typeof value === "string") return foldDottedI(value);
    if (Array.isArray(value)) return value.map(foldDottedI);
    return value;
  },
  keys: [
    { name: "name", weight: 0.4 },
    { name: "tags", weight: 0.3 },
    { name: "summary", weight: 0.2 },
    { name: "languageNotes", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  useExtendedSearch: true,
};

export class SearchEngine {
  private fuse: Fuse<GraphNode>;
  private nodes: GraphNode[];

  constructor(nodes: GraphNode[]) {
    this.nodes = nodes;
    this.fuse = new Fuse(nodes, FUSE_OPTIONS);
  }

  search(query: string, options?: SearchOptions): SearchResult[] {
    const trimmed = foldDottedI(query.trim());
    if (!trimmed) {
      return [];
    }

    const limit = options?.limit ?? 50;

    // Use extended search: join space-separated tokens with | (OR)
    // so "auth contrl" becomes "auth | contrl" — matches items containing either token
    const extendedQuery = trimmed.split(/\s+/).join(" | ");
    const rawResults = this.fuse.search(extendedQuery);

    let filtered = rawResults;
    if (options?.types && options.types.length > 0) {
      const allowedTypes = new Set(options.types);
      filtered = filtered.filter((r) => allowedTypes.has(r.item.type));
    }

    return filtered.slice(0, limit).map((r) => ({
      nodeId: r.item.id,
      score: r.score ?? 0,
    }));
  }

  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
    this.fuse = new Fuse(nodes, FUSE_OPTIONS);
  }
}

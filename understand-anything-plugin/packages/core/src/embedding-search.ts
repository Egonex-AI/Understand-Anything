import type { GraphNode } from "./types.js";
import type { SearchResult } from "./search.js";

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude or if the two vectors have
 * different lengths.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  // A length mismatch means the two vectors came from different embedding
  // models/dimensions — i.e. a stale or corrupt index, not a meaningful data
  // point. We swallow it as 0 (treated as "completely dissimilar") so callers
  // never see NaN or an overstated similarity. This is intentionally silent
  // here because cosineSimilarity is a pure helper invoked once per node per
  // query in search()'s hot loop and has no state to dedupe a warning.
  // TODO(follow-up): surface mismatches at the engine level (record the
  // expected dimension and warn-once / count skipped stored embeddings) so a
  // user re-running search after a model upgrade gets a signal instead of
  // quietly degraded recall.
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Semantic search engine using vector embeddings.
 * Stores pre-computed embeddings for graph nodes and performs
 * cosine similarity search against query embeddings.
 */
export class SemanticSearchEngine {
  private nodes: GraphNode[];
  private embeddings: Map<string, number[]>;

  constructor(nodes: GraphNode[], embeddings: Record<string, number[]>) {
    this.nodes = nodes;
    this.embeddings = new Map(Object.entries(embeddings));
  }

  hasEmbeddings(): boolean {
    return this.embeddings.size > 0;
  }

  addEmbedding(nodeId: string, embedding: number[]): void {
    this.embeddings.set(nodeId, embedding);
  }

  search(
    queryEmbedding: number[],
    options?: SemanticSearchOptions,
  ): SearchResult[] {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0;
    const typeFilter = options?.types;

    const scored: Array<{ nodeId: string; score: number }> = [];

    for (const node of this.nodes) {
      if (typeFilter && !typeFilter.includes(node.type)) continue;

      const embedding = this.embeddings.get(node.id);
      if (!embedding) continue;

      // If a stored embedding's length differs from queryEmbedding (e.g. a
      // persisted index from a prior model/dimension loaded alongside a fresh
      // query), cosineSimilarity returns 0, so the node is treated as fully
      // dissimilar rather than throwing or scoring spuriously high. See the
      // TODO in cosineSimilarity about surfacing these mismatches engine-side.
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity >= threshold) {
        scored.push({ nodeId: node.id, score: 1 - similarity });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit);
  }

  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
  }
}

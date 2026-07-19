import type { GraphNode } from "./types.js";
import type { SearchResult } from "./search.js";

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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
 * Cosine similarity when the query vector's magnitude is already known.
 * The query is constant across an entire search() sweep, so recomputing its
 * magnitude (and re-squaring every query component) per candidate node is
 * pure waste. Same arithmetic, same order as cosineSimilarity → bit-identical
 * results, but it skips the per-node magA loop.
 */
function cosineSimilarityWithQueryMag(
  query: number[],
  queryMag: number,
  vec: number[],
): number {
  if (queryMag === 0) return 0;
  let dot = 0;
  let magB = 0;
  for (let i = 0; i < query.length; i++) {
    dot += query[i] * vec[i];
    magB += vec[i] * vec[i];
  }
  magB = Math.sqrt(magB);
  if (magB === 0) return 0;
  return dot / (queryMag * magB);
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

    // Hoist the query magnitude out of the per-node loop — it's invariant.
    let queryMag = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      queryMag += queryEmbedding[i] * queryEmbedding[i];
    }
    queryMag = Math.sqrt(queryMag);

    for (const node of this.nodes) {
      if (typeFilter && !typeFilter.includes(node.type)) continue;

      const embedding = this.embeddings.get(node.id);
      if (!embedding) continue;

      const similarity = cosineSimilarityWithQueryMag(
        queryEmbedding,
        queryMag,
        embedding,
      );
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

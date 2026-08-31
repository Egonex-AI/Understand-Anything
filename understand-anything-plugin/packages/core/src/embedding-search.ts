import type { GraphNode } from "./types.js";
import type { SearchResult } from "./search.js";

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
}

/** Default dimension for `HashingEmbedder` vectors. Power of two for fast modulo. */
export const EMBEDDING_DIM = 256;

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

// A small English stopword list — common tokens that would otherwise dominate
// the hash buckets and dilute every node's signal.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
  "this", "to", "was", "were", "will", "with", "if", "but", "not", "so",
]);

/**
 * Tokenise text into normalised word tokens used by `HashingEmbedder`.
 *
 * 1. Splits on non-alphanumeric boundaries.
 * 2. Splits CamelCase identifiers (`AuthMiddleware` → `Auth`, `Middleware`).
 * 3. Lowercases.
 * 4. Drops tokens shorter than 2 characters and a small stopword list.
 *
 * This is sufficient for code-graph search where identifiers, summaries,
 * and tags carry most of the semantic signal.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  const out: string[] = [];

  // First, split on whitespace + punctuation
  const chunks = text.split(/[^A-Za-z0-9]+/);
  for (const chunk of chunks) {
    if (!chunk) continue;

    // Split each chunk on CamelCase boundaries:
    //   "AuthMiddleware" → ["Auth", "Middleware"]
    //   "HTTPSConnection" → ["HTTPS", "Connection"]  (run of caps treated as one)
    //   "loadJSON" → ["load", "JSON"]
    const parts = chunk
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/\s+/);

    for (const raw of parts) {
      const tok = raw.toLowerCase();
      if (tok.length < 2) continue;
      if (STOPWORDS.has(tok)) continue;
      out.push(tok);
    }
  }
  return out;
}

/** DJB2 string hash — fast, deterministic across browser and Node. */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit
  return hash >>> 0;
}

/**
 * Bag-of-words text embedder using the hashing trick + sub-linear TF + L2
 * normalisation. Fast, deterministic, and dependency-free — runs in both
 * Node and the browser.
 *
 * Two strings that share many tokens (even with different casing or word
 * order) produce similar vectors under cosine similarity. This is weaker
 * than a learned model but materially better than substring matching: a
 * query like "authentication" matches nodes whose `summary` mentions
 * "auth" or whose `tags` include `login`, not just nodes named "auth".
 */
export class HashingEmbedder {
  readonly dim: number;

  constructor(dim: number = EMBEDDING_DIM) {
    this.dim = dim;
  }

  /** Embed a string into a `dim`-dimensional L2-normalised vector. */
  embed(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vec;

    for (const tok of tokens) {
      const bucket = djb2(tok) % this.dim;
      vec[bucket] += 1;
    }

    // Sub-linear term frequency: sqrt damps very common tokens (e.g. when
    // the same identifier appears many times in a long summary).
    for (let i = 0; i < this.dim; i++) {
      if (vec[i] > 0) vec[i] = Math.sqrt(vec[i]);
    }

    // L2 normalise so cosine similarity reduces to a dot product.
    let mag = 0;
    for (let i = 0; i < this.dim; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < this.dim; i++) vec[i] /= mag;
    }
    return vec;
  }
}

/** Gather every text field on a node that's worth indexing for semantic search. */
function nodeText(node: GraphNode): string {
  const parts: string[] = [node.name];
  if (node.summary) parts.push(node.summary);
  if (node.languageNotes) parts.push(node.languageNotes);
  if (node.tags && node.tags.length > 0) parts.push(node.tags.join(" "));
  if (node.type) parts.push(node.type);
  return parts.join(" ");
}

/**
 * Embed every node into a vector keyed by node id. Used to seed
 * `SemanticSearchEngine` from a fully assembled knowledge graph.
 */
export function embedGraphNodes(
  nodes: GraphNode[],
  embedder: HashingEmbedder = new HashingEmbedder(),
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const node of nodes) {
    out[node.id] = embedder.embed(nodeText(node));
  }
  return out;
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

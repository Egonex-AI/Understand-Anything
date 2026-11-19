import type { GraphEdge, GraphNode } from "../types.js";
import { SearchEngine, type SearchOptions, type SearchResult } from "../search.js";
import {
  WORD_PREFIX,
  extractFeatures,
  extractQueryFeatures,
  nodeToFieldedText,
  toSparseVector,
  type FieldedText,
  type SparseVector,
} from "./embedder.js";
import { conceptsForTerms } from "./concepts.js";
import { STOPWORDS, tokenize } from "./text.js";

export type HybridMode = "hybrid" | "keyword" | "vector";

export interface HybridSearchOptions extends SearchOptions {
  /**
   * hybrid  – BM25 + semantic vector + fuzzy, fused (default)
   * keyword – BM25 + fuzzy only (no concept / n-gram vector channel)
   * vector  – semantic channels only (sparse vector + concept match)
   */
  mode?: HybridMode;
  /**
   * Pseudo-relevance feedback: expand the lexical query with terms typical of the
   * best hits. Default false — on the repo benchmark it helped one query set and
   * hurt the other, so it is opt-in.
   */
  feedback?: boolean;
  /**
   * Propagate relevance along graph edges (file ↔ its functions, imports, calls) so
   * containers and neighbours of a hit are surfaced with a `near:` reason. Default
   * false — on the repo benchmark it pushed files and siblings above the exact
   * target and lowered MRR, so it is opt-in (useful for "which file handles X?").
   */
  graphBoost?: boolean;
}

export interface HybridSearchResult extends SearchResult {
  /** Short human-readable reasons this node matched, e.g. `name: login`, `concept: auth`. */
  reasons: string[];
}

export interface HybridEngineConfig {
  /**
   * Hash buckets for the semantic vectors. Default 2^18: vectors are sparse so the size is
   * free, and a small space makes unrelated features collide by chance (≈1 in 5 docs at 4096).
   */
  dim?: number;
  /** Reciprocal-rank-fusion constant. Default 60. */
  rrfK?: number;
  /** Channel weights in the fusion. */
  weights?: { bm25?: number; vector?: number; concept?: number; fuzzy?: number };
  /** Strength of graph propagation (0 disables). Default 0.15. */
  graphAlpha?: number;
  /** Vector hits below this cosine are ignored. Default 0.06. */
  minCosine?: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const CHANNEL_DEPTH = 100;
/**
 * The concept channel is a vocabulary-mismatch fallback: when at least this many
 * nodes match the query lexically, the user's words are present in the graph and
 * broad shared concepts would only add noise (they are weak discriminators in a
 * domain where "graph", "file" or "parse" are in every other node).
 */
const CONCEPT_FALLBACK_BELOW = 5;
const PRF_DOCS = 5;
const PRF_TERMS = 6;
const PRF_TERM_WEIGHT = 0.3;
const PRF_MIN_CONFIDENCE = 0.3;
const MAX_REASONS = 3;
/** Fuse.js scores run 0 (exact) → 1; the fuzzy channel only rescues close matches such as typos. */
const FUZZY_MAX_SCORE = 0.7;

/** How strongly relevance flows across each edge type. */
const EDGE_FLOW: Record<string, number> = {
  contains: 1,
  calls: 0.7,
  inherits: 0.7,
  implements: 0.7,
  imports: 0.6,
  tested_by: 0.6,
  depends_on: 0.5,
};
const DEFAULT_EDGE_FLOW = 0.4;

interface Postings {
  docs: number[];
  vals: number[];
}

/**
 * Hybrid retrieval over a knowledge graph.
 *
 * Three channels are retrieved independently and fused with weighted
 * reciprocal-rank fusion:
 *   1. BM25 over stemmed, identifier-split words (field-weighted).
 *   2. A sparse semantic vector (word + bigram + char-trigram + software-concept
 *      features, IDF-weighted) — matches "login" to a node that talks about
 *      "JWT session tokens", and tolerates morphology ("authenticating").
 *   3. Fuse.js fuzzy match — typo tolerance.
 * Optional pseudo-relevance feedback then expands the lexical query with terms
 * that are characteristic of the best hits, and a graph step lets relevance flow
 * along edges so a file whose functions match the query is surfaced too.
 *
 * Everything is deterministic and runs offline in the browser, Node, or MCP.
 */
export class HybridSearchEngine {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private readonly dim: number;
  private readonly rrfK: number;
  private readonly weights: { bm25: number; vector: number; concept: number; fuzzy: number };
  private readonly graphAlpha: number;
  private readonly minCosine: number;

  private fuzzy: SearchEngine;
  private nodeIndex = new Map<string, number>();
  private docFeatures: Array<Map<string, number>> = [];
  private featureDf = new Map<string, number>();
  private vectors: SparseVector[] = [];
  private vecPostings = new Map<number, Postings>();
  private wordPostings = new Map<string, Postings>();
  private docLen: number[] = [];
  private avgLen = 1;
  private conceptPostings = new Map<string, Array<[number, number]>>();
  private docConceptCount: number[] = [];
  private nameKeys: string[] = [];
  private adjacency: Array<Array<[number, number]>> = [];

  constructor(nodes: GraphNode[], edges: GraphEdge[] = [], config: HybridEngineConfig = {}) {
    this.dim = config.dim ?? 1 << 18;
    this.rrfK = config.rrfK ?? 60;
    this.weights = {
      bm25: config.weights?.bm25 ?? 1,
      vector: config.weights?.vector ?? 0.8,
      concept: config.weights?.concept ?? 0.8,
      fuzzy: config.weights?.fuzzy ?? 0.5,
    };
    this.graphAlpha = config.graphAlpha ?? 0.15;
    this.minCosine = config.minCosine ?? 0.06;
    this.fuzzy = new SearchEngine([]);
    this.update(nodes, edges);
  }

  /** Replace the corpus and rebuild every index. */
  update(nodes: GraphNode[], edges: GraphEdge[] = this.edges): void {
    this.nodes = nodes;
    this.edges = edges;
    this.fuzzy = new SearchEngine(nodes);
    this.build();
  }

  /** Same as {@link update}; mirrors `SearchEngine.updateNodes`. */
  updateNodes(nodes: GraphNode[], edges?: GraphEdge[]): void {
    this.update(nodes, edges ?? this.edges);
  }

  get size(): number {
    return this.nodes.length;
  }

  // ───────────────────────────── indexing ─────────────────────────────

  private idf(feature: string): number {
    const n = this.nodes.length;
    const df = this.featureDf.get(feature) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private build(): void {
    const n = this.nodes.length;
    this.nodeIndex = new Map(this.nodes.map((node, i) => [node.id, i]));
    this.docFeatures = this.nodes.map((node) => extractFeatures(nodeToFieldedText(node)));

    this.featureDf = new Map();
    for (const feats of this.docFeatures) {
      for (const f of feats.keys()) this.featureDf.set(f, (this.featureDf.get(f) ?? 0) + 1);
    }

    // Semantic vectors + inverted index over hashed buckets.
    this.vectors = this.docFeatures.map((feats) => toSparseVector(feats, (f) => this.idf(f), this.dim));
    this.vecPostings = new Map();
    this.vectors.forEach((vec, d) => {
      for (let k = 0; k < vec.idx.length; k++) {
        let p = this.vecPostings.get(vec.idx[k]);
        if (!p) this.vecPostings.set(vec.idx[k], (p = { docs: [], vals: [] }));
        p.docs.push(d);
        p.vals.push(vec.val[k]);
      }
    });

    // BM25 postings over word features.
    this.wordPostings = new Map();
    this.docLen = new Array<number>(n).fill(0);
    this.docFeatures.forEach((feats, d) => {
      for (const [f, w] of feats) {
        if (!f.startsWith(WORD_PREFIX)) continue;
        const term = f.slice(WORD_PREFIX.length);
        let p = this.wordPostings.get(term);
        if (!p) this.wordPostings.set(term, (p = { docs: [], vals: [] }));
        p.docs.push(d);
        p.vals.push(w);
        this.docLen[d] += w;
      }
    });
    this.avgLen = n > 0 ? this.docLen.reduce((a, b) => a + b, 0) / n || 1 : 1;

    // Concept postings: which docs talk about which software concept, and how strongly.
    this.conceptPostings = new Map();
    this.docConceptCount = new Array<number>(n).fill(0);
    this.docFeatures.forEach((feats, d) => {
      for (const [f, w] of feats) {
        if (f.charCodeAt(0) !== 64 /* @ */) continue;
        const concept = f.slice(1);
        let list = this.conceptPostings.get(concept);
        if (!list) this.conceptPostings.set(concept, (list = []));
        list.push([d, w]);
        this.docConceptCount[d]++;
      }
    });

    this.nameKeys = this.nodes.map((node) => node.name.toLowerCase().trim());

    // Undirected weighted adjacency for graph propagation.
    this.adjacency = Array.from({ length: n }, () => [] as Array<[number, number]>);
    for (const e of this.edges) {
      const a = this.nodeIndex.get(e.source);
      const b = this.nodeIndex.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      const flow = EDGE_FLOW[e.type] ?? DEFAULT_EDGE_FLOW;
      this.adjacency[a].push([b, flow]);
      this.adjacency[b].push([a, flow]);
    }
  }

  // ───────────────────────────── channels ─────────────────────────────

  private bm25Idf(term: string): number {
    const n = this.nodes.length;
    const df = this.wordPostings.get(term)?.docs.length ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private bm25(terms: ReadonlyMap<string, number>): Float64Array {
    const scores = new Float64Array(this.nodes.length);
    for (const [term, qw] of terms) {
      const p = this.wordPostings.get(term);
      if (!p) continue;
      const idf = this.bm25Idf(term);
      for (let k = 0; k < p.docs.length; k++) {
        const d = p.docs[k];
        const tf = p.vals[k];
        const norm = tf + BM25_K1 * (1 - BM25_B + (BM25_B * this.docLen[d]) / this.avgLen);
        scores[d] += qw * idf * ((tf * (BM25_K1 + 1)) / norm);
      }
    }
    return scores;
  }

  private cosineScores(qVec: SparseVector): Float64Array {
    const scores = new Float64Array(this.nodes.length);
    for (let k = 0; k < qVec.idx.length; k++) {
      const p = this.vecPostings.get(qVec.idx[k]);
      if (!p) continue;
      const qv = qVec.val[k];
      for (let j = 0; j < p.docs.length; j++) scores[p.docs[j]] += qv * p.vals[j];
    }
    return scores;
  }

  /**
   * Concept channel: docs sharing a software concept with the query, scored by how
   * rare the concept is in this corpus (IDF) and discounted for docs that touch many
   * concepts (a specialised node beats a catch-all one).
   */
  private conceptScores(qTerms: readonly string[]): Float64Array {
    const scores = new Float64Array(this.nodes.length);
    const n = this.nodes.length;
    for (const [concept, support] of conceptsForTerms(qTerms)) {
      const list = this.conceptPostings.get(concept);
      if (!list) continue;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      for (const [d, w] of list) {
        scores[d] += (support * idf * Math.min(1.5, w)) / Math.sqrt(1 + this.docConceptCount[d]);
      }
    }
    return scores;
  }

  /** Indices of the best-scoring docs (score > floor), best first. */
  private topIndices(scores: Float64Array, floor: number, allowed?: Set<GraphNode["type"]>): number[] {
    const ids: number[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > floor && (!allowed || allowed.has(this.nodes[i].type))) ids.push(i);
    }
    ids.sort((a, b) => scores[b] - scores[a] || a - b);
    return ids.slice(0, CHANNEL_DEPTH);
  }

  // ───────────────────────────── search ─────────────────────────────

  search(query: string, options: HybridSearchOptions = {}): HybridSearchResult[] {
    const q = query.trim();
    if (!q || this.nodes.length === 0) return [];

    const limit = options.limit ?? 50;
    const mode: HybridMode = options.mode ?? "hybrid";
    const allowed = options.types?.length ? new Set(options.types) : undefined;
    const qTerms = tokenize(q);

    // Only stopwords / punctuation: nothing to rank on except fuzzy.
    if (qTerms.length === 0) {
      return this.fuzzy
        .search(q, { limit, types: options.types })
        .map((r) => ({ ...r, reasons: ["approximate name match"] }));
    }

    // Fuse ORs every word, so "where is login handled?" must not search for "where" / "is".
    const fuzzyQuery = q
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
      .join(" ");

    const queryTermWeights = new Map<string, number>();
    for (const t of qTerms) queryTermWeights.set(t, 1);

    const useBm25 = mode !== "vector";
    const useVector = mode !== "keyword";
    const useFuzzy = mode !== "vector";

    const channelLists = (bm25Terms: ReadonlyMap<string, number>) => {
      const lists: Array<{ ids: number[]; weight: number }> = [];
      let lexicalHits = 0;
      if (useBm25) {
        const bm25Ids = this.topIndices(this.bm25(bm25Terms), 0, allowed);
        lexicalHits = bm25Ids.length;
        lists.push({ ids: bm25Ids, weight: this.weights.bm25 });
      }
      if (useVector) {
        const qVec = toSparseVector(extractQueryFeatures(q, (t) => this.wordPostings.has(t)), (f) => this.idf(f), this.dim);
        lists.push({ ids: this.topIndices(this.cosineScores(qVec), this.minCosine, allowed), weight: this.weights.vector });
        // "vector" mode is the pure-semantic view, so it always includes concepts.
        if (mode === "vector" || lexicalHits < CONCEPT_FALLBACK_BELOW) {
          lists.push({ ids: this.topIndices(this.conceptScores(qTerms), 0, allowed), weight: this.weights.concept });
        }
      }
      if (useFuzzy) {
        const fuzzyIds = this.fuzzy
          .search(fuzzyQuery, { limit: CHANNEL_DEPTH, types: options.types })
          .filter((r) => r.score <= FUZZY_MAX_SCORE)
          .map((r) => this.nodeIndex.get(r.nodeId))
          .filter((i): i is number => i !== undefined);
        lists.push({ ids: fuzzyIds, weight: this.weights.fuzzy });
      }
      return lists;
    };

    let lists = channelLists(queryTermWeights);
    let relevance = this.fuse(lists);

    // Pseudo-relevance feedback: add terms typical of the strongest hits to the lexical query.
    const wantFeedback = options.feedback === true && useBm25;
    if (wantFeedback) {
      const expansion = this.feedbackTerms(relevance, queryTermWeights);
      if (expansion) {
        const expanded = new Map(queryTermWeights);
        for (const [t, w] of expansion) expanded.set(t, w);
        lists = channelLists(expanded);
        relevance = this.fuse(lists);
      }
    }

    // Exact name match always wins.
    const qLower = q.toLowerCase();
    for (let i = 0; i < this.nameKeys.length; i++) {
      if (this.nameKeys[i] === qLower) relevance.set(i, Math.min(1, (relevance.get(i) ?? 0) + 0.35));
    }

    // Graph propagation.
    const via = new Map<number, number>();
    const finalScores =
      options.graphBoost === true && this.graphAlpha > 0
        ? this.propagate(relevance, via, allowed)
        : relevance;

    // Drop weak tail hits: below an absolute floor, or far below the best hit.
    let best = 0;
    for (const v of finalScores.values()) if (v > best) best = v;
    const cutoff = Math.max(0.03, best * 0.2);
    const ranked = [...finalScores.entries()]
      .filter(([, s]) => s >= cutoff)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limit);

    return ranked.map(([i, s]) => ({
      nodeId: this.nodes[i].id,
      score: 1 - Math.min(1, Math.max(0, s)),
      reasons: this.explain(i, qTerms, via.get(i)),
    }));
  }

  /** Weighted reciprocal-rank fusion, normalised so "rank 1 in every channel" = 1. */
  private fuse(lists: Array<{ ids: number[]; weight: number }>): Map<number, number> {
    const out = new Map<number, number>();
    let max = 0;
    for (const { ids, weight } of lists) {
      max += weight / (this.rrfK + 1);
      ids.forEach((d, rank) => {
        out.set(d, (out.get(d) ?? 0) + weight / (this.rrfK + rank + 1));
      });
    }
    if (max > 0) for (const [d, s] of out) out.set(d, s / max);
    return out;
  }

  /** Terms over-represented in the top hits (Rocchio-style), as a small weighted expansion. */
  private feedbackTerms(
    relevance: Map<number, number>,
    queryTerms: ReadonlyMap<string, number>,
  ): Map<string, number> | null {
    const top = [...relevance.entries()].sort((a, b) => b[1] - a[1]).slice(0, PRF_DOCS);
    if (top.length === 0 || top[0][1] < PRF_MIN_CONFIDENCE) return null;

    const n = this.nodes.length;
    const scores = new Map<string, number>();
    for (const [d, rel] of top) {
      for (const [f, w] of this.docFeatures[d]) {
        if (!f.startsWith(WORD_PREFIX)) continue;
        const term = f.slice(WORD_PREFIX.length);
        if (queryTerms.has(term)) continue;
        const df = this.wordPostings.get(term)?.docs.length ?? 0;
        // Skip near-ubiquitous terms and singletons that only this doc has.
        if (df > Math.max(3, n * 0.3) || df < 2) continue;
        scores.set(term, (scores.get(term) ?? 0) + rel * Math.log1p(w) * this.bm25Idf(term));
      }
    }
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, PRF_TERMS);
    if (best.length === 0) return null;
    const maxScore = best[0][1];
    return new Map(best.map(([t, s]) => [t, PRF_TERM_WEIGHT * (s / maxScore)]));
  }

  /** One round of relevance flow along edges: s' = s + α·tanh(Σ flow·s_neighbor). */
  private propagate(
    base: Map<number, number>,
    via: Map<number, number>,
    allowed?: Set<GraphNode["type"]>,
  ): Map<number, number> {
    const out = new Map(base);
    const touched = new Set<number>(base.keys());
    for (const d of base.keys()) for (const [nb] of this.adjacency[d]) touched.add(nb);

    for (const i of touched) {
      if (allowed && !allowed.has(this.nodes[i].type)) continue;
      let sum = 0;
      let bestContribution = 0;
      let bestNeighbor = -1;
      for (const [nb, flow] of this.adjacency[i]) {
        const s = base.get(nb);
        if (!s) continue;
        const contribution = flow * s;
        sum += contribution;
        if (contribution > bestContribution) {
          bestContribution = contribution;
          bestNeighbor = nb;
        }
      }
      if (sum <= 0) continue;
      const boost = this.graphAlpha * Math.tanh(sum);
      out.set(i, Math.min(1, (out.get(i) ?? 0) + boost));
      if (bestNeighbor >= 0) via.set(i, bestNeighbor);
    }
    return out;
  }

  // ───────────────────────────── explanations ─────────────────────────────

  private fieldTerms(text: FieldedText): Array<[string, Set<string>]> {
    const set = (s: string | undefined, path = false) => new Set(tokenize(s ?? "", { path }));
    const tags = new Set<string>();
    for (const t of text.tags ?? []) for (const tok of tokenize(t)) tags.add(tok);
    return [
      ["name", set(text.name)],
      ["tags", tags],
      ["path", set(text.path, true)],
      ["summary", set(text.summary)],
      ["notes", set(text.notes)],
    ];
  }

  private explain(i: number, qTerms: readonly string[], viaNeighbor?: number): string[] {
    const node = this.nodes[i];
    const text = nodeToFieldedText(node);
    const fields = this.fieldTerms(text);
    const reasons: string[] = [];

    // Literal hits, grouped by the most important field they occur in.
    const unique = [...new Set(qTerms)];
    const byField = new Map<string, string[]>();
    const matchedTerms = new Set<string>();
    for (const term of unique) {
      for (const [field, terms] of fields) {
        if (terms.has(term)) {
          let arr = byField.get(field);
          if (!arr) byField.set(field, (arr = []));
          arr.push(term);
          matchedTerms.add(term);
          break;
        }
      }
    }
    for (const [field, terms] of byField) reasons.push(`${field}: ${terms.join(", ")}`);

    // Conceptual hits: shared software concept with no literal word in common.
    const docTerms = fields.flatMap(([f, s]) => (f === "path" ? [] : [...s]));
    const docConcepts = conceptsForTerms(docTerms);
    const unmatchedQuery = unique.filter((t) => !matchedTerms.has(t));
    const queryConcepts = conceptsForTerms(unmatchedQuery);
    const shared = [...queryConcepts.keys()].filter((c) => docConcepts.has(c));
    if (shared.length > 0) reasons.push(`concept: ${shared.slice(0, 2).join(", ")}`);

    if (viaNeighbor !== undefined) {
      reasons.push(`near: ${this.nodes[viaNeighbor].name}`);
    }
    if (reasons.length === 0) reasons.push("approximate match");
    return reasons.slice(0, MAX_REASONS);
  }

  // ───────────────────────────── more-like-this ─────────────────────────────

  /** Nodes whose content is most similar to the given node ("more like this"). */
  similarTo(nodeId: string, options: Pick<SearchOptions, "limit" | "types"> = {}): HybridSearchResult[] {
    const i = this.nodeIndex.get(nodeId);
    if (i === undefined) return [];
    const allowed = options.types?.length ? new Set(options.types) : undefined;
    const scores = this.cosineScores(this.vectors[i]);
    scores[i] = 0;

    const docConcepts = conceptsForTerms(
      this.fieldTerms(nodeToFieldedText(this.nodes[i])).flatMap(([f, s]) => (f === "path" ? [] : [...s])),
    );

    return this.topIndices(scores, this.minCosine, allowed)
      .slice(0, options.limit ?? 10)
      .map((j) => {
        const theirs = conceptsForTerms(
          this.fieldTerms(nodeToFieldedText(this.nodes[j])).flatMap(([f, s]) => (f === "path" ? [] : [...s])),
        );
        const shared = [...docConcepts.keys()].filter((c) => theirs.has(c));
        return {
          nodeId: this.nodes[j].id,
          score: 1 - Math.min(1, scores[j]),
          reasons: [shared.length ? `concept: ${shared.slice(0, 2).join(", ")}` : "similar wording"],
        };
      });
  }
}

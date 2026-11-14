import type { GraphNode } from "../types.js";
import { charNgrams, fnv1a, tokenize } from "./text.js";
import { conceptsForTerms } from "./concepts.js";

/** Text fields of a graph node that are searchable. */
export interface FieldedText {
  name?: string;
  path?: string;
  tags?: readonly string[];
  summary?: string;
  notes?: string;
}

/** How much each field contributes. A hit in the name is worth 3x one in the summary. */
export const FIELD_WEIGHTS = {
  name: 3,
  tags: 2,
  path: 1.2,
  summary: 1,
  notes: 0.5,
} as const;

/** Cap on knowledge-article body text pulled into the index. */
const MAX_CONTENT_CHARS = 600;

/** Flatten a GraphNode (including domain / knowledge metadata) into searchable fields. */
export function nodeToFieldedText(node: GraphNode): FieldedText {
  const noteParts: string[] = [];
  if (node.languageNotes) noteParts.push(node.languageNotes);
  const dm = node.domainMeta;
  if (dm) {
    if (dm.entities) noteParts.push(dm.entities.join(" "));
    if (dm.businessRules) noteParts.push(dm.businessRules.join(" "));
    if (dm.entryPoint) noteParts.push(dm.entryPoint);
  }
  const km = node.knowledgeMeta;
  if (km) {
    if (km.category) noteParts.push(km.category);
    if (km.content) noteParts.push(km.content.slice(0, MAX_CONTENT_CHARS));
  }
  return {
    name: node.name,
    path: node.filePath,
    tags: node.tags,
    summary: node.summary,
    notes: noteParts.join(" "),
  };
}

/** Prefix of the feature that is also used by the lexical (BM25) channel. */
export const WORD_PREFIX = "w:";

/**
 * Turn a document into weighted features:
 *   w:<stem>        word unigrams            (weight = field weight)
 *   b:<a>_<b>       adjacent word bigrams    (0.6 x)
 *   c:<tri>         char trigrams of words   (0.25 x, typo / morphology tolerance)
 *   @<concept>      software concepts        (0.8 x sqrt(support))
 */
export function extractFeatures(
  doc: FieldedText,
  /** When given, char trigrams are only emitted for terms this returns false for (typo / morphology fallback). */
  isKnownTerm?: (term: string) => boolean,
): Map<string, number> {
  const feats = new Map<string, number>();
  const add = (key: string, w: number) => feats.set(key, (feats.get(key) ?? 0) + w);

  const conceptTerms: string[] = [];

  const addField = (text: string | undefined, weight: number, isPath = false, countForConcepts = true) => {
    if (!text) return;
    const terms = tokenize(text, { path: isPath });
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      add(WORD_PREFIX + t, weight);
      if (i + 1 < terms.length) add(`b:${t}_${terms[i + 1]}`, weight * 0.6);
      if (!isKnownTerm || !isKnownTerm(t)) {
        for (const g of charNgrams(t)) add("c:" + g, weight * 0.25);
      }
      if (countForConcepts) conceptTerms.push(t);
    }
  };

  addField(doc.name, FIELD_WEIGHTS.name);
  for (const tag of doc.tags ?? []) addField(tag, FIELD_WEIGHTS.tags);
  addField(doc.path, FIELD_WEIGHTS.path, true, false);
  addField(doc.summary, FIELD_WEIGHTS.summary);
  addField(doc.notes, FIELD_WEIGHTS.notes);

  for (const [concept, support] of conceptsForTerms(conceptTerms)) {
    add("@" + concept, 0.8 * Math.sqrt(support));
  }
  return feats;
}

/**
 * Features of a free-text query. No field weighting: every query word counts the
 * same. Char trigrams are only added for words absent from the corpus vocabulary,
 * so exact vocabulary hits are not diluted by accidental sub-word overlaps while
 * typos and unseen inflections ("tolerant" vs "tolerance") still find neighbours.
 */
export function extractQueryFeatures(query: string, isKnownTerm?: (term: string) => boolean): Map<string, number> {
  return extractFeatures({ summary: query }, isKnownTerm);
}

/** Sparse vector, indices ascending. */
export interface SparseVector {
  idx: Int32Array;
  val: Float32Array;
}

/**
 * Hashing-trick projection of weighted features onto `dim` buckets, weighted by
 * IDF and L2-normalised. Signed hashing keeps collisions from biasing scores.
 */
export function toSparseVector(
  feats: ReadonlyMap<string, number>,
  idf: (feature: string) => number,
  dim: number,
): SparseVector {
  const acc = new Map<number, number>();
  for (const [feat, w] of feats) {
    const idx = fnv1a(feat) % dim;
    const sign = (fnv1a("~" + feat) & 1) === 1 ? 1 : -1;
    const v = Math.log1p(w) * idf(feat) * sign;
    acc.set(idx, (acc.get(idx) ?? 0) + v);
  }

  const entries = [...acc.entries()].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  let norm = 0;
  for (const [, v] of entries) norm += v * v;
  norm = Math.sqrt(norm) || 1;

  const idx = new Int32Array(entries.length);
  const val = new Float32Array(entries.length);
  entries.forEach(([i, v], k) => {
    idx[k] = i;
    val[k] = v / norm;
  });
  return { idx, val };
}

/** Cosine similarity of two L2-normalised sparse vectors (dot product via merge). */
export function sparseDot(a: SparseVector, b: SparseVector): number {
  let i = 0;
  let j = 0;
  let dot = 0;
  while (i < a.idx.length && j < b.idx.length) {
    if (a.idx[i] === b.idx[j]) dot += a.val[i++] * b.val[j++];
    else if (a.idx[i] < b.idx[j]) i++;
    else j++;
  }
  return dot;
}

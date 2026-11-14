/**
 * Text normalisation shared by the semantic search channels.
 *
 * Browser-safe: no Node.js imports. The dashboard bundles this module.
 */

/** Words that carry no retrieval signal in code-graph summaries or queries. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "has", "have", "how", "i", "if", "in", "is", "it", "its", "of", "on",
  "or", "that", "the", "their", "then", "there", "these", "this", "to", "was",
  "we", "what", "when", "where", "which", "who", "why", "will", "with", "you",
  "your", "our", "us", "into", "than", "also", "any", "all", "each", "other",
  "such", "via", "used", "uses", "use", "using", "about", "etc", "e", "g",
  "show", "find", "get", "me", "my", "should", "would", "could", "being",
  "been", "so", "not", "no", "but", "up", "out", "over", "per", "both",
]);

/** Path segments / extensions that appear in almost every file path. */
const PATH_NOISE: ReadonlySet<string> = new Set([
  "src", "lib", "index", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "md",
  "json", "main", "dist", "packages", "package",
]);

/**
 * Split an identifier or path into lowercase sub-words.
 * `getUserByID` → get user by id, `parse_file-path` → parse file path,
 * `HTTPServer2` → http server 2.
 */
export function splitIdentifier(input: string): string[] {
  const spaced = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

const DOUBLE_CONSONANT = /([^aeiou])\1$/;

/**
 * Deliberately conservative suffix stripper. It only has to be *consistent*
 * (the same function runs over documents and queries), not linguistically
 * perfect. Keeps words of length <= 3 intact.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;

  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ations")) w = w.slice(0, -1);
  if (w.endsWith("ization") && w.length > 8) return w.slice(0, -7) + "iz"; // matches "...ize" after silent-e removal
  if (w.endsWith("ation") && w.length > 6) return w.slice(0, -5) + "at"; // matches "...ate" after silent-e removal

  if (w.endsWith("ing") && w.length > 5) {
    let r = w.slice(0, -3);
    if (DOUBLE_CONSONANT.test(r)) r = r.slice(0, -1);
    return r;
  }
  if (w.endsWith("ed") && w.length > 4) {
    let r = w.slice(0, -2);
    if (DOUBLE_CONSONANT.test(r)) r = r.slice(0, -1);
    return r;
  }
  if (w.endsWith("ers") && w.length > 5) return w.slice(0, -1);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    w = w.slice(0, -1);
  }
  // Drop a trailing silent "e" so save/saved/saving and cache/cached/caching all
  // collapse to the same stem ("sav", "cach") — the stem only has to be consistent.
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export interface TokenizeOptions {
  /** Drop path/extension noise such as "src", "ts", "index". */
  path?: boolean;
  /** Keep stopwords (used when building char n-grams of names). */
  keepStopwords?: boolean;
}

/** Tokenise free text or an identifier into stemmed, stopword-free terms. */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  if (!text) return [];
  const out: string[] = [];
  // Split on whitespace/punctuation first, then split identifiers inside each chunk,
  // so "authenticateUser()" and "login flow" tokenise the same way.
  for (const chunk of text.split(/[\s,;:()[\]{}<>"'`!?|\\]+/)) {
    if (!chunk) continue;
    for (const part of splitIdentifier(chunk)) {
      if (!options.keepStopwords && STOPWORDS.has(part)) continue;
      if (options.path && PATH_NOISE.has(part)) continue;
      if (part.length === 1 && !/[0-9]/.test(part)) continue;
      out.push(stem(part));
    }
  }
  return out;
}

/** Character trigrams of a term, with boundary markers. */
export function charNgrams(term: string, n = 3): string[] {
  if (term.length < 4) return [];
  const padded = `^${term}$`;
  const grams: string[] = [];
  for (let i = 0; i + n <= padded.length; i++) grams.push(padded.slice(i, i + n));
  return grams;
}

/** FNV-1a 32-bit hash. Deterministic across platforms and runtimes. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

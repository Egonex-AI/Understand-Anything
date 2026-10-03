/**
 * Embedding-based semantic search over graph nodes. Node vectors are cached
 * in the data directory's `embeddings.json`, keyed by embedding endpoint +
 * model and by a hash of each node's text, so only new or changed nodes are
 * re-embedded after `/understand` updates the graph.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { embedTexts, loadAiConfig, resolveEmbeddingTarget, type AiConfig } from "./ai";

export const EMBEDDINGS_FILE = "embeddings.json";
const MAX_QUERY_CHARS = 1000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const RELATIVE_CUTOFF = 0.75;

interface EmbeddableNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  summary?: string;
  tags?: string[];
}

interface CacheFile {
  version: 1;
  /** `${baseUrl}|${model}` — vectors from different models are not comparable. */
  key: string;
  nodes: Record<string, { h: string; v: string }>;
}

export interface SemanticHit {
  nodeId: string;
  /** Cosine similarity, 1 = identical direction. */
  similarity: number;
}

/** The text a node is embedded from. */
export function nodeEmbeddingText(node: EmbeddableNode): string {
  return [
    `${node.type}: ${node.name}`,
    node.filePath ? `file: ${node.filePath}` : "",
    node.tags?.length ? `tags: ${node.tags.join(", ")}` : "",
    node.summary ?? "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

function hashText(text: string): string {
  return crypto.createHash("sha1").update(text).digest("base64").slice(0, 16);
}

// Float32 + base64 keeps the cache ~4x smaller than JSON number arrays.
export function encodeVector(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString("base64");
}

export function decodeVector(encoded: string): Float32Array {
  const buf = Buffer.from(encoded, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

function readCache(file: string, key: string): CacheFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CacheFile>;
    if (raw.version === 1 && raw.key === key && raw.nodes && typeof raw.nodes === "object") {
      return raw as CacheFile;
    }
  } catch {
    /* missing or corrupt — rebuild */
  }
  return { version: 1, key, nodes: {} };
}

function writeCache(file: string, cache: CacheFile): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, file);
}

function norm(v: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

function cosine(query: ArrayLike<number>, queryNorm: number, vec: ArrayLike<number>): number {
  if (queryNorm === 0 || vec.length !== query.length) return 0;
  let dot = 0;
  for (let i = 0; i < vec.length; i++) dot += query[i] * vec[i];
  const n = norm(vec);
  return n === 0 ? 0 : dot / (queryNorm * n);
}

type Embedder = (config: AiConfig, texts: string[]) => Promise<number[][]>;

// One indexing run per cache file at a time; concurrent searches share it.
const inflight = new Map<string, Promise<{ cache: CacheFile; embedded: number }>>();

/** Bring the cache up to date with the graph; returns how many nodes were (re-)embedded. */
export async function ensureIndex(
  dataDir: string,
  nodes: EmbeddableNode[],
  config: AiConfig,
  embed: Embedder = embedTexts,
): Promise<{ cache: CacheFile; embedded: number }> {
  const target = resolveEmbeddingTarget(config);
  if (!target) throw new Error("No embedding model configured");
  const file = path.join(dataDir, EMBEDDINGS_FILE);
  const running = inflight.get(file);
  if (running) return running;

  const run = (async () => {
    const cache = readCache(file, `${target.baseUrl}|${target.model}`);
    const wanted = new Map(nodes.map((n) => [n.id, nodeEmbeddingText(n)]));
    const stale: Array<{ id: string; text: string; h: string }> = [];
    for (const [id, text] of wanted) {
      const h = hashText(text);
      if (cache.nodes[id]?.h !== h) stale.push({ id, text, h });
    }
    let changed = false;
    for (const id of Object.keys(cache.nodes)) {
      if (!wanted.has(id)) {
        delete cache.nodes[id];
        changed = true;
      }
    }
    if (stale.length) {
      const vectors = await embed(config, stale.map((s) => s.text));
      stale.forEach((s, i) => {
        cache.nodes[s.id] = { h: s.h, v: encodeVector(vectors[i]) };
      });
      changed = true;
    }
    if (changed) writeCache(file, cache);
    return { cache, embedded: stale.length };
  })();
  inflight.set(file, run);
  try {
    return await run;
  } finally {
    inflight.delete(file);
  }
}

export async function semanticSearch(
  dataDir: string,
  nodes: EmbeddableNode[],
  query: string,
  config: AiConfig,
  options: { limit?: number; embed?: Embedder } = {},
): Promise<{ hits: SemanticHit[]; embedded: number; indexed: number }> {
  const embed = options.embed ?? embedTexts;
  const { cache, embedded } = await ensureIndex(dataDir, nodes, config, embed);
  const [queryVector] = await embed(config, [query]);
  const qNorm = norm(queryVector);
  const hits: SemanticHit[] = [];
  for (const [nodeId, entry] of Object.entries(cache.nodes)) {
    hits.push({ nodeId, similarity: cosine(queryVector, qNorm, decodeVector(entry.v)) });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  // Similarity scales differ per model, so cut relative to the best hit
  // instead of returning `limit` rows however unrelated they are.
  const floor = (hits[0]?.similarity ?? 0) * RELATIVE_CUTOFF;
  const relevant = hits.filter((h) => h.similarity > 0 && h.similarity >= floor);
  return { hits: relevant.slice(0, options.limit ?? DEFAULT_LIMIT), embedded, indexed: hits.length };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/** GET `/ai/semantic-search?q=…&limit=…` — the caller has checked the token. */
export async function handleSemanticSearchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  graphFile: string | null,
): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  if (!graphFile) return sendJson(res, 404, { error: "No knowledge graph found. Run /understand first." });
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return sendJson(res, 400, { error: "Missing q" });
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));
  const config = loadAiConfig();
  if (!resolveEmbeddingTarget(config)) return sendJson(res, 409, { error: "No embedding model configured" });
  try {
    const graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as { nodes?: EmbeddableNode[] };
    const result = await semanticSearch(path.dirname(graphFile), graph.nodes ?? [], query, config, { limit });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDINGS_FILE, decodeVector, encodeVector, ensureIndex, semanticSearch } from "../semantic";
import type { AiConfig } from "../ai";

const VOCAB = ["auth", "login", "password", "database", "query", "sql", "render", "button"];
/** Toy embedder: bag-of-words over a fixed vocabulary. */
function fakeEmbedder() {
  const calls: string[][] = [];
  const embed = async (_config: AiConfig, texts: string[]) => {
    calls.push(texts);
    return texts.map((t) => VOCAB.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)));
  };
  return { embed, calls };
}

const config: AiConfig = {
  protocol: "openai",
  baseUrl: "http://localhost:1/v1",
  apiKey: "",
  model: "m",
  embeddingModel: "e",
  embeddingBaseUrl: "",
  maxTokens: 0,
} as AiConfig;

const nodes = [
  { id: "a", type: "file", name: "auth.ts", summary: "Login and password checks" },
  { id: "b", type: "file", name: "db.ts", summary: "Database query helpers, SQL" },
  { id: "c", type: "function", name: "Button", summary: "Render a button" },
];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ua-sem-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("semantic search", () => {
  it("round-trips vectors through the base64 encoding", () => {
    expect(Array.from(decodeVector(encodeVector([0.5, -1, 2])))).toEqual([0.5, -1, 2]);
  });

  it("ranks nodes by similarity to the query", async () => {
    const { embed } = fakeEmbedder();
    const { hits, embedded, indexed } = await semanticSearch(dir, nodes, "where is the sql database code", config, { embed });
    expect(embedded).toBe(3);
    expect(indexed).toBe(3);
    expect(hits[0].nodeId).toBe("b");
    // Unrelated nodes fall below the cutoff relative to the best hit.
    expect(hits.map((h) => h.nodeId)).toEqual(["b"]);
  });

  it("only re-embeds new or changed nodes and drops removed ones", async () => {
    const { embed, calls } = fakeEmbedder();
    await ensureIndex(dir, nodes, config, embed);
    expect(calls[0]).toHaveLength(3);

    const changed = [{ ...nodes[0], summary: "Login, password and auth tokens" }, nodes[1]];
    const { embedded, cache } = await ensureIndex(dir, changed, config, embed);
    expect(embedded).toBe(1);
    expect(calls[1]).toHaveLength(1);
    expect(Object.keys(cache.nodes).sort()).toEqual(["a", "b"]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, EMBEDDINGS_FILE), "utf8"));
    expect(Object.keys(onDisk.nodes).sort()).toEqual(["a", "b"]);
  });

  it("rebuilds the index when the embedding model changes", async () => {
    const { embed, calls } = fakeEmbedder();
    await ensureIndex(dir, nodes, config, embed);
    const { embedded } = await ensureIndex(dir, nodes, { ...config, embeddingModel: "other" }, embed);
    expect(embedded).toBe(3);
    expect(calls).toHaveLength(2);
  });

  it("refuses without an embedding model", async () => {
    await expect(ensureIndex(dir, nodes, { ...config, embeddingModel: "" })).rejects.toThrow(/embedding/);
  });
});

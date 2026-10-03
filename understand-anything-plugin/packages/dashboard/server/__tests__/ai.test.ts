import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  embedTexts,
  emptyAiConfig,
  loadAiConfig,
  mergeAiConfig,
  publicAiConfig,
  resolveEmbeddingTarget,
  saveAiConfig,
  streamChat,
  type AiConfig,
} from "../ai";

let server: http.Server;
let baseUrl: string;
const seen: Array<{ url: string; auth?: string; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push({ url: req.url ?? "", auth: req.headers.authorization, body });
      if (req.url === "/v1/chat/completions") {
        res.setHeader("Content-Type", "text/event-stream");
        for (const piece of ["Hel", "lo"]) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      } else if (req.url === "/anthropic/v1/messages") {
        res.setHeader("Content-Type", "text/event-stream");
        const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } });
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Bon" } });
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "jour" } });
        ev("content_block_stop", { index: 0 });
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } });
        ev("message_stop", {});
        res.end();
      } else if (req.url === "/v1/embeddings") {
        const input = body.input as string[];
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: [t.length, i] })).reverse() }));
      } else {
        res.statusCode = 401;
        res.end("nope");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => server.close());

const config = (over: Partial<AiConfig> = {}): AiConfig => ({
  ...emptyAiConfig(),
  protocol: "openai",
  baseUrl,
  apiKey: "sk-test-123456789",
  model: "deepseek-chat",
  ...over,
});

describe("streamChat (openai protocol)", () => {
  it("streams deltas and sends the system prompt first", async () => {
    const deltas: string[] = [];
    const result = await streamChat(
      config(),
      { system: "be brief", messages: [{ role: "user", content: "hi" }] },
      { onDelta: (d) => deltas.push(d) },
      new AbortController().signal,
    );
    expect(deltas.join("")).toBe("Hello");
    expect(result.stopReason).toBe("stop");
    const req = seen.find((s) => s.url === "/v1/chat/completions")!;
    expect(req.auth).toBe("Bearer sk-test-123456789");
    expect(req.body.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(req.body.stream).toBe(true);
  });

  it("surfaces provider errors", async () => {
    await expect(
      streamChat(config({ baseUrl: `${baseUrl}/missing` }), { messages: [{ role: "user", content: "x" }] }, { onDelta: () => {} }, new AbortController().signal),
    ).rejects.toThrow(/HTTP 401/);
  });
});

describe("streamChat (anthropic protocol)", () => {
  it("streams text deltas through the SDK against a custom base URL", async () => {
    const deltas: string[] = [];
    const result = await streamChat(
      config({ protocol: "anthropic", baseUrl: baseUrl.replace(/\/v1$/, "/anthropic"), model: "glm-4.6" }),
      { system: "sys", messages: [{ role: "user", content: "hi" }] },
      { onDelta: (d) => deltas.push(d) },
      new AbortController().signal,
    );
    expect(deltas.join("")).toBe("Bonjour");
    expect(result.stopReason).toBe("end_turn");
    const req = seen.find((s) => s.url === "/anthropic/v1/messages")!;
    expect(req.body).toMatchObject({ model: "glm-4.6", system: "sys", max_tokens: 8192, stream: true });
    expect(req.body.fallbacks).toBeUndefined();
  });
});

describe("embeddings", () => {
  it("embeds in order through the chat endpoint by default", async () => {
    const vectors = await embedTexts(config({ embeddingModel: "text-embedding-3-small" }), ["a", "bbb", "cc"], 2);
    expect(vectors).toEqual([[1, 0], [3, 1], [2, 0]]);
  });

  it("needs an OpenAI-compatible endpoint", () => {
    expect(resolveEmbeddingTarget(config({ protocol: "anthropic", embeddingModel: "m" }))).toBeNull();
    expect(resolveEmbeddingTarget(config({ protocol: "anthropic", embeddingModel: "m", embeddingBaseUrl: "http://x/v1/" }))).toEqual({
      baseUrl: "http://x/v1",
      apiKey: "",
      model: "m",
    });
  });
});

describe("config", () => {
  it("never exposes the key and keeps it when the update leaves it blank", () => {
    const current = config();
    const pub = publicAiConfig(current);
    expect(JSON.stringify(pub)).not.toContain("sk-test-123456789");
    expect(pub.apiKeyHint).toBe("sk-…6789");
    expect(pub.configured).toBe(true);
    const next = mergeAiConfig(current, { model: "glm-4-plus", apiKey: "" });
    expect(next.apiKey).toBe("sk-test-123456789");
    expect(next.model).toBe("glm-4-plus");
    expect(mergeAiConfig(current, { clearApiKey: true }).apiKey).toBe("");
  });

  it("treats a keyless local endpoint (Ollama) as configured", () => {
    expect(publicAiConfig(config({ apiKey: "", baseUrl: "http://localhost:11434/v1" })).configured).toBe(true);
    expect(publicAiConfig(config({ apiKey: "" })).configured).toBe(true); // 127.0.0.1 mock
    expect(publicAiConfig(config({ apiKey: "", baseUrl: "https://api.openai.com/v1" })).configured).toBe(false);
  });

  it("persists outside the project with private permissions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ua-ai-"));
    process.env.UA_AI_CONFIG = path.join(dir, "nested", "ai.json");
    try {
      saveAiConfig(config());
      expect(loadAiConfig().model).toBe("deepseek-chat");
      if (process.platform !== "win32") {
        expect(fs.statSync(process.env.UA_AI_CONFIG).mode & 0o777).toBe(0o600);
      }
    } finally {
      delete process.env.UA_AI_CONFIG;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * "Ask AI" backend for the dashboard dev server: a small, provider-neutral
 * LLM proxy.
 *
 * Two wire protocols cover practically every vendor:
 *   - "openai"    — POST {baseUrl}/chat/completions (OpenAI, DeepSeek, GLM,
 *                   Qwen, Moonshot, OpenRouter, Ollama, vLLM, …)
 *   - "anthropic" — the Messages API through the official SDK, with an
 *                   optional baseUrl for Anthropic-compatible endpoints.
 *
 * The user's settings (incl. the API key) live in their home directory —
 * never in the analyzed project, where they could be committed — and the key
 * is never sent back to the browser.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import Anthropic from "@anthropic-ai/sdk";

export type AiProtocol = "openai" | "anthropic";

export interface AiConfig {
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0 / undefined = pick a default for the endpoint. */
  maxTokens?: number;
  /** OpenAI-compatible embeddings for semantic search (Anthropic has no embeddings API). */
  embeddingModel?: string;
  /** Defaults to baseUrl / apiKey when the chat endpoint is OpenAI-compatible. */
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
}

export interface PublicAiConfig extends Omit<AiConfig, "apiKey" | "embeddingApiKey"> {
  configured: boolean;
  apiKeyHint: string;
  embeddingApiKeyHint: string;
  embeddingsConfigured: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const OFFICIAL_ANTHROPIC = /^https:\/\/api\.anthropic\.com\/?$/;
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function aiConfigPath(): string {
  return process.env.UA_AI_CONFIG || path.join(os.homedir(), ".understand-anything", "ai.json");
}

export function emptyAiConfig(): AiConfig {
  return { protocol: "openai", baseUrl: "", apiKey: "", model: "" };
}

export function loadAiConfig(): AiConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(aiConfigPath(), "utf-8")) as Partial<AiConfig>;
    return { ...emptyAiConfig(), ...sanitizeConfig(raw) };
  } catch {
    return emptyAiConfig();
  }
}

export function saveAiConfig(config: AiConfig): void {
  const file = aiConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function sanitizeConfig(raw: Partial<Record<keyof AiConfig, unknown>>): Partial<AiConfig> {
  const out: Partial<AiConfig> = {};
  if (raw.protocol === "openai" || raw.protocol === "anthropic") out.protocol = raw.protocol;
  for (const key of ["baseUrl", "apiKey", "model", "embeddingModel", "embeddingBaseUrl", "embeddingApiKey"] as const) {
    if (key in raw) out[key] = str(raw[key]);
  }
  const maxTokens = Number(raw.maxTokens);
  if (Number.isInteger(maxTokens) && maxTokens >= 0 && maxTokens <= 1_000_000) out.maxTokens = maxTokens;
  return out;
}

function keyHint(key: string | undefined): string {
  if (!key) return "";
  return key.length <= 8 ? "••••" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export function publicAiConfig(config: AiConfig): PublicAiConfig {
  const { apiKey, embeddingApiKey, ...rest } = config;
  const embed = resolveEmbeddingTarget(config);
  return {
    ...rest,
    configured: Boolean(config.model && (config.apiKey || isLocalUrl(config.baseUrl))),
    apiKeyHint: keyHint(apiKey),
    embeddingApiKeyHint: keyHint(embeddingApiKey),
    embeddingsConfigured: embed !== null,
  };
}

/**
 * Merge a settings update. Blank secret fields keep the stored secret, so the
 * browser (which only ever sees a masked hint) can save other fields.
 */
export function mergeAiConfig(current: AiConfig, update: unknown): AiConfig {
  if (!update || typeof update !== "object") return current;
  const clean = sanitizeConfig(update as Record<string, unknown>);
  const next = { ...current, ...clean };
  if (!clean.apiKey) next.apiKey = current.apiKey;
  if (!clean.embeddingApiKey) next.embeddingApiKey = current.embeddingApiKey;
  if ((update as { clearApiKey?: unknown }).clearApiKey === true) next.apiKey = "";
  if ((update as { clearEmbeddingApiKey?: unknown }).clearEmbeddingApiKey === true) next.embeddingApiKey = "";
  return next;
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function defaultMaxTokens(config: AiConfig): number {
  if (config.maxTokens) return config.maxTokens;
  // Streaming lets the official API take a generous cap; third-party
  // endpoints often reject anything above ~8K.
  if (config.protocol === "anthropic" && (!config.baseUrl || OFFICIAL_ANTHROPIC.test(config.baseUrl))) return 64000;
  return 8192;
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
}

export interface StreamResult {
  stopReason: string | null;
  /** Set when an official-API refusal fallback answered instead of the configured model. */
  servedBy?: string;
}

/** Stream a chat completion from the configured provider. */
export async function streamChat(
  config: AiConfig,
  input: { system?: string; messages: ChatMessage[] },
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<StreamResult> {
  if (!config.model) throw new Error("No model configured");
  return config.protocol === "anthropic"
    ? streamAnthropic(config, input, callbacks, signal)
    : streamOpenAi(config, input, callbacks, signal);
}

async function streamAnthropic(
  config: AiConfig,
  input: { system?: string; messages: ChatMessage[] },
  { onDelta }: StreamCallbacks,
  signal: AbortSignal,
): Promise<StreamResult> {
  const client = new Anthropic({
    apiKey: config.apiKey || undefined,
    ...(config.baseUrl ? { baseURL: trimSlash(config.baseUrl) } : {}),
  });
  const params = {
    model: config.model,
    max_tokens: defaultMaxTokens(config),
    ...(input.system ? { system: input.system } : {}),
    messages: input.messages,
  };
  const official = !config.baseUrl || OFFICIAL_ANTHROPIC.test(config.baseUrl);
  // On the official API, let a policy decline be re-answered by a fallback
  // model instead of ending the turn (server-side, routed by refusal category).
  const stream = official && FALLBACK_MODELS.has(config.model)
    ? client.beta.messages.stream(
        { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as Parameters<
          typeof client.beta.messages.stream
        >[0],
        { signal },
      )
    : client.messages.stream(params, { signal });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onDelta(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  return {
    stopReason: final.stop_reason ?? null,
    ...(final.model && final.model !== config.model ? { servedBy: final.model } : {}),
  };
}

async function streamOpenAi(
  config: AiConfig,
  input: { system?: string; messages: ChatMessage[] },
  { onDelta }: StreamCallbacks,
  signal: AbortSignal,
): Promise<StreamResult> {
  if (!config.baseUrl) throw new Error("No base URL configured");
  const res = await fetch(`${trimSlash(config.baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      max_tokens: defaultMaxTokens(config),
      messages: [...(input.system ? [{ role: "system", content: input.system }] : []), ...input.messages],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Provider returned HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
  }

  let stopReason: string | null = null;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return { stopReason };
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
          error?: { message?: string };
        };
        if (parsed.error) throw new Error(parsed.error.message ?? "Provider error");
        const choice = parsed.choices?.[0];
        if (choice?.delta?.content) onDelta(choice.delta.content);
        if (choice?.finish_reason) stopReason = choice.finish_reason;
      } catch (err) {
        if (err instanceof SyntaxError) continue; // keep-alive / partial junk
        throw err;
      }
    }
  }
  return { stopReason };
}

/** Where embeddings go: an explicit embedding endpoint, else an OpenAI-compatible chat endpoint. */
export function resolveEmbeddingTarget(config: AiConfig): { baseUrl: string; apiKey: string; model: string } | null {
  if (!config.embeddingModel) return null;
  const baseUrl = config.embeddingBaseUrl || (config.protocol === "openai" ? config.baseUrl : "");
  if (!baseUrl) return null;
  const apiKey = config.embeddingApiKey || (config.embeddingBaseUrl ? "" : config.apiKey);
  return { baseUrl: trimSlash(baseUrl), apiKey, model: config.embeddingModel };
}

/** Embed texts through an OpenAI-compatible /embeddings endpoint, in batches. */
export async function embedTexts(config: AiConfig, texts: string[], batchSize = 64): Promise<number[][]> {
  const target = resolveEmbeddingTarget(config);
  if (!target) throw new Error("No embedding model configured");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch(`${target.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: target.model, input: batch }),
    });
    if (!res.ok) {
      throw new Error(`Embedding provider returned HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== batch.length) throw new Error("Embedding provider returned the wrong number of vectors");
    out.push(...rows.map((r) => r.embedding));
  }
  return out;
}

// ── HTTP handlers ─────────────────────────────────────────────────────────

export function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "null"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function isJsonRequest(req: IncomingMessage): boolean {
  return (req.headers["content-type"] ?? "").startsWith("application/json");
}

function validMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    out.push({ role, content });
  }
  return out[0].role === "user" ? out : null;
}

/**
 * Handle `/ai/config` (GET/PUT) and `/ai/chat` (POST, Server-Sent Events).
 * The caller has already checked the access token. Returns false for other paths.
 */
export async function handleAiRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname === "/ai/config") {
    if (req.method === "GET") {
      sendJson(res, 200, publicAiConfig(loadAiConfig()));
    } else if (req.method === "PUT") {
      if (!isJsonRequest(req)) return sendJson(res, 415, { error: "Expected application/json" }), true;
      try {
        const next = mergeAiConfig(loadAiConfig(), await readJsonBody(req));
        saveAiConfig(next);
        sendJson(res, 200, publicAiConfig(next));
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      sendJson(res, 405, { error: "Method not allowed" });
    }
    return true;
  }

  if (pathname === "/ai/chat") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" }), true;
    if (!isJsonRequest(req)) return sendJson(res, 415, { error: "Expected application/json" }), true;
    let body: { system?: unknown; messages?: unknown };
    try {
      body = ((await readJsonBody(req)) ?? {}) as typeof body;
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }), true;
    }
    const messages = validMessages(body.messages);
    if (!messages) return sendJson(res, 400, { error: "messages must be a user-first list of {role, content}" }), true;
    const config = loadAiConfig();
    if (!publicAiConfig(config).configured) return sendJson(res, 409, { error: "AI is not configured" }), true;

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    try {
      const result = await streamChat(
        config,
        { system: typeof body.system === "string" ? body.system : undefined, messages },
        { onDelta: (text) => send({ delta: text }) },
        controller.signal,
      );
      send({ done: true, ...result });
    } catch (err) {
      if (!controller.signal.aborted) send({ error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
    return true;
  }

  return false;
}

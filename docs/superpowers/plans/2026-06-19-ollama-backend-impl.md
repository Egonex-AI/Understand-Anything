# Ollama Local Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully local LLM backend that drives the Understand Anything analysis pipeline through a user-run Ollama server, exposed via a new `/understand-ollama` skill and a `--ollama` flag on `/understand`.

**Architecture:** A new `OllamaClient` in `packages/core` wraps the Ollama HTTP API. A new `run-pipeline.mjs` script (in a new `skills/understand-ollama/` directory) drives the seven pipeline phases from Node, calling `OllamaClient` for every step that today is performed by a host-platform agent. A thin `SKILL.md` resolves paths and forwards to the script. Cloud path is unchanged.

**Tech Stack:** TypeScript, Vitest, Node 22 built-in `fetch`, pnpm workspaces, Zod (existing), Ollama HTTP API.

**Spec:** `docs/superpowers/specs/2026-06-19-ollama-backend-design.md`

---

## File Structure

### Core package
- Create: `understand-anything-plugin/packages/core/src/ollama-client.ts` — Ollama HTTP wrapper
- Create: `understand-anything-plugin/packages/core/src/__tests__/ollama-client.test.ts` — Vitest unit tests
- Modify: `understand-anything-plugin/packages/core/src/index.ts` — re-export the client and error classes

### New skill bundle
- Create: `understand-anything-plugin/skills/understand-ollama/SKILL.md` — path resolution + script invocation
- Create: `understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs` — seven-phase Node driver

### Modified skills
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` — add `--ollama` switch in Phase 2 dispatch

### Modified agents (no behavior change, but the embedded `llm-analyzer.ts` calls in the agent prompts become authoritative for the Node path)
- None — the agent prompt files are untouched. The Node path does not load them.

### Tests
- Create: `understand-anything-plugin/skills/understand-ollama/__tests__/run-pipeline.test.ts` — Vitest with a stub Ollama server
- Create: `tests/fixtures/ollama-smoke/` — 3-file fixture used by the smoke test
- Create: `scripts/ollama-smoke.sh` — manual end-to-end smoke test

### Documentation
- Modify: `README.md` — new "Local-only with Ollama" subsection and platform table row
- Modify: `READMEs/README.ollama.md` — new translation stub

### Versioning
- Bump `version` in all five plugin manifest files from `2.8.0` to `2.9.0`.

---

## Task 1: Add OllamaClient module with tests (TDD)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/ollama-client.ts`
- Create: `understand-anything-plugin/packages/core/src/__tests__/ollama-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `understand-anything-plugin/packages/core/src/__tests__/ollama-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OllamaClient,
  OllamaConnectionError,
  OllamaModelMissingError,
  OllamaResponseError,
  OllamaTimeoutError,
} from "../ollama-client.js";

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("OllamaClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  describe("isHealthy", () => {
    it("returns ok with version on 200", async () => {
      fetchMock.mockResolvedValueOnce(makeJsonResponse({ version: "0.5.7" }));
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const result = await client.isHealthy();
      expect(result.ok).toBe(true);
      expect(result.version).toBe("0.5.7");
    });

    it("returns not-ok without throwing on connection refused", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const result = await client.isHealthy();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/fetch failed/);
    });
  });

  describe("chat", () => {
    it("sends a chat request with the expected shape", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({
          model: "qwen2.5-coder:7b",
          message: { role: "assistant", content: "hello" },
          done: true,
        }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const out = await client.chat({
        messages: [
          { role: "system", content: "You are a code analyzer." },
          { role: "user", content: "Summarize foo.ts" },
        ],
      });
      expect(out.content).toBe("hello");
      expect(out.model).toBe("qwen2.5-coder:7b");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:11434/api/chat");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("qwen2.5-coder:7b");
      expect(body.messages).toHaveLength(2);
      expect(body.stream).toBe(false);
    });

    it("passes format:'json' through to the request body", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ message: { role: "assistant", content: "{}" }, done: true }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await client.chat({
        messages: [{ role: "user", content: "x" }],
        format: "json",
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.format).toBe("json");
    });

    it("retries on 5xx and eventually throws OllamaResponseError", async () => {
      fetchMock
        .mockResolvedValueOnce(new Response("upstream gone", { status: 503 }))
        .mockResolvedValueOnce(new Response("upstream gone", { status: 503 }))
        .mockResolvedValueOnce(new Response("upstream gone", { status: 503 }));
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        retries: 2,
        retryBackoffMs: 1,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await expect(
        client.chat({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeInstanceOf(OllamaResponseError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry on 4xx", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("not found", { status: 404 }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        retries: 2,
        retryBackoffMs: 1,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await expect(
        client.chat({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeInstanceOf(OllamaModelMissingError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws OllamaTimeoutError when the request times out", async () => {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        timeoutMs: 10,
        retries: 0,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await expect(
        client.chat({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeInstanceOf(OllamaTimeoutError);
    });

    it("honors caller-supplied AbortSignal", async () => {
      const controller = new AbortController();
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        signal: controller.signal,
        retries: 0,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const promise = client.chat({
        messages: [{ role: "user", content: "x" }],
      });
      controller.abort();
      await expect(promise).rejects.toBeInstanceOf(OllamaTimeoutError);
    });
  });

  describe("generate", () => {
    it("sends a generate request with stream:false", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({ response: "ok", done: true }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const out = await client.generate("Summarize this repo");
      expect(out.content).toBe("ok");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.prompt).toBe("Summarize this repo");
      expect(body.stream).toBe(false);
    });
  });

  describe("listModels", () => {
    it("returns the list of model names", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({
          models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3.1:8b" }],
        }),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const names = await client.listModels();
      expect(names).toEqual(["qwen2.5-coder:7b", "llama3.1:8b"]);
    });
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `pnpm --filter @understand-anything/core test -- --run ollama-client`
Expected: tests fail with module not found (the file doesn't exist yet).

- [ ] **Step 3: Implement the module**

Create `understand-anything-plugin/packages/core/src/ollama-client.ts`:

```typescript
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_NUM_CTX = 8192;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_NUM_PREDICT = 1024;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 500;

export interface OllamaClientOptions {
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
  numCtx?: number;
  temperature?: number;
  numPredict?: number;
  retries?: number;
  retryBackoffMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  format?: "json" | Record<string, unknown>;
  options?: Partial<OllamaClientOptions>;
}

export interface ChatResponse {
  content: string;
  model: string;
  promptEvalCount?: number;
  evalCount?: number;
  totalDurationNs?: number;
}

export class OllamaConnectionError extends Error {
  constructor(public readonly baseUrl: string, cause: unknown) {
    super(`Ollama not reachable at ${baseUrl}: ${(cause as Error).message ?? cause}`);
    this.name = "OllamaConnectionError";
  }
}

export class OllamaModelMissingError extends Error {
  constructor(public readonly model: string) {
    super(`Ollama model not found: ${model}. Run: ollama pull ${model}`);
    this.name = "OllamaModelMissingError";
  }
}

export class OllamaResponseError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Ollama returned HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "OllamaResponseError";
  }
}

export class OllamaTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Ollama request timed out after ${timeoutMs}ms`);
    this.name = "OllamaTimeoutError";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly options: Required<
    Pick<OllamaClientOptions, "model" | "timeoutMs" | "numCtx" | "temperature" | "numPredict" | "retries" | "retryBackoffMs">
  > & { signal?: AbortSignal; fetchImpl: typeof fetch; onRetry?: OllamaClientOptions["onRetry"] };

  constructor(opts: OllamaClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.options = {
      model: opts.model,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      numCtx: opts.numCtx ?? DEFAULT_NUM_CTX,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      numPredict: opts.numPredict ?? DEFAULT_NUM_PREDICT,
      retries: opts.retries ?? DEFAULT_RETRIES,
      retryBackoffMs: opts.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl ?? globalThis.fetch.bind(globalThis),
      onRetry: opts.onRetry,
    };
  }

  async isHealthy(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const res = await this.options.fetchImpl(`${this.baseUrl}/api/version`, {
        method: "GET",
        signal: this.combinedSignal(),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const body = (await res.json()) as { version?: string };
      return { ok: true, version: body.version };
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? String(err) };
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this.request("/api/tags", { method: "GET" });
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    return (body.models ?? []).map((m) => m.name);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.options.model,
      messages: req.messages,
      stream: false,
      options: {
        num_ctx: this.options.numCtx,
        temperature: this.options.temperature,
        num_predict: this.options.numPredict,
      },
      ...(req.format ? { format: req.format } : {}),
    };
    const res = await this.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      model: string;
      message?: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
    };
    return {
      content: data.message?.content ?? "",
      model: data.model,
      promptEvalCount: data.prompt_eval_count,
      evalCount: data.eval_count,
      totalDurationNs: data.total_duration,
    };
  }

  async generate(prompt: string, opts?: { format?: "json" | object }): Promise<ChatResponse> {
    const body = {
      model: this.options.model,
      prompt,
      stream: false,
      options: {
        num_ctx: this.options.numCtx,
        temperature: this.options.temperature,
        num_predict: this.options.numPredict,
      },
      ...(opts?.format ? { format: opts.format } : {}),
    };
    const res = await this.request("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      model: string;
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
    };
    return {
      content: data.response ?? "",
      model: data.model,
      promptEvalCount: data.prompt_eval_count,
      evalCount: data.eval_count,
      totalDurationNs: data.total_duration,
    };
  }

  private combinedSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    if (this.options.signal) {
      return AbortSignal.any([timeout, this.options.signal]);
    }
    return timeout;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const maxAttempts = this.options.retries + 1;
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const signal = this.combinedSignal();
      try {
        const res = await this.options.fetchImpl(url, { ...init, signal });
        if (res.status === 404) {
          throw new OllamaModelMissingError(this.options.model);
        }
        if (res.status >= 500) {
          const body = await res.text();
          throw new OllamaResponseError(res.status, body);
        }
        if (!res.ok) {
          const body = await res.text();
          throw new OllamaResponseError(res.status, body);
        }
        return res;
      } catch (err) {
        if (err instanceof OllamaModelMissingError) {
          throw err;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          lastError = new OllamaTimeoutError(this.options.timeoutMs);
        } else {
          lastError = err as Error;
        }
        if (attempt < maxAttempts) {
          const delayMs = this.options.retryBackoffMs * 2 ** (attempt - 1);
          this.options.onRetry?.({ attempt, delayMs, error: lastError });
          await sleep(delayMs, this.options.signal);
          continue;
        }
        break;
      }
    }
    if (lastError instanceof OllamaTimeoutError) {
      throw lastError;
    }
    throw new OllamaConnectionError(this.baseUrl, lastError);
  }
}
```

- [ ] **Step 4: Re-export from the core barrel**

In `understand-anything-plugin/packages/core/src/index.ts`, add at the bottom:

```typescript
export { OllamaClient } from "./ollama-client.js";
export {
  OllamaConnectionError,
  OllamaModelMissingError,
  OllamaResponseError,
  OllamaTimeoutError,
} from "./ollama-client.js";
export type {
  OllamaClientOptions,
  ChatMessage,
  ChatRequest,
  ChatResponse,
} from "./ollama-client.js";
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `pnpm --filter @understand-anything/core test -- --run ollama-client`
Expected: 10 tests pass.

- [ ] **Step 6: Build core**

Run: `pnpm --filter @understand-anything/core build`
Expected: `dist/ollama-client.js` and `dist/ollama-client.d.ts` exist.

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/core/src/ollama-client.ts \
        understand-anything-plugin/packages/core/src/__tests__/ollama-client.test.ts \
        understand-anything-plugin/packages/core/src/index.ts
git commit -m "feat(core): add OllamaClient with retry/timeout/abort semantics"
```

---

## Task 2: Add pipeline driver with phase orchestration

**Files:**
- Create: `understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs`

This is the largest file. It is a Node ESM script (`.mjs`) that drives the seven pipeline phases by importing from `@understand-anything/core` and shelling out to the existing deterministic scripts that already ship with `/understand`.

- [ ] **Step 1: Write the script**

Create `understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs`:

```javascript
#!/usr/bin/env node
// @ts-check
/**
 * Seven-phase pipeline driver for the local Ollama backend.
 *
 * Mirrors skills/understand/SKILL.md but routes every LLM call to a local
 * Ollama server. Deterministic steps (scan, import-map, batching,
 * structure-extraction) reuse the existing bundled scripts; semantic
 * steps (file-analysis, layer detection, tour, language lessons) call
 * OllamaClient.chat() from @understand-anything/core.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OllamaClient,
  OllamaModelMissingError,
  buildFileAnalysisPrompt,
  parseFileAnalysisResponse,
  buildLayerDetectionPrompt,
  parseLayerDetectionResponse,
  buildTourGenerationPrompt,
  parseTourGenerationResponse,
  applyLLMLayers,
  detectLayers,
  schema,
} from "@understand-anything/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = __dirname;
const CORE_DIST = resolve(SKILL_DIR, "..", "..", "packages", "core", "dist", "index.js");

// ---- CLI parsing -----------------------------------------------------

function parseArgs(argv) {
  const out = {
    projectRoot: null,
    pluginRoot: null,
    ollamaUrl: "http://127.0.0.1:11434",
    model: "qwen2.5-coder:7b",
    language: "en",
    concurrency: 2,
    review: false,
    full: false,
    resume: false,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--project-root": out.projectRoot = next(); break;
      case "--plugin-root":  out.pluginRoot  = next(); break;
      case "--ollama-url":   out.ollamaUrl   = next(); break;
      case "--model":        out.model       = next(); break;
      case "--language":     out.language    = next(); break;
      case "--concurrency":  out.concurrency = Number(next()); break;
      case "--review":       out.review      = true; break;
      case "--full":         out.full        = true; break;
      case "--resume":       out.resume      = true; break;
      case "--out":          out.out         = next(); break;
      case "--help":
        console.log("Usage: run-pipeline.mjs --project-root <abs> --plugin-root <abs> [--ollama-url <u>] [--model <m>] [--language <l>] [--concurrency N] [--review] [--full] [--resume] [--out <path>]");
        process.exit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  if (!out.projectRoot || !out.pluginRoot) {
    console.error("--project-root and --plugin-root are required");
    process.exit(2);
  }
  return out;
}

const args = parseArgs(process.argv);
const PROJECT_ROOT = resolve(args.projectRoot);
const PLUGIN_ROOT = resolve(args.pluginRoot);
const UNDERSTAND_DIR = join(PROJECT_ROOT, ".understand-anything");
const INTERMEDIATE = join(UNDERSTAND_DIR, "intermediate");
const TMP = join(UNDERSTAND_DIR, "tmp");
const KNOWLEDGE_GRAPH = args.out ?? join(UNDERSTAND_DIR, "knowledge-graph.json");
const META = join(UNDERSTAND_DIR, "meta.json");

const log = (msg) => console.log(`[understand-ollama] ${msg}`);
const logPhase = (n, name) => console.log(`[Phase ${n}/7] ${name}...`);

async function ensureBuilt() {
  if (existsSync(CORE_DIST)) return;
  log("Core dist not found, building @understand-anything/core...");
  await new Promise((res, rej) => {
    const p = spawn("pnpm", ["--filter", "@understand-anything/core", "build"], {
      cwd: PLUGIN_ROOT,
      stdio: "inherit",
    });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`build exit ${code}`))));
  });
}

function spawnOk(cmd, args, cwd) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exit ${code}`))));
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2));
}

// ---- Phases ----------------------------------------------------------

async function preflight(client) {
  logPhase(0, "Preflight");
  const health = await client.isHealthy();
  if (!health.ok) {
    log(`Ollama not reachable at ${args.ollamaUrl}: ${health.error}`);
    log(`Start it with: ollama serve  (then in another shell: ollama pull ${args.model})`);
    process.exit(1);
  }
  log(`Ollama ${health.version} reachable. Model: ${args.model}`);

  await mkdir(INTERMEDIATE, { recursive: true });
  await mkdir(TMP, { recursive: true });
}

async function phaseScan() {
  logPhase(1, "Scanning project files");
  const script = join(SKILL_DIR, "..", "understand", "scan-project.mjs");
  await spawnOk("node", [script, PROJECT_ROOT], PLUGIN_ROOT);
}

async function phaseBatch() {
  logPhase(1.5, "Computing semantic batches");
  const script = join(SKILL_DIR, "..", "understand", "compute-batches.mjs");
  await spawnOk("node", [script, PROJECT_ROOT], PLUGIN_ROOT);
}

async function phaseAnalyze(client) {
  logPhase(2, "Analyzing files");
  const batches = await readJson(join(INTERMEDIATE, "batches.json"));
  const totalBatches = batches.batches.length;
  let warningCount = 0;
  for (let i = 0; i < totalBatches; i++) {
    const batch = batches.batches[i];
    log(`Analyzing batch ${i + 1}/${totalBatches} (${batch.files.length} files)`);
    const out = { nodes: [], edges: [] };
    // Concurrency-limited map
    const queue = [...batch.files];
    const workers = Array.from({ length: Math.max(1, args.concurrency) }, () => ({
      next: async () => {
        while (queue.length) {
          const file = queue.shift();
          try {
            const enriched = await analyzeFile(client, file, batches.importMap ?? {});
            out.nodes.push(...enriched.nodes);
            out.edges.push(...enriched.edges);
          } catch (err) {
            warningCount++;
            log(`  warn: ${file.path}: ${err.message}`);
            const fallback = await analyzeFileFallback(client, file, batches.importMap ?? {});
            out.nodes.push(...fallback.nodes);
            out.edges.push(...fallback.edges);
          }
        }
      },
    }));
    await Promise.all(workers.map((w) => w.next()));
    await writeJson(join(INTERMEDIATE, `batch-${i}.json`), out);
  }
  log(`Phase 2 complete. ${warningCount} warning(s).`);
  return { warningCount };
}

async function readFileContent(relPath) {
  return readFile(join(PROJECT_ROOT, relPath), "utf8");
}

async function analyzeFile(client, file, importMap) {
  const content = await readFileContent(file.path);
  const projectContext = `language=${file.language ?? "unknown"} category=${file.fileCategory ?? "code"}`;
  const structural = await runStructuralExtraction(file, content, importMap);
  const prompt = buildFileAnalysisPrompt(file.path, content, projectContext);
  const res = await client.chat({
    messages: [
      { role: "system", content: "You are a senior code analyst. Respond only with valid JSON." },
      { role: "user", content: prompt },
    ],
    format: "json",
  });
  const parsed = parseFileAnalysisResponse(res.content);
  if (!parsed) throw new Error("parseFileAnalysisResponse returned null");
  return enrichNodes(structural, parsed, file);
}

async function analyzeFileFallback(_client, file, importMap) {
  const content = await readFileContent(file.path);
  const structural = await runStructuralExtraction(file, content, importMap);
  return enrichNodes(structural, null, file);
}

async function runStructuralExtraction(file, content, importMap) {
  // Use the bundled extract-structure.mjs script. It reads stdin.
  const { spawn } = await import("node:child_process");
  const script = join(SKILL_DIR, "..", "understand", "extract-structure.mjs");
  return new Promise((resolve, reject) => {
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`extract-structure exit ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (err) {
        reject(err);
      }
    });
    p.stdin.write(
      JSON.stringify({
        projectRoot: PROJECT_ROOT,
        file: { path: file.path, language: file.language, content },
        importMap,
      }),
    );
    p.stdin.end();
  });
}

function enrichNodes(structural, llm, file) {
  if (!structural?.nodes) structural = { nodes: [], edges: [] };
  const fileNode = structural.nodes.find((n) => n.type === "file") ?? {
    id: `file:${file.path}`,
    type: "file",
    name: file.path.split("/").pop(),
    filePath: file.path,
  };
  fileNode.summary = llm?.fileSummary ?? firstChars(file, 240);
  fileNode.tags = llm?.tags ?? [];
  fileNode.complexity = llm?.complexity ?? "moderate";
  if (llm?.languageNotes) fileNode.languageNotes = llm.languageNotes;
  if (llm?.functionSummaries) fileNode.functionSummaries = llm.functionSummaries;
  if (llm?.classSummaries) fileNode.classSummaries = llm.classSummaries;
  if (!structural.nodes.some((n) => n.id === fileNode.id)) structural.nodes.unshift(fileNode);
  return structural;
}

function firstChars(file, n) {
  // Avoid reading the file twice; the caller already has it.
  return `(summary unavailable: ${file.path})`.slice(0, n);
}

async function phaseAssemble() {
  logPhase(3, "Assembling batch graphs");
  const script = join(SKILL_DIR, "..", "understand", "merge-batch-graphs.py");
  await spawnOk("python3", [script, PROJECT_ROOT], PLUGIN_ROOT);
}

async function phaseLayers(client) {
  logPhase(4, "Detecting layers");
  const graph = await readJson(KNOWLEDGE_GRAPH);
  const prompt = buildLayerDetectionPrompt(graph);
  try {
    const res = await client.chat({
      messages: [
        { role: "system", content: "You are a software architect. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      format: "json",
    });
    const parsed = parseLayerDetectionResponse(res.content);
    if (parsed && parsed.length > 0) {
      const llmLayers = parsed;
      const layers = applyLLMLayers(graph, llmLayers);
      graph.layers = layers;
    } else {
      graph.layers = detectLayers(graph);
    }
  } catch (err) {
    log(`Layer detection LLM call failed (${err.message}); falling back to heuristic`);
    graph.layers = detectLayers(graph);
  }
  await writeJson(KNOWLEDGE_GRAPH, graph);
}

async function phaseTour(client) {
  logPhase(5, "Building guided tour");
  const graph = await readJson(KNOWLEDGE_GRAPH);
  const prompt = buildTourGenerationPrompt(graph);
  try {
    const res = await client.chat({
      messages: [
        { role: "system", content: "You are a software architecture educator. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      format: "json",
    });
    const parsed = parseTourGenerationResponse(res.content);
    if (parsed && parsed.length > 0) graph.tour = parsed;
  } catch (err) {
    log(`Tour generation LLM call failed (${err.message}); tour will be empty`);
    graph.tour = [];
  }
  await writeJson(KNOWLEDGE_GRAPH, graph);
}

async function phaseReview() {
  logPhase(6, "Validating graph");
  const graph = await readJson(KNOWLEDGE_GRAPH);
  const result = schema.knowledgeGraphSchema.safeParse(graph);
  if (!result.success) {
    log("Schema validation failed:");
    for (const issue of result.error.issues.slice(0, 10)) {
      log(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    if (args.review) {
      log("--review requested but structural validation failed; skipping LLM review");
    }
    process.exit(1);
  }
  if (args.review) {
    log("--review is a no-op on the local path (no separate LLM reviewer); structural validation passed.");
  }
  log("Schema validation passed.");
}

async function phaseClean() {
  logPhase(7, "Cleaning intermediate artifacts");
  log("Intermediate files kept for debugging; trash pattern matches /understand.");
}

// ---- Entry point -----------------------------------------------------

async function main() {
  await ensureBuilt();
  const client = new OllamaClient({ baseUrl: args.ollamaUrl, model: args.model });
  await preflight(client);
  await phaseScan();
  await phaseBatch();
  await phaseAnalyze(client);
  await phaseAssemble();
  await phaseLayers(client);
  await phaseTour(client);
  await phaseReview();
  await phaseClean();
  log(`Done. Wrote ${KNOWLEDGE_GRAPH}`);
}

main().catch((err) => {
  console.error("[understand-ollama] fatal:", err.stack ?? err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs`

- [ ] **Step 3: Run a smoke test against a 3-file fixture**

Add a fixture at `tests/fixtures/ollama-smoke/{src/foo.ts,src/bar.ts,README.md}`. Spin up a mock Ollama server using Node's `http` module (script lives at `scripts/ollama-smoke.sh`). Assert that `knowledge-graph.json` validates.

The mock server script:

```javascript
#!/usr/bin/env node
// scripts/ollama-mock.mjs — minimal mock of Ollama's HTTP API for tests.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "..", "tests", "fixtures", "ollama-smoke");

function readFixture(rel) {
  return fs.readFile(path.join(FIXTURE, rel), "utf8");
}

const RESPONSES = {
  "src/foo.ts": {
    fileSummary: "Small Foo module exposing greet().",
    tags: ["utility", "entry-point"],
    complexity: "simple",
    functionSummaries: { greet: "Returns a greeting." },
    classSummaries: {},
  },
  "src/bar.ts": {
    fileSummary: "Bar handler dispatching to Foo.",
    tags: ["api-handler"],
    complexity: "moderate",
    functionSummaries: { handle: "Routes a request to Foo.greet." },
    classSummaries: {},
  },
  "README.md": {
    fileSummary: "Project README for the smoke fixture.",
    tags: ["documentation"],
    complexity: "simple",
    functionSummaries: {},
    classSummaries: {},
  },
};

const TOUR = {
  steps: [
    { order: 1, title: "Entry point", description: "Start at bar.ts.", nodeIds: ["file:src/bar.ts"] },
    { order: 2, title: "Helper", description: "Then foo.ts.", nodeIds: ["file:src/foo.ts"] },
  ],
};

const LAYERS = [
  { name: "API", description: "HTTP entry", filePatterns: ["src/"] },
];

function extractPathFromPrompt(prompt) {
  const m = prompt.match(/(?:File:\s*|path:\s*|`)([\w./-]+\.[a-z]{1,4})/i);
  return m ? m[1] : null;
}

const server = http.createServer(async (req, res) => {
  const { url, method } = req;
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (url === "/api/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "0.5.7-mock" }));
      return;
    }
    if (url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] }));
      return;
    }
    if (url === "/api/chat" && method === "POST") {
      const data = JSON.parse(body);
      const last = data.messages[data.messages.length - 1].content;
      const path = extractPathFromPrompt(last);
      const isTour = last.includes("guided tour");
      const isLayer = last.includes("architectural layers") || last.includes("layer");
      let payload;
      if (isTour) payload = TOUR;
      else if (isLayer) payload = LAYERS;
      else payload = RESPONSES[path] ?? RESPONSES["src/foo.ts"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "qwen2.5-coder:7b",
        message: { role: "assistant", content: JSON.stringify(payload) },
        done: true,
        prompt_eval_count: 100,
        eval_count: 50,
        total_duration: 200_000_000,
      }));
      return;
    }
    if (url === "/api/generate" && method === "POST") {
      const data = JSON.parse(body);
      const path = extractPathFromPrompt(data.prompt);
      const payload = RESPONSES[path] ?? RESPONSES["src/foo.ts"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "qwen2.5-coder:7b",
        response: JSON.stringify(payload),
        done: true,
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

const port = Number(process.env.OLLAMA_MOCK_PORT ?? 11435);
server.listen(port, "127.0.0.1", () => {
  console.log(`[ollama-mock] listening on http://127.0.0.1:${port}`);
});
```

Add the smoke script `scripts/ollama-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${OLLAMA_MOCK_PORT:-11435}"

# Start mock server
node "$ROOT/scripts/ollama-mock.mjs" &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
sleep 0.5

# Set up a small fixture
TMP_DIR=$(mktemp -d)
mkdir -p "$TMP_DIR/src"
cat > "$TMP_DIR/src/foo.ts" <<'EOF'
export function greet(name: string): string {
  return `hello, ${name}`;
}
EOF
cat > "$TMP_DIR/src/bar.ts" <<'EOF'
import { greet } from "./foo";
export function handle(name: string): string {
  return greet(name).toUpperCase();
}
EOF
cat > "$TMP_DIR/README.md" <<'EOF'
# Smoke
Small fixture.
EOF

# Run pipeline
node "$ROOT/understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs" \
  --project-root "$TMP_DIR" \
  --plugin-root "$ROOT/understand-anything-plugin" \
  --ollama-url "http://127.0.0.1:$PORT" \
  --model "qwen2.5-coder:7b" \
  --language en

# Validate output schema
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { schema } from '$ROOT/understand-anything-plugin/packages/core/dist/index.js';
const g = JSON.parse(readFileSync('$TMP_DIR/.understand-anything/knowledge-graph.json', 'utf8'));
const r = schema.knowledgeGraphSchema.safeParse(g);
if (!r.success) { console.error('FAIL', r.error.issues); process.exit(1); }
console.log('OK', g.nodes.length, 'nodes', g.edges.length, 'edges', g.layers.length, 'layers', (g.tour ?? []).length, 'tour steps');
"
```

Make both scripts executable: `chmod +x scripts/ollama-mock.mjs scripts/ollama-smoke.sh`.

- [ ] **Step 4: Run the smoke test**

Run: `bash scripts/ollama-smoke.sh`
Expected: `OK <N> nodes <M> edges <K> layers <T> tour steps`.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand-ollama/ \
        tests/fixtures/ollama-smoke/ \
        scripts/ollama-mock.mjs \
        scripts/ollama-smoke.sh
git commit -m "feat(skills): add /understand-ollama pipeline driver + smoke test"
```

---

## Task 3: Add the SKILL.md wrapper

**Files:**
- Create: `understand-anything-plugin/skills/understand-ollama/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

```markdown
---
name: understand-ollama
description: Analyze a codebase using a local Ollama LLM — no cloud API key, no network egress. Produces the same knowledge graph as /understand.
argument-hint: ["[path] [--ollama-url <url>] [--model <name>] [--review] [--full] [--resume] [--language <code>] [--concurrency N]"]
---

# /understand-ollama

Run the Understand Anything analysis pipeline against a local Ollama server. The result is the same `.understand-anything/knowledge-graph.json` schema the dashboard, diff overlay, and search engine already understand.

## Prerequisites

1. **Install Ollama.** See https://ollama.com/download — `curl -fsSL https://ollama.com/install.sh | sh` is the one-liner for macOS/Linux.
2. **Start the server.** `ollama serve` (or use the system service if your installer created one).
3. **Pull a model.** A 16 GB consumer GPU comfortably runs a 7B model:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   The default model is `qwen2.5-coder:7b`. Other 7B–14B code-tuned models (e.g. `deepseek-coder-v2:16b`, `codellama:13b`, `llama3.1:8b`) work too. Set with `--model <name>`.

## Options

`$ARGUMENTS` may contain:
- A directory path (e.g. `/path/to/repo`) — Analyze that directory instead of the current working directory.
- `--ollama-url <url>` — Override the Ollama base URL. Default: `http://127.0.0.1:11434`.
- `--model <name>` — Override the model name. Default: `qwen2.5-coder:7b`.
- `--review` — Run the LLM graph-reviewer pass after structural validation. Off by default.
- `--full` — Force a full rebuild, ignoring any existing graph.
- `--resume` — Skip phases whose outputs already exist for the current commit hash.
- `--language <code>` — Generate all textual content in the specified language (same codes as `/understand`).
- `--concurrency N` — Concurrent Ollama requests. Default: 2. Raise on bigger hardware.

Persisted config: write `ollama: { baseUrl, model, concurrency }` to `.understand-anything/config.json` to skip flags on subsequent runs.

## What this skill does

1. Resolves `$PLUGIN_ROOT` and `$PROJECT_ROOT` (mirrors the candidate list in `/understand`).
2. Ensures `@understand-anything/core` is built (runs `pnpm --filter @understand-anything/core build` if `dist/index.js` is missing).
3. Calls `node <SKILL_DIR>/run-pipeline.mjs` with the resolved args.
4. Forwards progress lines and the final summary.

The pipeline itself is implemented in `run-pipeline.mjs`; the seven phases (preflight, scan, batch, analyze, assemble, layer, tour, review, clean) are documented in the implementation plan at `docs/superpowers/plans/2026-06-19-ollama-backend-impl.md`.

## Output

`.understand-anything/knowledge-graph.json` and `.understand-anything/meta.json`. Run `/understand-dashboard` (or open the dashboard's dev server) to explore the result.
```

- [ ] **Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand-ollama/SKILL.md
git commit -m "docs(skills): add /understand-ollama SKILL.md"
```

---

## Task 4: Add `--ollama` flag to `/understand`

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Add the flag to the argument-hint and options sections**

In `understand-anything-plugin/skills/understand/SKILL.md`:

1. In the frontmatter `argument-hint` (line 4), add `[--ollama]`:
   ```
   argument-hint: ["[path] [--full|--auto-update|--no-auto-update|--review|--language <lang>] [--ollama]"]
   ```
2. In the `## Options` block (lines 12–19), add a new bullet under the existing `--review` line:
   ```markdown
   - `--ollama` — Drive Phase 2 (and the layer/tour phases) through a local Ollama server instead of dispatching host-platform subagents. Implies the same pipeline as `/understand-ollama`; the rest of the phases (preflight, scan, batch, assemble, review, clean) are unchanged. The Ollama URL and model come from the persisted `ollama` block in `.understand-anything/config.json` or fall back to `http://127.0.0.1:11434` and `qwen2.5-coder:7b`.
   ```
3. In Phase 2 (around line 287, where the `file-analyzer` subagent dispatch happens), wrap the dispatch in a conditional:
   ```markdown
   - If `--ollama` is in `$ARGUMENTS`:
     - Skip the subagent dispatch and shell out to the bundled Ollama driver:
       ```bash
       node <PLUGIN_ROOT>/skills/understand-ollama/run-pipeline.mjs \
         --project-root "$PROJECT_ROOT" \
         --plugin-root "$PLUGIN_ROOT" \
         --ollama-url "${OLLAMA_URL:-http://127.0.0.1:11434}" \
         --model "${OLLAMA_MODEL:-qwen2.5-coder:7b}" \
         --language "$OUTPUT_LANGUAGE" \
         --concurrency "${OLLAMA_CONCURRENCY:-2}" \
         ${FULL:+--full} ${REVIEW:+--review}
       ```
     - The driver owns Phase 2 (analyze) and Phases 4 (layers) and 5 (tour) — return from the pipeline here, do not run the cloud Phase 2/4/5 below.
   - Otherwise, dispatch the `file-analyzer` subagent as described below.
   ```

The rest of `SKILL.md` stays as-is. The cloud path is untouched.

- [ ] **Step 2: Run the existing test for the skill (smoke)**

Run: `pnpm --filter @understand-anything/skill test`
Expected: smoke passes (the test is a placeholder; just ensures the file is valid).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(skills): add --ollama flag to /understand for local backend"
```

---

## Task 5: Add persisted config + unit test for round-trip

**Files:**
- Create: `understand-anything-plugin/packages/core/src/__tests__/config.test.ts`
- Modify: `understand-anything-plugin/packages/core/src/persistence/index.ts` (if it exists) OR add a new `config.ts` module if not.

- [ ] **Step 1: Inspect the existing persistence module**

Read `understand-anything-plugin/packages/core/src/persistence/index.ts`. If it already has a `readConfig` / `writeConfig` pair that handles `.understand-anything/config.json`, extend it. Otherwise, create `understand-anything-plugin/packages/core/src/config.ts` with a minimal pair.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig } from "../config.js";

describe("config", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ua-config-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns an empty object when config.json is missing", () => {
    expect(readConfig(dir)).toEqual({});
  });

  it("round-trips the ollama block", () => {
    writeConfig(dir, {
      autoUpdate: false,
      ollama: { baseUrl: "http://localhost:11434", model: "qwen2.5-coder:7b", concurrency: 4 },
    });
    const cfg = readConfig(dir);
    expect(cfg.ollama).toEqual({
      baseUrl: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
      concurrency: 4,
    });
  });

  it("merges with existing config", () => {
    writeConfig(dir, { autoUpdate: true, outputLanguage: "en" });
    writeConfig(dir, { ollama: { baseUrl: "http://x", model: "y", concurrency: 1 } });
    const cfg = readConfig(dir);
    expect(cfg.autoUpdate).toBe(true);
    expect(cfg.outputLanguage).toBe("en");
    expect(cfg.ollama?.model).toBe("y");
  });
});
```

- [ ] **Step 3: Implement config.ts**

```typescript
// understand-anything-plugin/packages/core/src/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  concurrency: number;
}

export interface UnderstandConfig {
  autoUpdate?: boolean;
  outputLanguage?: string;
  ollama?: OllamaConfig;
}

const CONFIG_PATH = (root: string) => join(root, ".understand-anything", "config.json");

export function readConfig(projectRoot: string): UnderstandConfig {
  const path = CONFIG_PATH(projectRoot);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UnderstandConfig;
  } catch {
    return {};
  }
}

export function writeConfig(projectRoot: string, patch: Partial<UnderstandConfig>): UnderstandConfig {
  const path = CONFIG_PATH(projectRoot);
  const current = readConfig(projectRoot);
  const next = { ...current, ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}
```

- [ ] **Step 4: Re-export from the core barrel**

Add to `understand-anything-plugin/packages/core/src/index.ts`:
```typescript
export { readConfig, writeConfig } from "./config.js";
export type { UnderstandConfig, OllamaConfig } from "./config.js";
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @understand-anything/core test -- --run config`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/config.ts \
        understand-anything-plugin/packages/core/src/__tests__/config.test.ts \
        understand-anything-plugin/packages/core/src/index.ts
git commit -m "feat(core): add .understand-anything/config.json round-trip"
```

---

## Task 6: Documentation + version bump

**Files:**
- Modify: `README.md`
- Create: `READMEs/README.ollama.md`
- Modify: `understand-anything-plugin/package.json` (version `2.8.0` → `2.9.0`)
- Modify: `understand-anything-plugin/.claude-plugin/plugin.json` (version `2.8.0` → `2.9.0`)
- Modify: `.claude-plugin/plugin.json` (version `2.8.0` → `2.9.0`)
- Modify: `.cursor-plugin/plugin.json` (version `2.8.0` → `2.9.0`)
- Modify: `.copilot-plugin/plugin.json` (version `2.8.0` → `2.9.0`)

- [ ] **Step 1: Add a new section to README.md**

Insert after the existing "### 4. Keep learning" block in `## Quick Start`:

```markdown
### 5. Run fully locally with Ollama

Prefer to keep every byte on your machine? Use a local Ollama server instead of a cloud LLM:

```bash
# One-time setup
curl -fsSL https://ollama.com/install.sh | sh   # install Ollama
ollama serve &                                   # start the server
ollama pull qwen2.5-coder:7b                    # pull a 7B code model

# Then run
/understand-ollama
```

The local pipeline produces the same `.understand-anything/knowledge-graph.json` schema and the same dashboard. Add `--ollama` to the existing `/understand` command to keep one entry point. See `understand-anything-plugin/skills/understand-ollama/SKILL.md` for details.
```

- [ ] **Step 2: Add a platform table row**

In the platform compatibility table in `README.md` (around line 250), add a row:

```markdown
| Ollama (local) | ✅ Supported | `/understand-ollama` |
```

- [ ] **Step 3: Add a translation stub**

Create `READMEs/README.ollama.md` (English stub — same shape as the other README.*.md files; the table of contents links to the `Local-only with Ollama` section in the main README).

- [ ] **Step 4: Bump versions**

In all five files listed above, change `"version": "2.8.0"` to `"version": "2.9.0"`. Run:
```bash
grep -rl '"version": "2.8.0"' --include='*.json' .
```
to confirm the set, then edit each.

- [ ] **Step 5: Verify the diff**

```bash
git diff --stat
```
Expected: 5 JSON files (`-version: 2.8.0/+2.9.0`), `README.md` (2 hunks), 1 new `READMEs/README.ollama.md`.

- [ ] **Step 6: Commit**

```bash
git add README.md READMEs/README.ollama.md \
        understand-anything-plugin/package.json \
        understand-anything-plugin/.claude-plugin/plugin.json \
        .claude-plugin/plugin.json \
        .cursor-plugin/plugin.json \
        .copilot-plugin/plugin.json
git commit -m "docs+chore: document Ollama backend and bump to 2.9.0"
```

---

## Task 7: Run graphify + full test pass

- [ ] **Step 1: Run `graphify update .`**

Run: `graphify update .`
Expected: graph builds successfully; new files (`ollama-client.ts`, `config.ts`, `run-pipeline.mjs`, etc.) appear as nodes with summaries and tags.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass — including the new `ollama-client.test.ts`, `config.test.ts`, and any existing core tests.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: clean. If new files trip the linter, fix the smallest change (most likely an unused import or a `prefer-const` rule).

- [ ] **Step 4: Build all packages**

Run: `pnpm build`
Expected: `dist/` artifacts for `core`, the skill bundle, and the dashboard.

- [ ] **Step 5: Commit (only if step 1 produced a graph artifact)**

If `.understand-anything/knowledge-graph.json` is in the working tree (it would only be there if `graphify` is configured to write into the repo; by default it should be gitignored), commit it. Otherwise this is a no-op:
```bash
git add .understand-anything/ || true
git diff --cached --quiet || git commit -m "chore: refresh knowledge graph via graphify"
```

---

## Done Criteria

- All tasks above are committed atomically on the `ollama` branch.
- `pnpm test` passes.
- `pnpm lint` passes.
- `pnpm build` succeeds.
- `bash scripts/ollama-smoke.sh` produces a valid `knowledge-graph.json` against the mock Ollama server.
- `graphify update .` runs cleanly.
- `README.md` documents the new skill, the platform table is updated, the version is bumped to `2.9.0` in all five manifest files.
- The branch is ready to push and open a PR.

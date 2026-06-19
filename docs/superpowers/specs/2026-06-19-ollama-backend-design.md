# Ollama Local Backend Design Spec

## Overview

Add a fully local LLM backend that drives the Understand Anything analysis pipeline through a user-run Ollama server, so the plugin works end-to-end with no cloud LLM subscription, no API key, and no network egress from the host machine.

Today, every LLM call in the pipeline is performed by a host-platform agent (Claude Code, Cursor, Copilot, etc.) that loads the markdown agent definitions from `understand-anything-plugin/agents/`. The host picks the model; we have no control over it. We will add a parallel, host-agnostic pipeline path that calls a local Ollama HTTP server directly from Node scripts, reusing the same deterministic scaffolding (`packages/core`) so the resulting `.understand-anything/knowledge-graph.json` is byte-comparable to the cloud-driven output modulo the prose itself.

The result is a new `/understand-ollama` skill (and a `--ollama` flag on `/understand` for users who prefer a single entry point) that can be run on any host that has Node 22+ and an Ollama server reachable on `http://127.0.0.1:11434` (or any configured URL).

## Goals

- Drive all seven pipeline phases (preflight, scan, batch, analyze, assemble, tour, review, clean) from Node scripts, using Ollama as the LLM.
- Reuse existing `packages/core` analyzers (`llm-analyzer`, `layer-detector`, `tour-generator`, `language-lesson`) unchanged — they already separate prompt construction from response parsing.
- Add an `OllamaClient` to `packages/core` (browser-safe subpath) that handles chat/generate requests, retries, streaming, and structured-output extraction.
- Default to a model that runs on a 16 GB consumer GPU (e.g. `qwen2.5-coder:7b`); document model recommendations and the context-window trade-off.
- Keep the cloud-orchestrated path untouched. `--ollama` and `/understand-ollama` are additive.
- Emit the same `.understand-anything/knowledge-graph.json` schema so the existing dashboard reads the result without changes.

## Non-Goals

- Replacing the cloud-orchestrated agent pipeline. Both paths coexist.
- Building a generic LLM provider abstraction (Anthropic / OpenAI / Ollama / vLLM). The scope is Ollama only; the surface stays small enough that a second provider is a follow-up.
- GPU provisioning, model quantization, or model download UX. Ollama's own `ollama pull` is the install step; we just call it.
- Streaming into a TUI progress UI. The skill writes progress lines like the existing `SKILL.md` does.
- Replacing the dashboard. The output schema is unchanged.

---

## Module: OllamaClient

New file: `understand-anything-plugin/packages/core/src/ollama-client.ts`

Re-exported from the browser-safe subpath index so it is tree-shakable for the dashboard if a future surface needs it. The class wraps a fetchable Ollama HTTP API.

### API

```typescript
export interface OllamaClientOptions {
  baseUrl?: string;          // default "http://127.0.0.1:11434"
  model: string;             // e.g. "qwen2.5-coder:7b"
  timeoutMs?: number;        // default 120_000 per request
  numCtx?: number;           // default 8192
  temperature?: number;      // default 0.2 for structured output
  numPredict?: number;       // default 1024
  retries?: number;          // default 2 (total attempts = retries + 1)
  retryBackoffMs?: number;   // default 500, doubles per attempt
  signal?: AbortSignal;      // caller-supplied cancel
  fetchImpl?: typeof fetch;  // test injection point
  onRetry?: (info: { attempt: number; delayMs: number; error: Error }) => void;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  format?: "json" | Record<string, unknown>;  // Ollama structured output
  options?: Partial<OllamaClientOptions>;
}

export interface ChatResponse {
  content: string;
  model: string;
  promptEvalCount?: number;
  evalCount?: number;
  totalDurationNs?: number;
}

export class OllamaClient {
  constructor(options: OllamaClientOptions);
  chat(req: ChatRequest): Promise<ChatResponse>;
  generate(prompt: string, opts?: { format?: "json" | object }): Promise<ChatResponse>;
  listModels(): Promise<string[]>;
  isHealthy(): Promise<{ ok: boolean; version?: string; error?: string }>;
}
```

### Behavior

1. **Health check.** `isHealthy()` issues `GET <baseUrl>/api/version`. Returns `{ ok: true, version }` on 200, `{ ok: false, error }` otherwise. The skill calls this first and stops with a clear message on failure.
2. **Chat.** `chat()` issues `POST <baseUrl>/api/chat` with `{ model, messages, stream: false, options: { num_ctx, temperature, num_predict }, format }`. Returns the assembled `content` string from the last assistant message.
3. **Generate.** `generate()` issues `POST <baseUrl>/api/generate` with `{ model, prompt, stream: false, options, format }`. Used for short, single-prompt tasks like project narrative.
4. **Retries.** Transient failures (network error, HTTP 5xx, timeout) are retried with exponential backoff. JSON parse failures and HTTP 4xx are not retried — they indicate a prompt or model problem.
5. **Cancellation.** Caller-supplied `AbortSignal` is honored across the whole retry chain.
6. **Test injection.** `fetchImpl` lets the test suite supply a stub `fetch` for unit tests. The default uses the global `fetch` (Node 22 ships it).
7. **Streaming.** Out of scope for v1. `stream: false` is the only mode; the caller awaits the full response. The Ollama API keeps `stream: true` for a future PR.

### Error Model

```typescript
export class OllamaConnectionError extends Error { readonly baseUrl: string; }
export class OllamaModelMissingError extends Error { readonly model: string; }
export class OllamaResponseError extends Error { readonly status: number; readonly body: string; }
export class OllamaTimeoutError extends Error {}
```

`isHealthy()` returns `{ ok: false }` rather than throwing on connection refused — the skill wants a soft failure with a remediation hint.

---

## Module: Pipeline Driver

New file: `understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs`

A single Node entry point that drives phases 1–7 of the pipeline. The skill is a thin shell wrapper that resolves paths, prints progress lines, and invokes this script with arguments. The script reuses the existing `scan-project.mjs`, `extract-import-map.mjs`, `compute-batches.mjs`, `extract-structure.mjs`, and `merge-batch-graphs.py` from the bundled skill — it does not duplicate their deterministic work.

### CLI

```bash
node run-pipeline.mjs \
  --project-root <abs-path> \
  --plugin-root <abs-path> \
  --ollama-url http://127.0.0.1:11434 \
  --model qwen2.5-coder:7b \
  [--language en] \
  [--concurrency 2] \
  [--review] \
  [--full] \
  [--resume] \
  [--out <path>]
```

### Phases

| Phase | Driver | Reuses |
|------|--------|--------|
| 0 Preflight | inline | mirrors `skills/understand/SKILL.md` Phase 0 |
| 1 SCAN | shell out to `scan-project.mjs` | `bundled/scan-project.mjs` |
| 1.5 BATCH | shell out to `compute-batches.mjs` | `bundled/compute-batches.mjs` |
| 2 ANALYZE | inline loop over batches; calls `OllamaClient.chat()` per file | `core.extractStructure` for structural edges |
| 3 ASSEMBLE | shell out to `merge-batch-graphs.py` | `bundled/merge-batch-graphs.py` |
| 4 LAYERS | inline: prompt Ollama with `buildLayerDetectionPrompt` | `core.parseLayerDetectionResponse` |
| 5 TOUR | inline: prompt Ollama with `buildTourGenerationPrompt` | `core.parseTourGenerationResponse` |
| 6 REVIEW | inline: structural validation (always) + Ollama review (with `--review`) | existing `schema.ts` validators |
| 7 CLEAN | inline: mirrors the trash-and-purge pattern | — |

### Concurrency

Default 2 concurrent Ollama requests. A 7B model on a 16 GB GPU saturates around 1–2 concurrent prompts; we keep the default conservative and let the user raise it on bigger hardware. Each batch of files is processed sequentially within a worker; only file-level analysis within a batch runs concurrently.

### Per-File Analysis Flow (Phase 2)

For each file in a batch:

1. **Structural extraction** — invoke `core.extractStructure(filePath, content, language, projectContext)` (new thin wrapper around the existing `extract-structure.mjs`). This is what produces `nodes[]` and `edges[]` for the file deterministically.
2. **Semantic enrichment** — build the prompt with `core.buildFileAnalysisPrompt(filePath, content, projectContext)`. Call `OllamaClient.chat({ messages, format: "json" })`. Parse with `core.parseFileAnalysisResponse`.
3. **Merge** — attach `fileSummary`, `tags`, `complexity`, `functionSummaries`, `classSummaries`, `languageNotes` from the parsed LLM response onto the file node produced in step 1.
4. **Persist** — write the partial batch graph to `.understand-anything/intermediate/batch-<i>.json` immediately so the run is crash-resumable.

If the LLM call fails, fall back to a "best-effort" node: `summary` from the first 240 chars of the file, no tags, `complexity: "moderate"`, empty function summaries. The structural edges from step 1 are still preserved. The skill surfaces a warning count at the end.

### Output Schema

Identical to the existing pipeline: `.understand-anything/knowledge-graph.json` and `.understand-anything/meta.json`. The dashboard, the diff overlay, the search engine, and the chat skill all read the same shape.

### Resume

`--resume` reads the existing `meta.json` and skips phases whose outputs already exist with a matching `gitCommitHash`. Same as the cloud skill's incremental path.

---

## Skill: `/understand-ollama`

New directory: `understand-anything-plugin/skills/understand-ollama/`

```
understand-ollama/
├── SKILL.md
└── run-pipeline.mjs
```

`SKILL.md` is a short preamble (≤ 80 lines) that:

1. Tells the user to install Ollama (`curl -fsSL https://ollama.com/install.sh | sh`) and pull a model (`ollama pull qwen2.5-coder:7b`).
2. Resolves `$PLUGIN_ROOT` exactly like the existing `SKILL.md` (same candidate list, same precedence).
3. Resolves `$PROJECT_ROOT` from `$ARGUMENTS` or `cwd`, applies the worktree redirect.
4. Calls `node <SKILL_DIR>/run-pipeline.mjs` with the resolved args, including `--ollama-url` and `--model` from `$ARGUMENTS` (defaults baked in).
5. Forwards progress lines and the final summary to the user.

It does **not** re-implement any of the seven phases — all of that lives in the Node script.

### Argument Grammar

```
/understand-ollama [<path>] [--ollama-url <url>] [--model <name>] [--review] [--full] [--resume] [--language <code>] [--concurrency N>]
```

`--ollama-url` and `--model` are the two new flags. Everything else mirrors `/understand` so a user who knows one skill knows the other.

---

## Plugin-Level Flag: `--ollama` on `/understand`

Modify `understand-anything-plugin/skills/understand/SKILL.md` and the dispatch logic so that `--ollama` switches Phase 2 dispatch from "dispatch a subagent" to "shell out to `run-pipeline.mjs`". All other phases stay identical. The flag is a thin conditional inside the existing phase machine — the cloud path and the local path share preflight, ignore-config, scan, batch, assemble, review, and clean.

This is the path users take when they want a single command. The standalone `/understand-ollama` skill exists for users who want a small, dedicated entry point.

---

## Configuration Persistence

Add a section to `.understand-anything/config.json`:

```json
{
  "autoUpdate": false,
  "outputLanguage": "en",
  "ollama": {
    "baseUrl": "http://127.0.0.1:11434",
    "model": "qwen2.5-coder:7b",
    "concurrency": 2
  }
}
```

A new `--set-ollama` flag on `/understand` writes the `ollama` block without running analysis. The skill reads the persisted block before falling back to the URL/model CLI defaults.

---

## Testing Strategy

### Unit (Vitest)

- `ollama-client.test.ts` — stub `fetchImpl`, assert chat/generate request shape, retry on 5xx, no retry on 4xx, AbortSignal honored, JSON `format` passed through.
- `run-pipeline.test.ts` — fake Ollama responses per phase, assert per-file merge behavior, fallback summary on LLM failure, batch persistence on every file.
- `config.test.ts` — round-trip the `ollama` block in `config.json`.

### Integration (manual)

- `bash scripts/ollama-smoke.sh` — spins up an in-process mock Ollama server (using Node's `http`), runs `run-pipeline.mjs` against the `homepage/` test fixture (a small codebase already in this repo), asserts the produced `knowledge-graph.json` validates against the Zod schema in `core/src/schema.ts`.

### Fixture

A 200-line fixture (a stripped copy of `homepage/`) sits at `tests/fixtures/ollama-smoke/`. The mock Ollama server returns canned responses for a 3-file fixture, exercising the file-analyzer, layer-detector, and tour-generator prompts.

---

## Documentation

- New section in `README.md` under `## Quick Start` (third entry) titled `### Local-only with Ollama`. Six lines, ends with a link to the skill SKILL.md.
- New entry in the platform compatibility table: `Ollama (local) | ✅ Supported | /understand-ollama`.
- New `READMEs/README.ollama.md` translation stub (English) — same prose pattern as the other `README.*.md` files. Localized translations are out of scope for v1.

---

## Versioning

`understand-anything-plugin/package.json` and the four plugin manifest files (`understand-anything-plugin/.claude-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.copilot-plugin/plugin.json`) bump from `2.8.0` to `2.9.0`. Adding a new skill is a minor feature under the project's existing semver rhythm (the most recent two minor releases are 2.7 and 2.8).

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| 7B model produces invalid JSON for complex prompts | Prompt templates already use `format: "json"`; parsers return `null` on failure; the pipeline falls back to a best-effort node. |
| Local model is slower than cloud, user expects parity | Concurrency defaults to 2 (not 5); progress lines are explicit. Documented. |
| Ollama not running on the host | `isHealthy()` is the first call; the skill stops with `Ollama not reachable at <url>. Start it with: ollama serve`. |
| Model not pulled | `listModels()` is checked next; skill stops with `Model <name> not found. Run: ollama pull <name>`. |
| Output diverges from cloud output and breaks tests | The dashboard, schema, and search engine are content-agnostic. The fixture test asserts schema validity, not byte equality. |
| User has a tiny GPU and the model OOMs | Default model is `qwen2.5-coder:7b` (fits 16 GB). The `OllamaClientOptions.numCtx` defaults to 8192, not the model's full window, to stay conservative. The user can override. |
| `fetch` in Node 22 has subtle timeout semantics | We use `AbortSignal.timeout(timeoutMs)` plus caller-supplied `signal`. Both are tested. |
| Plugin built dist is stale on first run | `run-pipeline.mjs` triggers `pnpm --filter @understand-anything/core build` if `dist/index.js` is missing, mirroring the existing Phase 0.5 logic in `/understand`. |

---

## Out of Scope (Follow-up Issues)

- Streaming responses (Ollama supports NDJSON streaming; we use `stream: false` for v1).
- Multi-model routing (e.g. a small model for tagging, a bigger one for tours).
- Anthropic / OpenAI / vLLM provider abstraction.
- Embedding-based semantic search via local models (`embedding-search.ts` is currently empty for the local path).
- A TUI for live progress.

---
name: understand-ollama
description: Run the /understand analysis pipeline against a local Ollama server. Produces the same knowledge graph as /understand, with no cloud LLM and no API key.
argument-hint: ["[path] [--ollama-url <url>] [--model <name>] [--review] [--full] [--resume] [--language <code>] [--concurrency N]"]
---

# /understand-ollama

Run the Understand Anything analysis pipeline against a local Ollama server. The output — `.understand-anything/knowledge-graph.json` and `.understand-anything/meta.json` — is the same schema the dashboard, diff overlay, and search engine already understand. Use this when you want full local control, no API key, and no network egress from the host machine.

## Prerequisites

> **Note for Claude Code and Codex users:** Ollama also publishes [native integrations for Claude Code](https://docs.ollama.com/integrations/claude-code) and Codex that let you override the upstream model from inside the host platform. Those integrations are the lightest path on those two hosts. Use `/understand-ollama` instead if (a) you are on any other supported host (Cursor, Copilot, OpenCode, Kiro, Gemini CLI, etc.), (b) you want a guarantee that no prompt ever leaves the host machine, or (c) you are running in an air-gapped or vendor-restricted environment where managed platforms may still forward traffic.


1. **Install Ollama.** macOS / Linux:
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```
   See https://ollama.com/download for Windows and other platforms.

2. **Start the server.** The installer usually creates a system service that auto-starts. If not:
   ```bash
   ollama serve
   ```

3. **Pull a model.** A 7B code model is the sweet spot for a 16 GB consumer GPU. For a beefier workstation, `qwen3-coder:30b` produces noticeably more accurate tour and layer output:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```

   Other code-tuned models also work: `qwen3-coder:30b`, `codellama:13b`, `llama3.1:8b`, `deepseek-coder-v2:16b`. The 1.5B variants are useful for laptops or CI smoke tests but produce shallower tour summaries.

## Options

`$ARGUMENTS` may include:
- A directory path (e.g. `/path/to/repo`) — Analyze that directory instead of the current working directory.
- `--ollama-url <url>` — Ollama base URL. Default: `http://127.0.0.1:11434`.
- `--model <name>` — Model name. Default: `qwen2.5-coder:1.5b`.
- `--review` — Reserved for future use; the local path runs structural validation only.
- `--full` — Force a full rebuild, ignoring any existing graph.
- `--resume` — Reuse existing outputs where the commit hash matches.
- `--language <code>` — Generate the project description and tour prose in the specified language. Default: `en`.
- `--concurrency N` — Concurrent Ollama requests. Default: 2. Raise on bigger hardware.

Persisted config: write `ollama: { baseUrl, model, concurrency }` to `.understand-anything/config.json` to skip flags on subsequent runs.

## What this skill does

1. Resolves `$PLUGIN_ROOT` and `$PROJECT_ROOT` using the same candidate list as `/understand`:
   - `$CLAUDE_PLUGIN_ROOT` if set, else `$HOME/.understand-anything-plugin`, else the local checkout.
2. Ensures `@understand-anything/core` is built. If `packages/core/dist/index.js` is missing, runs `pnpm --filter @understand-anything/core build` once.
3. Calls `node <SKILL_DIR>/run-pipeline.mjs` with the resolved args. The driver owns all seven phases:
   - **Phase 0 Preflight** — verifies Ollama is reachable and the model is pulled.
   - **Phase 1 Scan** — runs the bundled `scan-project.mjs` and `extract-import-map.mjs`; uses Ollama for the project narrative (name, description, frameworks, languages).
   - **Phase 1.5 Batches** — runs the bundled `compute-batches.mjs`.
   - **Phase 2 Analyze** — for each batch, runs the bundled `extract-structure.mjs`, then uses Ollama to fill the per-file `summary` / `tags` / `complexity` / `languageNotes` / `functionSummaries` / `classSummaries` fields.
   - **Phase 3 Assemble** — runs the bundled `merge-batch-graphs.py` to combine batches into `assembled-graph.json`.
   - **Phase 4 Layers** — uses Ollama to identify logical layers; falls back to the heuristic detector on LLM failure.
   - **Phase 5 Tour** — uses Ollama to produce a guided tour.
   - **Phase 6 Review** — runs the dashboard's Zod schema validation; runs `build-fingerprints.mjs` for the auto-update baseline; writes the final `knowledge-graph.json` and `meta.json`.
   - **Phase 7 Done** — prints the output path.
4. Forwards progress lines and the final summary to the host.

The script is the single source of truth for the local pipeline; the seven phases are documented in `docs/superpowers/plans/2026-06-19-ollama-backend-impl.md`.

## Output

- `.understand-anything/knowledge-graph.json` — same schema as the cloud-driven path.
- `.understand-anything/meta.json` — includes the model name and Ollama URL used.
- `.understand-anything/fingerprints.json` — structural baseline for future auto-updates.

Run `/understand-dashboard` (or open the dashboard's dev server) to explore the result.

## Differences from the cloud path

- Project narrative, per-file enrichment, layer detection, and tour generation are issued directly to Ollama. The cloud path delegates them to host-platform subagents.
- `--review` runs structural validation only. The cloud path's `graph-reviewer` subagent is a host-platform LLM call; on the local path, structural issues are surfaced as warnings and the run continues.
- Concurrency is bounded by the local model's memory budget. The default is 2 concurrent requests; on a 16 GB GPU with a 7B model, raise to 3–4 only if you have headroom.
- The `qwen2.5-coder:1.5b` default is a fast, low-memory choice. It produces valid JSON via `format: "json"` and is sufficient for the smoke fixture in `tests/fixtures/ollama-smoke/`. For higher-quality tours and layers on real codebases, switch to `qwen2.5-coder:7b` or `qwen3-coder:30b`.

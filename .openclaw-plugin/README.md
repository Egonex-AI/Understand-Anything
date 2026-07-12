# Understand-Anything — OpenClaw Gateway Plugin

A native [OpenClaw](https://github.com/openclaw/openclaw) gateway plugin that runs the
Understand-Anything knowledge-graph pipeline **inside the gateway process** — no
Claude Code, no skill/Task-tool dispatch, no per-platform symlinks.

This is a deeper integration than the `install.sh openclaw` skill symlink (which
still works and is unaffected): the gateway itself gains analysis tools that any
connected agent can call mid-conversation, plus a dashboard route.

## What it registers

**Agent tools** (available to every agent connected to the gateway):

| Tool | Purpose |
| --- | --- |
| `understand_list_projects` | List configured projects + analyzed status and graph size |
| `understand_analyze_project` | Start background analysis: tree-sitter structural pass + one LLM call per file, persisted to the project's `.ua/` dir |
| `understand_status` | Poll a running analysis job / inspect the persisted graph's metadata |
| `understand_search` | Fuzzy-search graph nodes (names, tags, summaries) via `@understand-anything/core`'s SearchEngine |
| `understand_get_node` | Full node detail + incoming/outgoing edges with neighbor names |

**HTTP routes** (mounted on the gateway):

- `GET /understand-anything` — project picker
- `GET /understand-anything/open?project=<idx>` — starts (or reuses) a viewer
  instance for that project and redirects to its token-protected dashboard
  URL. Binds to 127.0.0.1 only.

  With an Anthropic API key configured, this serves **interactive-server.ts**
  instead of the plain upstream viewer: the identical dashboard + read-only
  JSON API, plus a floating "Ask" chat panel backed by a live LLM
  (`POST /ask.json`) — grounded in the persisted knowledge graph via
  `SearchEngine`, the same idea as upstream's `/understand-chat` skill, just
  reachable from the browser instead of a CLI. With no key configured, it
  falls back to the plain zero-LLM `understand-anything-viewer` unchanged.
  This split is deliberate: the standalone viewer's whole reason to exist is
  staying LLM-free for team-sharing, so that path is never modified — the
  interactive server is an additive, separate script that happens to reuse
  its static assets.

## How it works

The pipeline (`src/pipeline.ts`) is built entirely on `@understand-anything/core`'s
public API: `createIgnoreFilter` + `LanguageRegistry` for the walk,
`TreeSitterPlugin.analyzeFile` for deterministic structure,
`buildFileAnalysisPrompt`/`parseFileAnalysisResponse` +
`buildProjectSummaryPrompt`/`parseProjectSummaryResponse` for LLM enrichment,
`GraphBuilder` → `validateGraph` → `saveGraph`/`saveMeta` for persistence. The
LLM step is a single-turn structured-JSON call per file against the Anthropic
Messages API (`src/llm.ts`) — bounded by `concurrency` and `maxFiles`.

Output is byte-compatible with the rest of the ecosystem: the same
`.ua/knowledge-graph.json` the skills produce, and the same dashboard renders.

The Ask panel (`src/ask.ts`) works the same way at query time: `SearchEngine`
finds the graph nodes most relevant to the question, a bounded number of
their source files are read for grounding, and a single LLM call (the same
`llm.ts` caller used for analysis) answers using only that context — no
re-scanning the project per question. `src/interactive-server.ts` is a
distinct server from `understand-anything-viewer` (same static dashboard
build + JSON API, reused read-only) that adds the `/ask.json` endpoint and
injects a small vanilla-JS chat widget (`src/ask-widget.js`, no build step)
into the served `index.html`.

## Install

From the repo root:

```bash
pnpm install
pnpm --filter @understand-anything/openclaw-plugin build
pnpm --filter understand-anything-viewer build   # embeds the dashboard for the /understand-anything route
```

Then in your `~/.openclaw/openclaw.json`:

```jsonc
{
  "plugins": {
    "load": { "paths": ["/path/to/Understand-Anything/.openclaw-plugin"] },
    "entries": {
      "understand-anything": {
        "enabled": true,
        "config": {
          "projects": ["/abs/path/to/project-a", "/abs/path/to/project-b"],
          "model": "claude-sonnet-5",        // optional
          "concurrency": 5,                   // optional
          "maxFiles": 400,                    // optional
          "anthropicApiKey": "sk-ant-..."    // optional; falls back to ANTHROPIC_API_KEY on the gateway process
        }
      }
    }
  }
}
```

Restart the gateway. Then, from any agent session:

```
understand_analyze_project { "project": "0" }
understand_status
understand_search { "query": "session management" }
```

Open `/understand-anything` in a browser to view the dashboard. With an API
key configured (as above), you'll see a floating chat button — ask it
anything about the analyzed codebase and it answers grounded in the graph.

## Security notes

- Analysis and serving are restricted to the configured `projects` allowlist.
- The dashboard viewer inherits upstream's security model: 127.0.0.1 bind,
  per-instance random access token, graph-derived file allowlist, 1 MB/no-binary
  caps on source preview.
- The API key is only read from plugin config or the gateway process env; it is
  never written to disk by the plugin. It's passed to the interactive server
  subprocess via an environment variable, never a CLI arg (CLI args are
  visible in `ps`; env vars of a process you own are not).
- `/ask.json` requires the same per-instance access token as the graph/file
  endpoints (sent as `X-Ask-Token` instead of a query param, since it's a
  POST body, not a GET link) and only ever reads files already listed in the
  persisted knowledge graph, same as `/file-content.json`.

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
- `GET /understand-anything/open?project=<idx>` — starts (or reuses) a
  `understand-anything-viewer` instance for that project and redirects to its
  token-protected dashboard URL. The viewer binds to 127.0.0.1 only.

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

## Security notes

- Analysis and serving are restricted to the configured `projects` allowlist.
- The dashboard viewer inherits upstream's security model: 127.0.0.1 bind,
  per-instance random access token, graph-derived file allowlist, 1 MB/no-binary
  caps on source preview.
- The API key is only read from plugin config or the gateway process env; it is
  never written to disk by the plugin.

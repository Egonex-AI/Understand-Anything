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
| `understand_analyze_pr` | Resolve a PR's (or branch diff's) changed files, compute the blast radius against the persisted graph, and generate an LLM-narrated PR walkthrough tour |

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

  Unanalyzed projects get an **"Understand this project" button** right on
  this page — no need to go find the tool call. Already-analyzed ones get a
  **"Re-analyze"** button (analysis is always a full, fresh re-run — never
  incremental — so this is also how you reset a project's tours/summaries to
  whatever the pipeline currently produces as it improves). With
  `allowAddProject: true` (see Install below), the picker also gets an
  **"Add a project"** form: paste a `https://github.com/owner/repo` URL
  (shallow-cloned into `~/.local/share/understand-anything-plugin/clones`) or
  an existing local path, and it's added to the list and analysis starts
  immediately.

  With an API key configured, the dashboard also gets a **"Tours" panel**
  (🧭 button): every analyzed project gets two tours automatically —
  a free, deterministic **module walkthrough** (dependency order, also
  synced into the standard `graph.tour` field so upstream's own Learn
  persona/LearnPanel plays it with zero changes) and an LLM-narrated
  **code-review walkthrough** ranking the highest-risk files by complexity
  and how central they are in the dependency graph. You can also select node(s)
  in the graph canvas and type a prompt to generate a **custom tour** scoped
  to just what you picked (e.g. "walk me through the auth flow"), or enter a
  PR number or base branch to generate a **PR walkthrough**
  (`POST /generate-pr-tour.json`, also callable directly as the
  `understand_analyze_pr` tool): the changed files are resolved via `gh pr diff`
  or `git diff <base>...HEAD` (falling back to uncommitted working-tree changes),
  mapped onto the already-analyzed graph, and the LLM narrates the change plus
  its 1-hop blast radius, grounded only in nodes actually in the diff or
  directly touching it.

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

Tours (`src/tour-generation.ts`, `src/custom-tour.ts`, `src/tour-store.ts`) are
persisted to a plugin-owned `.ua/tours.json` sidecar, not the graph itself —
upstream's schema only has room for one tour (`graph.tour`), so module
walkthroughs go there for compatibility while code-review and custom tours
live alongside in `tours.json` and are played by `src/tours-widget.js`, the
same vanilla-JS/no-build-step pattern as the Ask widget. Selecting nodes for
a custom tour reads the live React Flow selection via a `MutationObserver` on
`.react-flow__node.selected` — zero patches to the dashboard's React source,
the same non-invasive approach the whole interactive layer uses throughout.

PR walkthroughs (`src/pr-diff.ts`) build on `@understand-anything/core`'s pure,
deterministic `computeDiffOverlay` — no LLM involved in the blast-radius
computation itself: changed files map onto file/function/class nodes sharing
the same `filePath`, then a 1-hop edge walk (both directions) finds everything
else the change touches. Only the resulting changed + affected node lists (not
the whole graph) get passed to the LLM to narrate, and large diffs are capped
(40 changed / 20 affected nodes shown per prompt) so the required output stays
bounded regardless of how many files a diff touches — the model is told how
many nodes were omitted and asked to summarize rather than enumerate. The
result — a `DiffOverlay` plus generated tour steps — is persisted the same way
as a custom tour (`kind: "prWalkthrough"` in `.ua/tours.json`, one entry per
generation, unlike the singleton module/code-review kinds) and the overlay
itself is saved to `.ua/diff-overlay.json`, formalizing the on-disk contract
the `understand-diff` skill already documents.

Project registration (`src/project-store.ts`) keeps config-declared projects
(fixed, from `projects` below) and dynamically-added ones (persisted to
`dynamic-projects.json` in the same state dir, so they survive a restart) in
one combined, index-stable list — new entries only ever append. Adding a
GitHub URL only recognizes an actual `https://github.com/...` or
`git@github.com:...` URL (never a bare `owner/repo` shorthand, `file://`, or
non-GitHub git URL — those could otherwise be used to smuggle an arbitrary
local path or host into a "clone", defeating the projects allowlist this
whole feature sits inside) and shells out to `git clone --depth 1` with a
3-minute timeout.

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
          "anthropicApiKey": "sk-ant-...",   // optional; falls back to ANTHROPIC_API_KEY on the gateway process
          "allowAddProject": true             // optional, default false — lets the dashboard register new projects at runtime
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
- `allowAddProject` is **off by default** and worth understanding before
  turning on: the `projects` allowlist is otherwise the *only* way to expand
  what this plugin can read, run LLM calls against, or serve — a fixed list
  the operator controls via config. Enabling it means anyone who can reach
  the dashboard route can trigger analysis (file reads + LLM API cost) of any
  local path on the host, or have it clone and analyze any public GitHub
  repo. Reasonable for a personal/trusted-operator gateway; think twice
  before enabling it anywhere the dashboard route isn't equally trusted.

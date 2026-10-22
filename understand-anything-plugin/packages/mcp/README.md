# @understand-anything/mcp

Stdio **MCP server** that exposes a project's Understand Anything
**knowledge graph** to any MCP-capable agent — Devin, Claude Code, Cursor, or a
custom client — without requiring a Claude Code plugin install.

The server is **read-only with respect to analysis**: it serves graphs that
already exist, it does not generate them. Graph generation ("ingestion") is the
LLM-agent pipeline described below.

```
┌────────────┐  stdio (JSON-RPC)  ┌──────────────────────────┐   reads   ┌──────────────────────────┐
│ MCP client │ ◄────────────────► │ understand-anything-mcp  │ ────────► │ <repo>/.ua/              │
│ (Devin, …) │                    │                          │           │   knowledge-graph.json   │
└────────────┘                    │                          │ ────────► │   meta.json, config.json │
                                  └──────────────────────────┘           └──────────────────────────┘
                                           │ spawns (understand_dashboard)
                                           ▼
                                  packages/viewer → http://127.0.0.1:<port>/?token=…
```

---

## 1. Prerequisites

From the **monorepo root**:

```bash
pnpm install
pnpm --filter @understand-anything/core build    # analysis engine (dist/)
pnpm --filter @understand-anything/skill build   # context builders (dist/)

# Only needed for the understand_dashboard tool:
pnpm --filter understand-anything-viewer build
```

- Node.js ≥ 22, pnpm ≥ 10.
- The server imports `@understand-anything/core` and `@understand-anything/skill`
  via workspace links — **their `dist/` output must exist** or the server exits
  on first tool call.

---

## 2. Starting the server

The server speaks JSON-RPC over **stdio** and is normally **spawned by the
client** (section 4). To run it by hand for debugging:

```bash
node understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs
# [understand-anything-mcp] server ready on stdio   ← goes to stderr; stdout stays JSON-RPC-only
```

There are no CLI flags. Behavior is controlled per tool call:

- **Project resolution order** (every tool): `projectPath` argument →
  `DEVIN_PROJECT_DIR` env var → the server's working directory.
- Symlinked project paths (e.g. macOS `/tmp`) are canonicalized with
  `realpath` so git-relative paths line up.

---

## 3. Ingesting a repository

The MCP server consumes `.ua/knowledge-graph.json` (or the legacy
`.understand-anything/knowledge-graph.json`). Producing that file is the
`/understand` analysis pipeline — an LLM-agent workflow, not part of this
server.

**Option A — via a supported agent platform** (Claude Code, Cursor, Copilot, …):

```bash
# In the target repository, with the Understand Anything plugin installed:
/understand
```

This runs the multi-agent pipeline and writes `.ua/knowledge-graph.json`,
`meta.json`, and `config.json` into the target repo.

**Option A′ — inside Devin itself:** install `understand-anything-plugin` as a
Devin plugin (Devin loads it through its Claude-plugin compatibility). It ships
the same pipeline as `/understand-anything:understand` plus a post-commit hook
that keeps the graph fresh automatically — the graphs this server serves:

```bash
devin auth login
devin plugins install Egonex-AI/Understand-Anything#understand-anything-plugin
# or, from a local checkout (linked, edits apply live):
devin plugins install --local ./understand-anything-plugin
```

**Option B — check freshness later:** re-run `/understand` (incremental by
default). Every MCP tool reports graph freshness against the current git state
(`fresh` / `dirty` / `stale` / `unknown`) so clients know when context may be
out of date.

**Without a graph**, all tools fail gracefully:

```
Error: No knowledge graph found at /path/to/repo/.ua/knowledge-graph.json.
Run Understand Anything's /understand analysis on this project first, then call this tool again.
```

> Deterministic helpers (`scan-project.mjs`, `extract-structure.mjs`, …) only
> produce pipeline intermediates — they are **not** a substitute for
> `/understand`'s LLM summaries, layers, and tours.

---

## 4. Connecting a client

All MCP clients use the same pattern: register a stdio server whose command is
`node <absolute path to understand-anything-mcp.mjs>`.

### Devin

`.devin/config.json` (committed, team-wide) or `.devin/config.local.json`
(personal, gitignored) at the project root:

```json
{
  "mcpServers": {
    "understand-anything": {
      "command": "node",
      "args": [
        "/absolute/path/to/understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs"
      ]
    }
  }
}
```

Or via the CLI (`-s project` writes the same file):

```bash
devin mcp add -s project understand-anything -- \
  node /absolute/path/to/understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs
devin mcp list   # verify
```

Tools appear to the agent as
`mcp__understand-anything__understand_status`, etc.

### Claude Code

```bash
claude mcp add understand-anything -- \
  node /absolute/path/to/understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs
```

### Cursor / generic clients

Any client accepting standard `mcpServers` JSON:

```json
{
  "mcpServers": {
    "understand-anything": {
      "command": "node",
      "args": ["/absolute/path/to/understand-anything-mcp.mjs"]
    }
  }
}
```

---

## 5. Tool reference

All tools return markdown (or JSON-ish text) in a single `text` content item.
`projectPath` is always optional (see resolution order in §2).

| Tool | Parameters | Returns |
|---|---|---|
| `understand_status` | `projectPath?` | Graph presence, project metadata, node/edge counts, **freshness** vs git, config |
| `understand_search` | `projectPath?`, **`query`** (required), `limit?` (1–50, default 15) | Fuzzy-matched nodes expanded 1 hop, with layers and relationships (markdown) |
| `understand_explain` | `projectPath?`, **`path`** (required, `src/auth.ts` or `src/auth.ts:login`) | Deep-dive: summary, complexity, layer, children, connections, relationships |
| `understand_diff` | `projectPath?`, `staged?`, `base?` (git ref) | Impact analysis of changes: changed components, downstream blast radius, affected layers, risk assessment. Default scope = working tree + staged + untracked |
| `understand_onboard` | `projectPath?` | Standalone onboarding guide (overview, layers, concepts, tour, file map, hotspots) |
| `understand_dashboard` | `projectPath?`, `port?` (default: OS-assigned) | Starts the graph dashboard in the background and returns its **token-gated URL**; reused for the rest of the session |

Recommended agent flow (encoded in the server's `instructions`):

1. `understand_status` — confirm a graph exists and is fresh.
2. `understand_search` / `understand_explain` / `understand_diff` /
   `understand_onboard` — pull focused context.
3. `understand_dashboard` — when the user wants the visual UI. Always share
   the full URL including `?token=` — without it the dashboard shows an
   access-token gate.

---

## 6. Examples

### 6.1 Server registration (Devin project config)

```json
// .devin/config.json
{
  "mcpServers": {
    "understand-anything": {
      "command": "node",
      "args": [
        "/home/alice/Understand-Anything/understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs"
      ]
    }
  }
}
```

### 6.2 Agent interaction (what to ask the client)

```
"Check the understand-anything status for this repo."
→ calls understand_status → reports graph at .ua/knowledge-graph.json, 248 nodes, freshness: fresh

"Use the knowledge graph to explain how authentication works."
→ calls understand_search { query: "authentication flow" }
→ calls understand_explain { path: "src/auth/login.ts" } (for the top hit)

"What does my current diff affect?"
→ calls understand_diff {} → changed components, downstream impact, risk notes

"Open the graph dashboard."
→ calls understand_dashboard {}
→ Dashboard is running at http://127.0.0.1:55291/?token=448e5fe9…
```

### 6.3 Raw JSON-RPC over stdio

Requests are newline-delimited JSON-RPC 2.0 on the server's stdin:

```jsonc
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-client","version":"0.1.0"}}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{…},"serverInfo":{"name":"understand-anything","version":"2.9.7"}}}

→ {"jsonrpc":"2.0","method":"notifications/initialized"}
→ {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
← {… six tools: understand_status, understand_search, understand_explain, understand_diff, understand_onboard, understand_dashboard …}

→ {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"understand_search","arguments":{"projectPath":"/home/alice/my-app","query":"payment flow","limit":10}}}
← {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"# Project: my-app\n…## Code Components\n### chargeCard (function)…"}]}}
```

Tool errors arrive with `isError: true` in the result (not as JSON-RPC errors):

```jsonc
← {"jsonrpc":"2.0","id":4,"result":{"isError":true,"content":[{"type":"text","text":"Error: No knowledge graph found at /repo/.ua/knowledge-graph.json.…"}]}}
```

### 6.4 Minimal Node.js client

```js
// client.mjs — spawn the server, list tools, search a repo
import { spawn } from "node:child_process";

const SERVER =
  "/absolute/path/to/understand-anything-plugin/packages/mcp/bin/understand-anything-mcp.mjs";
const PROJECT = "/home/alice/my-app";

const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "demo", version: "0.1.0" },
});
child.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
);

const { result: tools } = await rpc("tools/list", {});
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const { result } = await rpc("tools/call", {
  name: "understand_search",
  arguments: { projectPath: PROJECT, query: "payment flow" },
});
console.log(result.content[0].text);

child.kill();
```

Run: `node client.mjs`

---

## 7. Operational notes

- **One server process per client session.** The dashboard tool keeps the
  spawned viewer alive across calls within that session (URL reuse keyed by
  project + port).
- **stdout is sacred.** The server never writes anything but JSON-RPC to
  stdout; diagnostics go to stderr (`[understand-anything-mcp] …`).
- **Dashboard security** mirrors the viewer: binds to `127.0.0.1`, requires
  the one-time `?token=`, and only serves source files listed in the graph
  (≤ 1 MB, no binaries).
- **Monorepos**: pass the subdirectory as `projectPath`; git diff paths are
  automatically re-rooted from the repository toplevel to the project dir.

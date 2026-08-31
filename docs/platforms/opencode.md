# OpenCode Integration

OpenCode (≥ 1.15.11) can install Understand-Anything, but **only the structural-only analysis pipeline runs end-to-end** today. The LLM-driven subagent phases (file summaries, architecture detection, guided tour, review) require Claude Code's `Task` tool, which OpenCode does not yet implement. This page documents what works, what does not, and a manual activation procedure that produces a structural knowledge graph you can browse in the dashboard.

> **TL;DR** — On OpenCode you get a file graph with import edges (no function/class nodes, no LLM summaries). Use the manual steps below if `/understand` does not auto-register or auto-run.

---

## Status: structural-only

**What runs:**
- File enumeration, language/category detection, complexity estimation
- Import-edge extraction (tree-sitter, all supported languages)
- Louvain community detection / batch computation
- Dashboard launch + graph viewing

**What does not run on OpenCode:**
- LLM subagents (`file-analyzer`, `assemble-reviewer`, `architecture-analyzer`, `tour-builder`, `graph-reviewer`)
- Per-file summaries, function/class node extraction
- Architectural layer detection
- Guided tour generation
- Graph review / refinement

**Why:** Understand-Anything's `/understand` pipeline dispatches per-file analyses through Claude Code's `Task` tool. OpenCode 1.15.11 does not expose an equivalent subagent dispatch mechanism, so the LLM phases never execute. The deterministic Node.js scripts (`scan-project.mjs`, `extract-import-map.mjs`, `compute-batches.mjs`) are unaffected and can be invoked directly.

---

## Compatibility matrix

| Component                       | Status   | Notes                                                                 |
|---------------------------------|----------|-----------------------------------------------------------------------|
| Plugin install (`install.sh opencode`) | ✅       | Clones repo to `~/.understand-anything/repo`, symlinks skills to `~/.agents/skills/` |
| Core build (`@understand-anything/core`) | ✅       | `pnpm --filter @understand-anything/core build`                       |
| Scan engine (`scan-project.mjs`)       | ✅       | Deterministic file enumeration + language/category detection           |
| Import extraction (`extract-import-map.mjs`) | ✅       | Tree-sitter import resolution for all supported languages              |
| Batch computation (`compute-batches.mjs`) | ✅       | Louvain community detection over the import graph                     |
| `.understandignore` generation         | ✅       | Auto-generated on first scan                                          |
| Dashboard (Vite + React Flow)          | ✅       | Loads the structural graph; file nodes + import edges render          |
| Slash command auto-registration        | ⚠️ Partial | May require the manual command files under `~/.config/opencode/command/` |
| `file-analyzer` subagent (×N concurrent) | ❌       | Needs `Task`-tool dispatch                                            |
| `assemble-reviewer` subagent           | ❌       | Needs `Task`-tool dispatch                                            |
| `architecture-analyzer` subagent       | ❌       | Needs `Task`-tool dispatch                                            |
| `tour-builder` subagent                | ❌       | Needs `Task`-tool dispatch                                            |
| `graph-reviewer` subagent              | ❌       | Needs `Task`-tool dispatch                                            |

---

## What you get

A structural-only knowledge graph:

- **Nodes:** one per source file (with detected language + category)
- **Edges:** resolved import relationships between files
- **Communities:** batches from Louvain partitioning of the import graph
- **No** function or class nodes
- **No** LLM-generated file summaries, layer labels, or tour
- **Dashboard:** file tree + graph view work; the `Info` tab shows scan metadata but no summaries

For reference, a full Claude Code run on the same project typically reaches ~70% semantic coverage and includes function/class nodes plus call/usage edges; the OpenCode structural-only run is closer to ~14%.

---

## Manual activation procedure

Use this if `/understand` does not auto-register inside OpenCode, or if you want to produce the structural graph without invoking the LLM pipeline.

### Prerequisites

```bash
# 1. Install the plugin (clones to ~/.understand-anything/repo, symlinks skills)
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s opencode

# 2. Build the core package once
cd ~/.understand-anything/repo
pnpm install
pnpm --filter @understand-anything/core build
```

Verify:

```bash
[ -f ~/.understand-anything/repo/understand-anything-plugin/packages/core/dist/index.js ] && echo "core built"
ls -l ~/.agents/skills/understand*
```

### Step 1 — Scan the project

From your project root:

```bash
PROJECT_ROOT="$(pwd)"
SKILL_DIR=~/.understand-anything/repo/understand-anything-plugin/skills/understand
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate"

node "$SKILL_DIR/scan-project.mjs" \
  "$PROJECT_ROOT" \
  "$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json"
```

This produces `scan-result.json` with file list, language/category per file, and a complexity estimate. It also generates `.understandignore` on first run if missing.

### Step 2 — Extract the import map

```bash
node "$SKILL_DIR/extract-import-map.mjs" \
  "$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/import-map.json"
```

Outputs resolved import edges per file.

### Step 3 — Compute batches (Louvain communities)

```bash
node "$SKILL_DIR/compute-batches.mjs" "$PROJECT_ROOT"
```

Reads `scan-result.json`, writes `batches.json` containing batches + neighbor map.

### Step 4 — Assemble the structural knowledge graph

The LLM-driven `assemble-reviewer` is unavailable on OpenCode, so produce a minimal graph by hand from `scan-result.json` + `import-map.json`:

```bash
node -e '
const fs = require("fs");
const root = process.argv[1];
const scan = JSON.parse(fs.readFileSync(root + "/.understand-anything/intermediate/scan-result.json", "utf8"));
const imports = JSON.parse(fs.readFileSync(root + "/.understand-anything/intermediate/import-map.json", "utf8"));
const nodes = scan.files.map(f => ({
  id: f.path,
  type: "file",
  label: f.path.split("/").pop(),
  data: { path: f.path, language: f.language, category: f.fileCategory, sizeLines: f.sizeLines },
}));
const edges = [];
for (const [from, targets] of Object.entries(imports.importMap || {})) {
  for (const to of targets) edges.push({ id: from + "->" + to, source: from, target: to, type: "imports" });
}
fs.writeFileSync(
  root + "/.understand-anything/knowledge-graph.json",
  JSON.stringify({ nodes, edges, meta: { mode: "structural-only", platform: "opencode" } }, null, 2),
);
console.error("wrote", nodes.length, "nodes,", edges.length, "edges");
' "$PROJECT_ROOT"
```

### Step 5 — Launch the dashboard

```bash
PLUGIN_ROOT=~/.understand-anything/repo/understand-anything-plugin
cd "$PLUGIN_ROOT/packages/dashboard"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
GRAPH_DIR="$PROJECT_ROOT" npx vite --host 127.0.0.1
```

Vite prints an access-token URL like:

```
🔑  Dashboard URL: http://127.0.0.1:5173?token=<TOKEN>
```

Open it. You should see your project's files and import edges. The `Info` panel will be empty (no LLM summaries), but the graph is fully navigable and the source viewer works.

### Optional — Register slash commands in OpenCode

If `/understand` does not appear in the OpenCode slash menu, create command stubs that load the existing skills:

```bash
mkdir -p ~/.config/opencode/command
SKILL_ROOT=~/.understand-anything/repo/understand-anything-plugin/skills

cat > ~/.config/opencode/command/understand.md <<'CMD'
---
name: understand
description: Analyze the current codebase and produce a knowledge graph (structural-only on OpenCode).
---

Load the understand skill at ~/.agents/skills/understand/SKILL.md and follow its instructions.

OpenCode note: the LLM subagent phases require Claude Code's Task tool and will not
execute here. Run the deterministic scripts directly (see docs/platforms/opencode.md):

  node ~/.understand-anything/repo/understand-anything-plugin/skills/understand/scan-project.mjs <root> <out>
  node ~/.understand-anything/repo/understand-anything-plugin/skills/understand/extract-import-map.mjs <in> <out>
  node ~/.understand-anything/repo/understand-anything-plugin/skills/understand/compute-batches.mjs <root>
CMD

cat > ~/.config/opencode/command/understand-dashboard.md <<'CMD'
---
name: understand-dashboard
description: Launch the interactive web dashboard for the knowledge graph.
argument-hint: [project-path]
---

Load the understand-dashboard skill at ~/.agents/skills/understand-dashboard/SKILL.md and follow its instructions.
CMD

for skill in chat diff domain explain knowledge onboard; do
  cat > ~/.config/opencode/command/understand-${skill}.md <<CMD
---
name: understand-${skill}
description: Understand-Anything ${skill} skill.
---

Load the understand-${skill} skill at ~/.agents/skills/understand-${skill}/SKILL.md and follow its instructions.
CMD
done
```

Restart OpenCode after creating the command files.

---

## Future direction

If OpenCode (or another platform) adds a `Task`-equivalent subagent dispatch mechanism, the full pipeline can activate by:

1. Detecting the host runtime (Claude Code / OpenCode / Codex / …).
2. Routing `dispatchSubagent()` to the platform's native subagent API instead of Claude Code's `Task` tool.
3. Keeping the deterministic scripts as the shared structural-graph backbone.

Until then, OpenCode users get the structural graph; Claude Code users get the full semantic graph. Both load into the same dashboard.

Related discussion: [issue #317](https://github.com/Lum1104/Understand-Anything/issues/317).

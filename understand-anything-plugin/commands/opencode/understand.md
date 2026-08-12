---
description: Analyze the codebase into an interactive knowledge graph (structural-only on OpenCode)
---

# /understand (OpenCode — structural-only)

Analyze the current codebase and produce a schema-valid `knowledge-graph.json`
in the project's data directory (`.ua/`, or legacy `.understand-anything/`),
then launch the interactive dashboard.

**Platform constraint:** OpenCode does not implement Claude Code's `Task` tool,
so the LLM subagent phases of `/understand` (file analysis, architecture,
tour, review) cannot run. This command runs the deterministic pipeline only —
the result is a structural graph (file nodes + import edges) with
schema-valid `complexity`, `tags`, and `summary` fields. No LLM summaries,
layers, or tours. See the upstream OpenCode platform documentation for the
compatibility matrix and future directions.

## Procedure

1. **Resolve the skill directory.** The deterministic scripts live next to
   this skill. Prefer the symlink-resolved path:

   ```bash
   SKILL_ROOT="$(python3 -c "import os;print(os.path.realpath(os.path.expanduser('$HOME/.agents/skills/understand')))" 2>/dev/null)"
   [ -d "$SKILL_ROOT" ] || SKILL_ROOT="$HOME/.understand-anything-plugin/skills/understand"
   [ -d "$SKILL_ROOT" ] || { echo "[understand] skill dir not found"; exit 1; }
   ```

2. **Resolve the project root.** Parse `$ARGUMENTS` for a non-flag token; if
   found and it is a directory, use it. Otherwise use the current working
   directory.

3. **Phase 1 — SCAN** (deterministic):

   ```bash
   UA_DIR="$PROJECT_ROOT/.ua"
   mkdir -p "$UA_DIR/intermediate"
   node "$SKILL_ROOT/scan-project.mjs" "$PROJECT_ROOT" "$UA_DIR/intermediate/scan-result.json" --exclude-analysis-data
   ```

4. **Phase 1.5 — IMPORT MAP.** `extract-import-map.mjs` needs an input file
   with a `projectRoot` field and the scanned `files` array:

   ```bash
   node -e '
   const fs = require("fs");
   const scan = JSON.parse(fs.readFileSync("'"$UA_DIR"'/intermediate/scan-result.json", "utf8"));
   fs.writeFileSync("'"$UA_DIR"'/intermediate/scan-for-importmap.json",
     JSON.stringify({ projectRoot: scan.projectRoot ?? "'"$PROJECT_ROOT"'", files: scan.files }, null, 2));
   '
   node "$SKILL_ROOT/extract-import-map.mjs" "$UA_DIR/intermediate/scan-for-importmap.json" "$UA_DIR/intermediate/import-map.json"
   ```

5. **Phase 1.5b — BATCHES** (optional but recommended; needs `@understand-anything/core` — run via the plugin checkout if the symlinked skill dir lacks `node_modules`):

   ```bash
   node "$SKILL_ROOT/compute-batches.mjs" "$PROJECT_ROOT"
   ```

6. **Assemble the structural graph.** Build `knowledge-graph.json` with the
   project metadata schema (`version`, `kind`, `project` with `name`,
   `languages`, `frameworks`, `description`, `analyzedAt`, `gitCommitHash`;
   `nodes` keyed `file:<relativePath>` with `type: "file"`, `filePath`,
   `language`, `fileCategory`, `sizeLines`, `name`; `edges` with `source`,
   `target`, `type: "imports"`, `direction: "forward"`, `weight: 0.7`;
   plus `layers: []` and `tour: []`). For file count per language, use the
   scan's stats. Write it to `$UA_DIR/knowledge-graph.json`.

7. **Enrich (schema validity).** Add `complexity`, `tags`, `summary` to every
   node deterministically:

   ```bash
   python3 "$SKILL_ROOT/enrich-structural-graph.py" "$UA_DIR/knowledge-graph.json" --write
   ```

   Verify with the plugin's validator:

   ```bash
   node -e '
   const { autoFixGraph } = require(process.env.HOME + "/.understand-anything-plugin/packages/core/dist/schema.js");
   const kg = JSON.parse(require("fs").readFileSync("'"$UA_DIR"'/knowledge-graph.json", "utf8"));
   const { issues } = autoFixGraph(kg);
   console.log("[understand] validation issues:", issues.length);
   if (issues.length) process.exit(1);
   '
   ```

8. **Launch the dashboard** and report the URL:

   ```bash
   GRAPH_DIR="$PROJECT_ROOT/.ua" npx --prefix "$HOME/.understand-anything-plugin/packages/dashboard" vite --config "$HOME/.understand-anything-plugin/packages/dashboard/vite.config.ts" --port 5173 &
   ```

   Report `http://localhost:5173/?token=<from stdout>` to the user.

## Report

Report to the user:
- Files scanned, languages, edge count (from `scan-result.json` stats)
- The dashboard URL
- A one-line caveat: structural-only graph (no LLM summaries/layers/tour —
  OpenCode lacks subagent dispatch; run `/understand` in Claude Code for the
  full graph)

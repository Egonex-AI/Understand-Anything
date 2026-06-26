---
name: understand-crossrepo
description: Analyze multiple interlinked microservice repos and build one combined knowledge graph — each repo a layer, with typed cross-repo edges — explorable in the existing dashboard
argument-hint: "[repoA repoB ...] [--out <dir>]"
---

# /understand-crossrepo

Analyze two or more related repositories together and produce a single `crossrepo-knowledge-graph.json` in a shared output directory. Each repo becomes a named layer; cross-repo edges capture the real runtime dependencies between services that single-repo graphs cannot express.

## Options

- `$ARGUMENTS` may contain:
  - One or more repo paths (non-flag tokens) — each treated as a repo to include. Paths may be absolute or relative to the current working directory.
  - `--out <dir>` — write the combined graph to this directory instead of the default.

---

## Progress Reporting

Use the same conventions as `/understand`:

- **Phase transitions:** `[Phase N/M] <phase name>...`
- **Phase completion:** `Phase N complete. <one-line summary>.`

---

## Phase 0 — Pre-flight: plugin root, repo selection, output dir

### Step 0.1 — Resolve PLUGIN_ROOT and ensure core is built

Do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand-crossrepo` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first, then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

```bash
SKILL_REAL=$(realpath ~/.agents/skills/understand-crossrepo 2>/dev/null || readlink -f ~/.agents/skills/understand-crossrepo 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-crossrepo 2>/dev/null || readlink -f ~/.copilot/skills/understand-crossrepo 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT}" \
  "$HOME/.understand-anything-plugin" \
  "$SELF_RELATIVE" \
  "$COPILOT_SELF_RELATIVE" \
  "$HOME/.codex/understand-anything/understand-anything-plugin" \
  "$HOME/.opencode/understand-anything/understand-anything-plugin" \
  "$HOME/.pi/understand-anything/understand-anything-plugin" \
  "$HOME/understand-anything/understand-anything-plugin"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the understand-anything plugin root."
  echo "Checked:"
  echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
  echo "  - $HOME/.understand-anything-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand-crossrepo>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand-crossrepo>}"
  echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
  echo "  - $HOME/understand-anything/understand-anything-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi

if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
  cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
fi
```

If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/understand-crossrepo`."

### Step 0.2 — Repo selection

Parse `$ARGUMENTS` and collect every non-flag token (anything that does not start with `--`) as a candidate repo path. Also strip `--out <dir>` and its value from the token list before collecting (so `--out` values are never mistaken for repo paths).

**Path provided:** If one or more non-flag tokens are found:

1. For each token, resolve it to an absolute path: if the token is relative, resolve it against the current working directory.
2. Verify with `test -d <resolved>`. If any path does not exist or is not a directory, report an error naming the bad path and **STOP**.
3. Set `$REPO_PATHS` to the list of resolved absolute paths.

**No paths provided:** Ask the user for a parent directory that contains the repos:

> "Which parent directory holds the repos you want to analyze together? (e.g. `/workspace/myproject`)"

Once the user supplies a path (resolve it to absolute if relative):

```bash
find <parent> -maxdepth 1 -type d \( \
  -name ".git" -prune -o \
  -exec sh -c 'test -d "$1/.git" || test -f "$1/package.json" || test -f "$1/pyproject.toml" || test -f "$1/requirements.txt" || test -d "$1/.understand-anything"' _ {} \; -print \
\) 2>/dev/null | sort
```

Present the list to the user as a numbered menu, for example:

```
Found these candidate repos under <parent>:
  1) savo_gemba_service
  2) savo_gemba_ui
  3) savo_pricing_service
  4) savo_pricing_ui
  ...
Enter the numbers to include (e.g. 1 3 4), or "all":
```

Wait for the user's reply. Resolve their selection back to absolute paths and set `$REPO_PATHS`.

**Minimum-repo guard:** If `$REPO_PATHS` contains fewer than 2 paths after resolution, report:

> "Error: /understand-crossrepo requires at least 2 repos. Please provide 2 or more valid repo paths."

Then **STOP**.

### Step 0.3 — Namespace assignment

Each repo's namespace is its directory basename (e.g. `/workspace/savo_gemba_service` → `savo_gemba_service`). Namespaces are used as the `<repo>` segment in node IDs: `<type>:<repo>/<relpath>[:member]`.

**Collision detection:** If two selected repos share the same basename, disambiguate:

1. For each colliding repo, compute a 6-character prefix of its SHA-256 (or `md5`) hash:
   ```bash
   echo -n "<absolute-path>" | sha256sum | cut -c1-6
   ```
2. Append `_<hash>` to each colliding basename to form the namespace, e.g. `shared_lib_a1b2c3` and `shared_lib_d4e5f6`.
3. Warn the user:
   > "Warning: repos '<pathA>' and '<pathB>' share the basename '<name>'. Disambiguated namespaces: '<nameA>' and '<nameB>'."

Store the final `namespace → absolute-path` mapping as `$REPO_NAMESPACES`.

### Step 0.4 — Output directory setup

Parse `$ARGUMENTS` for `--out <dir>`. If found, resolve it to an absolute path (relative → absolute against cwd) and set `$OUT_DIR` to that value.

Otherwise, compute the common parent of all paths in `$REPO_PATHS`:

```bash
# Find longest common directory prefix across all repo paths.
# If repos are siblings (most common case), this is simply their shared parent.
# If they span different trees, use the filesystem root as a fallback.
COMMON_PARENT=$(printf '%s\n' "${REPO_PATHS[@]}" | \
  awk 'BEGIN{FS=OFS="/"} NR==1{n=split($0,a); for(i=1;i<=n;i++) p[i]=a[i]; pn=n} \
       NR>1{n=split($0,a); for(i=1;i<=pn;i++) if(a[i]!=p[i]){pn=i-1; break}} \
       END{for(i=1;i<=pn;i++) printf "%s%s",(i>1?OFS:""),p[i]; print ""}')
[ -z "$COMMON_PARENT" ] && COMMON_PARENT="/"
OUT_DIR="${COMMON_PARENT}/.understand-anything-crossrepo"
```

Create the required subdirectories:

```bash
mkdir -p "$OUT_DIR/.understand-anything/intermediate"
mkdir -p "$OUT_DIR/.understand-anything/tmp"
```

If `mkdir` fails (e.g. permission denied), report the error and **STOP**.

Report to the user:

> "Output directory: `$OUT_DIR`
> Repos selected (namespace → path):"
> - `<namespace>` → `<absolute-path>`
> - ...

---

## Phase 1 — Per-repo reuse-or-fill

Report: `[Phase 1/7] Checking per-repo graphs (reuse vs. analyze)...`

For each repo in `$REPO_NAMESPACES` (namespace → absolute path), decide whether its single-repo knowledge graph is fresh enough to reuse, or must be (re-)built.

**For each repo:**

```bash
# Read existing meta (may not exist)
META="<repoPath>/.understand-anything/meta.json"
CURRENT_HASH=$(git -C "<repoPath>" rev-parse HEAD 2>/dev/null || echo "")
if [ -f "$META" ]; then
  STORED_HASH=$(python3 -c "import json,sys; print(json.load(open('$META')).get('gitCommitHash',''))" 2>/dev/null || echo "")
else
  STORED_HASH=""
fi
```

| Condition | Action |
|-----------|--------|
| `$META` missing | Run `/understand <repoPath>` (full analysis) |
| `$STORED_HASH` ≠ `$CURRENT_HASH` | Run `/understand <repoPath>` (stale graph) |
| Hashes match | Reuse existing `<repoPath>/.understand-anything/knowledge-graph.json` |

To trigger analysis, invoke the `/understand` skill passing `<repoPath>` as its argument. Wait for it to complete before proceeding to the next repo. (Repos are analyzed sequentially here to avoid saturating LLM quota; the signal extraction in Phase 2 is fast and does not need parallelism.)

After processing all repos, report:

> Phase 1 complete. Reused: [list of reused namespaces]. Analyzed: [list of analyzed namespaces (or "none").].

Collect any per-repo failures in `$PHASE_WARNINGS`. A repo whose `/understand` run fails should be skipped with a warning — do not STOP the whole run for a single repo failure. However, if **all** repos fail, report the errors and STOP.

---

## Phase 2 — Extract signals

Report: `[Phase 2/7] Extracting cross-repo signals...`

`$SKILL_DIR` is the directory containing this SKILL.md file — resolve it the same way Phase 0 resolved `$PLUGIN_ROOT` (using the `realpath`/`readlink -f` pattern on `~/.agents/skills/understand-crossrepo`, then falling back to common paths).

For each repo (namespace `<ns>`, path `<repoPath>`):

```bash
node "$SKILL_DIR/extract-crossrepo-signals.mjs" \
  "<repoPath>" \
  "<ns>" \
  "$OUT_DIR/.understand-anything/intermediate/signals-<ns>.json"
```

Run all repos sequentially. If the extractor exits non-zero for a repo, add the error to `$PHASE_WARNINGS` and continue — a repo with no signals simply contributes nothing to cross-repo linking.

After all repos are done:

> Phase 2 complete. Signals extracted for: [list of namespaces with non-empty outbound arrays]. No outbound signals: [list or "none"].

---

## Phase 3 — Combine graphs

Report: `[Phase 3/7] Combining per-repo graphs into unified substrate...`

Build the `<repo>:<ns>` argument list from `$REPO_NAMESPACES`:

```bash
python3 "$SKILL_DIR/combine-graphs.py" "$OUT_DIR" \
  "<repoPath1>:<ns1>" \
  "<repoPath2>:<ns2>" \
  ...
```

This writes:
- `$OUT_DIR/.understand-anything/intermediate/combined-graph.json`
- `$OUT_DIR/.understand-anything/intermediate/id-map.json`

If `combine-graphs.py` exits non-zero, read stderr, report it, and STOP — the downstream steps cannot run without a combined graph.

> Phase 3 complete. Combined graph written with [N] repos, [M] total nodes.

(Read `M` from `combined-graph.json`: `len(graph["nodes"])`.)

---

## Phase 4 — Cross-repo linking (LLM)

Report: `[Phase 4/7] Dispatching cross-repo linker agent...`

Prepare the linker's input by reading:
1. All `signals-<ns>.json` files from `$OUT_DIR/.understand-anything/intermediate/`.
2. From `combined-graph.json`: collect every node whose `id` starts with `module:` or `endpoint:`.

Dispatch a subagent using the `crossrepo-linker` agent definition (at `agents/crossrepo-linker.md` relative to `$PLUGIN_ROOT`). Pass this prompt to the agent:

> You are the cross-repo linker. Your output path is:
> `$OUT_DIR/.understand-anything/intermediate/crossrepo-edges.json`
>
> **Signal files** (one per repo):
> ```json
> [paste full JSON contents of each signals-<ns>.json, keyed by namespace]
> ```
>
> **Available anchor node IDs from combined-graph.json** (module + endpoint nodes):
> ```
> [one node id per line — all ids starting with "module:" or "endpoint:"]
> ```
>
> Follow the matching rules in your agent definition and WRITE your edge array to the output path above.

Wait for the agent to complete. Verify that `crossrepo-edges.json` now exists and is valid JSON containing an array. If the file is missing or invalid, retry the dispatch **once** with the failure appended to the prompt. If still failing after the retry, write an empty array `[]` to `crossrepo-edges.json`, add a warning to `$PHASE_WARNINGS`, and continue.

> Phase 4 complete. [N] cross-repo edges emitted by linker.

(Read `N` from `crossrepo-edges.json`: `len(edges)`.)

---

## Phase 5 — Apply, assemble, and validate

Report: `[Phase 5/7] Applying cross-repo edges and assembling final graph...`

```bash
python3 "$SKILL_DIR/apply-interlinks.py" "$OUT_DIR"
```

This script:
1. Backfills missing summaries/tags on `module:<ns>` anchor nodes.
2. Synthesizes `external:*` infra nodes for unmatched edge targets.
3. Applies and deduplicates cross-repo edges from `crossrepo-edges.json`.
4. Assembles `$OUT_DIR/.understand-anything/knowledge-graph.json`.
5. Runs the inline validator; writes results to `$OUT_DIR/.understand-anything/intermediate/review.json`.
6. Writes `$OUT_DIR/.understand-anything/meta.json`.

If `apply-interlinks.py` exits non-zero, read stderr, report it, and STOP.

After it completes, read `review.json`:

```bash
python3 -c "
import json
r = json.load(open('$OUT_DIR/.understand-anything/intermediate/review.json'))
print('issues:', r.get('issues', []))
print('warnings:', r.get('warnings', []))
"
```

**If `issues` is non-empty:**
- Report each issue to the user verbatim.
- Set `$VALIDATION_PASSED=false`.
- Tell the user: "Validation issues were found. The graph has been saved but the dashboard will not auto-launch. Fix the issues above and re-run `/understand-crossrepo` to rebuild."

**If `issues` is empty:**
- Set `$VALIDATION_PASSED=true`.
- > Phase 5 complete. Graph assembled and validated. [N] nodes, [M] edges (including [X] cross-repo edges). [W] warnings.

---

## Phase 6 — Summary report

Report: `[Phase 6/7] Building summary report...`

Read the final graph and intermediate files:

```bash
python3 - <<'EOF'
import json, sys

graph = json.load(open("$OUT_DIR/.understand-anything/knowledge-graph.json"))
try:
    edges_raw = json.load(open("$OUT_DIR/.understand-anything/intermediate/crossrepo-edges.json"))
except Exception:
    edges_raw = []

nodes = graph.get("nodes", [])
edges = graph.get("edges", [])
layers = graph.get("layers", [])

# Cross-repo edges: those whose source and target are in different namespaces
def ns(nid):
    # module:ns/... → ns; otherwise first segment after colon up to /
    parts = nid.split(":", 1)
    if len(parts) < 2:
        return ""
    rest = parts[1]
    return rest.split("/")[0]

cross_edges = [e for e in edges if ns(e.get("source","")) != ns(e.get("target",""))]
low_conf = [e for e in edges_raw if e.get("confidence","high") == "low"]

print(f"Nodes: {len(nodes)}")
print(f"Edges total: {len(edges)}")
print(f"Cross-repo edges: {len(cross_edges)}")
print(f"Low-confidence edges (linker): {len(low_conf)}")
print(f"Layers: {len(layers)} — {[l.get('id') for l in layers]}")
EOF
```

Report to the user:

```
Cross-repo graph summary
========================
Repos analyzed (fresh):  [list from Phase 1]
Repos reused (cached):   [list from Phase 1]

Layers:  [one per repo namespace + external layer if any]
Nodes:   [total]
Edges:   [total] ([X] cross-repo, [W] low-confidence)

Output: $OUT_DIR/.understand-anything/knowledge-graph.json

Warnings accumulated: [list from $PHASE_WARNINGS, or "none"]
```

> Phase 6 complete.

---

## Phase 7 — Dashboard

Report: `[Phase 7/7] Launching dashboard...`

**Only proceed if `$VALIDATION_PASSED=true`** (set in Phase 5).

Invoke the `/understand-dashboard` skill, passing `$OUT_DIR` as its project-path argument:

> `/understand-dashboard $OUT_DIR`

Do not hand-roll a Vite or Node server command — reuse the skill as-is. The skill reads `$OUT_DIR/.understand-anything/knowledge-graph.json` and launches the interactive explorer.

If `$VALIDATION_PASSED=false`, skip this phase and remind the user:

> "Dashboard launch skipped due to validation issues. Fix the issues reported in Phase 5 and re-run `/understand-crossrepo` to rebuild."

---

## Node ID Convention (reference)

All nodes use a namespaced ID: `<type>:<repo>/<relpath>[:member]`

Examples:
- `file:savo_gemba_service/app/models.py`
- `function:savo_gemba_ui/src/api/client.ts:fetchEmployee`
- `endpoint:savo_pricing_service/routes/pricing.py:POST /price`

Cross-repo edges use standard edge types from the single-repo schema (e.g. `calls`, `depends_on`, `reads_from`) with `source` and `target` IDs from different namespaces.

---

## Error Handling

- Report all errors to the user immediately. Never silently continue after a STOP condition.
- STOP conditions in Phase 0: missing repo path, fewer than 2 repos, `mkdir` failure.
- Non-STOP warnings (namespace collisions, individual-repo scan failures in later phases) are collected in `$PHASE_WARNINGS` and included in the final report.

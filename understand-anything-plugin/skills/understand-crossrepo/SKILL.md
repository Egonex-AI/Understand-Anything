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

## Phases 1–7 (added in later tasks)

The following phases are scaffolded here for continuity. Their full logic is authored in Tasks 2–6.

| Phase | Name | Task |
|-------|------|------|
| 1 | Per-repo scan | Task 2 |
| 2 | Per-repo file analysis (parallel) | Task 2 |
| 3 | Cross-repo linker — detect and emit cross-repo edges | Task 3 |
| 4 | Merge into unified graph — one node set, typed cross-repo edges | Task 4 |
| 5 | Architecture + tour over the combined graph | Task 5 |
| 6 | Review + validate the combined graph | Task 5 |
| 7 | Save `crossrepo-knowledge-graph.json` + launch dashboard | Task 6 |

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

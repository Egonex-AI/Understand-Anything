---
name: understand-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /understand knowledge graph.
argument-hint: [--full] [--standalone]
---

# /understand-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and produces an interactive horizontal flow graph in the dashboard.

## How It Works

- If a knowledge graph already exists (`.understand-anything/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists **and `--standalone` is passed**, performs a lightweight scan: file tree + entry point detection + sampled files
- If no knowledge graph exists **without `--standalone`**, reports an error — run `/understand` first to build the knowledge graph
- Use `--full` flag to force a fresh scan even if a knowledge graph exists

## Options

- `--full` — Force full regeneration even if a knowledge graph exists
- `--standalone` — Allow lightweight scan when no knowledge graph exists (Path 1). Without this flag, a knowledge graph is required (Path 2). Use when running `/understand-domain` independently without prior `/understand` execution.

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`

Set `PROJECT_ROOT` to the current working directory.

**Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.understand-anything/` written there is destroyed when the session ends, taking the domain graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[understand-domain] Detected git worktree at $PROJECT_ROOT"
      echo "[understand-domain] Redirecting output to main repo root: $MAIN_ROOT"
      echo "[understand-domain] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
```

Use `$PROJECT_ROOT` (not the bare CWD) for every reference to "the current project" / `<project-root>` in subsequent phases.

**Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand-domain` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

Resolve the plugin root like this:

```bash
SKILL_REAL=$(realpath ~/.agents/skills/understand-domain 2>/dev/null || readlink -f ~/.agents/skills/understand-domain 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-domain 2>/dev/null || readlink -f ~/.copilot/skills/understand-domain 2>/dev/null || echo "")
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
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand-domain>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand-domain>}"
  echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
  echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
  echo "  - $HOME/understand-anything/understand-anything-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi
```

Use `$PLUGIN_ROOT` for every reference to agent definitions in subsequent phases.

### Phase 1: Detect Existing Graph

1. Check if `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists
2. If it exists AND `--full` was NOT passed → proceed to Phase 3 (derive from graph)
3. If it does NOT exist:
   - If `--standalone` OR `--full` was passed → proceed to Phase 2 (lightweight scan; `--full` without KG implies standalone re-scan)
   - Otherwise → **report error and stop**:
     > `Error: Knowledge graph not found at .understand-anything/knowledge-graph.json. Run /understand first, or use --standalone for lightweight scan without a knowledge graph.`

### Phase 2: Lightweight Scan (Path 1)

The preprocessing script does NOT produce a domain graph — it produces **raw material** (file tree, entry points, exports/imports) so the domain-analyzer agent can focus on the actual domain analysis instead of spending dozens of tool calls exploring the codebase. Think of it as a cheat sheet: cheap Python preprocessing → expensive LLM gets a clean, small input → better results for less cost.

1. Run the preprocessing script bundled with this skill, passing `$PROJECT_ROOT` from Phase 0:
   ```
   python ./extract-domain-context.py "$PROJECT_ROOT"
   ```
   This outputs `$PROJECT_ROOT/.understand-anything/intermediate/domain-context.json` containing:
   - File tree (respecting `.gitignore`)
   - Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers)
   - File signatures (exports, imports per file)
   - Code snippets for each entry point (signature + first few lines)
   - Project metadata (package.json, README, etc.)
2. Read the generated `domain-context.json` as context for Phase 4
3. Proceed to Phase 4

### Phase 3: Derive from Existing Graph (Path 2)

1. Run the KG condensation script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/condense_kg_for_domain.py" "$PROJECT_ROOT"
   ```
   This produces `$PROJECT_ROOT/.understand-anything/intermediate/kg-summary.json` — a module-level summary of the KG (~15k tokens vs 100k+ for the full KG).

2. Read `kg-summary.json` as context for Phase 4a.
3. Proceed to Phase 4a.

### Phase 4: Domain Analysis (Split Pipeline)

This phase uses different strategies depending on Path:

**Path 1 (no KG — from Phase 2):** Use the existing `domain-analyzer` agent with `domain-context.json` as input. This is a single-pass analysis suitable for smaller projects where context size is manageable. Proceed directly to Phase 5 after completion.

**Path 2 (KG exists — from Phase 3):** Use the split pipeline below.

#### Phase 4a: Domain Discovery

1. Read the `domain-discoverer` agent prompt from `$PLUGIN_ROOT/agents/domain-discoverer.md`
2. Dispatch a subagent with the `domain-discoverer` prompt + `kg-summary.json` content as context
3. The agent writes to `$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.json`
4. Read the discovery output. If 0 domains found, report error and stop.

#### Phase 4a-audit: Domain Discovery Audit

1. Run the audit script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/audit_domain_discovery.py" "$PROJECT_ROOT"
   ```
2. Read `$PROJECT_ROOT/.understand-anything/intermediate/domain-audit.json`
3. If `shouldRefine` is `false`, proceed to Phase 4b
4. If `shouldRefine` is `true`, proceed to Phase 4a-refine

#### Phase 4a-refine: Domain Discovery Refinement

1. Read the `domain-discoverer` agent prompt from `$PLUGIN_ROOT/agents/domain-discoverer.md`
2. Prepare refinement context by combining:
   - The original `kg-summary.json` content
   - The current `domain-discovery.json` content
   - The audit warnings from `domain-audit.json`
3. Dispatch a subagent with the `domain-discoverer` prompt + refinement context, adding this instruction:
   ```
   REFINEMENT PASS: The previous domain discovery was audited and the following issues were found.
   Review each warning and decide whether to split the flagged domains.
   If splitting, create new domain entries with appropriate module assignments.
   If not splitting, explain why in your text response.

   <audit-warnings>
   {JSON array of warnings from domain-audit.json}
   </audit-warnings>
   ```
4. The agent overwrites `$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.json`
5. Re-run the audit script to verify improvement (warnings may remain — that's acceptable)
6. Proceed to Phase 4b

#### Phase 4b: KG Splitting

1. Run the splitting script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/split_kg_by_domain.py" "$PROJECT_ROOT"
   ```
2. Verify one `domain-<name>.json` file exists in `intermediate/` for each domain in the discovery.

#### Phase 4c: Flow Extraction (parallel, up to 3 concurrent)

1. Read the `domain-flow-extractor` agent prompt from `$PLUGIN_ROOT/agents/domain-flow-extractor.md`
2. **Before dispatching**, detect already-extracted domains by checking if `intermediate/flows-<name>.json` exists and is non-empty. Skip domains that already have output (this enables automatic resume when a previous run was interrupted). If an output file exists but contains invalid JSON (e.g. truncated from a crash), treat it as incomplete and re-process. If all domains are complete, skip directly to Phase 4d.
3. For each remaining domain in `domain-discovery.json`:
   - Read `intermediate/domain-<name>.json` as context
   - Dispatch a subagent with the `domain-flow-extractor` prompt + domain KG subset
   - The agent writes to `intermediate/flows-<name>.json`
4. Run up to **3 subagents concurrently** (same pattern as `/understand` Phase 2 batches)
5. If a domain's flow extraction fails, retry once. If it fails again, skip that domain and continue with others.
6. Wait for all to complete.

#### Phase 4d: Merge

1. Run the merge script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/merge_domain_results.py" "$PROJECT_ROOT"
   ```
2. Verify `intermediate/domain-analysis.json` exists. If not, report error.

### Phase 5: Validate and Save

1. Validate the domain analysis output using the shared validation script (zod schemas + auto-fix):
   ```bash
   node <SKILL_DIR>/../understand/validate-graph.mjs \
     "$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json" \
     "$PROJECT_ROOT/.understand-anything/intermediate/domain-validation-report.json"
   ```
2. Read the validation report. Log any warnings (auto-corrected or dropped issues).
3. If validation exits with fatal (exit code 1), log error but save what's valid (error tolerance).
4. Save the validated graph to `$PROJECT_ROOT/.understand-anything/domain-graph.json`
5. Clean up `$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.understand-anything/intermediate/domain-context.json`

### Phase 6: Launch Dashboard

1. Auto-trigger `/understand-dashboard` to visualize the domain graph
2. The dashboard will detect `domain-graph.json` and show the domain view by default

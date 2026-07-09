---
name: understand-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /understand knowledge graph.
argument-hint: '[--workflow|--full|--standalone]'
---

# /understand-domain

Extracts business domain knowledge — domains, business flows, and process steps — from a codebase and produces an interactive horizontal flow graph in the dashboard.

---

## Invocation Mode

**Check `$ARGUMENTS` for `--workflow` before doing anything else.**

### If `--workflow` is present → Workflow harness path

Strip `--workflow` from `$ARGUMENTS`, then invoke the **Workflow tool** (not a sub-agent) with:

```
scriptPath: "$SKILL_DIR/workflow.js"
args: { rawArgs: "<$ARGUMENTS without --workflow>", cwd: "<current working directory>" }
```

Wait for the workflow to complete and surface its result. **Do not execute any manual phases below.**

The workflow harness runs a deterministic multi-stage pipeline (Pre-flight → Detect → Scan → Discovery → Extraction → Merge → Validate → Save) with structured schemas and parallel extraction.

### If `--workflow` is absent (default) → Manual LLM-driven path

Continue to the manual phases described in this file (LLM agent orchestrates each step directly).

---

## How It Works

- If a knowledge graph already exists (`.understand-anything/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists **and `--standalone` is passed**, performs a lightweight scan: file tree + entry point detection + sampled files
- If no knowledge graph exists **without `--standalone`**, reports an error — run `/understand` first to build the knowledge graph
- Use `--full` flag to force fresh domain derivation, bypassing checkpoints and cached intermediate files

## Options

- `--full` — Force full regeneration. Deletes `domain-discovery-checkpoint.json` and existing `flows-*.json` in `intermediate/`, then re-derives from the knowledge graph (if KG exists) or runs the lightweight scan (if KG is missing). Bypasses all incremental checkpoints.
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

**Load business terms glossary (optional).** Read `businessTermsPath` from `$PROJECT_ROOT/.understand-anything/config.json` and load the terms markdown for injection into domain-discoverer (spec §3).

```bash
TERMS_MD=""
CONFIG_FILE="$PROJECT_ROOT/.understand-anything/config.json"
if [ -f "$CONFIG_FILE" ]; then
  REL_PATH=$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1], encoding='utf-8'))
    print(c.get('businessTermsPath', ''))
except Exception:
    print('')
" "$CONFIG_FILE")
  if [ -n "$REL_PATH" ]; then
    TERMS_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$REL_PATH"
    if [ -f "$TERMS_FILE" ]; then
      TERMS_MD=$(cat "$TERMS_FILE")
      echo "[understand-domain] Loaded business terms glossary: $TERMS_FILE"
    else
      echo "[understand-domain] businessTermsPath configured but file not found: $TERMS_FILE. Degraded — no glossary injection." >&2
    fi
  fi
fi
```

`$TERMS_MD` is empty when: field missing (silent), file not found (loud error to stderr), or config unreadable. Empty → domain-discoverer runs without glossary (original logic, spec §3 降级语义).

### Phase 1: Detect Existing Graph

1. If `--full` was passed, delete cached domain intermediates to force fresh generation:
   ```bash
   rm -f "$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery-checkpoint.json"
   rm -f "$PROJECT_ROOT/.understand-anything/intermediate/flows-"*.json
   ```
2. Check knowledge graph completeness using the artifact validator:
   ```bash
   KG_RESULT=$(node "$PLUGIN_ROOT/skills/understand/validate-artifact.mjs" \
     "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" \
     knowledge-graph:complete 2>/dev/null || echo '{"status":"missing"}')
   KG_STATUS=$(echo "$KG_RESULT" | node -e "d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.status)")
   ```
3. If `KG_STATUS` is `complete` AND `--full` was NOT passed → proceed to Phase 3 (derive from graph)
4. If `KG_STATUS` is `complete` AND `--full` was passed → proceed to Phase 3 (re-derive from graph, bypassing checkpoints — cleanup done in step 1)
5. If `KG_STATUS` is `degraded` or `stale`:
   - Report: `Knowledge graph is ${KG_STATUS}: $(echo "$KG_RESULT" | node -e "d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.reason)"). Rebuilding upstream...`
   - Dispatch an `/understand` subagent to rebuild the KG, then re-verify
   - If still degraded after rebuild → **report error and stop**
6. If `KG_STATUS` is `missing`:
   - If `--standalone` OR `--full` was passed → proceed to Phase 2 (lightweight scan; `--full` without KG implies standalone re-scan)
   - Otherwise → **report error and stop**:
     > `Error: Knowledge graph not found at .understand-anything/knowledge-graph.json. Run /understand first, or use --standalone for lightweight scan without a knowledge graph.`

### Phase 1.5: Platform Type Detection

Detect the project's platform type to select appropriate flow extraction strategy in Phase 4c.

1. Read project metadata from KG (`project.frameworks`, `project.languages`) or scan results (for Path 1)
2. Classify into one of: `backend`, `frontend`, `mobile-client`, `fullstack`

**Classification rules (in priority order):**

| Signal | Classification |
|---|---|
| frameworks contains any of: Android, Jetpack Compose, iOS, SwiftUI, UIKit, Flutter, React Native, HarmonyOS | `mobile-client` |
| frameworks contains any of: Vue, React, Next.js, Nuxt, Svelte, uni-app AND no backend framework present | `frontend` |
| frameworks contains any of: Spring, Spring Boot, Express, Django, FastAPI, Gin, Rails, NestJS, Flask | `backend` |
| frameworks contains BOTH a frontend/mobile AND a backend framework | `fullstack` |
| >70% files are .kt/.swift/.dart AND paths contain Activity/Fragment/ViewController | `mobile-client` |
| >70% files are .vue/.tsx/.jsx AND paths contain pages/views/components (no controller/) | `frontend` |
| Default (none of the above) | `backend` |

3. Store as `$PLATFORM_TYPE` for use in Phase 4c.
4. Report: `Platform detected: $PLATFORM_TYPE`

---

### Phase 2: Lightweight Scan (Path 1)

The preprocessing script does NOT produce a domain graph — it produces **raw material** (file tree, entry points, exports/imports) so the domain-analyzer agent can focus on the actual domain analysis instead of spending dozens of tool calls exploring the codebase. Think of it as a cheat sheet: cheap Python preprocessing → expensive LLM gets a clean, small input → better results for less cost.

1. Run the preprocessing script bundled with this skill, passing `$PROJECT_ROOT` from Phase 0:
   ```bash
   python3 "$PLUGIN_ROOT/skills/understand-domain/extract-domain-context.py" "$PROJECT_ROOT"
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

**Documentation exclusion rule (applies to all sub-phases):** Modules whose paths are exclusively documentation or infrastructure directories (`docs/`, `doc/`, `script/`, `docker/`, project root config files) do NOT participate in domain splitting. The `domain-discoverer` agent is instructed to exclude them (Rule 11). If the discovery output still contains documentation-only modules in domain assignments, remove them before proceeding to KG splitting and flow extraction. Only source code modules (containing `.java`, `.py`, `.ts`, `.go`, etc.) should be assigned to business domains.

#### Phase 4a: Domain Discovery

1. **Checkpoint detection:** Unless `--full` was passed (checkpoints deleted in Phase 1), check if `$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery-checkpoint.json` exists and contains valid JSON with `_checkpoint.status == "complete"`. If so, read `domain-discovery.json` and skip to Phase 4a-audit.
2. Read the `domain-discoverer` agent prompt from `$PLUGIN_ROOT/agents/domain-discoverer.md`
3. Dispatch a subagent with the `domain-discoverer` prompt + `kg-summary.json` content as context. If `$TERMS_MD` is non-empty, append the glossary markdown to the agent context with this preamble:

   ```
   ## Business Terms Glossary (PRD authoritative business view)

   The following is the project's PRD business terms glossary. Use it to align domain naming and record attribution (see Rule 13 in your instructions). Code (kg-summary) remains authoritative for domain boundaries — the glossary aligns names and records attribution only.

   <terms-glossary>
   $TERMS_MD
   </terms-glossary>
   ```

   If `$TERMS_MD` is empty, do not mention the glossary — the agent runs its original logic and omits matchedSubDomains/matchedTerms/evidence fields.
4. The agent writes to `$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.json`
5. Read the discovery output. If 0 domains found, report error and stop.
6. **Write checkpoint:**
   ```bash
   echo '{"_checkpoint":{"status":"complete","phase":"4a"}}' > \
     "$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery-checkpoint.json"
   ```

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

   If `$TERMS_MD` is non-empty, also append the glossary markdown (same preamble as Phase 4a step 3) so refine produces the same evidence structure.
4. **Backup current discovery before overwriting:**
   ```bash
   cp "$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.json" \
      "$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.v1.json"
   ```
   If the refine agent produces worse results, the backup can be restored manually.
5. The agent overwrites `$PROJECT_ROOT/.understand-anything/intermediate/domain-discovery.json`
6. Re-run the audit script to verify improvement (warnings may remain — that's acceptable)
7. Proceed to Phase 4b

#### Phase 4b: KG Splitting

1. Run the splitting script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/split_kg_by_domain.py" "$PROJECT_ROOT"
   ```
2. Verify one `domain-<name>.json` file exists in `intermediate/` for each domain in the discovery.

#### Phase 4c: Flow Extraction (parallel, up to 10 concurrent)

1. **Load platform-specific strategy.** Based on `$PLATFORM_TYPE` from Phase 1.5, read the appropriate strategy file:
   - `backend` → `$PLUGIN_ROOT/skills/understand-domain/platforms/backend-flow.md`
   - `frontend` → `$PLUGIN_ROOT/skills/understand-domain/platforms/frontend-flow.md`
   - `mobile-client` → `$PLUGIN_ROOT/skills/understand-domain/platforms/mobile-flow.md`
   - `fullstack` → load **both** `backend-flow.md` and `frontend-flow.md` (or `mobile-flow.md` if mobile is present). Apply each strategy to its respective domain subsets.

   The strategy file defines: entry point types, edge types to trace, domain splitting heuristics, and output format conventions for that platform.

2. Read the `domain-flow-extractor` agent prompt from `$PLUGIN_ROOT/agents/domain-flow-extractor.md`
3. **Domain-level incremental detection (script-backed):** Run the fingerprint check script to determine which domains need extraction:
   ```bash
   python3 "$PLUGIN_ROOT/skills/understand-domain/compute_domain_fingerprints.py" "$PROJECT_ROOT" --check
   # Or with --full to force all:
   python3 "$PLUGIN_ROOT/skills/understand-domain/compute_domain_fingerprints.py" "$PROJECT_ROOT" --check --full
   ```
   The script computes SHA-256 fingerprints of each `intermediate/domain-<name>.json` file, compares against the previous run's fingerprints stored in `intermediate/domain-fingerprints.json`, and checks if valid `flows-<name>.json` files exist. It outputs JSON to stdout with:
   - `to_extract`: domain short names that need extraction (changed fingerprint, missing/invalid flows, or new domain)
   - `skipped`: domain short names that can be skipped (unchanged fingerprint + valid flows)
   - `doc_only_skipped`: documentation-only domains excluded
   If `--full` is passed, all non-doc domains are listed in `to_extract` regardless of fingerprints.
   If all domains are skipped (empty `to_extract`), skip directly to fingerprint save.
4. For each domain in the `to_extract` list:
   - Read `intermediate/domain-<name>.json` as context
   - **Include the loaded platform strategy** as additional context for the subagent
   - Dispatch a subagent with the `domain-flow-extractor` prompt + domain KG subset + platform strategy
   - The agent writes to `intermediate/flows-<name>.json`
5. Run up to **10 subagents concurrently**
6. If a domain's flow extraction fails, retry once. If it fails again, skip that domain and continue with others.
7. **Save fingerprints:** After all extractions complete, save current fingerprints for future incremental comparisons:
   ```bash
   python3 "$PLUGIN_ROOT/skills/understand-domain/compute_domain_fingerprints.py" "$PROJECT_ROOT" --save
   ```
8. Wait for all to complete.

#### Phase 4d: Merge

1. Run the merge script:
   ```bash
   python "$PLUGIN_ROOT/skills/understand-domain/merge_domain_results.py" "$PROJECT_ROOT"
   ```
2. Verify `intermediate/domain-analysis.json` exists. If not, report error.

### Phase 5: Validate and Save

The merge script (`merge_domain_results.py`) stamps `project.provenance` with `completedStages: ["derive"]`, `analyzedAt`, and `gitCommitHash` so downstream `domain-graph:complete` validation passes.

1. Validate the domain analysis output using the shared validation script (zod schemas + auto-fix):
   ```bash
   node "$PLUGIN_ROOT/skills/understand/validate-graph.mjs" \
     "$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json" \
     "$PROJECT_ROOT/.understand-anything/intermediate/domain-validation-report.json"
   ```
2. Read the validation report. Log any warnings (auto-corrected or dropped issues).
3. If validation exits with fatal (exit code 1), log error but save what's valid (error tolerance).
4. Save the validated graph to `$PROJECT_ROOT/.understand-anything/domain-graph.json`. Use the auto-fixed `data` field from the validation report (not the raw input file) — `validate-graph.mjs` does not overwrite the input JSON on disk.
5. Clean up `$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.understand-anything/intermediate/domain-context.json`

### Phase 6: Launch Dashboard

1. Auto-trigger `/understand-dashboard` to visualize the domain graph
2. The dashboard will detect `domain-graph.json` and show the domain view by default

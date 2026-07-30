---
name: understand
description: Analyze a codebase to produce an interactive knowledge graph for understanding architecture, components, and relationships
argument-hint: ["[path] [--workflow|--full|--auto-update|--no-auto-update|--review|--language <lang>]"]
disable-model-invocation: true
---

# /understand

Analyze the current codebase and produce a `knowledge-graph.json` file in `.understand-anything/`. This file powers the interactive dashboard for exploring the project's architecture.

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

The workflow harness runs a deterministic multi-stage pipeline (Pre-flight → Scan → Structural → Analyze → Assemble → Architecture → Tour → Review → Save) with structured schemas and parallel execution.

### If `--workflow` is absent (default) → Manual LLM-driven path

Continue to the manual phases described in this file (LLM agent orchestrates each step directly).

---

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force a full rebuild, ignoring any existing graph
  - `--auto-update` — Enable automatic graph updates on commit (writes `autoUpdate: true` to `.understand-anything/config.json`)
  - `--no-auto-update` — Disable automatic graph updates (writes `autoUpdate: false` to `.understand-anything/config.json`)
  - `--review` — Run full LLM graph-reviewer instead of inline deterministic validation
  - `--language <lang>` — Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in the specified language. Accepts ISO 639-1 codes (`zh`, `ja`, `ko`, `en`, `es`, `fr`, `de`, etc.) or friendly names (`chinese`, `japanese`, `korean`, `english`, `spanish`, etc.). Locale variants supported: `zh-TW`, `zh-HK`, etc. Defaults to `en` (English). Stores preference in `.understand-anything/config.json` for consistency across incremental updates.
  - A directory path (e.g. `/path/to/repo` or `../other-project`) — Analyze the given directory instead of the current working directory

---

## Progress Reporting

Throughout execution, report progress to the user at each phase transition and during batch processing. This keeps users informed on large codebases where analysis can take a long time.

- **Phase transitions:** At the start of each phase, print a status line:
  > `[Phase N/8] <phase name>...`
  >
  > Example: `[Phase 3/8] Analyzing files (12 batches)...`

- **Batch progress:** During Phase 3, report each batch with its index and total:
  > `Analyzing batch X/N (files: foo.ts, bar.ts, ...)` (list up to 3 filenames, then `...` if more)

- **Phase completion:** When a phase finishes, briefly confirm:
  > `Phase N complete. <one-line summary of result>`
  >
  > Example: `Phase 1 complete. Found 247 files across 3 languages.`

---

## Phase 0 — Pre-flight

Determine whether to run a full analysis or incremental update.

1. **Resolve `PROJECT_ROOT`:**
   - Parse `$ARGUMENTS` for a non-flag token (any argument that does not start with `--`). If found, treat it as the target directory path.
     - If the path is relative, resolve it against the current working directory.
     - Verify the resolved path exists and is a directory (run `test -d <path>`). If it does not exist or is not a directory, report an error to the user and **STOP**.
     - Set `PROJECT_ROOT` to the resolved absolute path.
   - If no directory path argument is found, set `PROJECT_ROOT` to the current working directory.
   - **Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.understand-anything/` written there is destroyed when the session ends, taking the knowledge graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

     ```bash
     COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
     GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
     if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
       COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
       GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
       if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
         MAIN_ROOT=$(dirname "$COMMON_ABS")
         if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
           echo "[understand] Detected git worktree at $PROJECT_ROOT"
           echo "[understand] Redirecting output to main repo root: $MAIN_ROOT"
           echo "[understand] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
           PROJECT_ROOT="$MAIN_ROOT"
         fi
       fi
     fi
     ```

     Set `UNDERSTAND_NO_WORKTREE_REDIRECT=1` if you intentionally want a per-worktree graph (rare — most users want the redirect).
1.5. **Ensure the plugin is built.** Later phases invoke Node scripts that import `@understand-anything/core`. On a fresh install `packages/core/dist/` does not exist yet — build once.

   **Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/understand` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

   Resolve the plugin root like this:

   ```bash
   SKILL_REAL=$(realpath ~/.agents/skills/understand 2>/dev/null || readlink -f ~/.agents/skills/understand 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand 2>/dev/null || readlink -f ~/.copilot/skills/understand 2>/dev/null || echo "")
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
     echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand>}"
     echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand>}"
     echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
     echo "  - $HOME/understand-anything/understand-anything-plugin"
     echo "Make sure the plugin is installed correctly."
     exit 1
   fi

   CORE_DIST="$PLUGIN_ROOT/packages/core/dist/index.js"
   CORE_SRC_NEWER=$(
     if [ -f "$CORE_DIST" ]; then
       find "$PLUGIN_ROOT/packages/core/src" "$PLUGIN_ROOT/packages/core/package.json" \
         -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' \) \
         -newer "$CORE_DIST" -print -quit 2>/dev/null
     fi
   )
   if [ ! -f "$CORE_DIST" ] || [ -n "$CORE_SRC_NEWER" ]; then
     cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @understand-anything/core build
   fi
   ```

   If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/understand`."

2. Get the current git commit hash:
   ```bash
   git rev-parse HEAD
   ```
3. Create the intermediate and temp output directories:
   ```bash
   mkdir -p $PROJECT_ROOT/.understand-anything/intermediate
   mkdir -p $PROJECT_ROOT/.understand-anything/tmp
   ```
3.5. **Auto-update configuration:**
    - If `--auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": true}` to `$PROJECT_ROOT/.understand-anything/config.json`
    - If `--no-auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": false}` to `$PROJECT_ROOT/.understand-anything/config.json`
    - These flags only set the config — analysis proceeds normally regardless.

 3.6. **Language configuration:**
    - Parse `$ARGUMENTS` for `--language <lang>` flag. If found, extract the language code.
    - **Language code normalization:** Map friendly names to ISO codes:
      - `chinese` → `zh`, `japanese` → `ja`, `korean` → `ko`, `english` → `en`, `spanish` → `es`, `french` → `fr`, `german` → `de`, `portuguese` → `pt`, `russian` → `ru`, `arabic` → `ar`, etc.
      - Locale variants: `zh-TW`, `zh-HK`, `zh-CN`, `pt-BR`, etc. are preserved as-is.
    - If `--language` is NOT specified:
      - Check `$PROJECT_ROOT/.understand-anything/config.json` for an existing `outputLanguage` field. If present, use that.
      - If no stored preference, default to `en` (English).
    - If `--language` IS specified:
      - Update `$PROJECT_ROOT/.understand-anything/config.json` with the new language: merge `{"outputLanguage": "<lang>"}` into existing config.
      - Store as `$OUTPUT_LANGUAGE` for use throughout all phases.
    - **Language directive template:** Store as `$LANGUAGE_DIRECTIVE`:
      ```markdown
      > **Language directive**: Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in **{language}**. Maintain technical accuracy while using natural, native-level phrasing in the target language. Keep technical terms in English when no standard translation exists (e.g., "middleware", "hook", "barrel").
      ```

 4. **Check for subdomain knowledge graphs to merge:**
   List all `*knowledge-graph*.json` files in `$PROJECT_ROOT/.understand-anything/` **excluding** `knowledge-graph.json` itself (e.g. `frontend-knowledge-graph.json`, `backend-knowledge-graph.json`). If any subdomain graphs exist, run the merge script bundled with this skill (located next to this SKILL.md file — use the skill directory path, not the project root):
   ```bash
   python <SKILL_DIR>/merge-subdomain-graphs.py $PROJECT_ROOT
   ```
   The script discovers subdomain graphs, loads the existing `knowledge-graph.json` as a base (if present), and merges everything into `knowledge-graph.json` (deduplicating nodes and edges). Report the merge summary to the user, then continue with the merged graph.

5. Check if `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists. If it does, read it.
6. Check if `$PROJECT_ROOT/.understand-anything/meta.json` exists. If it does, read it to get `gitCommitHash`.
7. **Decision logic:**

   | Condition | Action |
   |---|---|
   | `--full` flag in `$ARGUMENTS` | Full analysis (all phases). Also clear all phase checkpoints: `rm -f $PROJECT_ROOT/.understand-anything/intermediate/phase-*.json` |
   | No existing graph or meta | Full analysis (all phases) |
   | `--review` flag + existing graph + unchanged commit hash | Skip to Phase 7 (review-only — reuse existing assembled graph) |
   | Existing graph + unchanged commit hash | Ask the user: "The graph is up to date at this commit. Would you like to: **(a)** run a full rebuild (`--full`), **(b)** run the LLM graph reviewer (`--review`), or **(c)** do nothing?" Then follow their choice. If they pick (c), STOP. |
   | Existing graph + changed files | Incremental update (re-analyze changed files only) |

   **Review-only path:** Copy the existing `knowledge-graph.json` to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`, then jump directly to Phase 7 step 3.

   For incremental updates, get the changed file list:
   ```bash
   git diff <lastCommitHash>..HEAD --name-only
   ```
   If this returns no files, report "Graph is up to date" and STOP.

8. **Collect project context for subagent injection:**
   - Read `README.md` (or `README.rst`, `readme.md`) from `$PROJECT_ROOT` if it exists. Store as `$README_CONTENT` (first 3000 characters).
   - Read the primary package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`) if it exists. Store as `$MANIFEST_CONTENT`.
   - Capture the top-level directory tree:
     ```bash
     find $PROJECT_ROOT -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100
     ```
     Store as `$DIR_TREE`.
   - Detect the project entry point by checking for common patterns (in order): `src/index.ts`, `src/main.ts`, `src/App.tsx`, `index.js`, `App.tsx`, `App.js`, `main.py`, `manage.py`, `app.py`, `wsgi.py`, `asgi.py`, `run.py`, `__main__.py`, `main.go`, `cmd/*/main.go`, `src/main.rs`, `src/lib.rs`, `src/main/java/**/Application.java`, `app/src/main/java/**/MainActivity.kt`, `app/src/main/java/**/MainActivity.java`, `Program.cs`, `config.ru`, `index.php`, `AppDelegate.swift`, `*App.swift`, `SceneDelegate.swift`, `lib/main.dart`. Store first match as `$ENTRY_POINT`.

---

## Phase 0.5 — Ignore Configuration

Set up and verify the `.understandignore` file before scanning.

1. Check if `$PROJECT_ROOT/.understand-anything/.understandignore` exists.
2. **If it does NOT exist**, generate a starter file:
   - Run the following Node.js one-liner in `$PROJECT_ROOT` (reads `.gitignore` and deduplicates against built-in defaults):
     ```bash
     node -e "
     const fs = require('fs');
     const path = require('path');
     const root = process.cwd();
     const defaults = ['node_modules/','node_modules','.git/','vendor/','venv/','.venv/','__pycache__/','dist/','dist','build/','build','out/','coverage/','coverage','.next/','.cache/','.turbo/','target/','obj/','*.lock','package-lock.json','yarn.lock','pnpm-lock.yaml','*.png','*.jpg','*.jpeg','*.gif','*.svg','*.ico','*.woff','*.woff2','*.ttf','*.eot','*.mp3','*.mp4','*.pdf','*.zip','*.tar','*.gz','*.min.js','*.min.css','*.map','*.generated.*','.idea/','.vscode/','.vs/','.fleet/','*.swp','*.swo','*~','.gitlab-ci.yml','.github/','.cursor/','.claude/','.copilot/','.aider*','.continue/','.codeium/','.tabnine/','.sourcegraph/','.understand-anything/','LICENSE','.gitignore','.editorconfig','.prettierrc','.eslintrc*','*.log','*.a','*.dylib','*.so','*.dll','*.lib','*.dat','*.bin','*.db','*.sqlite','*.aar','*.jar','*.xcframework/','Pods/'];
     const norm = p => p.replace(/\/+$/, '');
     const defaultSet = new Set(defaults.map(norm));
     const header = '# .understandignore — patterns for files/dirs to exclude from analysis\n# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)\n# Lines below are suggestions — uncomment to activate.\n# Use ! prefix to force-include something excluded by defaults.\n#\n# Built-in defaults (always excluded unless negated):\n#   node_modules/, .git/, dist/, build/, obj/, .understand-anything/,\n#   .idea/, .vscode/, .vs/, .fleet/, .cursor/, .claude/, .copilot/,\n#   .continue/, .codeium/, .tabnine/, .sourcegraph/, .aider*,\n#   *.lock, *.min.js, *.swp, *.swo, *~, etc.\n#\n';
     let body = '';
     const gitignorePath = path.join(root, '.gitignore');
     if (fs.existsSync(gitignorePath)) {
       const gi = fs.readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).filter(p => !defaultSet.has(norm(p)));
       if (gi.length) { body += '# --- From .gitignore (uncomment to exclude) ---\n\n' + gi.map(p => '# ' + p).join('\n') + '\n\n'; }
     }
     const dirs = ['__tests__','test','tests','fixtures','testdata','docs','examples','scripts','migrations','.storybook'];
     const found = dirs.filter(d => fs.existsSync(path.join(root, d)));
     if (found.length) { body += '# --- Detected directories (uncomment to exclude) ---\n\n' + found.map(d => '# ' + d + '/').join('\n') + '\n\n'; }
     body += '# --- Test file patterns (uncomment to exclude) ---\n\n# *.test.*\n# *.spec.*\n# *.snap\n';
     const outDir = path.join(root, '.understand-anything');
     if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
     fs.writeFileSync(path.join(outDir, '.understandignore'), header + body);
     "
     ```
   - Report to the user:
     > Generated `.understand-anything/.understandignore` with suggested exclusions based on your project structure. Please review it and uncomment any patterns you'd like to exclude from analysis. When ready, confirm to continue.
   - **Wait for user confirmation before proceeding.**
3. **If it already exists**, report:
   > Found `.understand-anything/.understandignore`. Review it if needed, then confirm to continue.
   - **Wait for user confirmation before proceeding.**
4. After confirmation, proceed to Phase 1.

---

## Phase 1 — SCAN (Full analysis only)

Report to the user: `[Phase 1/8] Scanning project files...`

Dispatch a subagent using the `project-scanner` agent definition (at `agents/project-scanner.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Package manifest:
> ```
> $MANIFEST_CONTENT
> ```
>
> Use this context to produce more accurate project name, description, and framework detection. The README and manifest are authoritative — prefer their information over heuristics.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Scan this project directory to discover all project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts and `fileCategory` per file (`code`, `config`, `docs`, `infra`, `data`, `script`, `markup`)
- Complexity estimate
- Import map (`importMap`): pre-resolved project-internal imports per file (non-code files have empty arrays)

Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 3 batch construction.
Store the file list as `$FILE_LIST` with `fileCategory` metadata for use in Phase 3 batch construction.

**Gate check:** If >100 files, inform the user and suggest scoping with a subdirectory argument. Proceed only if user confirms or add guidance that this may take a while.

If the scan result includes `filteredByIgnore > 0`, report:
> Excluded {filteredByIgnore} files via `.understandignore`.

---

## Phase 1.5 — STRUCTURAL (Deterministic extraction + source index)

Report: `[Phase 1.5/8] Extracting structure and building source index...`

This phase runs **before** batch computation. It uses `reextract-structure.mjs` with `--skip-scan` to reuse Phase 1's scan results. The tmp directory is preserved for downstream pipeline use (cleanup happens in Phase 8).

```bash
node <SKILL_DIR>/reextract-structure.mjs $PROJECT_ROOT --skip-scan
```

The script handles: import resolution, tree-sitter extraction, structural-analysis.json generation, and source index building. The structural index includes AST-resolved callgraph metadata where supported, such as `callerQualifiedName`, `calleeOwner`, `calleeQualifiedName`, and `argumentCount`. The rule engine consumes these fields to emit deterministic `calls` edges before LLM batch analysis; `/understand-query structure --callee/--caller --exact` uses the same fields for precise call-site lookup.

After the script, run the rule engine separately (not included in reextract-structure.mjs):

```bash
node <SKILL_DIR>/rule-engine-postprocess.mjs \
  $PROJECT_ROOT/.understand-anything/tmp/ua-extract-results-full.json \
  $PROJECT_ROOT/.understand-anything/tmp/rule-engine-results.json \
  --mode=extraction-input
```

After this phase completes, the following files exist:
- `.understand-anything/tmp/ua-extract-results-full.json` — raw extraction results
- `.understand-anything/tmp/rule-engine-results.json` — annotation-driven edges
- `.understand-anything/intermediate/extraction/structural-analysis.json` — file-path-indexed extraction
- `.understand-anything/intermediate/extraction/source-index.json` — source search index

---

## Phase 2 — BATCH + ANALYZE

Report: `[Phase 2/8] Computing structural batches...`

Reads `.understand-anything/intermediate/scan-result.json`, writes `.understand-anything/intermediate/batches.json`.

**Tunable parameters:**

| Flag | Default | When to adjust |
|---|---|---|
| `--min-batch-size` | 8 | Raise (12→15) to merge more small batches |
| `--max-merge-target` | 40 | Raise (50→60) to allow larger misc batches |
| `--max-community-size` | 50 | Raise (60→70) for fewer, larger batches; lower (35) for stricter modularity |
| `--exclude-hubs` | off | Set to N to exclude files with degree > N from Louvain (e.g., `--exclude-hubs=50`). Hub files are reassigned to their strongest importing batch after community detection. |
| `--max-dirs-per-batch` | off | Set to N to split batches spanning > N second-level directories (e.g., `--max-dirs-per-batch=2`). Prevents mixing unrelated business directories in one batch. |
| `--dry-run` | off | Preview diagnostics only, do not write batches.json |

### Step 1: Dry-run preview

Run with `--dry-run` first to preview batching quality:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT --dry-run 2>&1
```

Capture stderr. Extract:
- `Diagnostic:` line — batch count, avg size, intra-edge ratio, absorbed count, current params
- `Recommendation:` line — quality assessment (HIGH/MODERATE/LOW)
- Per-batch listings — each batch's file count, directories, and intra-edge count

### Step 2: Analyze quality

Evaluate using these criteria:

**Good enough → proceed to Step 4:**
- `Recommendation: quality=HIGH`
- Batch count reasonable (target: ~15–25 files per batch)
- No more than 20% singletons (≤2 files)

**Needs tuning → proceed to Step 3:**

| Symptom | Adjustment |
|---|---|
| Many small batches (≤5 files) with 0–1 intra-edges | Raise `--min-batch-size` (8→12→15) |
| Singleton batches that should have been merged | Raise `--min-batch-size` |
| Batches mixing files from many unrelated directories | Raise `--max-community-size` (50→60→70) |
| Misc batches too large or too many | Raise `--max-merge-target` (40→50→60) |
| Overall too many batches for project size | Raise `--min-batch-size` first, then `--max-merge-target` |
| `quality=LOW` and intra-edge < 40% | Raise `--min-batch-size` + `--max-community-size` |
| Per-batch intra-ratio < 20% for many batches | Raise `--min-batch-size` to consolidate weak batches |
| Hub files detected (hub-files > 0 in Diagnostic) | Try `--exclude-hubs=N` where N is slightly below the lowest hub degree |
| Mixed-dir batches in Coherence output | Try `--max-dirs-per-batch=2` to enforce directory boundaries |

### Step 3: Adjust and re-preview (max 3 rounds)

Apply the adjustment, re-run `--dry-run` to verify:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT --dry-run \
  --min-batch-size=N [--max-merge-target=N] [--max-community-size=N] 2>&1
```

Check that previously good batches still have similar file compositions. If a good batch now has completely different files, roll back the change.

Return to Step 2. **Max 3 tuning rounds** — after 3 rounds, proceed with the best parameters seen.

### Step 4: Final run

Run without `--dry-run` using the chosen parameters:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  [--min-batch-size=N] [--max-merge-target=N] [--max-community-size=N]
```

Capture stderr. Append any `Warning:` lines to `$PHASE_WARNINGS`. Report the final `Diagnostic:` line to the user.

**Automatic weak-batch absorption.** The script automatically absorbs weak batches (≤5 files, intra-edge <20%) into their strongest neighbor. `Diagnostic:` reports `absorbed=N`. This needs no tuning — only intervene if absorption can't solve the problem.

If the script exits non-zero, relay the full stderr to the user as a Phase 2 failure. Do not attempt to recover — the script's internal fallback (count-based) already handles recoverable issues.

After batching completes, read the detailed step instructions from the `phases/` subdirectory:

1. **Per-batch splitting + dispatch plan** → Read `./phases/step0-structural.md` (Steps 0c.6 and 0d only — structural extraction already completed in Phase 1.5)
2. **Agent dispatch + quality gate** → Read `./phases/step1-dispatch.md` (Steps 1–1.7: file-analyzer dispatch, quality validation, selective retry, recovery fallback)
3. **Merge** → Read `./phases/step2-merge.md` (Step 2: merge-batch-graphs.py, normalization, tested_by linker)

For **incremental updates** (changed files only), read `./phases/incremental.md` instead of following the full path above.

---

## Phase 4 — ASSEMBLE REVIEW

Report to the user: `[Phase 4/8] Reviewing assembled graph...`

Dispatch a subagent using the `assemble-reviewer` agent definition (at `agents/assemble-reviewer.md`).

Pass these parameters in the dispatch prompt:

> Review the assembled graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Batch files are at: `$PROJECT_ROOT/.understand-anything/intermediate/batch-*.json`
> Write review output to: `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json`
>
> **Merge script report:**
> ```
> <paste the full stderr output from merge-batch-graphs.py>
> ```
>
> **Import map for cross-batch edge verification:**
> ```json
> $IMPORT_MAP
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/assemble-review.json` and add any notes to `$PHASE_WARNINGS`.

**Checkpoint:** Write `$PROJECT_ROOT/.understand-anything/intermediate/phase-3-assemble-review.json` with the review result and `_checkpoint: { status: "complete" }`. On resume (non-`--full` runs), if this checkpoint exists and is valid, skip Phase 3.

---

## Phase 5 — ARCHITECTURE

Report to the user: `[Phase 5/8] Identifying architectural layers...`

**Build the combined prompt template:**
 1. Use the `architecture-analyzer` agent definition (at `agents/architecture-analyzer.md`).
 2. **Language context injection:** For each language detected in Phase 1 (e.g., `python`, `markdown`, `dockerfile`, `yaml`, `sql`, `terraform`, `graphql`, `protobuf`, `shell`, `html`, `css`), read the file at `./languages/<language-id>.md` (e.g., `./languages/python.md`, `./languages/dockerfile.md`) and append its content after the base template under a `## Language Context` header. If the file does not exist for a detected language, skip it silently and continue. These files are in the `languages/` subdirectory next to this SKILL.md file. **Include non-code language snippets** — they provide edge patterns and summary styles for non-code files.
 3. **Framework addendum injection:** For each framework detected in Phase 1 (e.g., `Django`), read the file at `./frameworks/<framework-id-lowercase>.md` (e.g., `./frameworks/django.md`) and append its full content after the language context. If the file does not exist for a detected framework, skip it silently and continue. These files are in the `frameworks/` subdirectory next to this SKILL.md file.
 4. **Output locale injection:** If `$OUTPUT_LANGUAGE` is NOT `en` (English), read the locale guidance file at `./locales/<language-code>.md` (e.g., `./locales/zh.md`, `./locales/ja.md`, `./locales/ko.md`) and append its content after the framework addendums under a `## Output Language Guidelines` header. This provides language-specific guidance for tag naming conventions, summary style, and layer name translations. If the locale file does not exist for the specified language, skip silently — the `$LANGUAGE_DIRECTIVE` still applies. These files are in the `locales/` subdirectory next to this SKILL.md file.

Append the language/framework context and the following additional context to the agent's prompt:

> **Additional context from main session:**
>
> Frameworks detected: `<frameworks from Phase 1>`
>
> Directory tree (top 2 levels):
> ```
> $DIR_TREE
> ```
>
> Use the directory tree, language context, and framework addendums (appended above) to inform layer assignments. Directory structure is strong evidence for layer boundaries. Non-code files (config, docs, infrastructure, data) should be assigned to appropriate layers — see the prompt template for guidance.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Analyze this codebase's structure to identify architectural layers.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/layers.json`
> Project: `<projectName>` — `<projectDescription>`
>
> File nodes (all node types — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, type, name, filePath, summary, tags} for ALL file-level nodes — omit complexity, languageNotes]
> ```
>
> Import edges:
> ```json
> [list of edges with type "imports"]
> ```
>
> All edges (for cross-category analysis — includes configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/layers.json` and normalize it into a final `layers` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "layers": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any layer object has a `nodes` field instead of `nodeIds`, rename `nodes` → `nodeIds`. If `nodes` entries are objects with an `id` field rather than plain strings, extract just the `id` values into `nodeIds`.
3. **Synthesize missing IDs:** If any layer is missing an `id`, generate one as `layer:<kebab-case-name>`.
4. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
5. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.

Each element of the final `layers` array MUST have this shape:

```json
[
  {
    "id": "layer:<kebab-case-name>",
    "name": "<layer name>",
    "description": "<what belongs in this layer>",
    "nodeIds": ["file:src/App.tsx", "config:tsconfig.json", "document:README.md"]
  }
]
```

All four fields (`id`, `name`, `description`, `nodeIds`) are required.

**For incremental updates:** Always re-run architecture analysis on the full merged node set, since layer assignments may shift when files change.

**Context for incremental updates:** When re-running architecture analysis, also inject the previous layer definitions:

> Previous layer definitions (for naming consistency):
> ```json
> [previous layers from existing graph]
> ```
>
> Maintain the same layer names and IDs where possible. Only add/remove layers if the file structure has materially changed.

**Non-empty guard:** After normalization, verify `layers.length > 0`. If the subagent produced zero layers (empty file, parse failure, or subagent timeout), **retry Phase 5 once**. If the retry also produces zero layers, halt with a clear error message: `"Phase 5 failed: no layers produced after retry. Cannot continue — dashboard requires at least 1 layer."` Do NOT proceed to Phase 6 with empty layers.

**Checkpoint:** Write `$PROJECT_ROOT/.understand-anything/intermediate/phase-5-layers.json` with the normalized layers array and `_checkpoint: { status: "complete" }`. On resume (non-`--full` runs), if this checkpoint exists and is valid **and contains at least 1 layer**, skip Phase 5 and load layers from the checkpoint. If the checkpoint exists but contains zero layers, treat it as invalid and re-run Phase 5.

---

## Phase 6 — TOUR

Report to the user: `[Phase 6/8] Building guided tour...`

Dispatch a subagent using the `tour-builder` agent definition (at `agents/tour-builder.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Project entry point: `$ENTRY_POINT`
>
> Use the README to align the tour narrative with the project's own documentation. Start the tour from the entry point if one was detected. The tour should tell the same story the README tells, but through the lens of actual code structure.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Create a guided learning tour for this codebase.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/tour.json`
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages>`
>
> Nodes (all file-level nodes — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, name, filePath, summary, type} for ALL file-level nodes — do NOT include function or class nodes]
> ```
>
> Layers:
> ```json
> [list of {id, name, description} for each layer — omit nodeIds]
> ```
>
> Edges (all types — includes imports, calls, configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types for complete graph topology analysis]
> ```

After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/tour.json` and normalize it into a final `tour` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "steps": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any step has `nodesToInspect` instead of `nodeIds`, rename it → `nodeIds`. If any step has `whyItMatters` instead of `description`, rename it → `description`.
3. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
4. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.
5. **Sort** by `order` before saving.

Each element of the final `tour` array MUST have this shape:

```json
[
  {
    "order": 1,
    "title": "Project Overview",
    "description": "Start with the README to understand the project's purpose and architecture.",
    "nodeIds": ["document:README.md"]
  },
  {
    "order": 2,
    "title": "Application Entry Point",
    "description": "This step explains how the frontend boots and mounts.",
    "nodeIds": ["file:src/main.tsx", "file:src/App.tsx"]
  }
]
```

Required fields: `order`, `title`, `description`, `nodeIds`. Preserve optional `languageLesson` when present.

**Non-empty guard:** After normalization, verify `tour.length > 0`. If the subagent produced zero tour steps, **retry Phase 6 once**. If the retry also produces zero steps, log a warning: `"Phase 6 warning: no tour steps produced. Dashboard tour feature will be unavailable."` — proceed to Phase 7 but mark the issue for the final report.

**Checkpoint:** Write `$PROJECT_ROOT/.understand-anything/intermediate/phase-6-tour.json` with the normalized tour array and `_checkpoint: { status: "complete" }`. On resume (non-`--full` runs), if this checkpoint exists and is valid **and contains at least 1 tour step**, skip Phase 6 and load the tour from the checkpoint. If the checkpoint exists but contains zero steps, treat it as invalid and re-run Phase 6.

---

## Phase 7 — REVIEW

Report to the user: `[Phase 7/8] Validating knowledge graph...`

Assemble the full KnowledgeGraph JSON object:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 4 review>],
  "edges": [<all edges from assembled-graph.json after Phase 4 review>],
  "layers": [<layers from Phase 5>],
  "tour": [<steps from Phase 6>]
}
```

1. Before writing the assembled graph, validate that:
   - `layers` is an array of objects with these required fields: `id`, `name`, `description`, `nodeIds`
   - `layers` is **NOT empty** — at least 1 layer MUST exist. If `layers` is empty (`[]`), this means Phase 5 failed or was skipped. **You MUST re-run Phase 5 before continuing.** Do NOT save a knowledge graph with zero layers — the dashboard's structural view requires layers to render and will show a blank canvas without them.
   - `tour` is an array of objects with these required fields: `order`, `title`, `description`, `nodeIds`
   - `tour` is **NOT empty** — at least 1 tour step MUST exist. If `tour` is empty (`[]`), this means Phase 6 failed or was skipped. **You MUST re-run Phase 6 before continuing.** Do NOT save a knowledge graph with zero tour steps.
   - `tour[*].languageLesson` is allowed as an optional string field
   - Every `layers[*].nodeIds` entry exists in the merged node set
   - Every `tour[*].nodeIds` entry exists in the merged node set

   If structural validation fails (missing fields, dangling refs), automatically normalize and rewrite the graph into this shape before saving. If the graph still fails final validation after the normalization pass, save it with warnings but mark dashboard auto-launch as skipped.

   **CRITICAL:** If `layers` or `tour` is empty after Phase 5/6, this is a **blocking error**, not a warning. Re-run the missing phase(s) before proceeding to Phase 7.

2. Write the assembled graph to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.

3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): deterministic validation via core schemas

Run the shared validation script (uses `@understand-anything/core` zod schemas with auto-fix):

```bash
node <SKILL_DIR>/validate-graph.mjs \
  "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/review.json"
```

If the script exits non-zero (1=fatal, 2=dropped issues), read the report and log warnings. Continue to Phase 8 — the report captures what was auto-corrected or dropped.

---

#### `--review` path: full LLM reviewer

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the `graph-reviewer` agent definition (at `agents/graph-reviewer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-5]
>
> Cross-validate: every file in the scan inventory should have a corresponding node in the graph (node types may vary: `file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`). Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/review.json`

---

4. Read `$PROJECT_ROOT/.understand-anything/intermediate/review.json`.

5. **If `issues` array is non-empty:**
   - Review the `issues` list
   - Apply automated fixes where possible:
     - Remove edges with dangling references
     - Fill missing required fields with sensible defaults (e.g., empty `tags` -> `["untagged"]`, empty `summary` -> `"No summary available"`)
     - Remove nodes with invalid types
   - Re-run the final graph validation after automated fixes
   - If critical issues remain after one fix attempt, save the graph anyway but include the warnings in the final report and mark dashboard auto-launch as skipped

6. **If `issues` array is empty:** Proceed to Phase 7.

**Checkpoint:** Write `$PROJECT_ROOT/.understand-anything/intermediate/phase-7-review.json` with the review result and `_checkpoint: { status: "complete" }` (or `"degraded"` if issues remain). On resume (non-`--full` runs), if this checkpoint exists and is valid/complete, skip Phase 7.

---

## Phase 8 — SAVE

Report to the user: `[Phase 8/8] Saving knowledge graph...`

1. Write the final knowledge graph to `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.

   **Include ALL required `project` fields (must match `ProjectMetaSchema` from `@understand-anything/core`):**
   ```json
   {
     "project": {
       "name": "...",
       "description": "...",
       "languages": ["java", "kotlin", ...],
       "frameworks": ["Spring Boot", ...],
       "analyzedAt": "<ISO 8601 timestamp>",
       "gitCommitHash": "<current commit hash>",
       "provenance": {
         "generationMode": "full",
         "completedStages": ["scan", "batch", "extract", "analyze", "merge", "validate"],
         "degraded": false,
         "gitCommitHash": "<current commit hash>",
         "toolVersion": "<plugin version from package.json>",
         "analyzedAt": "<ISO 8601 timestamp>"
       }
     }
   }
   ```
   **CRITICAL**: `analyzedAt` and `gitCommitHash` must be present at BOTH the `project` top level AND inside `provenance`. The dashboard's `validateGraph()` will reject the KG with `"Missing or invalid project metadata"` if any of these top-level fields are missing: `name`, `description`, `languages`, `frameworks`, `analyzedAt`, `gitCommitHash`.
   - Use `generationMode: "incremental"` when running with `--changed-files` (incremental update).
   - Use `generationMode: "standalone"` when the graph was built without full extraction.
   - Set `degraded: true` only if Phase 7 checkpoint status was "degraded".
   - `completedStages` must list every phase that actually ran and succeeded.

2. **Generate structural fingerprints baseline.** This creates the basis for future automatic incremental updates and **must succeed before `meta.json` is written** — otherwise auto-update sees a fresh commit hash with no fingerprints to compare against, classifies every file as STRUCTURAL, and escalates to `FULL_UPDATE` on every subsequent commit (issue #152).

   Write the input file:
   ```bash
   cat > $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json <<EOF
   {
     "projectRoot": "$PROJECT_ROOT",
     "sourceFilePaths": [<all source file paths from Phase 1, as JSON array>],
     "gitCommitHash": "<current commit hash>"
   }
   EOF
   ```

   Then invoke the bundled script (located next to this SKILL.md):
   ```bash
   node <SKILL_DIR>/build-fingerprints.mjs \
     $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json
   ```

   The script uses `TreeSitterPlugin + PluginRegistry` exactly like `extract-structure.mjs`, so the baseline matches the comparison logic used during auto-updates.

   **If the script exits non-zero or stdout does not include `Fingerprints baseline:`, abort Phase 8 and report the error. Do NOT proceed to step 3 (writing `meta.json`).**

3. Write metadata to `$PROJECT_ROOT/.understand-anything/meta.json` (only after step 2 succeeded):
   ```json
   {
     "lastAnalyzedAt": "<ISO 8601 timestamp>",
     "gitCommitHash": "<commit hash>",
     "version": "1.0.0",
     "analyzedFiles": <number of files analyzed>
   }
   ```

4. **MANDATORY — Schema validation** (run BEFORE cleanup):
   ```bash
   node <SKILL_DIR>/validate-artifact.mjs \
     $PROJECT_ROOT/.understand-anything/knowledge-graph.json \
     knowledge-graph:complete
   ```
   If validation fails, DO NOT proceed. Fix the missing fields and re-write `knowledge-graph.json`, then re-validate.

5. Clean up intermediate files, **preserving `scan-result.json`** and **`extraction/`** for downstream skill reuse:
   ```bash
   # Preserve scan-result.json — Phase 1's deterministic file inventory.
   # Future incremental runs (Phase 3 compute-batches.mjs --changed-files=…)
   # need this inventory; without it, Phase 1 must re-dispatch and pay ~157k
   # tokens / ~158s per incremental run.
   #
   # Preserve extraction results — contain function signatures, params,
   # returnType, and annotations that the KG summary nodes do not retain.
   # Downstream skills (wiki, query) can use these for richer code analysis.
   INTER="$PROJECT_ROOT/.understand-anything/intermediate"
   mkdir -p "$INTER/extraction"
   # Copy global extraction results (already in file-path-indexed format)
   # for downstream skills (wiki, query) to use for richer code analysis.
   cp $PROJECT_ROOT/.understand-anything/tmp/structural-analysis.json \
      "$INTER/extraction/structural-analysis.json" 2>/dev/null || true

   if [ -d "$INTER" ]; then
     find "$INTER" -mindepth 1 -maxdepth 1 \
       -not -name 'scan-result.json' \
       -not -name 'extraction' \
       -exec rm -rf {} +
   fi
   rm -rf $PROJECT_ROOT/.understand-anything/tmp
   ```

6. **Build source code search index.** After structural-analysis.json is preserved, build the serialized MiniSearch index for full-text source search (`understand-query` source command):
   ```bash
   node <SKILL_DIR>/build-source-index.mjs "$PROJECT_ROOT"
   ```

   The script reads `structural-analysis.json`, chunks source files by AST boundaries (function/class/header/gap), builds an inverted index via MiniSearch, and serializes to `source-index.json`. The serialized file only contains the inverted index and metadata references (filePath, startLine, endLine) — NOT raw source content — keeping file size small (~5-12MB for large projects).

   **If the script exits non-zero**, log a warning but do NOT abort — source search is a non-critical enhancement. The dashboard and query commands will fall back to building the index on-demand at query time.

7. Report a summary to the user containing:
   - Project name and description
   - Files analyzed / total files (with breakdown by fileCategory: code, config, docs, infra, data, script, markup)
   - Nodes created (broken down by type: file, function, class, config, document, service, table, endpoint, pipeline, schema, resource)
   - Edges created (broken down by type)
   - Layers identified (with names)
   - Tour steps generated (count)
   - Source index status (chunks indexed, file size)
   - Any warnings from the reviewer
   - Path to the output file: `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`

8. Do NOT automatically launch the dashboard. Instead, report the manual launch command to the user:
   ```
   cd <PLUGIN_ROOT>/packages/dashboard && GRAPH_DIR=$PROJECT_ROOT npx vite --host 0.0.0.0
   ```
   Or instruct the user to run `/understand-dashboard $PROJECT_ROOT`.

---

## Error Handling

Read the full error handling strategy from `./docs/error-handling.md` — it covers the unified failure strategy for extraction (hard abort), subagent dispatches (retry-then-skip), and the `$PHASE_WARNINGS` tracking mechanism.

---

## Reference: KnowledgeGraph Schema

Read the full schema reference from `./docs/schema-reference.md` — it lists all 14 node types, 27 edge types, and edge weight conventions.

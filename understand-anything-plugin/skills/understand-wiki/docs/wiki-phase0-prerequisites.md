## Phase 0 — Detection and Prerequisites

### Step 1 — Resolve PROJECT_ROOT and Determine Mode

**Rule: Default is single-service. Batch mode requires explicit `--batch` or `--service=` flag.**

```bash
WIKI_SESSION_ID="$$-$(date +%s)"

# Determine execution mode — explicit over implicit
if echo "$ARGUMENTS" | grep -q '\-\-service='; then
  # --service=<name> implies batch context (running from parent dir targeting a child)
  MODE="single"
  SERVICE_NAME=$(echo "$ARGUMENTS" | sed -n 's/.*--service=\([^ ]*\).*/\1/p')
  PROJECT_ROOT=$(pwd)
  SERVICE_ROOT="$PROJECT_ROOT/$SERVICE_NAME"
  if [ ! -d "$SERVICE_ROOT" ]; then
    echo "Error: Service directory \"${SERVICE_NAME}\" not found in $(pwd)"
    echo "Available directories:"
    ls -d */ 2>/dev/null | head -20
    exit 1
  fi
elif echo "$ARGUMENTS" | grep -q '\-\-batch'; then
  # Explicit batch mode — current directory is parent
  MODE="batch"
  PROJECT_ROOT=$(pwd)
else
  # DEFAULT: treat current directory as a single service
  MODE="single"
  SERVICE_ROOT=$(pwd)
  SERVICE_NAME=$(basename "$SERVICE_ROOT")
  PROJECT_ROOT=$(dirname "$SERVICE_ROOT")
fi
```

Report the detected mode:
> `Mode: <single|batch>. Service: <name|all>. Project root: "$PROJECT_ROOT"`

### Step 2 — Worktree Redirect

Apply the same worktree detection logic as `/understand`:

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[understand-wiki] Detected git worktree. Redirecting to: $MAIN_ROOT"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
```

### Step 3 — Resolve Plugin Root

```bash
SKILL_REAL=$(realpath ~/.agents/skills/understand-wiki 2>/dev/null || readlink -f ~/.agents/skills/understand-wiki 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-wiki 2>/dev/null || readlink -f ~/.copilot/skills/understand-wiki 2>/dev/null || echo "")
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
  exit 1
fi
```

### Step 3b — Dry-Run (When `--dry-run` is Present)

If `$ARGUMENTS` contains `--dry-run`, run the planner and **stop** — no wiki-worker dispatch, no file writes:

```bash
SKILL_DIR="$PLUGIN_ROOT/skills/understand-wiki"
if [ "$MODE" = "batch" ]; then
  python3 "$SKILL_DIR/wiki_dry_run.py" "$PROJECT_ROOT"
else
  python3 "$SKILL_DIR/wiki_dry_run.py" "$SERVICE_ROOT"
fi
```

Print the script output to the user and exit 0. See [Dry-Run Mode](wiki-quality-gate.md#dry-run-mode) for the expected report format.

### Step 4 — Language Configuration

```bash
SKILL_DIR="$PLUGIN_ROOT/skills/understand-wiki"

# Parse --language flag
OUTPUT_LANGUAGE=""
if echo "$ARGUMENTS" | grep -q '\-\-language'; then
  OUTPUT_LANGUAGE=$(echo "$ARGUMENTS" | sed -n 's/.*--language[= ]\([^ ]*\).*/\1/p')
fi

# Normalize friendly names to ISO codes
case "$OUTPUT_LANGUAGE" in
  chinese) OUTPUT_LANGUAGE="zh" ;;
  japanese) OUTPUT_LANGUAGE="ja" ;;
  korean) OUTPUT_LANGUAGE="ko" ;;
  english) OUTPUT_LANGUAGE="en" ;;
  spanish) OUTPUT_LANGUAGE="es" ;;
  french) OUTPUT_LANGUAGE="fr" ;;
  german) OUTPUT_LANGUAGE="de" ;;
esac

# If --language was explicitly set, persist to service config.json
# so upstream skills (/understand, /understand-domain) pick it up
# even when dispatched without --language in $SKILL_ARGS.
if [ -n "$OUTPUT_LANGUAGE" ]; then
  mkdir -p "$SERVICE_ROOT/.understand-anything"
  CONFIG_FILE="$SERVICE_ROOT/.understand-anything/config.json"
  if [ -f "$CONFIG_FILE" ]; then
    python3 -c "
import json, sys
p = sys.argv[1]
with open(p) as f: cfg = json.load(f)
cfg['outputLanguage'] = sys.argv[2]
with open(p, 'w') as f: json.dump(cfg, f, indent=2, ensure_ascii=False)
" "$CONFIG_FILE" "$OUTPUT_LANGUAGE"
  else
    echo "{\"outputLanguage\": \"$OUTPUT_LANGUAGE\"}" > "$CONFIG_FILE"
  fi
fi

# Fall back to config, then default
if [ -z "$OUTPUT_LANGUAGE" ]; then
  if [ -f "$SERVICE_ROOT/.understand-anything/config.json" ]; then
    OUTPUT_LANGUAGE=$(python3 "$SKILL_DIR/wiki_json_reader.py" "$SERVICE_ROOT/.understand-anything/config.json" "outputLanguage" "en")
  else
    OUTPUT_LANGUAGE="en"
  fi
fi
```

Build `$LANGUAGE_DIRECTIVE`:
```
> **Language directive**: Generate all textual content in **{OUTPUT_LANGUAGE}**. Maintain technical accuracy while using natural, native-level phrasing. Keep technical terms in English when no standard translation exists.
```

**Locale guidance injection:** If `$OUTPUT_LANGUAGE` is NOT `en`, read the locale guidance file at `$SKILL_DIR/locales/<language-code>.md` (e.g., `$SKILL_DIR/locales/zh.md`, `$SKILL_DIR/locales/ja.md`, `$SKILL_DIR/locales/ko.md`). If the file exists, store its contents as `$WIKI_LOCALE_GUIDANCE`. This will be appended to the wiki-worker dispatch prompt under a `## Wiki Locale Guidance` header to provide language-specific formatting conventions for summaries, ubiquitous language, business rules, and technical term retention. If the locale file does not exist for the specified language, skip silently — the `$LANGUAGE_DIRECTIVE` still applies.

### Step 4.5 — RPC Annotations Configuration

**Built-in frameworks are always detected** — the file-analyzer automatically recognizes the following annotations and emits `provides_rpc` / `consumes_rpc` / `publishes` / `subscribes` edges without any configuration:

| Annotation | Framework | Edge type |
|---|---|---|
| `@DubboService` / `@DubboReference` | Dubbo | `provides_rpc` / `consumes_rpc` |
| `@MoaProvider` / `@MoaConsumer` | MOA | `provides_rpc` / `consumes_rpc` |
| `@FeignClient` | Spring Cloud | `consumes_rpc` |
| `@GrpcService` / `@GrpcClient` | gRPC | `provides_rpc` / `consumes_rpc` |
| `@KafkaTemplate` / `@KafkaListener` | Spring Kafka | `publishes` / `subscribes` |

**`rpcAnnotations` in `config.json` is only needed for custom frameworks** not in the built-in list above. When present, custom entries are merged with the built-in annotations — they never override or disable built-in detection.

**Schema** — `rpcAnnotations` is an array of objects:

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | string | yes | Provider annotation class name (e.g. `"@CustomRpcProvider"`) |
| `consumer` | string | yes | Consumer annotation class name (e.g. `"@CustomRpcConsumer"`) |
| `type` | string | yes | Framework identifier used in graph tags and matchers (e.g. `"custom-rpc"`) |
| `interfaceField` | string | no | Annotation attribute that holds the RPC interface name; defaults to `"value"` |

**Example `config.json`:**

Parent-level batch config may also set `excludeServices` (basename list, case-sensitive) to skip shared libraries during service discovery:

```json
{ "excludeServices": ["common", "shared", "libs", "tools"] }
```

Service-level custom RPC annotations (only needed for non-built-in frameworks):

```json
{
  "outputLanguage": "zh",
  "rpcAnnotations": [
    { "provider": "@CustomRpcProvider", "consumer": "@CustomRpcConsumer", "type": "custom-rpc", "interfaceField": "service" }
  ]
}
```

**Behavior:**
- Missing or empty `rpcAnnotations` → built-in annotations (Dubbo, MOA, Feign, gRPC, Kafka) are still detected automatically. Only custom framework detection is unavailable.
- Non-empty `rpcAnnotations` → custom entries are merged with built-in annotations, passed to wiki-worker and `/understand` so analyzers emit RPC edges for both built-in and custom frameworks.

**Load and validate** (optional sanity check before generation):

```bash
python3 "$PLUGIN_ROOT/skills/understand-wiki/wiki_config_validator.py" \
  "$SERVICE_ROOT/.understand-anything/config.json"
```

Or from Python: `load_and_merge_config(path)` returns `(config, valid, errors)`; invalid configs should be reported to the user before proceeding.

**Resolve `$RPC_ANNOTATIONS` for dispatch:**

```bash
SKILL_DIR="$PLUGIN_ROOT/skills/understand-wiki"
RPC_ANNOTATIONS="null"
if [ -f "$SERVICE_ROOT/.understand-anything/config.json" ]; then
  RPC_ANNOTATIONS=$(python3 "$SKILL_DIR/wiki_json_reader.py" "$SERVICE_ROOT/.understand-anything/config.json" "rpcAnnotations" "null")
fi
```

### Step 5 — Prerequisite Verification (per service)

For each target service (1 in single mode, N in batch mode):

```bash
SERVICE_UA="$SERVICE_ROOT/.understand-anything"

# Check knowledge graph
if [ ! -f "$SERVICE_UA/knowledge-graph.json" ]; then
  echo "[understand-wiki] Service \"${SERVICE_NAME}\" has no knowledge graph."
  echo "[understand-wiki] Dispatching upstream-updater to run /understand..."
  # → Dispatch upstream-updater subagent (see Subagent Dispatch Protocol below)
  # After completion, verify KG exists
  if [ ! -f "$SERVICE_UA/knowledge-graph.json" ]; then
    echo "Error: /understand failed for \"${SERVICE_NAME}\". Cannot generate Wiki without KG."
    exit 1
  fi
fi

# Check domain graph
if [ ! -f "$SERVICE_UA/domain-graph.json" ]; then
  echo "[understand-wiki] Service \"${SERVICE_NAME}\" has no domain graph."
  echo "[understand-wiki] Dispatching upstream-updater to run /understand-domain..."
  # → Dispatch upstream-updater subagent (see Subagent Dispatch Protocol below)
  if [ ! -f "$SERVICE_UA/domain-graph.json" ]; then
    echo "Error: /understand-domain failed for \"${SERVICE_NAME}\". Cannot generate Wiki without DG."
    exit 1
  fi
fi
```

#### Subagent Dispatch Protocol

When KG or DG is missing (Step 5) or stale (Step 5a), dispatch an `upstream-updater` subagent from `$PLUGIN_ROOT/agents/upstream-updater.md` instead of running the skill inline. This prevents context window bloat — `/understand` alone has 7 phases with multiple nested subagents.

**Dispatch template (KG update):**

> Read the agent definition at `$PLUGIN_ROOT/agents/upstream-updater.md` and follow its instructions.
>
> - `$SKILL_PATH`: `$PLUGIN_ROOT/skills/understand/SKILL.md`
> - `$SERVICE_ROOT`: `<service directory path>`
> - `$SKILL_ARGS`: `--language $OUTPUT_LANGUAGE` *(propagates language preference to KG generation)*
> - `$EXPECTED_OUTPUT`: `$SERVICE_ROOT/.understand-anything/knowledge-graph.json`

**Dispatch template (DG update):**

> Read the agent definition at `$PLUGIN_ROOT/agents/upstream-updater.md` and follow its instructions.
>
> - `$SKILL_PATH`: `$PLUGIN_ROOT/skills/understand-domain/SKILL.md`
> - `$SERVICE_ROOT`: `<service directory path>`
> - `$SKILL_ARGS`: *(empty — `/understand-domain` auto-derives from KG when available; language preference is read from `config.json`)*
> - `$EXPECTED_OUTPUT`: `$SERVICE_ROOT/.understand-anything/domain-graph.json`

**Sequential dependency:** If both KG and DG need updating, dispatch KG first, wait for completion, then dispatch DG. `/understand-domain` benefits from an up-to-date KG (Path 2: derive from graph).

**Batch mode concurrency:** In batch mode, upstream updates for different services MAY run in parallel (each operates on a separate `$SERVICE_ROOT`). Within one service, KG → DG is still sequential.

### Step 5a — Upstream KG/DG Staleness Check & Auto-Update

After KG and DG exist, verify they were generated from the current git HEAD. Wiki `meta.json` can be updated to the latest commit while graphs still reflect an older tree (silent stale upstream).

**When stale upstream is detected, automatically dispatch `upstream-updater` subagents to refresh them** (same protocol as Step 5). This eliminates the manual step of re-running `/understand` and `/understand-domain` separately.

Skip staleness check entirely when `--force` is set (proceed with existing graphs as-is):

```bash
SKILL_DIR="$PLUGIN_ROOT/skills/understand-wiki"

if ! echo "$ARGUMENTS" | grep -q '\-\-force'; then
  STALE_JSON=$(python3 "$SKILL_DIR/wiki_staleness_check.py" "$SERVICE_ROOT" 2>/dev/null)
  if [ -n "$STALE_JSON" ]; then
    KG_STALE=$(echo "$STALE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('should_regenerate',{}).get('kg') else 'false')")
    DG_STALE=$(echo "$STALE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('should_regenerate',{}).get('dg') else 'false')")
    echo "$STALE_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for w in d.get('warnings', []):
    print(f'[understand-wiki] WARNING: {w}')
"
    if [ "$KG_STALE" = "true" ] || [ "$DG_STALE" = "true" ]; then
      echo "[understand-wiki] Upstream data is stale. Auto-updating..."

      # --- Auto-trigger KG update (incremental) ---
      if [ "$KG_STALE" = "true" ]; then
        echo "[understand-wiki] Dispatching upstream-updater: /understand (incremental) for \"${SERVICE_NAME}\"..."
        # → Dispatch upstream-updater subagent with:
        #   $SKILL_PATH = $PLUGIN_ROOT/skills/understand/SKILL.md
        #   $SERVICE_ROOT = <current service root>
        #   $SKILL_ARGS = --language $OUTPUT_LANGUAGE
        #   $EXPECTED_OUTPUT = $SERVICE_ROOT/.understand-anything/knowledge-graph.json
        #
        # /understand will run incremental (git diff based) since KG+meta already exist.
        # --language propagates the wiki's language preference to KG content.
        # Wait for completion before proceeding.

        if [ ! -f "$SERVICE_UA/knowledge-graph.json" ]; then
          echo "[understand-wiki] WARNING: /understand update failed for \"${SERVICE_NAME}\". Proceeding with stale KG."
        else
          echo "[understand-wiki] KG updated for \"${SERVICE_NAME}\"."
        fi
      fi

      # --- Auto-trigger DG update (always full, but derives from KG when available) ---
      if [ "$DG_STALE" = "true" ]; then
        echo "[understand-wiki] Dispatching upstream-updater: /understand-domain for \"${SERVICE_NAME}\"..."
        # → Dispatch upstream-updater subagent with:
        #   $SKILL_PATH = $PLUGIN_ROOT/skills/understand-domain/SKILL.md
        #   $SERVICE_ROOT = <current service root>
        #   $SKILL_ARGS = (empty — auto-derives from freshly updated KG; language preference is read from config.json)
        #   $EXPECTED_OUTPUT = $SERVICE_ROOT/.understand-anything/domain-graph.json
        #
        # /understand-domain has no incremental mode, but if KG was just updated,
        # it will use Path 2 (derive from graph) which is cheaper than file scanning.
        # Language preference is already persisted in config.json by Step 4.
        # Wait for completion before proceeding.

        if [ ! -f "$SERVICE_UA/domain-graph.json" ]; then
          echo "[understand-wiki] WARNING: /understand-domain update failed for \"${SERVICE_NAME}\". Proceeding with stale DG."
        else
          echo "[understand-wiki] DG updated for \"${SERVICE_NAME}\"."
        fi
      fi
    fi
  fi
else
  echo "[understand-wiki] --force: skipping upstream staleness check."
fi
```

**Key behaviors:**
- **KG auto-update is incremental:** `/understand` detects existing graph + changed commit hash → only re-analyzes `git diff` changed files (fast, low token cost)
- **DG auto-update is full but cheap:** `/understand-domain` always regenerates, but derives from the freshly updated KG (no file scanning needed)
- **Sequential dependency:** KG update completes before DG update starts (DG benefits from fresh KG)
- **Graceful degradation:** If upstream update fails, proceed with stale data and log a warning (wiki generation can still produce useful output from slightly outdated graphs)
- **`--force` skips entirely:** Use when you intentionally want to generate wiki from current graphs regardless of staleness

Commit hashes are read from `project.gitCommitHash` in each graph (or `meta.generatedFromCommit` / `.understand-anything/meta.json` as fallback). Compared with `git -C "$SERVICE_ROOT" rev-parse HEAD`.

### Step 5b — Save DG Snapshot (for incremental diff)

Before upstream triggers modify the DG, save a snapshot for later comparison:

```bash
DG_PATH="$SERVICE_UA/domain-graph.json"
DG_SNAPSHOT="$SERVICE_UA/wiki/domain-graph.snapshot.json"

if [ -f "$DG_PATH" ] && [ -f "$SERVICE_UA/wiki/meta.json" ]; then
  mkdir -p "$SERVICE_UA/wiki"
  cp "$DG_PATH" "$DG_SNAPSHOT"
  echo "[understand-wiki] DG snapshot saved for incremental diff."
else
  echo "[understand-wiki] No existing wiki — will run full generation."
fi
```

### Step 6 — Wiki State Check + Incremental Decision

```bash
SKILL_DIR="$PLUGIN_ROOT/skills/understand-wiki"
WIKI_META="$SERVICE_UA/wiki/meta.json"
DG_SNAPSHOT="$SERVICE_UA/wiki/domain-graph.snapshot.json"
INCREMENTAL=false
DIRTY_DOMAINS=""

if [ -f "$WIKI_META" ] && ! echo "$ARGUMENTS" | grep -q '\-\-full'; then
  WIKI_COMMIT=$(python3 "$SKILL_DIR/wiki_json_reader.py" "$WIKI_META" "gitCommitHash" "")
  CURRENT_COMMIT=$(git -C "$SERVICE_ROOT" rev-parse HEAD 2>/dev/null || echo "")
  
  if [ "$WIKI_COMMIT" = "$CURRENT_COMMIT" ] && [ -n "$WIKI_COMMIT" ]; then
    echo "[understand-wiki] Wiki for \"${SERVICE_NAME}\" is up to date (commit: ${WIKI_COMMIT:0:8})."
    echo "[understand-wiki] Use --full to force regeneration."
    if [ "$MODE" = "single" ]; then
      echo "Wiki is current. Options: (a) force rebuild with --full, (b) run --review only, (c) skip"
    fi
    # Skip to next service (batch) or stop (single)
  elif [ -f "$DG_SNAPSHOT" ]; then
    # DG exists and commit changed — attempt incremental update
    DIFF_RESULT=$(python3 "$SKILL_DIR/wiki_diff_domains.py" \
      --old "$DG_SNAPSHOT" \
      --new "$SERVICE_UA/domain-graph.json" \
      --kg "$SERVICE_UA/knowledge-graph.json" 2>&1)
    DIFF_EXIT=$?
    
    if [ $DIFF_EXIT -ne 0 ]; then
      echo "[understand-wiki] Incremental skipped: diff script error. Running full generation."
    else
      MODIFIED_COUNT=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['added'])+len(d['modified']))")
      TOTAL_COUNT=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['added'])+len(d['modified'])+len(d['unchanged']))")
      
      if [ "$TOTAL_COUNT" -gt 0 ] && [ $((MODIFIED_COUNT * 100 / TOTAL_COUNT)) -gt 80 ]; then
        echo "[understand-wiki] Incremental skipped: ${MODIFIED_COUNT}/${TOTAL_COUNT} domains modified (>80%). Running full generation."
      elif [ "$MODIFIED_COUNT" -eq 0 ]; then
        echo "[understand-wiki] No domain changes detected. Running Phase 2 assembly only (commit hash update via assemble-wiki.py)."
        INCREMENTAL=true
        DIRTY_DOMAINS=""
      else
        INCREMENTAL=true
        DIRTY_DOMAINS=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d['added']+d['modified']))")
        echo "[understand-wiki] Incremental update: regenerating ${MODIFIED_COUNT} domain(s): $DIRTY_DOMAINS"
      fi
    fi
  fi
fi
```

### Step 7 — Build Service List (Batch Mode Only)

```bash
SKILL_DIR="$PLUGIN_ROOT/skills/understand-wiki"

if [ "$MODE" = "batch" ]; then
  EXCLUDE_SERVICES="[]"
  PARENT_CONFIG="$PROJECT_ROOT/.understand-anything/config.json"
  if [ -f "$PARENT_CONFIG" ]; then
    EXCLUDE_SERVICES=$(python3 "$SKILL_DIR/wiki_json_reader.py" "$PARENT_CONFIG" "excludeServices" "[]")
  fi

  SERVICES=()
  for dir in "$PROJECT_ROOT"/*/; do
    dir_name=$(basename "$dir")
    # Skip hidden dirs and common non-service dirs
    case "$dir_name" in
      .*|node_modules|dist|build|target|docs|scripts|tools) continue ;;
    esac
    # Skip directories listed in parent excludeServices (basename match, case-sensitive)
    if echo "$EXCLUDE_SERVICES" | python3 -c "import sys,json; ex=set(json.load(sys.stdin)); print('skip' if sys.argv[1] in ex else 'ok')" "$dir_name" 2>/dev/null | grep -q skip; then
      continue
    fi
    # Detect service indicators
    if [ -d "$dir/.understand-anything" ] || [ -f "$dir/pom.xml" ] || [ -f "$dir/package.json" ] || [ -f "$dir/go.mod" ] || [ -f "$dir/Cargo.toml" ]; then
      SERVICES+=("$dir_name")
    fi
  done
  
  echo "[understand-wiki] Found ${#SERVICES[@]} candidate services:"
  printf "  - %s\n" "${SERVICES[@]}"
  
  # Filter to services that need generation
  SERVICES_TO_GENERATE=()
  for svc in "${SERVICES[@]}"; do
    svc_meta="$PROJECT_ROOT/$svc/.understand-anything/wiki/meta.json"
    if [ ! -f "$svc_meta" ] || echo "$ARGUMENTS" | grep -q '\-\-full'; then
      SERVICES_TO_GENERATE+=("$svc")
    else
      svc_commit=$(python3 "$SKILL_DIR/wiki_json_reader.py" "$svc_meta" "gitCommitHash" "")
      current=$(git -C "$PROJECT_ROOT/$svc" rev-parse HEAD 2>/dev/null || echo "unknown")
      if [ "$svc_commit" != "$current" ]; then
        SERVICES_TO_GENERATE+=("$svc")
      fi
    fi
  done
  
  echo "[understand-wiki] Services needing Wiki generation: ${#SERVICES_TO_GENERATE[@]}"
  if [ ${#SERVICES_TO_GENERATE[@]} -eq 0 ]; then
    echo "All services up to date. Use --full to force regeneration."
    # Skip to Phase 3 (parent update) if any services are already integrated
  fi
fi
```

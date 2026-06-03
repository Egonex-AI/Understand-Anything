---
name: understand-wiki
description: Generate a comprehensive, navigable knowledge base Wiki for a microservice project. Supports single-service and batch modes with progressive adoption.
argument-hint: ["[--batch] [--service=<name>] [--review] [--full] [--force] [--dry-run] [--continue-on-error] [--language <lang>]"]
---

# /understand-wiki

Generate a team knowledge base Wiki for microservice projects. Each service gets its own Wiki (documenting domains, flows, steps with source references). When multiple services are integrated, a parent-level orchestration Wiki is generated with cross-service relationships and business flow navigation.

## Options

- `$ARGUMENTS` may contain:
  - `--batch` — Explicitly declare current directory as parent (batch mode). Without this flag, **default is single-service mode**.
  - `--service=<name>` — Generate Wiki for a specific service (implies batch mode, runs from parent dir)
  - `--review` — After generation, run the `wiki-reviewer` agent for quality assurance
  - `--full` — Force full regeneration, ignoring existing Wiki
  - `--force` — Skip upstream KG/DG staleness check (proceed even when graphs are from an older commit)
  - `--dry-run` — Preview what would be generated without running any LLM calls (see [Dry-Run Mode](#dry-run-mode))
  - `--continue-on-error` — In batch mode, continue after per-service failures (default: `true`). Set `--continue-on-error=false` to stop at first failure and skip Phase 2 (see [Partial Failure Policy](#partial-failure-policy))
  - `--language <lang>` — Generate content in specified language (ISO 639-1 or friendly name). Stores in config for future runs.

---

## Execution Modes

| How to invoke | Mode | Behavior |
|---|---|---|
| `cd service-a && /understand-wiki` | Single-service (default) | Generate Wiki for current service → trigger parent incremental update |
| `/understand-wiki --service=order-service` | Single-service (from parent) | Target named service (implies `--batch` context) |
| `/understand-wiki --batch` | Batch | Scan all sub-services, generate/update Wiki for each, then update parent |

**Design principle: Explicit over implicit.** Default is always single-service (current directory = one service). Use `--batch` to explicitly declare parent mode. This avoids misdetection in monorepo structures.

---

## Progress Reporting

Report progress at each phase transition:
> `[Phase N/4] <phase name>...`

During batch processing:
> `Generating Wiki for service X/N: <service-name>...`

Phase completion:
> `Phase N complete. <one-line summary>`

---

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

Print the script output to the user and exit 0. See [Dry-Run Mode](#dry-run-mode) for the expected report format.

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

### Step 4.5 — RPC Annotations Configuration

Custom RPC frameworks are configured in `$SERVICE_ROOT/.understand-anything/config.json` under the `rpcAnnotations` field. This tells `/understand` (file-analyzer) which annotation pairs map to provider/consumer roles so the knowledge graph gets `provides_rpc` / `consumes_rpc` edges for cross-service matching.

**Schema** — `rpcAnnotations` is an array of objects:

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | string | yes | Provider annotation class name (e.g. `"@MoaProvider"`, `"@DubboService"`) |
| `consumer` | string | yes | Consumer annotation class name (e.g. `"@MoaConsumer"`, `"@DubboReference"`) |
| `type` | string | yes | Framework identifier used in graph tags and matchers (e.g. `"moa"`, `"dubbo"`, `"grpc"`) |
| `interfaceField` | string | no | Annotation attribute that holds the RPC interface name; defaults to `"value"` |

**Example `config.json`:**

Parent-level batch config may also set `excludeServices` (basename list, case-sensitive) to skip shared libraries during service discovery:

```json
{ "excludeServices": ["common", "shared", "libs", "tools"] }
```

Service-level RPC annotations:

```json
{
  "outputLanguage": "zh",
  "rpcAnnotations": [
    { "provider": "@DubboService", "consumer": "@DubboReference", "type": "dubbo" },
    { "provider": "@MoaProvider", "consumer": "@MoaConsumer", "type": "moa", "interfaceField": "service" },
    { "provider": "@GrpcService", "consumer": "@GrpcClient", "type": "grpc" }
  ]
}
```

**Behavior:**
- Missing or empty `rpcAnnotations` → backward compatible; file-analyzer treats RPC annotations as ordinary dependencies; cross-service script matching has no RPC edges to match.
- Non-empty `rpcAnnotations` → passed to wiki-worker and `/understand` so analyzers emit `provides_rpc` / `consumes_rpc` edges; `cross-service-matcher.py` matches consumers to providers by interface name across services.

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
  echo "[understand-wiki] Triggering /understand for \"${SERVICE_NAME}\"..."
  # Dispatch /understand on the service (the dispatching agent should handle this)
  # After completion, verify KG exists
  if [ ! -f "$SERVICE_UA/knowledge-graph.json" ]; then
    echo "Error: /understand failed for \"${SERVICE_NAME}\". Cannot generate Wiki without KG."
    exit 1
  fi
fi

# Check domain graph
if [ ! -f "$SERVICE_UA/domain-graph.json" ]; then
  echo "[understand-wiki] Service \"${SERVICE_NAME}\" has no domain graph."
  echo "[understand-wiki] Triggering /understand-domain for \"${SERVICE_NAME}\"..."
  # Dispatch /understand-domain on the service
  if [ ! -f "$SERVICE_UA/domain-graph.json" ]; then
    echo "Error: /understand-domain failed for \"${SERVICE_NAME}\". Cannot generate Wiki without DG."
    exit 1
  fi
fi
```

### Step 5a — Upstream KG/DG Staleness Check

After KG and DG exist, verify they were generated from the current git HEAD. Wiki `meta.json` can be updated to the latest commit while graphs still reflect an older tree (silent stale upstream).

Skip when `--force` is set:

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
      echo "[understand-wiki] Upstream data may be stale. Regenerate before Wiki generation:"
      [ "$KG_STALE" = "true" ] && echo "  → Run /understand on \"${SERVICE_NAME}\" (knowledge graph)"
      [ "$DG_STALE" = "true" ] && echo "  → Run /understand-domain on \"${SERVICE_NAME}\" (domain graph)"
      echo "[understand-wiki] Use --force to skip this check and proceed anyway."
      exit 1
    fi
  fi
else
  echo "[understand-wiki] --force: skipping upstream staleness check."
fi
```

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
        echo "[understand-wiki] No domain changes detected. Updating meta.json commit hash only."
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
    # Skip to Phase 2 (parent update) if any services are already integrated
  fi
fi
```

---

## Phase 1 — Service Wiki Generation

Report: `[Phase 1/4] Generating service Wiki...`

### Dispatch Strategy (Incremental vs Full)

```bash
if [ "$INCREMENTAL" = true ] && [ -n "$DIRTY_DOMAINS" ]; then
  # --- Incremental Path: only regenerate dirty domains ---
  echo "[understand-wiki] Incremental mode: ${DIRTY_DOMAINS}"
  
  for DOMAIN_ID in $DIRTY_DOMAINS; do
    echo "[understand-wiki] Regenerating domain page: $DOMAIN_ID"
    FILTERED_KG=$(python3 "$SKILL_DIR/wiki_kg_filter.py" \
      "$SERVICE_UA/knowledge-graph.json" \
      "$SERVICE_UA/domain-graph.json" \
      "$DOMAIN_ID" --max-nodes=200)
    # Dispatch wiki-worker with --domain=$DOMAIN_ID and $FILTERED_KG (see below)
  done
  
  # Handle removed domains
  REMOVED=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d['removed']))")
  for DOMAIN_ID in $REMOVED; do
    rm -f "$SERVICE_UA/wiki/domains/${DOMAIN_ID}.json"
    echo "[understand-wiki] Removed obsolete domain page: $DOMAIN_ID"
  done
  
  # Conditionally regenerate service overview
  OVERVIEW_DIRTY=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['serviceOverviewDirty']).lower())")
  if [ "$OVERVIEW_DIRTY" = "true" ]; then
    echo "[understand-wiki] Regenerating service overview (domain list changed)..."
    # Dispatch wiki-worker for service-overview only
  fi
  
  # Update meta.json commit hash
  CURRENT_COMMIT=$(git -C "$SERVICE_ROOT" rev-parse HEAD 2>/dev/null || echo "")
  python3 "$SKILL_DIR/wiki_meta_update.py" "$SERVICE_UA/wiki/meta.json" "$CURRENT_COMMIT"
  
  # Cleanup snapshot
  rm -f "$DG_SNAPSHOT"
  
elif [ "$INCREMENTAL" = true ] && [ -z "$DIRTY_DOMAINS" ]; then
  # --- No changes: only update commit hash ---
  CURRENT_COMMIT=$(git -C "$SERVICE_ROOT" rev-parse HEAD 2>/dev/null || echo "")
  python3 "$SKILL_DIR/wiki_meta_update.py" "$SERVICE_UA/wiki/meta.json" "$CURRENT_COMMIT"
  rm -f "$DG_SNAPSHOT"
  echo "[understand-wiki] Meta updated. No wiki pages regenerated."
  
else
  # --- Full Generation Path ---
  echo "[understand-wiki] Full generation mode."
  # Dispatch wiki-worker for ALL domains (see below)
fi
```

### Incremental Dispatch — Per-Domain wiki-worker Prompt

Before dispatching each dirty domain, build a domain-scoped KG (avoids context overflow on large services):

```bash
FILTERED_KG=$(python3 "$SKILL_DIR/wiki_kg_filter.py" \
  "$SERVICE_UA/knowledge-graph.json" \
  "$SERVICE_UA/domain-graph.json" \
  "$DOMAIN_ID" --max-nodes=200)
```

> Generate/update the Wiki page for a SINGLE domain in this microservice.
> Project root: `$SERVICE_ROOT`
> Service name: `$SERVICE_NAME`
> **Target domain ID: `$DOMAIN_ID`**
>
> **Knowledge Graph (domain-scoped via `wiki_kg_filter.py`):**
> ```json
> $FILTERED_KG
> ```
>
> **Domain Graph:**
> ```json
> <contents of $SERVICE_ROOT/.understand-anything/domain-graph.json>
> ```
>
> Output language: `$OUTPUT_LANGUAGE`
> $LANGUAGE_DIRECTIVE
>
> **Instructions:** Only generate the page for domain `$DOMAIN_ID`. Write output to:
> `$SERVICE_ROOT/.understand-anything/wiki/domains/$DOMAIN_ID.json`

### Full Generation — Single-Service Mode

Dispatch ONE `wiki-worker` agent for the target service (full mode).

**Dispatch prompt template:**

> Generate a complete Wiki for this microservice.
> Project root: `$SERVICE_ROOT`
> Service name: `$SERVICE_NAME`
>
> **Knowledge Graph:**
> ```json
> <contents of $SERVICE_ROOT/.understand-anything/knowledge-graph.json>
> ```
>
> **Domain Graph:**
> ```json
> <contents of $SERVICE_ROOT/.understand-anything/domain-graph.json>
> ```
>
> Output language: `$OUTPUT_LANGUAGE`
> $LANGUAGE_DIRECTIVE
>
> RPC annotations config (if present; see Step 4.5):
> ```json
> $RPC_ANNOTATIONS
> ```
>
> Write all output files to: `$SERVICE_ROOT/.understand-anything/wiki/`

After the agent completes, verify output:
```bash
test -f "$SERVICE_ROOT/.understand-anything/wiki/meta.json" && \
test -f "$SERVICE_ROOT/.understand-anything/wiki/index.json" && \
test -f "$SERVICE_ROOT/.understand-anything/wiki/service.json" && \
test -d "$SERVICE_ROOT/.understand-anything/wiki/domains"
```

If any file is missing, report the failure and stop (do not proceed to Quality Gate).

### Batch Mode

For each service in `$SERVICES_TO_GENERATE`, dispatch wiki-worker agents. Run up to **3 concurrently** to manage token costs.

Progress reporting:
> `Generating Wiki for service 1/N: order-service...`
> `Generating Wiki for service 2/N: payment-service...`

Track per-service results:
- Success: wiki output verified
- Failure: log error, skip service, continue with remaining

After all services complete:
> `Phase 1 complete. Generated Wiki for X/N services. Failures: Y.`

---

## Partial Failure Policy

In batch mode, wiki-worker agents run per service. Some may succeed while others fail (dispatch error, quality gate failure, context overflow, etc.).

**Default (`--continue-on-error`, implied in batch):** Continue processing remaining services. **Phase 2 still runs** using whatever service wikis succeeded in this run (plus any already-integrated services from prior runs). Failed services are logged; they do not block parent wiki generation for successful siblings.

**Strict mode (`--continue-on-error=false`):** Stop at the **first** service failure. Do **not** run Phase 2. Report which service failed and how to retry.

Track per-service outcome for the batch summary:

| Outcome | Symbol | Meaning |
|---|---|---|
| Success | `✓` | Wiki output verified for this run |
| Failure | `✗` | wiki-worker or quality gate failed |
| Skipped | `-` | Up-to-date or user-skipped (no generation) |

**Batch completion summary** (print after Phase 1, repeat in Phase 4):

```
[understand-wiki] Batch complete:
  ✓ order-service (3 domains, 12 pages)
  ✓ payment-service (2 domains, 8 pages)
  ✗ inventory-service (wiki-worker failed: context overflow)
  - notification-service (skipped: up-to-date)

Phase 2: Parent wiki updated with 2/4 services.
Warning: 1 service failed. Run with --service=inventory-service --full to retry.
```

**Phase 2 trigger with partial failure:**

- Collect `INTEGRATED_SERVICES` from services that have `wiki/meta.json` after Phase 1 (includes successes from this run and prior integrations).
- If `--continue-on-error=false` and any failure occurred → skip Phase 2 entirely.
- If integrated count ≥ 2 → run Phase 2 with available service wikis only.
- In the summary, state how many services contributed to the parent update (e.g. `2/4 services`).

**Retry guidance:** For each `✗` service, suggest `/understand-wiki --service=<name> [--full]`.

---

## Dry-Run Mode

Use `--dry-run` to preview work without LLM generation or wiki file writes.

**What it shows:**

- Services to process (with reason: new / stale / incremental / up-to-date)
- Estimated domains per service (from `domain-graph.json`; incremental uses `wiki_diff_domains.py`)
- Whether Phase 2 would run (requires 2+ integrated services after the planned run)
- Rough token estimate (~2000 tokens per domain page to regenerate)

**Invocation:**

```bash
python3 "$PLUGIN_ROOT/skills/understand-wiki/wiki_dry_run.py" "$PROJECT_ROOT"
# Optional: --full to simulate forced full regeneration for all services
```

**Example output:**

```
[understand-wiki] Dry run — no files will be generated.

Services to process:
  • order-service: FULL (new, no existing wiki)
    - 3 domains, ~6000 tokens estimated
  • payment-service: INCREMENTAL (2 domains changed)
    - 2 domains to regenerate, ~4000 tokens estimated
  • inventory-service: SKIP (up-to-date)

Phase 2: Parent wiki would be regenerated (2 services changed).
Total estimated cost: ~10000 tokens

Run without --dry-run to execute.
```

The executing agent must not dispatch wiki-worker or write wiki files when `--dry-run` is set.

---

## Quality Gate

Located between Phase 1 and Phase 2. Runs for every successfully generated service Wiki.

### Layer 1 — Automatic Structural Validation (Always)

Run the validation logic from `@understand-anything/core` (wiki-schema.ts). Concretely, the skill writes and executes a validation script:

```bash
python3 "$SKILL_DIR/wiki_quality_gate.py" \
  "$SERVICE_ROOT/.understand-anything/wiki" \
  "$SERVICE_ROOT/.understand-anything/domain-graph.json" \
  "$SERVICE_ROOT" \
  "$PROJECT_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-qg-result.json"
```

Read the result:
- If `passed: true` → proceed to Layer 2 (if `--review`) or Phase 2
- If `passed: false` → report issues to user, recommend re-running with `--full`. Do NOT proceed to Phase 2 for this service.

### Layer 2 — wiki-reviewer Agent (When `--review` is specified)

Only triggered when `--review` is in `$ARGUMENTS`.

Dispatch a subagent using the `wiki-reviewer` agent definition (at `$PLUGIN_ROOT/agents/wiki-reviewer.md`).

**Dispatch prompt:**

> Review the Wiki quality for service `$SERVICE_NAME`.
> Project root: `$SERVICE_ROOT`
> Wiki directory: `$SERVICE_ROOT/.understand-anything/wiki`
>
> **Domain Graph:**
> ```json
> <contents of domain-graph.json>
> ```
>
> **Knowledge Graph (nodes and edges only, truncated to first 200 nodes):**
> ```json
> <first 200 nodes + all edges referencing them>
> ```
>
> Write review report to: `$PROJECT_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-review-report.json`

After the reviewer completes, read the report:

- **Overall verdict: pass** → proceed to Phase 2
- **Overall verdict: warn** → report warnings to user, proceed to Phase 2
- **Overall verdict: fail** → attempt ONE retry:
  1. Format reviewer feedback into a retry appendix (see wiki-reviewer.md "Feedback Format" section)
  2. Re-dispatch wiki-worker with original prompt + retry appendix
  3. Re-run Layer 1 validation on the new output
  4. If still failing after retry → report failure, skip this service, proceed with other services

---

## Phase 2 — Cross-Service Relationship Identification + Parent Wiki Generation

Report: `[Phase 2/4] Generating parent orchestration Wiki...`

**Trigger condition:** At least 2 services have Wiki (`.understand-anything/wiki/meta.json` exists).

If only 1 service is integrated: skip Phase 2 entirely with message:
> `Phase 2 skipped. Cross-service Wiki requires 2+ integrated services (current: 1).`

### Step 1 — Collect Integrated Services

```bash
INTEGRATED_SERVICES=()
for dir in "$PROJECT_ROOT"/*/; do
  if [ -f "$dir/.understand-anything/wiki/meta.json" ]; then
    INTEGRATED_SERVICES+=("$(basename "$dir")")
  fi
done
echo "[understand-wiki] Integrated services: ${#INTEGRATED_SERVICES[@]}"
printf "  - %s\n" "${INTEGRATED_SERVICES[@]}"
```

### Step 2 — Run Cross-Service Matcher Script (Layer 1)

```bash
python3 "$SKILL_DIR/cross-service-matcher.py" "$PROJECT_ROOT" \
  --services="${INTEGRATED_SERVICES[*]}" \
  --output="$PROJECT_ROOT/.understand-anything/tmp/cross-service-candidates.json"
```

The script reads KG files from all integrated services and performs deterministic matching:
- Matches `consumes_rpc` → `provides_rpc` across services (by interface name)
- Matches Kafka topic `publishes` → `subscribes` across services
- Matches shared database table access patterns
- Outputs: candidate relationship list with evidence

### Step 3 — LLM Review + Supplement + Organize (Layer 2, Always Execute)

The main skill (YOU, the executing agent) performs the LLM layer directly — no separate agent dispatch needed because the data is lightweight.

**Input for LLM analysis:**
- Script output: candidate relationships with evidence
- Per-service summaries: from each service's `wiki/index.json` entries
- Per-service endpoints: from each service's KG (`endpoint:` nodes)
- Per-service RPC interfaces: from each service's KG (`provides_rpc` / `consumes_rpc` edges)
- Per-service domain info: from each service's `wiki/service.json`

**LLM tasks:**
1. **Verify** script matches — confirm they are real interactions (remove false positives)
2. **Discover** missed relationships — identify cross-service calls the script couldn't detect (non-standard RPC, dynamic dispatch, event-driven patterns)
3. **Organize** into business flows — group related cross-service calls into end-to-end process flows (e.g., "Order Creation Flow" spanning order-service → payment-service → inventory-service)

### Step 4 — Generate Parent Wiki

Create the parent-level Wiki at `$PROJECT_ROOT/.understand-anything/wiki/`:

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/wiki/domains"
```

**Files to generate:**

1. **`overview.json`** — System overview:
```json
{
  "name": "<project/system name>",
  "description": "<what this system does as a whole>",
  "services": [
    { "name": "order-service", "description": "<from wiki/service.json>", "domains": ["order-management"] },
    { "name": "payment-service", "description": "<from wiki/service.json>", "domains": ["payment-processing"] }
  ],
  "techStack": ["Java", "Spring Boot", "MOA RPC", "MySQL", "Kafka"]
}
```

2. **`architecture.json`** — Cross-service architecture:
```json
{
  "crossServiceCalls": [
    {
      "caller": { "service": "order-service", "node": "function:...", "file": "...", "method": "OrderService.createOrder()" },
      "callee": { "service": "payment-service", "node": "service:...", "interface": "PaymentFacade", "method": "createPayment()" },
      "type": "moa_rpc",
      "evidence": "script-matched",
      "detail": "@MoaConsumer PaymentFacade in OrderService matched to @MoaProvider in payment-service"
    }
  ],
  "sharedResources": [],
  "eventFlows": []
}
```

3. **`domains/<cross-domain>.json`** — Cross-service business flow pages:
```json
{
  "id": "cross-domain:order-creation",
  "name": "Order Creation (End-to-End)",
  "summary": "Complete order creation flow spanning order, payment, and inventory services.",
  "services": ["order-service", "payment-service", "inventory-service"],
  "steps": [
    {
      "order": 1,
      "service": "order-service",
      "description": "OrderController receives order request → OrderService.createOrder() validates and persists",
      "wikiRef": "order-service/domains/order-management.json#flow:create-order"
    },
    {
      "order": 2,
      "service": "order-service",
      "description": "OrderService calls PaymentFacade.createPayment() via MOA RPC",
      "crossServiceCall": { "interface": "PaymentFacade", "method": "createPayment()", "type": "moa_rpc" }
    },
    {
      "order": 3,
      "service": "payment-service",
      "description": "PaymentFacadeImpl processes payment, publishes payment.completed event",
      "wikiRef": "payment-service/domains/payment-processing.json#flow:process-payment"
    }
  ]
}
```

---

## Phase 3 — Index Construction

Report: `[Phase 3/4] Building search index...`

### Parent-Level Index

Write `$PROJECT_ROOT/.understand-anything/wiki/index.json`:
```json
{
  "entries": [
    { "id": "wiki:overview", "name": "System Overview", "type": "overview", "summary": "..." },
    { "id": "wiki:architecture", "name": "System Architecture", "type": "architecture", "summary": "..." },
    { "id": "wiki:cross-domain:order-creation", "name": "Order Creation (E2E)", "type": "domain", "summary": "..." }
  ]
}
```

### Parent-Level Meta

Write `$PROJECT_ROOT/.understand-anything/wiki/meta.json`:
```json
{
  "gitCommitHash": "<latest commit across all integrated services>",
  "generatedAt": "<ISO 8601>",
  "version": "1.0.0",
  "outputLanguage": "<$OUTPUT_LANGUAGE>",
  "serviceCount": 3
}
```

---

## Phase 4 — Cleanup and Report

Report: `[Phase 4/4] Finalizing...`

1. Clean up temp files:
```bash
rm -rf "$PROJECT_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-"*
```

2. Print final summary:
```
╔══════════════════════════════════════════════════╗
║              /understand-wiki Complete            ║
╠══════════════════════════════════════════════════╣
║ Mode:       <single|batch>                       ║
║ Services:   <N generated> / <M total>            ║
║ Domains:    <total domain pages across services> ║
║ Flows:      <total flows documented>             ║
║ Cross-svc:  <relationships identified>           ║
║ Language:   <OUTPUT_LANGUAGE>                     ║
║                                                  ║
║ Service Wiki: <service>/.understand-anything/wiki/║
║ Parent Wiki:  .understand-anything/wiki/          ║
╚══════════════════════════════════════════════════╝
```

3. If `--review` was used, include reviewer results:
```
Review: <pass|warn|fail> (<N issues, M warnings>)
```

---

## Error Handling

- **Prerequisite trigger fails** (`/understand` or `/understand-domain`):
  → Report specific error, skip this service, continue batch
  
- **wiki-worker dispatch fails**:
  → Retry ONCE with same prompt + error context
  → If second failure: skip service, log error
  → Batch + `--continue-on-error` (default): continue remaining services, run Phase 2 with successes
  → Batch + `--continue-on-error=false`: stop batch, skip Phase 2
  
- **Quality Gate Layer 1 fails**:
  → Report issues to user
  → In batch mode: skip service
  → In single mode: ask user whether to proceed anyway
  
- **Quality Gate Layer 2 fails (reviewer)**:
  → Retry wiki-worker once with feedback
  → If still failing: save current Wiki with warnings, proceed to Phase 2
  
- **Cross-service matcher script fails**:
  → Fall back to LLM-only cross-service detection (skip script layer)
  
- **Parent Wiki generation fails**:
  → Service-level Wikis are still valid; report parent failure separately

**Never silently drop errors.** Every failure must appear in the final report.

---

## Reference: Wiki File Schema Summary

### Service-Level Files

| File | Required Fields |
|---|---|
| `meta.json` | `gitCommitHash`, `generatedAt`, `version`, `outputLanguage` |
| `index.json` | `entries[]` each with `id`, `name`, `type`, `summary` |
| `service.json` | `name`, `description`, `techStack[]`, `modules[]`, `entryPoints[]` |
| `domains/<slug>.json` | `id`, `name`, `summary`, `entities[]`, `flows[]` |

### Flow Structure

```json
{
  "id": "flow:<slug>",
  "name": "<display name>",
  "summary": "<2-3 sentences>",
  "steps": [
    {
      "order": 1,
      "name": "<step name>",
      "description": "<detailed description with business rules>",
      "sourceRef": { "file": "<relative path>", "lineRange": [start, end] }
    }
  ]
}
```

### Parent-Level Files

| File | Purpose |
|---|---|
| `overview.json` | System-wide summary, service list with descriptions |
| `architecture.json` | Cross-service call relationships, shared resources, event flows |
| `domains/<cross-domain>.json` | End-to-end business flow pages spanning multiple services |
| `index.json` | Parent-level navigation index |
| `meta.json` | Parent-level metadata with serviceCount |

---

## "Already Integrated" Detection

A service is considered "integrated" when:
```bash
test -f "$SERVICE_ROOT/.understand-anything/wiki/meta.json"
```

This file is the last thing wiki-worker writes, so its presence guarantees a complete Wiki.

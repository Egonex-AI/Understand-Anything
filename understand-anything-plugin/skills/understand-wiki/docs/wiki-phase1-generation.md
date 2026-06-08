## Phase 1 — Service Wiki Generation

Report: `[Phase 1/5] Generating service Wiki...`

### Batch Mode — Per-Service Sub-Agent Dispatch

In batch mode, Phase 1 dispatches one sub-agent per service. Each sub-agent runs the **complete single-service flow** from this SKILL.md:

1. Phase 0: prerequisite check (KG/DG missing → dispatch `/understand` and `/understand-domain`)
2. Phase 1: wiki-worker dispatch (this section, single-service path)
3. Phase 2: assembly (`assemble-wiki.py`)

**Dispatch one sub-agent per service** (up to 3 concurrently). See [Dispatch Protocol](../../../docs/DISPATCH-PROTOCOL.md).

> Read the skill definition at `$PLUGIN_ROOT/skills/understand-wiki/SKILL.md` and follow its instructions.
>
> - Working directory: `$PROJECT_ROOT/<service-name>` (the service directory, NOT the parent)
> - Arguments: `--language $OUTPUT_LANGUAGE` (add `--full` if parent was called with `--full`, `--force` if `--force`)
> - Skip Phase 3, 4, 5, 6 — the parent agent handles cross-service, index, cleanup, and dashboard launch
>
> You are authorized to dispatch sub-agents as required by the parent task.

Wait for ALL sub-agents to complete. For each, verify:

```bash
test -f "$PROJECT_ROOT/<service>/.understand-anything/wiki/meta.json"
```

Track successes and failures for the Phase 5 report. If `--continue-on-error=false` and any service fails, stop batch and skip Phase 3.

**After all per-service sub-agents complete, skip to Phase 3** (cross-service + parent wiki).

---

### Single-Service Mode — Wiki-Worker Dispatch

The instructions below apply to single-service mode only (and to each per-service sub-agent in batch mode).

### Dispatch Strategy (Incremental vs Full)

The following bash template shows the branching logic. Actual dispatch instructions are in the sections below — follow those, not the comments in this template.

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
    rm -f "$SERVICE_UA/intermediate/wiki/domains/${DOMAIN_ID}.json"
    echo "[understand-wiki] Removed obsolete domain page: $DOMAIN_ID"
  done
  
  # Conditionally regenerate service overview
  OVERVIEW_DIRTY=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['serviceOverviewDirty']).lower())")
  if [ "$OVERVIEW_DIRTY" = "true" ]; then
    echo "[understand-wiki] Regenerating service overview (domain list changed)..."
    python3 "$SKILL_DIR/generate_service_overview.py" "$SERVICE_ROOT"
    # Orchestrator enriches description inline (same as Full mode Step 4)
  fi
  
  # Phase 2 will handle meta.json generation via assemble-wiki.py
  
  # Cleanup snapshot
  rm -f "$DG_SNAPSHOT"
  
elif [ "$INCREMENTAL" = true ] && [ -z "$DIRTY_DOMAINS" ]; then
  # --- No changes: only update commit hash via assembly ---
  # No domain changes — Phase 2 (assemble-wiki.py) will update commit hash in final wiki/meta.json
  echo "[understand-wiki] No wiki pages need regeneration. Running Phase 2 for commit hash update."
  rm -f "$DG_SNAPSHOT"
  
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

**Dispatch a `wiki-worker` subagent** for this domain. See [Dispatch Protocol](../../../docs/DISPATCH-PROTOCOL.md).

> Read the agent definition at `$PLUGIN_ROOT/agents/wiki-worker.md` and follow its instructions.
>
> You are authorized to dispatch sub-agents as required by the parent task.
>
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
> $WIKI_LOCALE_GUIDANCE
>
> **Instructions:** Only generate the page for domain `$DOMAIN_ID`. Write output to:
> `$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains/$DOMAIN_ID.json`

### Full Generation — Single-Service Mode (Per-Domain Dispatch)

Full mode uses the same per-domain dispatch pattern as Incremental mode, ensuring consistent context sizes and enabling parallelism.

#### Step 1 — Generate Service Overview

```bash
mkdir -p "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains"
python3 "$SKILL_DIR/generate_service_overview.py" "$SERVICE_ROOT"
```

This produces `intermediate/wiki/service.json` with deterministic fields (name, techStack, modules, entryPoints). The `description` field uses `project.description` from the KG as a baseline.

#### Step 2 — Extract Domain List

Read the domain graph and extract all domain IDs:

```bash
DOMAIN_IDS=$(python3 -c "
import json, sys
dg = json.load(open('$SERVICE_UA/domain-graph.json'))
ids = [n['id'] for n in dg.get('nodes', []) if n.get('type') == 'domain']
print(' '.join(ids))
")
```

If no domains found, report error and stop.

#### Step 3 — Dispatch Per-Domain wiki-workers

**Before dispatching**, detect already-generated domains by checking if `domains/<DOMAIN_ID>.json` exists and is non-empty in `$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains/`. Skip domains that already have output (this enables automatic resume when a previous run was interrupted). If an output file exists but contains invalid JSON (e.g. truncated from a crash), treat it as incomplete and re-process. If all domains are complete, skip directly to Step 4.

For each remaining domain, build a domain-scoped KG first:

```bash
for DOMAIN_ID in $DOMAIN_IDS; do
  FILTERED_KG=$(python3 "$SKILL_DIR/wiki_kg_filter.py" \
    "$SERVICE_UA/knowledge-graph.json" \
    "$SERVICE_UA/domain-graph.json" \
    "$DOMAIN_ID" --max-nodes=200)
done
```

**Dispatch `wiki-worker` subagents in parallel** (up to **5 concurrently**). See [Dispatch Protocol](../../../docs/DISPATCH-PROTOCOL.md). For each domain, use the same prompt template as [Incremental Dispatch](#incremental-dispatch--per-domain-worker-prompt) with the domain-scoped `$FILTERED_KG`.

If a domain's wiki-worker fails, retry once. On second failure, skip that domain and continue.

#### Step 4 — Enrich Service Description

After all domain wiki-workers complete:

1. Read each generated domain page (`domains/*.json`), extract `name` and `summary`
2. Rewrite `service.json` description to a professional 2-3 sentence summary incorporating domain names and key capabilities (inline orchestrator LLM generation, NOT a separate subagent)
3. Re-write `service.json` with the enriched description

#### Step 5 — Verify Output

```bash
test -f "$SERVICE_ROOT/.understand-anything/intermediate/wiki/service.json" && \
test -d "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains" && \
DOMAIN_COUNT=$(ls "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains/"*.json 2>/dev/null | wc -l) && \
[ "$DOMAIN_COUNT" -gt 0 ]
```

If any file is missing, report the failure and stop (do not proceed to Phase 2).

Report:
> `[understand-wiki] Full generation: $DOMAIN_COUNT domain pages generated.`

If intermediate output is verified, proceed to **Phase 2** (deterministic assembly). See [Phase 2 — Assembly Pipeline](wiki-phase2-assembly.md).

### Batch Mode

For each service in `$SERVICES_TO_GENERATE`, **MUST dispatch wiki-worker agents in parallel** (up to **5 concurrently**). See [Dispatch Protocol](../../../docs/DISPATCH-PROTOCOL.md). Use the same per-domain dispatch prompt template as [Incremental Dispatch](#incremental-dispatch--per-domain-worker-prompt), passing the service's own `$SERVICE_ROOT`, `$SERVICE_NAME`, KG, and DG.

Progress reporting:
> `Generating Wiki for service 1/N: order-service...`
> `Generating Wiki for service 2/N: payment-service...`

Track per-service results:
- Success: wiki output verified
- Failure: log error, skip service, continue with remaining

After all services complete:
> `Phase 1 complete. Generated Wiki for X/N services. Failures: Y.`

### Repo-Type-Aware Worker Dispatch

When dispatching wiki-worker agents, pass the `REPO_TYPE` context:

- `REPO_TYPE=backend` (default): Use existing backend-focused prompt
- `REPO_TYPE=mobile`: Use mobile-focused prompt (screens, API calls, state management)
- `REPO_TYPE=frontend`: Use frontend-focused prompt (routes, components, API calls, state)

Also pass `SERVER_WIKI_AVAILABLE` and `SERVER_FACET_PATH` when `REPO_TYPE=mobile` so the wiki-worker can perform server-aware domain classification.

---

## Partial Failure Policy

In batch mode, wiki-worker agents run per service. Some may succeed while others fail (dispatch error, quality gate failure, context overflow, etc.).

**Default (`--continue-on-error`, implied in batch):** Continue processing remaining services. **Phase 3 still runs** using whatever service wikis succeeded in this run (plus any already-integrated services from prior runs). Failed services are logged; they do not block parent wiki generation for successful siblings.

**Strict mode (`--continue-on-error=false`):** Stop at the **first** service failure. Do **not** run Phase 3. Report which service failed and how to retry.

Track per-service outcome for the batch summary:

| Outcome | Symbol | Meaning |
|---|---|---|
| Success | `✓` | Wiki output verified for this run |
| Failure | `✗` | wiki-worker or quality gate failed |
| Skipped | `-` | Up-to-date or user-skipped (no generation) |

**Batch completion summary** (print after Phase 1, repeat in Phase 5):

```
[understand-wiki] Batch complete:
  ✓ order-service (3 domains, 12 pages)
  ✓ payment-service (2 domains, 8 pages)
  ✗ inventory-service (wiki-worker failed: context overflow)
  - notification-service (skipped: up-to-date)

Phase 3: Parent wiki updated with 2/4 services.
Warning: 1 service failed. Run with --service=inventory-service --full to retry.
```

**Phase 3 trigger with partial failure:**

- Collect `INTEGRATED_SERVICES` from services that have `wiki/meta.json` after Phase 1 (includes successes from this run and prior integrations).
- If `--continue-on-error=false` and any failure occurred → skip Phase 3 entirely.
- If integrated count ≥ 2 → run Phase 3 with available service wikis only.
- In the summary, state how many services contributed to the parent update (e.g. `2/4 services`).

**Retry guidance:** For each `✗` service, suggest `/understand-wiki --service=<name> [--full]`.

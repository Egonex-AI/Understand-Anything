## Phase 1 — Service Wiki Generation

Report: `[Phase 1/5] Generating service Wiki...`

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
    rm -f "$SERVICE_UA/intermediate/wiki/domains/${DOMAIN_ID}.json"
    echo "[understand-wiki] Removed obsolete domain page: $DOMAIN_ID"
  done
  
  # Conditionally regenerate service overview
  OVERVIEW_DIRTY=$(echo "$DIFF_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['serviceOverviewDirty']).lower())")
  if [ "$OVERVIEW_DIRTY" = "true" ]; then
    echo "[understand-wiki] Regenerating service overview (domain list changed)..."
    # Dispatch wiki-worker for service-overview only
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
> `$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains/$DOMAIN_ID.json`

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
> Write all output files to: `$SERVICE_ROOT/.understand-anything/intermediate/wiki/`

After the agent completes, verify output:
```bash
test -f "$SERVICE_ROOT/.understand-anything/intermediate/wiki/service.json" && \
test -d "$SERVICE_ROOT/.understand-anything/intermediate/wiki/domains"
```

If any file is missing, report the failure and stop (do not proceed to Quality Gate).

If intermediate output is verified, proceed to **Phase 2** (deterministic assembly). See [Phase 2 — Assembly Pipeline](wiki-phase2-assembly.md).

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

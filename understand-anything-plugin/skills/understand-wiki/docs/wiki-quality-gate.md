## Dry-Run Mode

Use `--dry-run` to preview work without LLM generation or wiki file writes.

**What it shows:**

- Services to process (with reason: new / stale / incremental / up-to-date)
- Estimated domains per service (from `domain-graph.json`; incremental uses `wiki_diff_domains.py`)
- Whether Phase 3 would run (requires 2+ integrated services after the planned run)
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

Phase 3: Parent wiki would be regenerated (2 services changed).
Total estimated cost: ~10000 tokens

Run without --dry-run to execute.
```

The executing agent must not dispatch wiki-worker or write wiki files when `--dry-run` is set.

---

## Quality Gate

Located after Phase 2 (deterministic assembly). Validates the assembled `wiki/` output before proceeding to Phase 3 (cross-service). Runs for every successfully generated service Wiki.

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
- If `passed: true` → proceed to Layer 2 (if `--review`) or Phase 3
- If `passed: false` → report issues to user, recommend re-running with `--full`. Do NOT proceed to Phase 3 for this service.

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

- **Overall verdict: pass** → proceed to Phase 3
- **Overall verdict: warn** → report warnings to user, proceed to Phase 3
- **Overall verdict: fail** → attempt ONE retry:
  1. Format reviewer feedback into a retry appendix (see wiki-reviewer.md "Feedback Format" section)
  2. Re-dispatch wiki-worker with original prompt + retry appendix
  2.5. Re-run Phase 2 (deterministic assembly) on updated intermediate output
  3. Re-run Layer 1 validation on the new output
  4. If still failing after retry → report failure, skip this service, proceed with other services

---
name: understand-wiki
description: Generate a comprehensive, navigable knowledge base Wiki for a microservice project. Supports single-service and batch modes with progressive adoption.
argument-hint: '[--workflow] [--batch] [--service=<name>] [--review] [--full] [--force] [--dry-run] [--continue-on-error] [--language <lang>] [--repo-type <type>]'
---

# /understand-wiki

Generate a team knowledge base Wiki for microservice projects. Each service gets its own Wiki (documenting domains, flows, steps with source references). When multiple services are integrated, a parent-level orchestration Wiki is generated with cross-service relationships and business flow navigation.

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

The workflow harness runs a deterministic multi-stage pipeline (KG → DG → Wiki → Assembly → Cross-Service → Business) with structured schemas and parallel execution — suitable for large batch runs and CI environments.

### If `--workflow` is absent (default) → Manual LLM-driven path

Continue to the manual phases described in this file (LLM agent orchestrates each step directly).

---

## Options

- `$ARGUMENTS` may contain:
  - `--workflow` — Use the Workflow harness (`workflow.js`) instead of the default LLM-driven execution. Enables deterministic multi-stage pipeline with structured schemas, parallel service processing, and resumable checkpoints. Recommended for batch runs with 3+ services.
  - `--batch` — Explicitly declare current directory as parent (batch mode). Without this flag, **default is single-service mode**.
  - `--service=<name>` — Generate Wiki for a specific service (implies batch mode, runs from parent dir)
  - `--review` — After generation, run the `wiki-reviewer` agent for quality assurance
  - `--full` — Force full regeneration, ignoring existing Wiki
  - `--force` — Skip upstream KG/DG staleness check (proceed even when graphs are from an older commit)
  - `--dry-run` — Preview what would be generated without running any LLM calls (see [Dry-Run Mode](docs/wiki-quality-gate.md#dry-run-mode))
  - `--continue-on-error` — In batch mode, continue after per-service failures (default: `true`). Set `--continue-on-error=false` to stop at first failure and skip Phase 3 (see [Partial Failure Policy](docs/wiki-phase1-generation.md#partial-failure-policy))
  - `--language <lang>` — Generate content in specified language (ISO 639-1 or friendly name). Stores in config for future runs.
  - `--repo-type <type>` — Repository type: `backend` (default), `mobile`, or `frontend`. Controls wiki-worker prompt focus, domain classification strategy, and Phase 3 aggregation output.

---

## Execution Modes

| How to invoke | Mode | Behavior |
|---|---|---|
| `cd service-a && /understand-wiki` | Single-service (default) | Generate Wiki for current service → trigger parent incremental update |
| `/understand-wiki --service=order-service` | Single-service (from parent) | Target named service (implies `--batch` context) |
| `/understand-wiki --batch` | Batch | Scan all sub-services, generate/update Wiki for each, then update parent |
| `/understand-wiki --workflow --batch` | Batch via Workflow harness | Same as above but runs `workflow.js` — deterministic pipeline, parallel, resumable |
| `/understand-wiki --workflow` | Single via Workflow harness | Single-service run through `workflow.js` |

**Design principle: Explicit over implicit.** Default is always single-service (current directory = one service). Use `--batch` to explicitly declare parent mode. This avoids misdetection in monorepo structures.

### Dependency Management

Both modes use the same dependency chain — the difference is **who orchestrates**:

| Mode | Orchestrator | Flow |
|---|---|---|
| Single-service | Main agent | `/understand` → `/understand-domain` → wiki-worker → assembly (all dispatched sequentially from main agent) |
| Batch | Per-service sub-agent | Each sub-agent runs the full single-service flow above in an isolated context |

In single-service mode, the main agent manages the dependency chain directly: it ensures KG exists (dispatching an `/understand` sub-agent if needed), then ensures DG exists (dispatching an `/understand-domain` sub-agent if needed), then generates the Wiki.

In batch mode, the main agent dispatches one sub-agent per service. Each sub-agent reads this same SKILL.md and executes the single-service flow end-to-end (Phase 0 → 1 → 2), including prerequisite resolution. This isolates each service's context and enables parallel execution across services.

---

## Progress Reporting

Report progress at each phase transition:
> `[Phase N/5] <phase name>...`

During batch processing:
> `Generating Wiki for service X/N: <service-name>...`

Phase completion:
> `Phase N complete. <one-line summary>`

---

## Workflow Phases

### Phase 0 — Detection and Prerequisites

Resolve execution mode, plugin root, language/RPC config, and service list.

**Single-service mode:** Also verify KG/DG prerequisites, check staleness, and make incremental decisions. If KG or DG is missing, dispatch `/understand` and/or `/understand-domain` sub-agents before proceeding to Phase 1.

**Batch mode:** Only resolve plugin root, language config, and build the service list. Prerequisites are handled by each per-service sub-agent in Phase 1.

**Detailed implementation:** See [Phase 0 — Prerequisites](docs/wiki-phase0-prerequisites.md)

### Phase 1 — Service Wiki Generation

**Single-service mode:** Dispatch `wiki-worker` agents (incremental per-domain or full), verify output.

**Batch mode:** Dispatch one sub-agent per service. Each sub-agent runs the complete single-service flow (Phase 0 prerequisite check → Phase 1 wiki-worker → Phase 2 assembly) in an isolated context. The sub-agent reads this SKILL.md and follows the single-service path. Up to 10 sub-agents run concurrently.

**Detailed implementation:** See [Phase 1 — Service Wiki Generation](docs/wiki-phase1-generation.md) (includes [Partial Failure Policy](docs/wiki-phase1-generation.md#partial-failure-policy))

### Phase 2 — Deterministic Assembly

After wiki-worker writes content to `intermediate/wiki/`, run the deterministic pipeline to validate, index, and assemble the final wiki.

**CRITICAL — Pipeline has 5 sequential scripts. Do NOT skip any:**
1. `extract-endpoints.py` — endpoint extraction (optional output, but MUST run)
2. `enrich-endpoint-descriptions.py` — LLM description enrichment (conditional on Script 0 success)
3. `validate-wiki-schema.mjs` — schema validation + auto-fix (MUST run)
4. `build-wiki-index.py` — generates `index.json` (MUST run)
5. `assemble-wiki.py` — final assembly (MUST run)

**Checkpoint:** After successful assembly, write `$SERVICE_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-checkpoint-p2-${SERVICE_NAME}.json` with `{"_checkpoint": {"status": "complete", "phase": 2}}`. On re-run (non-`--full`), if this checkpoint exists and is valid, skip Phase 2 and proceed directly to the Quality Gate.

**Detailed implementation:** See [Phase 2 — Assembly Pipeline](docs/wiki-phase2-assembly.md)

### Quality Gate (after Phase 2)

Structural validation (always) and optional `wiki-reviewer` when `--review` is set. Dry-run planning exits before Phase 1.

**Detailed implementation:** See [Quality Gate & Dry-Run](docs/wiki-quality-gate.md)

### Phase 3 — Cross-Service + Parent Wiki

Identify cross-service relationships, LLM review/organize flows, generate parent `overview.json`, `architecture.json`, and cross-domain pages.

**CRITICAL — Phase 3 has 5 steps. Do NOT skip the LLM layer:**
1. Collect integrated services (scan for `wiki/meta.json`)
2. `cross-service-matcher.py` — deterministic RPC/Event/DB matching (Layer 1)
3. **LLM Review + Supplement + Organize** — verify matches, discover missed relationships, organize into business flows (Layer 2, **always execute**)
4. **Generate Parent Wiki** — `overview.json`, `architecture.json`, `domains/<cross-domain>.json` (**always generate**)
5. Repo-type specific: `build-client-graph.py` (mobile), `build-system-graph.py` (backend), or `build-frontend-graph.py` (frontend)
   - Features are emitted per project (id `feature:<repo>:<domain>`, `project` field, `sourceRepos=[repo]`). Cross-project merges happen only via the frontend facet's `frontendMergeGroups` in system.json; `domainLinks` are emitted only for those explicit groups.

**Incremental mode:** Before running the cross-service LLM analysis, compute content hashes (SHA-256) of each service's `wiki/meta.json`. Compare against the previous run's hashes stored in `$PROJECT_ROOT/.understand-anything/wiki/service-hashes.json`. If all service hashes match, skip Phase 3 entirely. If only some changed, pass the unchanged service wikis as read-only context and focus the LLM analysis on changed services only. After completion, update `service-hashes.json`.

**Checkpoint:** After successful cross-service analysis, write `$PROJECT_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-checkpoint-p3.json` with `{"_checkpoint": {"status": "complete", "phase": 3}}`. On re-run, if checkpoint exists and all service hashes match, skip Phase 3.

**Detailed implementation:** See [Phase 3 — Cross-Service](docs/wiki-phase3-crossservice.md)

### Phase 4 — Parent Index Construction

Build parent-level `index.json` and `meta.json` for navigation and metadata.

**Detailed implementation:** See [Phase 4 — Index](docs/wiki-phase4-index.md)

### Phase 5 — Cleanup and Report

Report: `[Phase 5/5] Finalizing...`

1. **MANDATORY — Completeness verification** (run BEFORE cleanup):
```bash
# Single-service mode:
python3 "$SKILL_DIR/verify-wiki-completeness.py" "$SERVICE_ROOT" \
  --mode=single --repo-type="$REPO_TYPE"

# Batch mode:
python3 "$SKILL_DIR/verify-wiki-completeness.py" "$PROJECT_ROOT" \
  --mode=batch --repo-type="$REPO_TYPE" --parent-root="$PROJECT_ROOT"
```

If the verifier reports **ERROR**, do NOT proceed to cleanup. Fix the missing outputs by re-running the corresponding Phase/Script, then re-verify. Only **WARN** results are acceptable to continue.

2. Clean up temp files:
```bash
rm -rf "$PROJECT_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-"*
```

3. Print final summary:
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

4. If `--review` was used, include reviewer results:
```
Review: <pass|warn|fail> (<N issues, M warnings>)
```

---

## Error Handling

- **Prerequisite missing or stale** (`/understand` or `/understand-domain`): single mode auto-dispatches `/understand` and/or `/understand-domain` sub-agents with retry; batch mode per-service sub-agent handles this internally. On failure after retry, stop with error (single mode) or skip service (batch mode) — do not generate Wiki from degraded upstream
- **Per-service sub-agent fails (batch)**: retry once; on second failure skip service. Batch default continues and runs Phase 3 with successes; `--continue-on-error=false` stops batch and skips Phase 3
- **wiki-worker dispatch fails (single)**: retry once; on second failure stop
- **Quality Gate Layer 1 fails**: report issues; stop with error (single mode) or skip service (batch mode) — do not proceed to Phase 3 with invalid Wiki
- **Quality Gate Layer 2 fails (reviewer)**: retry wiki-worker once with feedback; if still failing, save Wiki with warnings and proceed
- **Cross-service matcher script fails**: fall back to LLM-only cross-service detection
- **Parent Wiki generation fails**: service-level Wikis remain valid; report parent failure separately

**Never silently drop errors.** Every failure must appear in the final report.

---

## Wiki File Schema

Service-level and parent-level JSON schemas, flow structure, and cross-domain examples.

**Detailed reference:** See [Wiki File Schema Reference](docs/wiki-schema-reference.md)

---

## "Already Integrated" Detection

A service is considered "integrated" when:
```bash
test -f "$SERVICE_ROOT/.understand-anything/wiki/meta.json"
```

This file is written by `assemble-wiki.py` (Phase 2). Its presence guarantees a complete, validated Wiki.

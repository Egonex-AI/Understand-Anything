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
  - `--dry-run` — Preview what would be generated without running any LLM calls (see [Dry-Run Mode](docs/wiki-quality-gate.md#dry-run-mode))
  - `--continue-on-error` — In batch mode, continue after per-service failures (default: `true`). Set `--continue-on-error=false` to stop at first failure and skip Phase 3 (see [Partial Failure Policy](docs/wiki-phase1-generation.md#partial-failure-policy))
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
> `[Phase N/5] <phase name>...`

During batch processing:
> `Generating Wiki for service X/N: <service-name>...`

Phase completion:
> `Phase N complete. <one-line summary>`

---

## Workflow Phases

### Phase 0 — Detection and Prerequisites

Resolve execution mode, plugin root, language/RPC config, verify KG/DG prerequisites, staleness and incremental decisions, and batch service list.

**Detailed implementation:** See [Phase 0 — Prerequisites](docs/wiki-phase0-prerequisites.md)

### Phase 1 — Service Wiki Generation

Dispatch `wiki-worker` agents (incremental per-domain or full), verify output, handle batch concurrency and per-service outcomes.

**Detailed implementation:** See [Phase 1 — Service Wiki Generation](docs/wiki-phase1-generation.md) (includes [Partial Failure Policy](docs/wiki-phase1-generation.md#partial-failure-policy))

### Phase 2 — Deterministic Assembly

After wiki-worker writes content to `intermediate/wiki/`, run the deterministic pipeline to validate, index, and assemble the final wiki.

**Detailed implementation:** See [Phase 2 — Assembly Pipeline](docs/wiki-phase2-assembly.md)

### Quality Gate (after Phase 2)

Structural validation (always) and optional `wiki-reviewer` when `--review` is set. Dry-run planning exits before Phase 1.

**Detailed implementation:** See [Quality Gate & Dry-Run](docs/wiki-quality-gate.md)

### Phase 3 — Cross-Service + Parent Wiki

Identify cross-service relationships, LLM review/organize flows, generate parent `overview.json`, `architecture.json`, and cross-domain pages.

**Detailed implementation:** See [Phase 3 — Cross-Service](docs/wiki-phase3-crossservice.md)

### Phase 4 — Parent Index Construction

Build parent-level `index.json` and `meta.json` for navigation and metadata.

**Detailed implementation:** See [Phase 4 — Index](docs/wiki-phase4-index.md)

### Phase 5 — Cleanup and Report

Report: `[Phase 5/5] Finalizing...`

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

- **Prerequisite missing or stale** (`/understand` or `/understand-domain`): auto-dispatch `upstream-updater` subagent; on failure, log warning and proceed with stale data (single mode) or skip service (batch mode)
- **wiki-worker dispatch fails**: retry once; on second failure skip service. Batch default continues and runs Phase 3 with successes; `--continue-on-error=false` stops batch and skips Phase 3
- **Quality Gate Layer 1 fails**: report issues; batch skips service; single mode asks user
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

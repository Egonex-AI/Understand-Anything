# Wiki Deterministic Assembly Pipeline

**Date:** 2026-06-04
**Status:** Approved
**Scope:** P0–P2 full reliability alignment with `/understand`

---

## Problem Statement

`/understand-wiki` generates wiki JSON files by having `wiki-worker` (LLM agent) write directly to the final `wiki/` directory. This "LLM writes final output" pattern causes:

1. **Index inconsistency** — `index.json` is LLM-generated, may not match actual files on disk
2. **No schema enforcement at write time** — TypeScript types exist but aren't validated at runtime
3. **No cross-file consistency checks** — index ↔ files ↔ domain references are never cross-validated
4. **No content fingerprinting** — incremental updates can't tell which domain pages are stale
5. **No source traceability metrics** — sourceRef coverage isn't tracked or surfaced

By contrast, `/understand` follows a "LLM generates raw material → deterministic scripts assemble & validate" pattern that ensures output determinism.

## Decision

Adopt **"Intermediate Output Pattern"** — wiki-worker writes to `intermediate/wiki/`, then a deterministic pipeline validates, fixes, indexes, and assembles into `wiki/`. This mirrors `/understand`'s architecture.

### Key Constraints

- **Backward compatibility:** Not required. Users re-run `--full` to regenerate.
- **Language:** Python for business logic + Node.js for schema validation (reusing `@understand-anything/core`).
- **Failure policy:** Auto-fix first → warn and save if unfixable → never block silently (same as `/understand`).

---

## Pipeline Architecture

### Current Flow

```
Phase 0 → Phase 1 (wiki-worker → wiki/) → QG (read-only) → Phase 2 (LLM → parent wiki/) → Phase 3 (LLM → index/meta)
```

### New Flow

```
Phase 0 (detection)
    ↓
Phase 1 (wiki-worker → intermediate/wiki/)           ← output path change
    ↓
Phase 1.5 (deterministic pipeline)                    ← NEW
    ├── validate-wiki-schema.mjs  → schema check + auto-fix
    ├── build-wiki-index.py       → compute index from files
    └── assemble-wiki.py          → copy to wiki/ + meta + fingerprints
    ↓
Quality Gate (validates final wiki/)
    ↓
Phase 2 (cross-service → intermediate/wiki-parent/)   ← parent also to intermediate
    ↓
Phase 2.5 (parent deterministic pipeline)              ← NEW
    ├── validate-wiki-schema.mjs --parent
    ├── build-wiki-index.py --parent
    └── assemble-wiki.py --parent
    ↓
Phase 3 → Phase 4
```

**Core principle:** LLM only writes to `intermediate/`. Final `wiki/` directory is only written by deterministic scripts.

---

## Script Designs

### Script 1: `validate-wiki-schema.mjs`

**Language:** Node.js (imports `@understand-anything/core` validators)
**Location:** `skills/understand-wiki/validate-wiki-schema.mjs`

**Usage:**
```bash
node validate-wiki-schema.mjs <intermediate_wiki_dir> [--parent] [--service-root=<path>]
```

**Input:** `intermediate/wiki/` directory
**Output:** `intermediate/wiki-validation-report.json` + in-place fixes to intermediate files

**Auto-fix rules (aligned with /understand):**

| Issue | Fix |
|---|---|
| Missing `summary` | → `"No summary available"` |
| Missing `entities` | → `[]` |
| String entities | → `{ name: string, description: "" }` |
| Missing `flows` | → `[]` (warning) |
| Flow missing `id` | → generate `flow:<kebab-case-name>` |
| Flow.steps missing `order` | → auto-number sequentially |
| `sourceRef` wrong type | → set to `null` |
| Extra fields | → silently ignore (don't delete) |
| `sourceRef.file` doesn't exist on disk | → set `sourceRef: null`, append "(Source location not resolved)" to description |

**Unfixable (reported as error):**

| Issue | Action |
|---|---|
| File is not valid JSON | Skip file, report error |
| Domain page missing `id` or `name` | Report error, include in report |
| `service.json` missing `name` | Report error |

**Cross-file consistency checks:**
1. Domain ID must equal `domain:<filename-without-extension>` — auto-fix if mismatched
2. Entity name spelling consistency across domains — warn on case mismatches
3. `crossServiceCalls` service names must exist in `overview.json` services (parent mode)

**Report format:**
```json
{
  "passed": true,
  "autoFixed": 3,
  "errors": [],
  "warnings": ["domains/order.json: entities[2] was string, converted to object"],
  "filesProcessed": 5,
  "filesSkipped": 0
}
```

### Script 2: `build-wiki-index.py`

**Language:** Python
**Location:** `skills/understand-wiki/build-wiki-index.py`

**Usage:**
```bash
python build-wiki-index.py <intermediate_wiki_dir> [--parent] [--service-name=<name>]
```

**Algorithm:**
1. Read `service.json` → generate `{ id: "wiki:service-overview", type: "service", name, service: <service-name>, summary }`
2. Iterate `domains/*.json` → for each file:
   - Generate domain entry: `{ id: "wiki:domain:<slug>", type: "domain", service: <service-name>, name, summary }`
   - For each flow in `flows[]`: generate flow entry with `domain` parent reference
3. Sort: service → domains (alphabetical) → flows (grouped by domain, alphabetical)
4. Write `intermediate/wiki/index.json`

**Guarantee:** Every index entry has a corresponding disk file. Every disk file has an index entry.

### Script 3: `assemble-wiki.py`

**Language:** Python
**Location:** `skills/understand-wiki/assemble-wiki.py`

**Usage:**
```bash
python assemble-wiki.py <intermediate_wiki_dir> <final_wiki_dir> <git_commit_hash> [--service-root=<path>]
```

**Steps:**
1. Read `intermediate/wiki-validation-report.json`
2. If unfixable errors exist → log but continue (partial results > none)
3. Clear old files in `wiki/` (preserve old `meta.json` for hash comparison)
4. Copy `intermediate/wiki/` to `wiki/`
5. Compute SHA-256 content hash for each domain JSON
6. Compute quality metrics (sourceRef coverage, content depth score via `wiki_structure_validator.py --depth` logic)
7. Write `wiki/meta.json`:

```json
{
  "gitCommitHash": "<hash>",
  "generatedAt": "<ISO 8601>",
  "version": "1.0.0",
  "outputLanguage": "<lang>",
  "domainHashes": {
    "order-management": "sha256:abc123...",
    "payment-processing": "sha256:def456..."
  },
  "sourceRefCoverage": {
    "totalSteps": 42,
    "withSourceRef": 38,
    "coveragePercent": 90.5
  },
  "qualityScore": {
    "schemaCompliance": 100,
    "sourceRefCoverage": 90.5,
    "contentDepth": 72,
    "overallGrade": "B+"
  },
  "validationWarnings": ["..."]
}
```

---

## wiki-worker Changes

### Output Path

| Mode | Before | After |
|---|---|---|
| Full | `$PROJECT_ROOT/.understand-anything/wiki/` | `$PROJECT_ROOT/.understand-anything/intermediate/wiki/` |
| Single-domain | `$PROJECT_ROOT/.understand-anything/wiki/domains/<domain>.json` | `$PROJECT_ROOT/.understand-anything/intermediate/wiki/domains/<domain>.json` |

### Removed Responsibilities

Delete Phase 3 (Steps 8 & 9) from `wiki-worker.md`:
- ~~Step 8: Generate Meta~~ → handled by `assemble-wiki.py`
- ~~Step 9: Generate Index~~ → handled by `build-wiki-index.py`

wiki-worker now ONLY generates content files: `service.json` + `domains/*.json`

### Directory Creation

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate/wiki/domains"
```

---

## Incremental Update Path

```
wiki_diff_domains.py (detect changed domains)
    ↓
Copy unchanged domain files from existing wiki/ to intermediate/wiki/
    ↓
wiki-worker --single-domain → intermediate/wiki/domains/<changed>.json
    ↓
validate-wiki-schema.mjs (validate changed files only)
    ↓
build-wiki-index.py (recompute from ALL files)
    ↓
assemble-wiki.py (use domainHashes for incremental copy — only copy hash-changed files)
```

**Content fingerprint usage:**
- `meta.json.domainHashes` records SHA-256 per domain JSON
- Incremental runs compare new vs old hashes → only copy actually changed files
- `wiki_staleness_check.py` can use hashes to determine which pages need update

---

## Error Handling

| Scenario | Behavior |
|---|---|
| JSON in `intermediate/wiki/` is invalid | Skip file, report error, continue |
| Schema validation finds fixable issue | Auto-fix, record warning |
| Schema validation finds unfixable issue | Record error, file still copied to `wiki/` |
| `build-wiki-index.py` fails | **Hard failure** — index is navigation core, cannot degrade |
| `assemble-wiki.py` copy fails | Report error, `wiki/` retains last valid version |
| wiki-worker produces no output | **Hard failure**, report to user |

**Principle:** `NEVER silently drop errors. Every failure must be visible in the final report.`

---

## Testing Strategy

### Unit Tests

- `validate-wiki-schema.mjs` auto-fix rules: test each fix type with fixture data
- `build-wiki-index.py` index generation: given directory structure → verify output
- Reuse existing `wiki-schema.test.ts` and `wiki-parent-schema.test.ts`

### Integration Test

Prepare a wiki fixture set with known issues (missing fields, type errors, dangling refs) → run full pipeline → verify auto-fixed results + validation report.

---

## File Change List

| File | Change | Description |
|---|---|---|
| `skills/understand-wiki/validate-wiki-schema.mjs` | **NEW** | Node.js schema validation + auto-fix |
| `skills/understand-wiki/build-wiki-index.py` | **NEW** | Deterministic index builder |
| `skills/understand-wiki/assemble-wiki.py` | **NEW** | Post-validation assembly + meta + fingerprints |
| `agents/wiki-worker.md` | **MODIFY** | Output path → intermediate/, remove Phase 3 |
| `skills/understand-wiki/SKILL.md` | **MODIFY** | Insert Phase 1.5 description |
| `skills/understand-wiki/docs/wiki-phase1-generation.md` | **MODIFY** | Update wiki-worker output path |
| `skills/understand-wiki/docs/wiki-phase1.5-assembly.md` | **NEW** | Phase 1.5 deterministic pipeline doc |
| `packages/core/src/wiki-schema.ts` | **MODIFY** | Export validators for mjs script import |
| `skills/understand-wiki/docs/wiki-schema-reference.md` | **MODIFY** | Document new meta.json fields |

---

## Migration

Users re-run `/understand-wiki --full` after updating the plugin. No migration script needed.

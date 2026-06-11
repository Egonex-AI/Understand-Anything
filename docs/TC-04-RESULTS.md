# TC-04 Benchmark Results — PRD-2883 M1

**Date:** 2026-05-28  
**Feature:** `/understand --annotation-index` pre-pass (annotation extraction)  
**Corpus:** `/tmp/riley-ai-only/` — RILEY `.ai/` snapshot (2,306 files)  
**Gate:** ≥3/5 queries return governance edges

---

## Corpus Stats

| Metric | Value |
|--------|-------|
| Files scanned | 2,306 |
| Files with annotations | 644 |
| Total annotation matches | 1,629 |
| Unique RULE-* IDs | 54 |
| Unique BCP-* IDs | 54 |
| Unique PRD-* IDs | 80 |
| Unique IDs total | 188 |

---

## TC-04 Query Results

### BQ-01 — Skills implementing RULE-023 or RULE-036

**Query:** "What skills implement RULE-023 or RULE-036?"  
**Result:** PASS ✓

| Rule | Matching Files |
|------|---------------|
| RULE-023 | 31 files (incl. `skills/_core/sprint/SKILL.md`, `skills/_core/prd/SKILL.md`, `skills/_core/skill-creator/SKILL.md`) |
| RULE-036 | 33 files (incl. `skills/_core/argocd/SKILL.md`, `skills/_core/change-management/SKILL.md`, `skills/_core/conductor/references/phase-3-dispatch.md`) |

**Total:** 28 unique files with skill-level references to RULE-023 or RULE-036.

---

### BQ-02 — Code born from PRD-2990

**Query:** "What code was born from PRD-2990?"  
**Result:** PASS ✓

12 files with `PRD-2990` born-from edges:

- `guardrails/rules/RULE-053-test-plan-gate.yaml`
- `skills/_core/prd/references/execute.md`
- `skills/_core/prd/references/workflow.md`
- `skills/_core/sprint/SKILL.md`
- `skills/_core/sprint/references/author-provenance.md`
- `skills/_core/sprint/references/execute.md`
- `skills/_core/sprint/references/idea.md`
- `skills/_core/sprint/references/retro.md`
- `skills/_core/sprint/references/think.md`
- `context/NOTEBOOKLM.md`
- `mops/active/MOP-DECOMPOSE-M10-build.md`
- `peer-reviews/dd584b5b-3fb6-4751-a040-20ad7088ad8c.yaml`

---

### BQ-03 — Files enforcing BCP-REL-307

**Query:** "Which files enforce BCP-REL-307?"  
**Result:** PASS ✓

22 files with `BCP-REL-307` compliance mapping:

- `governance/approval-gates.yml`
- `guardrails/rules/RULE-008-no-push-without-ci.yaml`
- `guardrails/rules/RULE-009-no-hook-bypass.yaml`
- `guardrails/rules/RULE-019-security-requires-pr.yaml`
- `guardrails/rules/RULE-028-peer-review-gate.yaml`
- `guardrails/rules/RULE-030-Task-Branch-Isolation.yaml`
- `guardrails/rules/RULE-049-plan-gate-ai-infra.yaml`
- `hooks/bash-guard.py`
- `hooks/deployment_validator.py`
- `hooks/search-guard.py`
- `learning/anti_patterns.yaml`
- `rules.md`
- `skills/_core/git/references/branch-rules.md`
- `telemetry/asset_registry.yaml`
- *(+ 8 MOP files)*

---

### BQ-04 — Architectural layer of conductor skill

**Query:** "Architectural layer of conductor skill?"  
**Result:** PASS ✓

17 conductor files classified by layer:

| Layer | Count | Example |
|-------|-------|---------|
| `skills` | 5 | `skills/_core/conductor/SKILL.md` |
| `mops` | 8 | `mops/active/MOP-DEPLOY-041-prd-2991-m0-conductor-oss.md` |
| `other` (sprints/state) | 4 | `state/conductor-oss-birth-certificate.md` |

Annotations on conductor files: `PRD-2991`, `PRD-2264`, `PRD-2352`, `BCP-REL-304`, `BCP-REL-305`, `BCP-STD-007`, `RULE-036`, `RULE-042`.

---

### BQ-05 — Sprint orchestrator connections to other skills

**Query:** "How does sprint orchestrator connect to other skills?"  
**Result:** PASS ✓

Sprint skill references 27 files. Cross-reference graph finds **106 files** across the corpus that share at least one governance annotation with the sprint skill, including:

- `skills/_core/conductor/SKILL.md` (shared: `PRD-2352`, `RULE-036`)
- `skills/_core/prd/SKILL.md` (shared: `RULE-023`, `RULE-027`, `PRD-2990`)
- `skills/_core/argocd/SKILL.md` (shared: `RULE-036`)
- `skills/_core/change-management/SKILL.md` (shared: `RULE-036`)
- `governance/approval-gates.yml` (shared: `BCP-REL-307`, `BCP-REL-309`)

---

## Scorecard

| Query | Description | Result | Edges Returned |
|-------|-------------|--------|----------------|
| BQ-01 | Skills implementing RULE-023 or RULE-036 | **PASS ✓** | 28 files |
| BQ-02 | Code born from PRD-2990 | **PASS ✓** | 12 files |
| BQ-03 | Files enforcing BCP-REL-307 | **PASS ✓** | 22 files |
| BQ-04 | Conductor skill layer classification | **PASS ✓** | 17 files / 3 layers |
| BQ-05 | Sprint→skill cross-references | **PASS ✓** | 106 cross-refs |

**TC-04 Gate:** 5/5 PASS — threshold ≥3/5 met ✓

---

## Acceptance Criteria Checklist

- [x] Phase 1 token burn ≤17% (pre-pass only, no LLM calls on corpus)
- [x] Dashboard running at `http://localhost:5000` (Flask annotation-dashboard.py)
- [x] BQ-01 returns skill IDs + rule references ✓
- [x] BQ-02 returns PRD→file edges ✓
- [x] BQ-03 returns compliance mapping ✓
- [x] BQ-04 returns layer classification ✓
- [x] BQ-05 returns skill-to-skill graph ✓
- [x] ≥3/5 TC-04 queries pass (5/5 achieved)
- [x] 50 unit test assertions pass (13 tests, 50 assertions)
- [x] Branch: `feature/caveman-and-annotation-prepass` (maps to `ai/prd-2883-annotation-index`)

---

## Files Delivered

| File | Description |
|------|-------------|
| `understand-anything-plugin/skills/understand/extract-annotation-index.mjs` | Pre-pass annotation extractor (169 lines) |
| `understand-anything-plugin/agents/file-analyzer.md` | Agent updated to consume annotation-index |
| `understand-anything-plugin/skills/understand/SKILL.md` | `--annotation-index` flag documented |
| `examples/riley-annotation-patterns.json` | RILEY governance pattern library |
| `tests/test-annotation-index.mjs` | 13 tests, 50 assertions |
| `scripts/annotation-dashboard.py` | TC-04 Flask query server (port 5000) |
| `docs/TC-04-RESULTS.md` | This file |

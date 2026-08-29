# Benchmark Unsupported Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the large-repository benchmark distinguish unsupported or unavailable analysis capabilities from real execution failures.

**Architecture:** Reuse the existing `filesSkipped` and call-graph `skipped` paths rather than changing report schema 1.0.0. Capability detection happens before interpreting parser results; only a selected, advertised capability that fails remains fatal.

**Tech Stack:** Node.js ESM, `PluginRegistry`, Vitest, JSON Schema 2020-12, pnpm.

## Global Constraints

- Preserve `large-repo-report-1.0.0.schema.json` and paired Markdown/JSON compatibility.
- Unsupported structure files must be accounted for, produce `degraded` rather than `failed`, and exit 0.
- Missing optional call-graph capability must be skipped, not failed.
- Exceptions or invalid values after a capability is selected must remain failed.
- Do not weaken path, digest, privacy, cleanup, or malformed-output integrity checks.
- Do not write benchmark output inside the subject repository.

---

### Task 1: Classify unsupported capabilities without false failures

**Files:**
- Modify: `tests/skill/understand/test_extract_structure_outcomes.test.mjs`
- Modify: `understand-anything-plugin/skills/understand/extract-structure-result.mjs`
- Modify: `understand-anything-plugin/skills/understand/extract-structure.mjs`
- Modify: `docs/benchmarks/large-monorepo.md`

**Interfaces:**
- Consumes: `PluginRegistry.getPluginForFile()`, optional `AnalyzerPlugin.extractCallGraph`, existing `filesSkipped`, and existing analysis outcome counters.
- Produces: capability-aware `analyzeFileWithOutcomes()` results and schema-compatible degraded reports for unsupported files.

- [ ] **Step 1: Add failing outcome tests**

  Add one test whose registry exposes `getPluginForFile()` returning `null` and expects both outcomes to be `skipped`. Add one test whose selected parser supports structure but has neither `analyzeFileFull` nor `extractCallGraph`; expect structure `succeeded` and call graph `skipped`.

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```powershell
  & .\node_modules\.bin\vitest.CMD run tests\skill\understand\test_extract_structure_outcomes.test.mjs
  ```

  Expected: the new unsupported/capability tests fail because the current mapper returns `failed`.

- [ ] **Step 3: Implement minimal capability-aware classification**

  Update `analyzeFileWithOutcomes()` to distinguish a known missing plugin from a selected plugin that fails. Return skipped outcomes for a known unsupported file. For code/script files, attempt call-graph analysis only when the selected plugin advertises `analyzeFileFull` or `extractCallGraph`; otherwise return `skipped`.

  In `extract-structure.mjs`, account a skipped structure path in `filesSkipped` and do not append a result or outcome count for it. Preserve existing counts for analyzed results so the benchmark's shape validation remains valid.

- [ ] **Step 4: Run focused and benchmark tests and verify GREEN**

  Run:

  ```powershell
  & .\node_modules\.bin\vitest.CMD run tests\skill\understand\test_extract_structure_outcomes.test.mjs tests\benchmark\test_large_repo_report_schema.test.mjs tests\benchmark\test_large_repo_benchmark.test.mjs
  ```

  Expected: all tests pass, with only existing documented skips.

- [ ] **Step 5: Document the semantics**

  Clarify in `docs/benchmarks/large-monorepo.md` that unsupported structural files are accounted as skipped and produce degraded reports, while a parser failure after capability selection remains fatal.

- [ ] **Step 6: Run full verification**

  Run the root test suite serially, build the core package, and run the benchmark against the clean repository with output outside the subject worktree. Validate the JSON against schema 1.0.0 and confirm the paired report IDs match.

- [ ] **Step 7: Commit**

  Commit as KumamuKuma with:

  ```text
  fix(bench): distinguish unsupported analysis from failures
  ```

# Benchmark Unsupported-Outcome Semantics

## Context

The large-repository benchmark currently reports the Understand Anything
repository as failed even though every reported analysis failure is an
unsupported file or an unavailable optional call-graph capability. The
current mapper collapses `PluginRegistry`'s contractual `null` return into a
runtime failure, and the benchmark correctly treats that mislabeled outcome
as an integrity failure.

The reproduced full-repository run scanned 457 files and 126,169 lines. All
20 structure failures had no registered analyzer. All 18 call-graph failures
had no call-graph capability. No registered parser failed.

## Approaches considered

### 1. Capability-aware use of the existing skipped path (selected)

Check registry support before analysis. Files with no registered analyzer are
accounted for through the existing `filesSkipped` field, so the report is
`degraded` with exit code 0. A code or script parser without an optional
call-graph API records a skipped call graph. A selected parser that throws,
returns an invalid final value, or produces damaged output remains failed.

This preserves report schema 1.0.0, keeps repository scale totals intact, and
uses an already tested degraded-report path.

### 2. Add explicit unsupported counters to a new schema version

Add `structureUnsupported` and capability-level counters. This is more
expressive, but it expands the patch into schema versioning and migration when
the existing skipped fields already model the required behavior.

### 3. Exclude unsupported extensions during scanning

Teach the scanner to ignore every unsupported extension. This hides useful
repository scale information, requires a brittle duplicate allowlist, and
does not solve optional capability detection for supported parsers.

## Selected behavior

- Scanner totals continue to include every discovered file.
- If `PluginRegistry.getPluginForFile(path)` returns `null`, structural
  extraction accounts for the path in `filesSkipped` and emits no structural
  result for that path.
- If a selected parser supports structure but not call-graph extraction, its
  structure result succeeds and its call graph is skipped.
- Once a parser advertises a capability, an exception, missing final value,
  or malformed output is a real failure.
- A run containing only unsupported structure skips is `degraded`, not
  `failed`, and exits 0.
- The Markdown and JSON reports retain the same schema version and pair
  integrity rules.

## Verification

Tests must prove the red/green transition for an unsupported file and a
structure-only parser. Existing exception tests must continue to prove that
real parser errors are failures. The full benchmark must then run against the
clean Understand Anything worktree and produce paired schema-valid reports
with zero structure failures, zero call-graph failures, zero failed batches,
and a non-failed status.

## Publication

After the fix is committed and pushed, share the generated Markdown and JSON
reports on PR #587. The comment must state that TensorFlow was not run locally
because its repository size and resource requirements exceed the practical
scope of this local validation.

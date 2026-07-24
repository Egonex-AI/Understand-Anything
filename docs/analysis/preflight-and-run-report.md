# Analysis Preflight and Run Reports

`/understand` writes two persistent, versioned artifacts in the project's
analysis data directory (`.ua/`, or the existing legacy
`.understand-anything/` directory):

- `analysis-plan.json` describes the selected workload before any
  `file-analyzer` is dispatched.
- `run-report.json` records the lifecycle and outcome of the current run.

These files remain available after intermediate analysis files are cleaned up.
They are intended for users, automation, and future dashboard progress views.

## Privacy and data transmission

Analysis plans and run reports are local artifacts. The planning and
run-report helpers write only to the project's analysis data directory and do
not transmit project, usage, or report data to the Understand Anything
maintainers or any analytics service. The `schemaUrl` fields stored in these
files are identifiers only; the helpers do not fetch them.

This local reporting guarantee is separate from the existing LLM-backed
analysis workflow. After the user continues past preflight, selected source and
context are processed according to the host and model-provider configuration.

## Preflight behavior

The orchestrator creates the plan after scanning and semantic batching, so it
can report the workload that will actually be dispatched rather than relying
on a file-count threshold. Full and incremental analyses use the same gate.

The terminal summary and `analysis-plan.json` include:

- selected and repository-wide file counts, lines, languages, categories,
  source bytes, and a content-sensitive digest of the selected files;
- batch count, concurrency, minimum batch waves, batch-size distribution, and
  serialized deterministic context bytes;
- a low-confidence token range for known Phase 2 input;
- explicit large-context and input-quality risks; and
- explainable subdirectory or generated-content exclusion suggestions.

The token range is an envelope derived from source bytes and the deterministic
batch payload. It excludes model output, reasoning, tool protocol overhead,
retries, later architecture/review agents, cache behavior, and provider
tokenization differences. Wall-time and USD estimates remain unavailable until
the host provides calibration or authoritative model telemetry.

The selected-source digest is computed from current file bytes, not only the
preserved scan artifact. A file change between scanning and planning therefore
changes both `inputDigest` and `planId`, including same-size edits during an
incremental run.

Before analysis begins, the user must choose one of these actions:

1. Continue with the displayed workload.
2. Adjust scope, which closes the current run and requires a fresh scan,
   batching pass, and plan.
3. Cancel before any file-analysis dispatch.

Non-interactive hosts cancel instead of implicitly accepting an expensive run.
The gate does not offer a deterministic-only graph because the production
pipeline does not implement that mode.

## Run-report lifecycle

`run-report.json` tracks the scan, batching, analysis, merge, assembled-graph
review, architecture, tour, review, and save stages. Stage and batch records
retain start/finish timestamps, duration, attempts, retries, bounded failure
history, and status. A new run archives the previous report; a still-running
predecessor is first marked `interrupted`.

Only the main orchestrator updates the report. An exclusive lock serializes
updates from concurrent batch scheduling, and writes use a temporary file plus
backup/restore sequence so a caught delivery failure does not silently discard
the previous report. Error and warning text is bounded and can be supplied
through files to avoid interpolating untrusted project output into commands.
Stage and batch durations span from the first attempt to the terminal result,
so retry work and time between attempts remain visible in the elapsed duration.

Actual input tokens, output tokens, and USD cost stay `null` unless the host
supplies authoritative values. The deterministic preflight range is copied
into a separate `estimatedPhase2InputTokens` field so estimates cannot be
mistaken for measured usage.

## Schemas

Both contracts use JSON Schema Draft 2020-12 and begin at version `1.0.0`:

- `understand-anything-plugin/skills/understand/schemas/analysis-plan-1.0.0.schema.json`
- `understand-anything-plugin/skills/understand/schemas/run-report-1.0.0.schema.json`

Consumers should validate `schemaVersion` and `schemaUrl`. Unknown future
versions must not be interpreted as the 1.0.0 shape.

## Relationship to the large-repository benchmark

The preflight planner reuses only the benchmark's pure calculation for
serialized file-analyzer payload bytes. The benchmark remains a deterministic,
LLM-free performance harness with its existing report schema; it does not
produce end-to-end token, cost, or run-lifecycle claims. This separation keeps
published benchmark evidence reproducible while allowing `/understand` to use
the same deterministic workload boundary during real analysis.

## Helper commands

The normal `/understand` workflow invokes these helpers. They can also be run
directly while developing the skill:

```bash
node understand-anything-plugin/skills/understand/analysis-plan.mjs \
  /path/to/project --mode=full --parallelism=5

node understand-anything-plugin/skills/understand/run-telemetry.mjs \
  start /path/to/project --mode=full
node understand-anything-plugin/skills/understand/run-telemetry.mjs \
  attach-plan /path/to/project
node understand-anything-plugin/skills/understand/run-telemetry.mjs \
  decision /path/to/project continue
```

Use `--scan-result`, `--batches`, `--output`, or `--report` only for controlled
development and tests. Production orchestration uses the resolved analysis data
directory and always excludes `.ua/` and `.understand-anything/` artifacts from
the next project scan.
# Analysis Preflight and Run Reports

`/understand` writes two persistent, versioned artifacts in the project's
analysis data directory (`.ua/`, or the existing legacy
`.understand-anything/` directory):

- `analysis-plan.json` describes the selected workload before any
  `file-analyzer` is dispatched.
- `run-report.json` records the lifecycle and outcome of the current run.

These files remain available after intermediate analysis files are cleaned up.
They are intended for users, automation, and future dashboard progress views.

## Preflight behavior

The orchestrator creates the plan after scanning and semantic batching, so it
can report the workload that will actually be dispatched rather than relying
on a file-count threshold. Full and incremental analyses use the same gate.

The terminal summary and `analysis-plan.json` include:

- selected and repository-wide file counts, lines, languages, categories,
  source bytes, and a content-sensitive digest of the selected files;
- batch count, concurrency, minimum batch waves, batch-size distribution, and
  serialized deterministic context bytes;
- a low-confidence token range for known Phase 2 input;
- explicit large-context and input-quality risks; and
- explainable subdirectory or generated-content exclusion suggestions.

The token range is an envelope derived from source bytes and the deterministic
batch payload. It excludes model output, reasoning, tool protocol overhead,
retries, later architecture/review agents, cache behavior, and provider
tokenization differences. Wall-time and USD estimates remain unavailable until
the host provides calibration or authoritative model telemetry.

The selected-source digest is computed from current file bytes, not only the
preserved scan artifact. A file change between scanning and planning therefore
changes both `inputDigest` and `planId`, including same-size edits during an
incremental run.

Before analysis begins, the user must choose one of these actions:

1. Continue with the displayed workload.
2. Adjust scope, which closes the current run and requires a fresh scan,
   batching pass, and plan.
3. Cancel before any file-analysis dispatch.

Non-interactive hosts cancel instead of implicitly accepting an expensive run.
The gate does not offer a deterministic-only graph because the production
pipeline does not implement that mode.

## Run-report lifecycle

`run-report.json` tracks the scan, batching, analysis, merge, assembled-graph
review, architecture, tour, review, and save stages. Stage and batch records
retain start/finish timestamps, duration, attempts, retries, bounded failure
history, and status. A new run archives the previous report; a still-running
predecessor is first marked `interrupted`.

Only the main orchestrator updates the report. An exclusive lock serializes
updates from concurrent batch scheduling, and writes use a temporary file plus
backup/restore sequence so a caught delivery failure does not silently discard
the previous report. Error and warning text is bounded and can be supplied
through files to avoid interpolating untrusted project output into commands.
Stage and batch durations span from the first attempt to the terminal result,
so retry work and time between attempts remain visible in the elapsed duration.

Actual input tokens, output tokens, and USD cost stay `null` unless the host
supplies authoritative values. The deterministic preflight range is copied
into a separate `estimatedPhase2InputTokens` field so estimates cannot be
mistaken for measured usage.

## Schemas

Both contracts use JSON Schema Draft 2020-12 and begin at version `1.0.0`:

- `understand-anything-plugin/skills/understand/schemas/analysis-plan-1.0.0.schema.json`
- `understand-anything-plugin/skills/understand/schemas/run-report-1.0.0.schema.json`

Consumers should validate `schemaVersion` and `schemaUrl`. Unknown future
versions must not be interpreted as the 1.0.0 shape.

## Relationship to the large-repository benchmark

The preflight planner reuses only the benchmark's pure calculation for
serialized file-analyzer payload bytes. The benchmark remains a deterministic,
LLM-free performance harness with its existing report schema; it does not
produce end-to-end token, cost, or run-lifecycle claims. This separation keeps
published benchmark evidence reproducible while allowing `/understand` to use
the same deterministic workload boundary during real analysis.

## Helper commands

The normal `/understand` workflow invokes these helpers. They can also be run
directly while developing the skill:

```bash
node understand-anything-plugin/skills/understand/analysis-plan.mjs \
  /path/to/project --mode=full --parallelism=5

node understand-anything-plugin/skills/understand/run-telemetry.mjs \
  start /path/to/project --mode=full
node understand-anything-plugin/skills/understand/run-telemetry.mjs \
  attach-plan /path/to/project
node understand-anything-plugin/skills/understand/run-telemetry.mjs \
  decision /path/to/project continue
```

Use `--scan-result`, `--batches`, `--output`, or `--report` only for controlled
development and tests. Production orchestration uses the resolved analysis data
directory and always excludes `.ua/` and `.understand-anything/` artifacts from
the next project scan.

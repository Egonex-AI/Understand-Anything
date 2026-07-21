# Large Monorepo Benchmark

Use this benchmark to collect reproducible scale and performance evidence from
large repositories without running an LLM. It is intended for local and
community runs on projects that are too large for normal CI fixtures.

## Scope

The runner executes the real deterministic helpers used by `/understand`:

1. file scanning, classification, and line counting;
2. static import-map extraction;
3. semantic batch planning; and
4. Tree-sitter structural extraction for every batch.

It reports wall-clock time, CPU time where available, peak resident memory,
output size, repository scale, batching statistics, structural coverage, and
deterministic SHA-256 digests.

For the regular scan, imports, and batching helpers, `peakRssBytes` is the peak
RSS of that helper process. The concurrent structure stage instead reports
`maxWorkerPeakRssBytes`, the maximum peak RSS of any individual worker, not a
sum across workers. Its `userCpuTimeMicros` and `systemCpuTimeMicros` values are
summed across all structure workers.

It does **not** run an LLM, call an API, count tokens, estimate cost, generate a
knowledge graph, or render the dashboard. Do not present these results as an
end-to-end `/understand` benchmark. `estimatedAgentInputBytes` is the size of
the deterministic batch payload, not a token estimate.

## Run the benchmark

From an Understand Anything checkout:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @understand-anything/core build
corepack pnpm benchmark:large-repo /absolute/path/to/repository --label public-repository-name --output /absolute/path/to/benchmark-results/public-repository-name.json
```

The command writes two files:

- `public-repository-name.json`, which conforms to the versioned
  [report schema](large-repo-report-1.0.0.schema.json); and
- `public-repository-name.md`, a human-readable summary beside the JSON file.

The benchmark tests compile that schema and validate normal, empty, degraded,
and partial failed reports against it. The runner does not perform runtime
schema validation.

The JSON and Markdown files share a generated `pairId`. Writers for the same
pair are serialized with an exclusive lock, and a caught synchronous delivery
failure attempts to restore both previous files. This is not a crash-atomic
filesystem transaction: process termination, power loss, or a machine crash
between renames can still leave a missing or mismatched pair. Consumers should
compare the `pairId` in both files and reject a mismatch. Recovery failures are
reported only as bounded counters; report errors do not expose filesystem
paths.

The default concurrency is 5. Override it with `--concurrency 1` through
`--concurrency 32`. Use the same concurrency when comparing runs.

All intermediate files are created under the operating system's temporary
directory and deleted after the run. Existing `.ua/` and
`.understand-anything/` analysis data is excluded from benchmark input. The
only persistent writes are the requested JSON report and its adjacent Markdown
summary. `--output` is mandatory and must resolve outside the subject
repository; the CLI enforces this boundary, including through filesystem
aliases.

Published warning summaries are bounded. Each entry records the stage, the
total warning `count`, up to five sanitized `messages`, and a `truncated` flag
that reports omitted or shortened detail.

Structure diagnostics are bounded across the whole run, rather than once per
batch. The report retains deterministic samples and aggregate success, failure,
and skip counts, but discards raw per-worker stdout and stderr after those
summaries are formed. Structural coverage counts successful structure analyses;
files without a registered structural parser are accounted in `filesSkipped`
and produce a degraded report. Missing optional call-graph capability is also
skipped. After a parser advertises a capability, an exception or invalid result
remains an integrity failure instead of being reported as skipped work.

`--keep-artifacts` preserves intermediate files and prints their location.
Those private files contain absolute paths and detailed structural data; do not
publish them without reviewing and sanitizing them.

## Reproducibility protocol

For results that another contributor can reproduce:

1. Record an immutable commit for both Understand Anything and the subject
   repository. The report captures both commits when the directories are Git
   worktrees.
2. Use clean worktrees where possible. The report records `dirty: true` when
   tracked or untracked changes are present, and the Markdown report displays a
   visible warning when either the tool or subject worktree is dirty.
3. Keep the operating system, Node.js version, machine, concurrency, and
   `.understandignore` rules constant between compared runs.
4. Run at least three times and retain every report. Treat the first run as a
   possible cold-cache result instead of silently discarding it.
5. Compare timing and memory only on the same machine. Cross-machine reports
   are useful scale evidence, but they are not a fair performance regression
   comparison.
6. Confirm matching `inputDigest` and `outputDigest` values before comparing
   performance for supposedly identical inputs.

Share both the JSON and Markdown files. The report intentionally omits the Git
remote URL, hostname, and absolute subject/tool/artifact paths. It does include
the public label, commit hashes, OS release, CPU model, memory size, and project
statistics, so review both files before publishing them.

## TensorFlow reproduction recipe

TensorFlow is a useful manual subject because it is a large, multilingual
monorepo. The benchmark is not TensorFlow-specific, and TensorFlow is
intentionally not cloned or benchmarked in CI. The commands below are a
reproduction recipe, not a claim that a TensorFlow benchmark was run.

This example pins TensorFlow v2.19.0 to commit
`e36baa302922ea3c7131b302c2996bd2051ee5c4`:

### Bash

```bash
git clone --depth 1 --branch v2.19.0 https://github.com/tensorflow/tensorflow.git ../tensorflow-v2.19.0
if [ "$(git -C ../tensorflow-v2.19.0 rev-parse HEAD)" != "e36baa302922ea3c7131b302c2996bd2051ee5c4" ]; then echo "TensorFlow v2.19.0 did not resolve to the pinned commit" >&2; exit 1; fi
corepack pnpm benchmark:large-repo ../tensorflow-v2.19.0 --label tensorflow-v2.19.0 --output ../benchmark-results/tensorflow-v2.19.0.json
```

### PowerShell

```powershell
git clone --depth 1 --branch v2.19.0 https://github.com/tensorflow/tensorflow.git ..\tensorflow-v2.19.0
if ((git -C ..\tensorflow-v2.19.0 rev-parse HEAD).Trim() -ne 'e36baa302922ea3c7131b302c2996bd2051ee5c4') { throw 'TensorFlow v2.19.0 did not resolve to the pinned commit' }
corepack pnpm benchmark:large-repo ..\tensorflow-v2.19.0 --label tensorflow-v2.19.0 --output ..\benchmark-results\tensorflow-v2.19.0.json
```

Both recipes assert the immutable commit before benchmarking and keep report
outputs outside the TensorFlow checkout. Community testers can share the two
report files; the environment block makes hardware and runtime differences
explicit.

## Community scale plan

1. Land the reproducible deterministic harness and its validation-tested report
   contract.
2. Collect at least three reports with matching input and output digests for
   TensorFlow and other community monorepos.
3. Compare timing and memory only across same-machine runs.
4. Use that evidence to choose the next bottleneck to optimize.
5. Keep LLM, token, and cost benchmarking as a separate future layer rather
   than inferring end-to-end performance from this deterministic harness.

## Status and exit codes

| Exit code | Meaning | Report behavior |
| ---: | --- | --- |
| `0` | Completed with status `ok` or `degraded` | JSON and Markdown are written |
| `1` | A deterministic stage, integrity check, or temporary-artifact cleanup failed | Partial reports are written when the output location is writable; cleanup failures appear in `secondaryErrors` without replacing the primary stage error |
| `2` | Invalid CLI usage | No report is written |

`degraded` means the deterministic pipeline completed but reported warnings or
skipped files. Inspect `warnings`, `integrity`, and the Markdown summary before
using that run in a comparison.

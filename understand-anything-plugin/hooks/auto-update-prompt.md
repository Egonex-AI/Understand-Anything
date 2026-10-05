# Auto-Update Knowledge Graph (Internal — Hook-Triggered)

Incrementally update the knowledge graph after a commit. Do not ask the user for confirmation.

**Cost rule:** deletion-only, ignored-only, generated-artifact-only, and cosmetic-only updates dispatch no LLM agent. Local structural updates dispatch file-analyzer only for the current files that actually changed structurally. Whole-graph architecture/tour agents run only when the prepared plan requests them.

## Phase 0 — Pre-flight and deterministic preparation

1. Set `PROJECT_ROOT` to the current working directory. Resolve the data directory once:

   ```bash
   UA_DIR="$PROJECT_ROOT/$([ -d "$PROJECT_ROOT/.understand-anything" ] && echo .understand-anything || echo .ua)"
   ```

2. Require `$UA_DIR/knowledge-graph.json` and `$UA_DIR/meta.json`. If either is missing, report that `/understand` must create a baseline and **STOP**.
3. Read `gitCommitHash` from meta as `$LAST_COMMIT_HASH`; get `$HEAD_COMMIT` with `git rev-parse HEAD`. If they match, report that the graph is current and **STOP**.
4. Resolve `$PLUGIN_ROOT` from `$CLAUDE_PLUGIN_ROOT`, then `$HOME/.understand-anything-plugin`, validating that it contains `skills/understand/prepare-incremental.mjs`. If it cannot be found, report the error and **STOP** without changing metadata.
5. Ensure core is built, then run the bundled helper with parameterized arguments:

   ```bash
   node "$PLUGIN_ROOT/skills/understand/prepare-incremental.mjs" \
     "$PROJECT_ROOT" \
     "$LAST_COMMIT_HASH"
   ```

   The helper is authoritative for `git diff --name-status -z`, renames, spaces, POSIX normalization, the current scan/ignore rules, structural fingerprints, generated artifacts, and selective import-map refresh. Do not recreate or post-filter its decisions.
6. Read `$UA_DIR/intermediate/incremental-plan.json`.

   | Action | Required behavior |
   |---|---|
   | `SKIP` | Run the finalizer below. It advances scan/fingerprint/meta for safe cosmetic or irrelevant changes and intentionally advances nothing for generated-only commits. Report zero tokens spent and **STOP**. |
   | `PARTIAL_UPDATE` | Continue with targeted analysis. |
   | `ARCHITECTURE_UPDATE` | Continue with targeted analysis, then rerun architecture and tour. |
   | `FULL_UPDATE` | Immediately invoke `/understand --full`; do not patch the incremental baseline. |

   SKIP finalizer:

   ```bash
   node "$PLUGIN_ROOT/skills/understand/finalize-incremental.mjs" "$PROJECT_ROOT"
   ```

## Phase 1 — Targeted file analysis

Read `filesToReanalyze` from the plan. It never contains deleted, ignored, cosmetic, or generated-artifact paths.

- If the list is empty, dispatch no agent and create no new batch file. Continue directly to merge; `batch-existing.json` already contains the pruned graph. This covers deletion-only updates at zero token cost.
- Otherwise compute only changed batches:

  ```bash
  node "$PLUGIN_ROOT/skills/understand/compute-batches.mjs" "$PROJECT_ROOT" \
    --changed-files="$UA_DIR/intermediate/changed-files.json"
  ```

  Dispatch file-analyzer for those batches only, using `agents/file-analyzer.md` and the batch prompt contract from the `/understand` skill. Include `previousSymbols` for each batch's files from `incremental-symbol-baseline.json`: old symbol IDs, names, types, paths, line ranges, and class containment. Existing symbols that still exist must survive significance filtering. Preserve each original batch index in its output filename. Retry a failed dispatch once; if it still fails, **STOP** without running the finalizer or advancing the baseline.

## Phase 2 — Merge

Run the deterministic merge in both empty and non-empty analyzer cases:

```bash
python "$PLUGIN_ROOT/skills/understand/merge-batch-graphs.py" "$PROJECT_ROOT"
```

It combines `batch-existing.json` with fresh batches and recovers imports from the refreshed `scan-result.json`, including `config:`, `schema:`, `service:`, and other valid whole-file nodes. Require both a successful exit and `$UA_DIR/intermediate/assembled-graph.json`; failed candidates remain on disk for diagnosis.

Merge runs `validate-incremental-symbols.mjs`, comparing the preserved old symbols with the candidate and base/current source. Read `incremental-symbol-report.json` for per-file counts, missing IDs/names, and still-present/deleted/unknown classifications. A same-size node set can still have missing symbols. Confirmed deletions are allowed; still-present or unknown omissions block publication.

Merge also preserves normalized dangling edge candidates from fresh batches in `incremental-edge-candidates.json` before discarding unresolved endpoints. Every successful validation reconciles both endpoint IDs, including first-pass updates without a retry and repairs where omitted symbols return. This evidence excludes `batch-existing.json` and is cleared by fresh preparation.

Current endpoint descriptors take precedence over baseline aliases when IDs are reused. Repair defers incoming edges outside the retained batch until their original HEAD identities are matched, preventing a reused ID from attaching an old current-analysis reference to a different symbol.

If the report has `unresolvedFiles`, prepare one targeted symbol retry:

```bash
node "$PLUGIN_ROOT/skills/understand/prepare-symbol-retry.mjs" "$PROJECT_ROOT"
```

Dispatch only `batches[]` from `incremental-symbol-retry.json`, with the usual file-analyzer prompt and its supplied `files`, `batchIndex`, `batchImportData`, `neighborMap`, `previousSymbols`, and `missingSymbols`. Reanalyze those files completely. The helper preserves other merged results in `batch-0.json`, removes affected nodes and outgoing edges, and clears old numeric shards before repair. Current inbound edges from other files remain candidates until merge reconciles their replacement targets and drops dangling references. Rerun merge after this one repair. Never paste old nodes or semantic edges back into the candidate. The attempt is recorded for the base/head commits, even across repeated prepare calls.

If the helper, repair dispatch, or second merge fails, **STOP** with diagnostics and leave `knowledge-graph.json`, `fingerprints.json`, and `meta.json` unchanged. Other merge failures without eligible unresolved files also stop immediately.

Languages without a deterministic structural parser (including `.sh`, `.ps1`, and `.bat`) cannot have missing symbols automatically confirmed as deleted. Callables without explicit class containment also require source verification when their IDs/names are unchanged, regardless of whether class nodes were emitted; unverified identities block publication. These cases remain `unknown` and require manual investigation or parser support. Do not use supplemental LLM inspection or regex guesses to waive the gate.

Do not dispatch assemble-reviewer or graph-reviewer for automatic updates.

## Phase 3 — Conditional architecture and tour

- For `PARTIAL_UPDATE`, dispatch neither agent. The finalizer preserves existing layer assignments and tour prose, removes dangling references/empty layers, and assigns new nodes deterministically by directory depth, graph connectivity, then prior layer order.
- For `ARCHITECTURE_UPDATE`, dispatch architecture-analyzer on the full merged node/edge set, including previous layers for naming stability, and write `$UA_DIR/intermediate/layers.json`. Then dispatch tour-builder and write `$UA_DIR/intermediate/tour.json`.

Retry either required agent once. If it still fails, **STOP** without advancing the baseline.

## Phase 4 — Atomic save and baseline patch

Run:

```bash
node "$PLUGIN_ROOT/skills/understand/finalize-incremental.mjs" "$PROJECT_ROOT"
```

The finalizer performs deterministic graph/layer/tour validation and independently reruns the shared symbol check on the exact graph before writing. It atomically saves `knowledge-graph.json`, patches changed fingerprints while preserving untouched entries, removes deleted fingerprints, and only then writes `meta.json`. A graph-save failure must never advance the fingerprint or commit baseline. If symbol loss is first detected here, follow the same one-retry procedure, rerun merge and any required architecture/tour phases, then finalize; an already-used or unsuccessful repair must stop with the old graph and baselines intact.

Report:

- action taken;
- files structurally analyzed;
- deleted/ignored/cosmetic/generated counts from the plan;
- whether architecture/tour ran;
- output path.

## Error handling

- Never fall back to a hand-written regex fingerprint script or an extension-only changed-file filter.
- Never pass a deleted or ignored path to file-analyzer.
- Never update `meta.json` after a failed graph/agent phase.
- Never update `meta.json` for a generated-artifact-only commit.
- Surface every warning or failure; a subsequent run can safely retry because the helper reconstructs the previous inventory from scan results, graph node `filePath` values, and fingerprints.

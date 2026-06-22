# Semantic Batching and Output Chunking Design

**Date:** 2026-05-24
**Status:** Draft
**Branch:** `feat/semantic-batching-and-output-chunking`
**Issue:** [#159](https://github.com/Egonex-AI/Understand-Anything/issues/159) — Frequently seeing output limit exceeded

---

## Problem

The `/understand` skill's Phase 2 dispatches `file-analyzer` subagents in batches of 20-30 files each (`skills/understand/SKILL.md:282`). Two issues compound on output-constrained LLM backends (notably Bedrock OPUS with default max_tokens of 4096-8192):

1. **Output cap pressure.** Each `file-analyzer` writes one `batch-<N>.json` containing all nodes (file + functions + classes) and edges for its batch. For 25 dense files the JSON content easily exceeds the per-turn `Write(content=...)` token budget. The agent improvises by entering an undefined "minimal output mode" and drops nodes/edges silently. Issue #159 reports this for OPUS on Bedrock at the 100-file scale.

2. **Count-based batching breaks module semantics.** Files are batched by count, not by logical relationship. Files that import each other (and would together form an `auth` module, an `api` module, etc.) get split across batches. The file-analyzer only sees within-batch edges confidently; `calls`/`related`/`inherits`/`implements` edges between modules get dropped at batch boundaries.

The existing `recover_imports_from_scan` in `merge-batch-graphs.py:913` is a deterministic safety net for `imports` edges — but it cannot recover semantic edges (calls / related / inherits / implements). Those are lost.

---

## Goals

- Eliminate "Batch X failed (output limit)" from `/understand` runs on Bedrock OPUS for projects up to 500 files.
- Improve cross-batch semantic edge coverage by replacing count-based batching with Louvain community detection on the import graph.
- Maintain `imports` edge coverage parity (no regression on existing safety net).
- Stay within one PR — defer broader refactors to follow-ups (Section "Out of scope").

## Non-goals

- Refactoring Phase 1 / 2 tree-sitter usage to deduplicate per-batch extraction.
- Adding LLM-generated file summaries to neighborMap.
- Auto-tuning output thresholds per provider.

---

## Architecture

Pipeline before:

```
Phase 1   project-scanner          → scan-result.json (files + importMap)
Phase 2   file-analyzer (×N concur) → batch-<i>.json (one per batch; SKILL.md prose batching)
Phase 2末 merge-batch-graphs.py    → assembled-graph.json
```

Pipeline after:

```
Phase 1   project-scanner          → scan-result.json (unchanged)
Phase 1.5 compute-batches.mjs      → batches.json (NEW — semantic batching + neighborMap)
Phase 2   file-analyzer (×N concur) → batch-<i>.json (single) OR batch-<i>-part-<k>.json (split)
Phase 2末 merge-batch-graphs.py    → assembled-graph.json (verified, no code change)
```

**Phase 1.5 single responsibility:** topology decision + neighborMap construction. Pure algorithm — reads `scan-result.json`, writes `batches.json`, no LLM calls.

**Phase 2 changes:** SKILL.md stops doing prose batching; iterates `batches.json` and dispatches one file-analyzer per batch.

**file-analyzer changes:** consumes neighborMap; self-checks output size before writing; splits into `batch-<i>-part-<k>.json` when above thresholds.

**merge-batch-graphs.py:** no code changes — the `batch-*.json` glob and sort-key regex already accept multi-part naming. Test fixture and stderr report enhancement added.

---

## Component 1 — `compute-batches.mjs`

**Location:** `understand-anything-plugin/skills/understand/compute-batches.mjs`

**Invocation:** `node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT [--changed-files=<path>]`

**Input:** `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`

**Output:** `$PROJECT_ROOT/.understand-anything/intermediate/batches.json`

### Dependencies

Added to `understand-anything-plugin/package.json`:

- `graphology` (~10KB)
- `graphology-communities-louvain` (~30KB)

Reuses `@understand-anything/core`'s `TreeSitterPlugin` and `PluginRegistry` (already imported by `extract-structure.mjs`).

### Algorithm

```
1. Load scan-result.json.

2. Partition files by fileCategory:
   - codeFiles = files where fileCategory === "code"
   - nonCodeFiles = the rest

3. Code batching (Louvain on import graph):
   a. Build undirected graph: nodes = codeFiles, edges = importMap relations
      (weight=1, undirected so import and imported-by both count).
   b. Run graphology-communities-louvain → community assignment per file.
   c. For any community with size > 35 (max): split via edge-betweenness greedy
      cut (or simpler weakly-connected-component partition) until each
      sub-community ≤ 35. Log warning per split.
      (Whether this branch fires is decided by the implementation prototype
      step — see "Prototype-first implementation" below.)
   d. Communities with size < 5 are kept as-is. Wasted dispatches are
      bounded by the 5-concurrent cap, and the alternative ("merge small")
      adds edge cases without proportional value.

4. Non-code batching (hardcoded heuristics, moved from SKILL.md prose):
   - Group A: For each directory containing a `Dockerfile`, bundle that
     directory's `Dockerfile` + any `docker-compose.*` + any
     `.dockerignore` → one batch per such directory (so multi-service
     repos with several Dockerfiles get one batch per service).
   - Group B: `.github/workflows/*.yml` files → one batch.
   - Group C: `.gitlab-ci.yml` + files under `.circleci/` → one batch.
   - Group D: SQL files under any `migrations/` or `migration/` directory,
     sorted by filename → one batch per directory.
   - Group E: All other non-code files grouped by their immediate parent
     directory, max 20 per batch.

5. Assign batchIndex: code communities first (1..N), non-code groups
   second (N+1..M).

6. Exports extraction:
   - For each code file, run TreeSitterPlugin.extract() and collect
     top-level exports (function names, class names, exported const names).
   - Per-file failures: catch, set exports = [], emit warning.
   - Non-code files: exports = [].

7. Construct neighborMap (1-hop):
   For each file F in batch B:
     neighborMap[F.path] = [
       { path: G.path, batchIndex: G.batch, symbols: G.exports }
       for G in importMap[F.path] ∪ reverseImportMap[F.path]
       where G.batch ≠ B
     ]
   If neighborMap[F.path].length > 50, truncate to top 50 by neighbor
   degree (highest-imported neighbors kept), emit warning.

8. Construct batchImportData:
   For each batch B:
     batchImportData[F.path] = importMap[F.path]  for F in B.files

9. Write batches.json.

Fallback (script-internal): If steps 3a-3c throw, catch → emit warning
→ assign batches by alphabetical chunking (12 files per code batch).
Steps 4, 6, 7, 8 still run normally. Set `algorithm: "count-fallback"`
in the output.
```

### Louvain implementation

Use `graphology-communities-louvain`'s default modularity-greedy algorithm:

```js
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

const graph = new Graph({ type: 'undirected' });
for (const file of codeFiles) graph.addNode(file.path);
for (const [src, targets] of Object.entries(importMap)) {
  for (const tgt of targets) {
    if (graph.hasNode(src) && graph.hasNode(tgt) && !graph.hasEdge(src, tgt)) {
      graph.addEdge(src, tgt);
    }
  }
}
const communities = louvain(graph); // { nodeId: communityId }
```

### Output schema (`batches.json`)

```json
{
  "schemaVersion": 1,
  "algorithm": "louvain",
  "totalFiles": 100,
  "totalBatches": 7,
  "batches": [
    {
      "batchIndex": 1,
      "files": [
        { "path": "src/auth/login.ts", "language": "typescript",
          "sizeLines": 120, "fileCategory": "code" }
      ],
      "batchImportData": {
        "src/auth/login.ts": ["src/auth/session.ts", "src/db/users.ts"]
      },
      "neighborMap": {
        "src/auth/login.ts": [
          { "path": "src/db/users.ts", "batchIndex": 3,
            "symbols": ["User", "findById", "createUser"] }
        ]
      }
    }
  ]
}
```

`algorithm` is `"louvain"` on the happy path, `"count-fallback"` when the Louvain branch crashed.

### `--changed-files` mode

When invoked with `--changed-files=<path>`, the script:

- Loads file paths from `<path>` (one per line).
- Still builds the full project import graph (for accurate neighborMap construction).
- Only emits batches containing changed files.
- neighborMap entries reference unchanged files with their batchIndex from the deterministic full-graph Louvain re-run. The seed is fixed so the assignment is reproducible across incremental invocations.

### Prototype-first implementation

Before writing the full script, build a minimal skeleton:

1. Load `scan-result.json` from this repo's `.understand-anything/` directory (if absent, generate via `/understand --full`).
2. Run Louvain only — no size enforcement, no neighborMap.
3. Print community size distribution.
4. Decide: do real-world communities cluster in [5, 35]? If yes, size enforcement branch may be unnecessary or trivially defensive. If no, implement edge-betweenness split.

This gates the more speculative code (size enforcement) on empirical observation rather than upfront design.

---

## Component 2 — `skills/understand/SKILL.md` changes

### Add — Phase 1.5 section (after Phase 1)

```markdown
## Phase 1.5 — BATCH

Report: `[Phase 1.5/7] Computing semantic batches...`

Run the bundled batching script:
\`\`\`bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT
\`\`\`

Reads `.understand-anything/intermediate/scan-result.json`, writes
`.understand-anything/intermediate/batches.json`.

Capture stderr. Append any line starting with `Warning:` to
$PHASE_WARNINGS for the final report.

If the script exits non-zero, the failure is hard — relay the full
stderr to the user as a Phase 1.5 failure. Do not attempt to recover;
the script's internal fallback (count-based) already handles recoverable
issues. A non-zero exit means a fundamental problem (missing input file,
malformed JSON, etc.).
```

### Replace — Phase 2 ANALYZE section (current SKILL.md:280-332)

Delete the existing "Batch the file list from Phase 1 into groups of 20-30 files each" prose, the non-code grouping prose (now in compute-batches), and the dispatch-time `batchImportData` construction prose (now provided in batches.json). Replace with:

```markdown
## Phase 2 — ANALYZE

### Full analysis path

Load `.understand-anything/intermediate/batches.json` (produced by
Phase 1.5). Iterate the `batches[]` array.

Report: `[Phase 2/7] Analyzing files — <totalFiles> files in
<totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a `file-analyzer` subagent (up to 5
concurrent). Dispatch prompt template:

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory: `<SKILL_DIR>`
> Output: write to
> `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json`
> (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode,
> per Step B of your output protocol).
>
> Pre-resolved import data (use directly — do NOT re-resolve from source):
> \`\`\`json
> <batchImportData JSON inline from batches.json[i].batchImportData>
> \`\`\`
>
> Cross-batch neighbors with their exported symbols (confidence boost
> for cross-batch edges):
> \`\`\`json
> <neighborMap JSON inline from batches.json[i].neighborMap>
> \`\`\`
>
> Files to analyze:
> 1. `<path>` (<sizeLines> lines, language: `<language>`,
>    fileCategory: `<fileCategory>`)
> ...

$LANGUAGE_DIRECTIVE

After ALL batches complete, run the merge-and-normalize script:
\`\`\`bash
python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
\`\`\`

(Rest of Phase 2 unchanged.)
```

### Replace — Incremental update path (current SKILL.md:355-366)

```markdown
### Incremental update path

Run compute-batches.mjs with `--changed-files=<path>`, where `<path>`
is a temp file listing changed file paths (one per line). The script
reuses the full project's import graph for neighborMap computation
but only emits batches containing changed files. Dispatch file-analyzer
subagents per the same template as the full path.
```

### Line budget

Net added LLM-context prose: Phase 1.5 (~12 lines) + Phase 2 template clarifications (~5 lines) − removed batching prose (~15 lines) − removed batchImportData construction prose (~6 lines) ≈ **−4 lines**.

---

## Component 3 — `agents/file-analyzer.md` changes

### Add — Cross-batch context section

Insert after "Step 1: Input file construction":

```markdown
### Cross-batch context (neighborMap)

Your dispatch prompt includes a `neighborMap` — for each file in your
batch, it lists project-internal neighbors in OTHER batches (files that
import yours or that you import), with their exported symbols.

Use neighborMap as a confidence boost for cross-batch edges (`calls`,
`related`, `inherits`, `implements` to nodes outside your batch):

- If your source clearly references a symbol that appears in some
  `neighbor.symbols`, emit the edge to
  `function:<neighbor.path>:<symbol>` or
  `class:<neighbor.path>:<symbol>` with confidence.
- If your source references a cross-batch symbol that is NOT in
  neighborMap (the project-scanner may not have extracted it), you may
  still emit the edge if you saw it explicitly in the imported file's
  surface — but prefer matching neighborMap symbols when available.
- Imports continue to use `batchImportData` (fully resolved), not
  neighborMap.

The merge script's dangling-edge dropper is the safety net for
genuinely unresolvable targets.
```

### Replace — Writing Results section (current file-analyzer.md:467-475)

```markdown
## Writing Results — single or multi-part

**Step A — Compute totals.**
\`\`\`
nodeCount = nodes.length
edgeCount = edges.length
\`\`\`

**Step B — Decide split.**
- If `nodeCount ≤ 60` AND `edgeCount ≤ 120`: write ONE file to
  `.understand-anything/intermediate/batch-<batchIndex>.json`. Done.
  Skip to Step E.
- Otherwise: `parts = ceil(max(nodeCount / 60, edgeCount / 120))`.

**Step C — Partition.**
Sort files in your batch alphabetically by path. Chunk them sequentially
into `parts` groups of size `ceil(N / parts)`. For each part:
- All nodes whose `filePath` is in this part's files (for non-file
  nodes like `module`/`concept`, use the file they belong to).
- All edges whose `source` is in this part's nodes (target may be
  anywhere — same part, different part of same batch, different batch).

**Step D — Write each part.**
Write part `k` (1-indexed) to
`.understand-anything/intermediate/batch-<batchIndex>-part-<k>.json`.
Each part is a valid GraphFragment: `{ "nodes": [...], "edges": [...] }`.

**Step E — Self-validate.**
For each file written, verify:
- Valid JSON.
- `nodes` array exists and is well-formed.
- For every edge: `source` and `target` both appear as either (a) a
  node `id` in this part's nodes, OR (b) a `file:<path>` reference
  where `<path>` is in `neighborMap` or `batchImportData`, OR (c) a
  `function:<path>:<symbol>` / `class:<path>:<symbol>` reference where
  `<symbol>` is in some `neighbor.symbols`.

If validation fails on a part, do NOT silently rebuild. Respond with
an explicit error stating which part failed, which edge(s) failed
validation, and why. The dispatching session can then retry.

**Step F — Respond.**
Respond with ONLY a brief text summary: parts written (1 or more),
total nodes/edges across all parts, any files skipped. Do NOT include
JSON content in the response.
```

### Threshold rationale

`60 nodes / 120 edges per part` derives from:

- File node JSON serialized ≈ 150-300 chars; function/class ≈ 80-150 chars; edge ≈ 100-150 chars.
- 60 nodes + 120 edges ≈ 25-35KB JSON ≈ 7000-9000 output tokens (JSON tokenization is dense).
- Bedrock OPUS default `max_tokens` 4096-8192 → ~10% safety margin.

These constants live as file-analyzer.md prose for now. Auto-tuning per provider is deferred to follow-up.

---

## Component 4 — `merge-batch-graphs.py` (verify-only)

### Confirmed compatibility

The existing glob and sort-key already handle multi-part files transparently:

- `intermediate_dir.glob("batch-*.json")` matches `batch-3-part-1.json`.
- `re.search(r"batch-(\d+)", p.stem)` extracts `3` from `batch-3-part-1`, giving the same sort key as `batch-3.json`. Python `sorted` is stable, so parts load in lexicographic tie-break order.
- `merge_and_normalize` walks `all_nodes.extend(...)` / `all_edges.extend(...)`; load order does not affect dedup correctness.
- `recover_imports_from_scan` operates on the merged graph — transparent to multi-part inputs.
- `link_tests` operates on the merged node pool — transparent.

No code change required for correctness.

### Add — Multi-part awareness in stderr report

`merge-batch-graphs.py:1026` currently prints `Found {N} batch files:`. Enhance:

```python
from collections import defaultdict
by_batch = defaultdict(list)
for f in batch_files:
    m = re.match(r"batch-(\d+)(?:-part-(\d+))?\.json", f.name)
    if m:
        by_batch[int(m.group(1))].append(f.name)

logical_count = len(by_batch)
multi_part = sum(1 for files in by_batch.values() if len(files) > 1)
print(
    f"Found {len(batch_files)} batch files "
    f"({logical_count} logical batches, {multi_part} multi-part)",
    file=sys.stderr,
)
```

### Add — Missing-part warning

After grouping, detect logical batches with non-contiguous part numbers (e.g. parts `{2, 3}` present but `1` missing) and emit:

```
Warning: merge: batch <i> has parts {<set>} but missing part {<missing>}
  — possible truncated write — affected nodes/edges may be lost
```

---

## Failure modes & observability

| Failure point | Behavior | Safety net | Required warning text |
|---|---|---|---|
| Louvain library throws | exception | Script-internal: catch → count-based fallback (12 files/batch); neighborMap still built | `Warning: compute-batches: Louvain failed (<msg>) — falling back to count-based grouping (12 files/batch) — module semantic boundaries lost` |
| tree-sitter exports per-file failure | empty exports | symbols=[] in neighborMap | `Warning: compute-batches: exports extraction failed for <path> (<msg>) — symbols=[] in neighborMap — cross-batch edges to this file limited to file-level` |
| Louvain produces oversized community | size > 35 | Edge-betweenness split | `Warning: compute-batches: community size <N> > max 35 — splitting via edge-betweenness — modularity may decrease` |
| compute-batches complete crash | exit non-zero, no batches.json | SKILL.md surfaces full stderr to user; no Phase 2 fallback | (script's own error to stderr; SKILL.md relays verbatim) |
| neighborMap truncation | > 50 neighbors | Top-50 by degree kept | `Warning: compute-batches: neighborMap for <path> truncated from <N> to top 50 (by neighbor degree)` |
| file-analyzer part JSON malformed | `load_batch` skips | Existing `load_batch:139` warns and skips | (existing — verify the warning is not swallowed) |
| Missing part in multi-part batch | gap in parts | merge detects and warns | `Warning: merge: batch <i> has parts {<set>} but missing part {<missing>} — possible truncated write — affected nodes/edges may be lost` |
| file-analyzer dangling edges | source/target missing | merge drops, adds to `unfixable` (existing) | (existing) |
| file-analyzer dispatch fails | subagent error | existing retry-once mechanism | (existing) |

### Observability invariant

Every fallback / degrade / drop MUST:

1. Write a stderr line in `Warning: <component>: <what happened> — <why> — <impact>` format.
2. Bubble up to `$PHASE_WARNINGS` (SKILL.md existing mechanism) → user-facing Phase 7 final report.
3. Never use silent `catch {}` / `except: pass`. Code review treats this as a blocker.

### Invariants

1. **scan-result.json is source of truth.** Any batching/topology change preserves importMap; `recover_imports_from_scan` always restores `imports` edges.
2. **Dangling-edge dropper is final defense.** No batch-generated edge can connect to a nonexistent node in the assembled graph.
3. **No silent fallback.** `batches.json` missing → loud failure. Internal compute-batches fallback → loud warning that bubbles to user.

---

## Testing

### Unit tests — `compute-batches.mjs`

New file: `understand-anything-plugin/skills/understand/test_compute_batches.test.mjs` (Vitest).

Required cases:

- **Louvain basic:** 3 disjoint cliques → 3 batches.
- **Empty importMap:** independent files → count-fallback batches by alphabetical chunking.
- **Oversized community:** 50-node complete graph → split triggered, all sub-batches ≤ 35.
- **Non-code grouping A:** `Dockerfile` + `docker-compose.yml` + `.dockerignore` siblings → one batch per directory cluster.
- **Non-code grouping B:** `.github/workflows/*.yml` → one batch.
- **Non-code grouping C:** SQL migrations under `migrations/` → one batch per directory.
- **Mixed code + non-code:** non-code batchIndex follows code batches.
- **neighborMap correctness:** file A imports file B across batches → `neighborMap[A]` contains `{path: B, batchIndex: B's, symbols: B's exports}`.
- **neighborMap excludes same-batch:** A and C in same batch → `neighborMap[A]` does not contain C.
- **Exports failure tolerance:** mock TreeSitter to throw on one file → `exports = []` for that file, others unaffected.
- **`--changed-files`:** input subset → output contains only batches with changed files; neighborMap may reference unchanged files.
- **Fallback triggers:** mock Louvain throw → `algorithm` field = `"count-fallback"`, warning in stderr.
- **Warning assertion per fallback:** for each of {Louvain crash, exports failure, oversize split, neighborMap truncation}, assert the exact warning string appears in stderr.

### Unit tests — `merge-batch-graphs.py`

New test class `TestMultiPart` in `test_merge_batch_graphs.py`:

- Two parts of one logical batch: `batch-1-part-1.json` + `batch-1-part-2.json` → assembled contains all nodes/edges from both.
- Three parts of one logical batch.
- Cross-part edges: edge with source in part-1, target node in part-2 → connected after merge.
- Malformed part-1 + valid part-2: part-1 skipped with warning, part-2 contents present.
- Mixed single-batch and multi-part inputs.
- Missing part detection: `batch-1-part-2.json` + `batch-1-part-3.json` (no part-1) → warning emitted with exact text.
- stderr format: assert `"X logical batches, Y multi-part"` appears.

### Integration — PR acceptance gate (manual)

Documented in the PR's Test plan:

- [ ] `pnpm install` (graphology installs cleanly).
- [ ] `pnpm --filter @understand-anything/core build`.
- [ ] Run `/understand --full` on this repo (Understand-Anything itself):
  - `batches.json` generated; community size distribution sanity-check (mix of small and medium batches).
  - At least one batch produces multi-part output.
  - `assembled-graph.json` node/edge counts within expected range vs current main.
  - Dashboard renders normally.
  - Phase 7 final report includes any `$PHASE_WARNINGS` from compute-batches (visually verify warnings reach user-facing output, not just stderr).
- [ ] Run on a ~100-file repo matching ayushghosh's scenario; confirm no "output limit" errors.
- [ ] Run on a 5-10 file small repo: fallback path (all one batch) works correctly.

### Not tested

- Louvain algorithm correctness (trust `graphology-communities-louvain`'s own tests).
- Performance benchmarks (sub-second on 100-500 files is empirical; not gated).
- Multiple LLM provider output-cap variations (thresholds are conservative for Bedrock OPUS; first-party Anthropic is more permissive).

---

## Out of scope (tracked for follow-up)

### Tree-sitter deduplication

Currently Phase 1 (project-scanner), Phase 1.5 (compute-batches), and Phase 2 (file-analyzer per-batch) each run tree-sitter independently. Consolidating into a single Phase 1.5 structure extraction would simplify file-analyzer and save time on large projects. Defer because it requires reorganizing file-analyzer's protocol significantly.

### neighborMap LLM summaries

Adding one-sentence summaries per file to neighborMap would enable file-analyzer to emit `related` edges across batches with semantic justification. Requires a new lightweight summary-pass agent; defer until the tree-sitter dedup lands (Phase 1.5 will already have full structure → cheaper to add).

### Adaptive thresholds

`60 nodes / 120 edges` are conservative for Bedrock OPUS. Anthropic first-party supports much larger output caps. Adding a `--output-cap=<N>` CLI to compute-batches and propagating to file-analyzer would unlock larger parts on permissive backends. Track real-world part counts before implementing.

### Cross-batch edge audit

A post-merge audit comparing neighborMap-suggested edges vs actually-emitted edges would surface gaps. Mirror the existing `recover_imports_from_scan` pattern. Requires preserving `batches.json` for merge-time consumption.

### Multi-language monorepo handling

Multi-language repos (TS + Python) tend to naturally split via Louvain (no cross-language imports). Bridge files (OpenAPI, protobuf) might create odd communities. Address only if real reports surface.

---

## Implementation order

1. **Prototype:** minimal `compute-batches.mjs` skeleton — load scan-result.json, run Louvain, print community sizes. Run against this repo's `scan-result.json` (generate if missing via `/understand --full`). Decide whether size-enforcement branch is needed; if needed, choose between edge-betweenness and weakly-connected-component split.
2. Add exports extraction (reuse TreeSitterPlugin).
3. Add neighborMap construction + batchImportData passthrough.
4. Add non-code grouping heuristics (Groups A-E).
5. Add fallback path + warning emissions for every failure mode listed in the Failure modes table.
6. Write unit tests for compute-batches (per Testing section), including warning-text assertions.
7. Modify `agents/file-analyzer.md` — add Cross-batch context section, replace Writing Results.
8. Modify `skills/understand/SKILL.md` — add Phase 1.5, replace Phase 2 ANALYZE batching prose, replace incremental path.
9. Add multi-part stderr report + missing-part warning to `merge-batch-graphs.py`.
10. Write unit tests for `merge-batch-graphs.py` multi-part handling.
11. Add `graphology` + `graphology-communities-louvain` to `understand-anything-plugin/package.json`.
12. Run integration acceptance gate.
13. Bump version in all five `package.json` / `plugin.json` files per the project's CLAUDE.md versioning rule.

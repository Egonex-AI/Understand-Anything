# Token Reduction Design

**Date:** 2026-03-27
**Status:** Draft
**Goal:** Reduce total token cost of `/understand` by ~85-90% on large codebases (200+ files)

---

## Problem

For large codebases, the `/understand` pipeline spends the vast majority of its tokens on **repeated context injection**. The same data is sent to every subagent independently, even when that data could be computed once and shared.

### Token cost breakdown (500-file TypeScript+React project, baseline)

| Source | Phase | Tokens (input) | % of total |
|---|---|---|---|
| `allProjectFiles` list × 67 batches | Phase 2 | ~167,000 | ~50% |
| `file-analyzer-prompt.md` × 67 batches | Phase 2 | ~134,000 | ~40% |
| Language/framework addendums × 67 batches | Phase 2 | ~68,000 | ~20% |
| Tour builder payload (all nodes + edges) | Phase 5 | ~80,000 | ~24% |
| Graph reviewer (assembled graph + inventory) | Phase 6 | ~58,000 | ~17% |
| Architecture analyzer payload | Phase 4 | ~22,000 | ~7% |
| **Total** | | **~529,000** | |

The root cause: **Phase 2 runs 67 batches (at 5-10 files each), and every single batch receives the full 500-file list for import resolution.** The file list alone costs ~2,500 tokens × 67 repetitions = 167,000 tokens on input, doing work that is entirely redundant between batches.

---

## Goals

- Reduce total input tokens by 85%+ on a 500-file project
- No degradation in graph quality for standard projects
- Preserve the `--full` / incremental / scope flags
- Maintain backward compatibility with existing `knowledge-graph.json` output schema

---

## Changes

Five changes compose the full approach (C1–C5). Each is independent and can be shipped separately, but all five are needed for the full reduction.

---

### C1 — Pre-resolve imports in the project scanner

**Root cause addressed:** `allProjectFiles` (the entire file list) is injected into every file-analyzer batch solely so each batch's extraction script can resolve relative imports. This is redundant: the full file list is available during Phase 1, and import resolution is deterministic. It should happen once, not 67 times.

**Change:** Extend the Phase 1 scanner script to also parse import statements from every source file and resolve relative imports against the discovered file list. The resolved results are written into `scan-result.json` as a new `importMap` field. File-analyzer batches then receive only their own batch's pre-resolved imports — not the full file list.

#### Scanner output addition

`scan-result.json` gains:

```json
{
  "importMap": {
    "src/index.ts": ["src/utils.ts", "src/config.ts"],
    "src/utils.ts": [],
    "src/components/App.tsx": ["src/hooks/useAuth.ts", "src/store/index.ts"]
  }
}
```

- Keys are project-relative paths (matching `files[*].path`)
- Values are resolved project-relative paths only (external/unresolvable imports are omitted)
- External imports (`node_modules`, unresolvable paths) are excluded from the map entirely

#### Scanner script additions (Phase 1 Step 8)

After the existing 7 steps, the scanner script adds a new step:

```
Step 8 — Import Resolution

For each file in the discovered source list:
  1. Read the file content
  2. Extract import statements (language-specific patterns per Step 3's language detection):
     - TypeScript/JavaScript: `import ... from '...'`, `require('...')`
     - Python: `import ...`, `from ... import ...`
     - Go: `import "..."` blocks
     - Rust: `use ...` statements
     - Java/Kotlin: `import ...` statements
     - Ruby: `require`, `require_relative`
  3. For each relative import (starts with `./` or `../`):
     a. Compute the resolved path from the current file's directory
     b. Normalize to project-relative format
     c. Try common extension variants if the import has no extension:
        `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.js`, `/index.tsx`
     d. If any variant exists in the discovered file list, record it; otherwise skip
  4. For absolute imports (no `.` prefix): skip (external package)

Output the full importMap in the JSON result.
```

#### File-analyzer input schema change

**Before:**
```json
{
  "projectRoot": "/path/to/project",
  "allProjectFiles": ["src/index.ts", "src/utils.ts", "...500 paths..."],
  "batchFiles": [
    {"path": "src/index.ts", "language": "typescript", "sizeLines": 150}
  ]
}
```

**After:**
```json
{
  "projectRoot": "/path/to/project",
  "batchFiles": [
    {"path": "src/index.ts", "language": "typescript", "sizeLines": 150}
  ],
  "batchImportData": {
    "src/index.ts": ["src/utils.ts", "src/config.ts"],
    "src/components/App.tsx": ["src/hooks/useAuth.ts"]
  }
}
```

`allProjectFiles` is removed entirely. `batchImportData` contains only the pre-resolved imports for the files in this batch (sliced from `importMap` by the orchestrator).

#### File-analyzer extraction script change

The extraction script no longer performs import resolution. It:
- Still extracts: functions, classes, exports, metrics (unchanged)
- For imports: reads `batchImportData[file.path]` from the input JSON — no cross-referencing needed
- The `imports` array in each file result becomes: `batchImportData[file.path]` mapped to import edge objects with `resolvedPath` already populated, `isExternal: false`

#### SKILL.md Phase 2 change

Remove the `allProjectFiles` injection from the batch dispatch prompt. Replace with a per-batch `batchImportData` slice:

```
For each batch, slice importData from the importMap read in Phase 1:
batchImportData = { [file.path]: importMap[file.path] ?? [] }
  for each file in this batch
```

#### Token savings estimate

| | Batches | Tokens/batch | Total |
|---|---|---|---|
| Before | 67 | ~2,500 (file list) | ~167,500 |
| After (C1 alone) | 67 | ~200 (batch importData) | ~13,400 |
| **Savings** | | | **~154,100** |

---

### C2 — Increase batch size from 5-10 to 20-30 files

**Root cause addressed:** Every batch incurs the full cost of `file-analyzer-prompt.md` (~2,000 tokens) plus the batch dispatch overhead. With 67 batches, this adds up even without `allProjectFiles`. Fewer, larger batches directly reduce this repetition.

**Change:** In SKILL.md Phase 2, change the batch size guidance:

- **Before:** "Batch the file list from Phase 1 into groups of **5-10 files each**"
- **After:** "Batch the file list from Phase 1 into groups of **20-30 files each** (aim for ~25 per batch)"

Also update the concurrency limit from 3 to **5** concurrent batches. Fewer total batches means we can afford more parallelism without overwhelming the system.

#### Trade-offs

| | Smaller batches (current) | Larger batches (new) |
|---|---|---|
| Files per batch | 5-10 | 20-30 |
| Total batches (500 files) | ~67 | ~20 |
| Prompt repetition | 67× | 20× |
| Quality risk | Lower (focused) | Slightly higher (more files per subagent) |
| Concurrency | 3 | 5 |

Quality risk is low: each subagent still operates on distinct, non-overlapping file groups. The extraction script is deterministic regardless of batch size. Semantic analysis (summaries, tags) may be marginally less focused, but the quality difference is negligible in practice for well-structured files.

#### Token savings estimate (combined with C1)

| | Batches | Tokens/batch (prompt) | Total |
|---|---|---|---|
| Before (C1 only) | 67 | ~2,000 | ~134,000 |
| After (C1+C2) | 20 | ~2,000 | ~40,000 |
| **Savings from C2** | | | **~94,000** |

C1+C2 combined eliminate ~248,000 tokens from Phase 2 (down from ~301,500 to ~53,500, a ~82% Phase 2 reduction).

---

### C3 — Remove language/framework addendums from file-analyzer batches

**Root cause addressed:** `languages/typescript.md` (~600 tokens) and `frameworks/react.md` (~700 tokens) are read and injected into every file-analyzer batch prompt. For a TypeScript+React project with 20 batches (after C2), this costs 20 × 1,300 = 26,000 additional tokens — and the model already has deep knowledge of these languages from training.

**Change:** Stop injecting addendum files into Phase 2 batch prompts entirely. The addendums remain injected into Phase 4 (architecture analyzer) where there is only **one** subagent call, making the cost acceptable.

Instead, add a compact "Language and Framework Hints" reference section directly into `file-analyzer-prompt.md`. This section is a distilled, one-time addition (~150 tokens total) that captures the most useful patterns from all addendums in a concise lookup table.

#### New section in `file-analyzer-prompt.md` (replace addendum injection)

```markdown
## Language and Framework Quick Reference

Use these hints to improve tag and edge accuracy. These supplement your training knowledge.

| Signal | Tag(s) | Note |
|---|---|---|
| File in `hooks/`, exports function starting with `use` | `hook`, `service` | React custom hook |
| File in `contexts/`, exports a Provider | `service`, `state` | React context |
| File in `pages/` or `views/` | `ui`, `routing` | Page-level component |
| File in `store/`, `slices/`, `reducers/` | `state` | State management |
| File in `services/`, `api/` | `service` | Data-fetching / API client |
| `__init__.py` with re-exports | `entry-point`, `barrel` | Python package root |
| `manage.py` at project root | `entry-point` | Django management entry |
| File named `mod.rs` | `barrel` | Rust module barrel |
| File named `main.go` in `cmd/` | `entry-point` | Go binary entry |

For React: create `depends_on` edges from components to hooks they call. Create `publishes`/`subscribes` edges for Context provider/consumer patterns.
```

#### SKILL.md Phase 2 change

Remove steps 2 and 3 from the "Build the combined prompt template" block:
- **Remove:** Step 2 (Language context injection — read `./languages/<language-id>.md` per detected language)
- **Remove:** Step 3 (Framework addendum injection — read `./frameworks/<framework-id>.md` per detected framework)
- **Keep:** Step 1 (Read the base template at `./file-analyzer-prompt.md`)

The addendum injection steps **remain unchanged** in Phase 4 (architecture analyzer), since they run once.

#### Token savings estimate

| | Batches | Addendum tokens/batch | Total |
|---|---|---|---|
| Before (after C2) | 20 | ~1,300 (TS+React) | ~26,000 |
| After | 20 | ~150 (inline hints) | ~3,000 |
| **Savings** | | | **~23,000** |

---

### C4 — Slim Phase 4 and Phase 5 payloads

**Root cause addressed:** Phase 5 (tour builder) receives all nodes (file + function + class) and all edges (imports + contains + calls + exports + ...). For a 500-file project, this can include 1,500+ nodes and 3,000+ edges. Most of this data is not needed for tour design.

#### Phase 4 (Architecture Analyzer) — minor trim

Phase 4 already only sends file-type nodes, which is correct. Minor change: explicitly strip `languageNotes` from each node object in the payload (it's not useful for layer assignment and can be verbose). Also strip `name` — it is always derivable as the basename of `filePath`.

**Before per node:** `{id, name, filePath, summary, tags, complexity, languageNotes?}`
**After per node:** `{id, filePath, summary, tags}`

Savings: ~15-20% fewer tokens per node, ~3,000–5,000 tokens total for Phase 4.

#### Phase 5 (Tour Builder) — major trim

Three changes to what the orchestrator injects into the tour-builder subagent:

**1. File nodes only (strip function/class nodes)**

The tour references node IDs for wayfinding. In practice the tour always references `file:` nodes — function and class nodes are visible in the dashboard's NodeInfo sidebar once a file is selected, but the tour itself navigates at the file level.

- **Before:** all nodes (file + function + class) — for 500 files, maybe 1,500+ nodes
- **After:** file-type nodes only — 500 nodes

**2. Slim node format**

The tour builder script only uses node IDs, names, and types for graph computation. Summaries and tags are used in Phase 2 (pedagogical narrative writing). Strip heavy optional fields from the injected payload:

- **Before per node:** `{id, name, filePath, summary, type, tags, complexity, languageNotes?}`
- **After per node:** `{id, name, filePath, summary, type}` (drop tags, complexity, languageNotes)

**3. Slim edges (imports + calls only) and slim layers**

The tour's BFS traversal only traverses `imports` and `calls` edges. `contains`, `exports`, `tested_by`, `depends_on`, and other edge types add no value to the traversal and inflate the payload.

- **Before edges:** all edge types (~3,000+ edges including all `contains` edges to function/class nodes)
- **After edges:** only `imports` and `calls` edge types (~400–800 edges for typical projects)

For layers, the tour builder uses layer data only to inform the tour's narrative arc (which layer to introduce first, second, etc.). It does not need the full `nodeIds` arrays — those can be very large.

- **Before per layer:** `{id, name, description, nodeIds: [...hundreds of IDs]}`
- **After per layer:** `{id, name, description}` (drop nodeIds)

#### Token savings estimate (Phase 5)

| Data | Before | After |
|---|---|---|
| Node count | ~1,500 × ~180 chars | ~500 × ~120 chars |
| Node tokens | ~67,500 | ~15,000 |
| Edge count | ~3,000 × ~80 chars | ~600 × ~80 chars |
| Edge tokens | ~60,000 | ~12,000 |
| Layer tokens | ~5,000 | ~500 |
| **Phase 5 total** | **~132,500** | **~27,500** |
| **Savings** | | **~105,000** |

#### SKILL.md changes

In **Phase 4** dispatch prompt template, update the file node format:
```
File nodes:
[list of {id, filePath, summary, tags} for all file-type nodes]
```

In **Phase 5** dispatch prompt template, update all three payload specs:
```
Nodes (file nodes only):
[list of {id, name, filePath, summary, type} for all file-type nodes only — do NOT include function or class nodes]

Key edges (imports and calls only):
[list of edges where type is "imports" or "calls" only]

Layers:
[list of {id, name, description} — omit nodeIds]
```

---

### C5 — Gate the graph-reviewer subagent behind `--review`

**Root cause addressed:** The graph-reviewer subagent (Phase 6) reads the entire assembled graph (~500 nodes, all edges, layers, tour) and runs a LLM-powered validation. However, its Phase 1 is entirely a deterministic script, and its Phase 2 is a simple threshold decision: if `issues.length === 0`, approve. There is no LLM judgment needed for the happy path.

**Change:** By default, skip the graph-reviewer subagent. The orchestrator performs inline deterministic validation using a pre-written script. Only when `--review` is explicitly passed in `$ARGUMENTS` does the full LLM reviewer subagent run.

#### Default path (no `--review`)

In Phase 6, instead of dispatching the graph-reviewer subagent, the orchestrator:

1. Writes a compact validation script inline (embedded in SKILL.md, ~50 lines of Node.js):
   - Check: every edge source/target references a real node ID
   - Check: every file node appears in exactly one layer
   - Check: every tour step nodeId exists
   - Check: no duplicate node IDs
   - Check: required fields present on nodes and edges
2. Runs the script against `assembled-graph.json`
3. If `issues.length === 0`: proceed to Phase 7 (save)
4. If `issues.length > 0`: apply the same automated fixes as before (remove dangling edges, fill defaults), then save

This is sufficient for standard runs. The LLM reviewer adds value for catching subtle quality issues (generic summaries, orphan nodes, tour step coherence) — but those are nice-to-have, not blocking.

#### `--review` path

When `--review` is in `$ARGUMENTS`, the full graph-reviewer subagent runs as it does today. No change to that code path.

#### Token savings estimate

| Path | Tokens |
|---|---|
| Current (always runs LLM reviewer) | ~58,000 input + ~500 output |
| Default (inline script, no LLM) | ~0 |
| `--review` (unchanged) | ~58,000 (same as current) |
| **Savings for default runs** | **~58,500** |

---

## Combined savings summary

| Change | Tokens before | Tokens after | Savings |
|---|---|---|---|
| C1+C2: import map + batch consolidation | ~301,500 | ~53,500 | ~248,000 |
| C3: remove addendums from batches | ~26,000 | ~3,000 | ~23,000 |
| C4: slim Phase 4+5 payloads | ~154,500 | ~33,000 | ~121,500 |
| C5: gate reviewer (default path) | ~58,500 | ~0 | ~58,500 |
| **Total** | **~540,500** | **~89,500** | **~451,000 (~83%)** |

Estimates are for a 500-file TypeScript+React project. Actual savings scale with project size — a 1,000-file project would see proportionally larger savings from C1+C2 (more batches = more repetition eliminated).

---

## File changes

| File | Change |
|---|---|
| `skills/understand/project-scanner-prompt.md` | Add Step 8 (import resolution); add `importMap` to output schema |
| `skills/understand/file-analyzer-prompt.md` | Replace `allProjectFiles` with `batchImportData` in input schema; update extraction script to use pre-resolved imports; add compact Language/Framework Quick Reference section; remove addendum injection steps |
| `skills/understand/SKILL.md` | Phase 1: note importMap in scan result; Phase 2: remove addendum injection (steps 2+3), increase batch size 5-10→20-30, increase concurrency 3→5, replace `allProjectFiles` injection with `batchImportData` slice; Phase 4: slim node format in dispatch; Phase 5: file nodes only + slim edges + slim layers in dispatch; Phase 6: conditional reviewer — default inline script, `--review` flag for LLM reviewer |
| `skills/understand/architecture-analyzer-prompt.md` | No change (addendums still injected here) |
| `skills/understand/tour-builder-prompt.md` | Update input schema to reflect file-only nodes, imports+calls-only edges, slim layer format |
| `skills/understand/graph-reviewer-prompt.md` | No change (only used when `--review` flag is passed) |

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scanner import resolution misses edge cases (complex re-exports, dynamic imports) | Medium | Log unresolved imports; file-analyzer still uses resolved data and creates edges only for confirmed matches. Missed imports = missing edges, which is same behavior as before for unresolvable imports |
| Larger batches (C2) reduce summary quality | Low | Summary quality is driven by the model's analysis of individual files. Batch size mainly affects how many files share one subagent's context window, not per-file quality. 20-30 files remains well within context limits |
| Stripping function/class nodes from tour (C4) breaks existing tour steps | None | Tour steps reference `file:` node IDs. No existing tour data references function/class nodes at the step level |
| Removing reviewer by default (C5) misses graph errors | Low | The inline deterministic script catches all critical structural issues (dangling refs, missing layers, duplicate IDs). The LLM reviewer's additional value is quality warnings (orphan nodes, generic summaries), which are non-blocking |
| Import map generation slows down Phase 1 | Low | The scanner script already reads all files for line counting. Import parsing adds one regex pass per file — negligible overhead |

---

## Phased rollout recommendation

Given the risk profile, implement in this order:

1. **C5 first** — gate the reviewer, lowest risk, immediate 58K token savings per run
2. **C4** — slim Phase 5 payload, no scanner changes, no quality risk
3. **C3** — remove addendums from batches, add inline hints
4. **C1+C2 together** — scanner changes and batch consolidation, test thoroughly on small/medium/large projects before releasing

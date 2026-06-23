# Token Reduction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `/understand` token cost by ~85% on large codebases through import pre-resolution, batch consolidation, addendum removal, payload slimming, and gating the LLM reviewer.

**Architecture:** Five changes (C5 → C4 → C3 → C1+C2) applied in rollout order — lowest risk first. All changes are to prompt/skill markdown files in `understand-anything-plugin/skills/understand/`. No TypeScript source changes required.

**Tech Stack:** Markdown skill files, Node.js inline scripts embedded in SKILL.md, knowledge-graph JSON pipeline.

**Design doc:** `docs/plans/2026-03-27-token-reduction-design.md`

---

## Task 1: C5 — Gate graph-reviewer behind `--review` flag

Replaces the always-on LLM graph-reviewer subagent with a deterministic inline validation script. The LLM reviewer only runs when `--review` is in `$ARGUMENTS`. Saves ~58,500 tokens per default run.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (Phase 6, lines 330–362)

### Step 1: Open SKILL.md and locate Phase 6

Read the file and find "## Phase 6 — REVIEW" (line 297). Identify steps 3–6 (lines 330–362) which currently always dispatch the LLM graph-reviewer subagent.

### Step 2: Replace Phase 6 steps 3–6 with conditional reviewer logic

Replace lines 330–362 (from "3. Dispatch a subagent using the prompt template" through "6. **If `approved: true`:** Proceed to Phase 7.") with:

```markdown
3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): inline deterministic validation

Write the following Node.js script to `$PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.js`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileNodes = graph.nodes.filter(n => n.type === 'file').map(n => n.id);
  const assigned = new Map();
  (graph.layers || []).forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) issues.push(`File node '${id}' not in any layer`);
  });
  (graph.tour || []).forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: (graph.layers || []).length,
    tourSteps: (graph.tour || []).length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
```

Execute it:
```bash
node $PROJECT_ROOT/.understand-anything/tmp/ua-inline-validate.js \
  "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/review.json"
```

If the script exits non-zero, read stderr, fix the script, and retry once.

---

#### `--review` path: full LLM reviewer

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the prompt template at `./graph-reviewer-prompt.md`. Read the template file and pass the full content as the subagent's prompt, appending the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-5]
>
> Cross-validate: every file in the scan inventory should have a corresponding `file:` node in the graph. Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/review.json`

---

4. Read `$PROJECT_ROOT/.understand-anything/intermediate/review.json`.

5. **If `issues` array is non-empty:**
   - Review the `issues` list
   - Apply automated fixes where possible:
     - Remove edges with dangling references
     - Fill missing required fields with sensible defaults (e.g., empty `tags` -> `["untagged"]`, empty `summary` -> `"No summary available"`)
     - Remove nodes with invalid types
   - Re-run the final graph validation after automated fixes
   - If critical issues remain after one fix attempt, save the graph anyway but include the warnings in the final report and mark dashboard auto-launch as skipped

6. **If `issues` array is empty:** Proceed to Phase 7.
```

### Step 3: Verify the edit

Re-read SKILL.md lines 297–380 and confirm:
- Phase 6 step 3 now checks for `--review` flag
- The inline validation script is present and complete
- The `--review` path still dispatches the LLM subagent identically to before
- Steps 4–6 handle the `review.json` output the same way as before

### Step 4: Commit

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "perf(understand): gate LLM graph-reviewer behind --review flag, add inline deterministic validation"
```

---

## Task 2: C4a — Slim Phase 4 (architecture) node payload

Removes `name` and `languageNotes` from the file node format injected into the architecture-analyzer subagent. These fields are not needed for architectural layer assignment and add unnecessary tokens.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (Phase 4, around line 188–196)

### Step 1: Locate the Phase 4 dispatch prompt in SKILL.md

Find the block starting "Pass these parameters in the dispatch prompt:" under Phase 4 (around line 181). Look for:

```
> File nodes:
> ```json
> [list of {id, name, filePath, summary, tags} for all file-type nodes]
> ```
```

### Step 2: Update the file node format

Change the file nodes line from:
```
> [list of {id, name, filePath, summary, tags} for all file-type nodes]
```

To:
```
> [list of {id, filePath, summary, tags} for all file-type nodes — omit name, complexity, languageNotes]
```

### Step 3: Verify

Re-read Phase 4 and confirm the node format line is updated. Import edges line below it (`[list of edges with type "imports"]`) is unchanged.

### Step 4: Commit

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "perf(understand): slim Phase 4 architecture payload — drop redundant node fields"
```

---

## Task 3: C4b — Slim Phase 5 (tour builder) payload

Phase 5 currently injects all nodes (including function/class), all edge types, and full layer objects (with nodeIds arrays). Only file nodes, import+calls edges, and slim layers are needed for tour design. This is the largest single payload change, saving ~105,000 tokens on a 500-file project.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (Phase 5, lines 257–270)
- Modify: `understand-anything-plugin/skills/understand/tour-builder-prompt.md` (input schema)

### Step 1: Locate the Phase 5 dispatch prompt in SKILL.md

Find the block starting with (around line 257):
```
> Nodes (summarized):
> ```json
> [list of {id, name, filePath, summary, type} for key nodes]
> ```
>
> Layers:
> ```json
> [layers from Phase 4]
> ```
>
> Key edges:
> ```json
> [imports and calls edges]
> ```
```

### Step 2: Replace all three payload sections

Replace those lines with:

```markdown
> Nodes (file nodes only):
> ```json
> [list of {id, name, filePath, summary, type} for file-type nodes ONLY — do NOT include function or class nodes]
> ```
>
> Layers:
> ```json
> [list of {id, name, description} for each layer — omit nodeIds]
> ```
>
> Edges (imports and calls only):
> ```json
> [list of edges where type is "imports" or "calls" only — exclude all other edge types]
> ```
```

### Step 3: Update tour-builder-prompt.md input schema

Open `tour-builder-prompt.md` and find the "Script Requirements" section (around line 18–35). The input schema currently shows:
```json
{
  "nodes": [...],
  "edges": [...],
  "layers": [
    {"id": "layer:core", "name": "Core", "nodeIds": ["file:src/index.ts"]}
  ]
}
```

Update the layers example to reflect the slim format:
```json
{
  "nodes": [
    {"id": "file:src/index.ts", "type": "file", "name": "index.ts", "filePath": "src/index.ts", "summary": "..."}
  ],
  "edges": [
    {"source": "file:src/index.ts", "target": "file:src/utils.ts", "type": "imports"}
  ],
  "layers": [
    {"id": "layer:core", "name": "Core", "description": "Core application logic"}
  ]
}
```

Also update the "G. Node Summary Index" description (around line 84) to reflect that input nodes are file-type only:

Find:
```
**G. Node Summary Index**

Create a lookup of each node ID to its `summary`, `type`, `tags` (default to empty array `[]` if not present in input), and `name` for easy reference.
```

Add a note after it:
```
Note: input nodes are file-type only. The nodeSummaryIndex will contain only file nodes.
```

### Step 4: Verify

- Re-read SKILL.md Phase 5 payload block: confirms file-only nodes, slim layers (no nodeIds), imports+calls edges only
- Re-read tour-builder-prompt.md input schema: layers no longer have nodeIds

### Step 5: Commit

```bash
git add understand-anything-plugin/skills/understand/SKILL.md \
        understand-anything-plugin/skills/understand/tour-builder-prompt.md
git commit -m "perf(understand): slim Phase 5 tour payload — file nodes only, imports+calls edges, slim layers"
```

---

## Task 4: C3 — Remove language/framework addendums from file-analyzer batches

The addendums (`languages/typescript.md`, `frameworks/react.md`, etc.) are currently injected into every file-analyzer batch prompt. They cost ~1,300 tokens × N batches. The model already knows these languages. Replace with a compact inline reference table (~150 tokens, paid once, embedded in the base template).

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (Phase 2, lines 104–117)
- Modify: `understand-anything-plugin/skills/understand/file-analyzer-prompt.md` (add quick reference section)

### Step 1: Update the "Build the combined prompt template" block in SKILL.md Phase 2

Find the block at lines 104–117:
```
**Build the combined prompt template:**
1. Read the base template at `./file-analyzer-prompt.md`.
2. **Language context injection:** ...
3. **Framework addendum injection:** ...

Then for each batch pass the combined template content as the subagent's prompt, appending the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Frameworks detected: `<frameworks from Phase 1>`
> Languages: `<languages from Phase 1>`
>
> Use the language context and framework addendums (appended above) to produce more accurate summaries and better classify file roles.
```

Replace it with:
```markdown
**Build the prompt for each batch:**
1. Read the base template at `./file-analyzer-prompt.md`. (Language and framework hints are embedded in the template — do NOT append addendum files for Phase 2 batches. Addendums are reserved for Phase 4.)

Then for each batch pass the template content as the subagent's prompt, appending the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
```

This removes steps 2 and 3 (the addendum injection loops) entirely from Phase 2.

### Step 2: Add Language and Framework Quick Reference to file-analyzer-prompt.md

Open `file-analyzer-prompt.md`. Find the "## Critical Constraints" section near the bottom (around line 299). Insert the following new section **before** "## Critical Constraints":

```markdown
## Language and Framework Quick Reference

Use these hints to improve tag and edge accuracy for common patterns. Your training knowledge covers these — this is a fast lookup for the most impactful signals.

**Tag signals:**

| Signal | Tags to apply |
|---|---|
| File in `hooks/`, exports a function starting with `use` | `hook`, `service` |
| File in `contexts/` or `context/`, exports a Provider component | `service`, `state` |
| File in `pages/` or `views/` | `ui`, `routing` |
| File in `store/`, `slices/`, `reducers/`, `state/` | `state` |
| File in `services/`, `api/`, `client/` | `service` |
| `__init__.py` at a package root with re-exports | `entry-point`, `barrel` |
| `manage.py` at the project root | `entry-point` |
| `mod.rs` in a directory | `barrel` |
| `main.go` in a `cmd/` subdirectory | `entry-point` |

**Edge signals:**

| Pattern | Edge to create |
|---|---|
| React component renders another component in its JSX | `contains` from parent to child |
| Component/hook calls a custom hook (`useX`) | `depends_on` from consumer to hook file |
| Context provider wraps components | `publishes` from provider to context definition |
| Component calls `useContext` or custom context hook | `subscribes` from consumer to context definition |
| Python file uses `from x import y` where x is a project file | `imports` edge (same rule as JS/TS) |
| Go file `import`s an internal package path | `imports` edge to the resolved file |

```

### Step 3: Verify

- Re-read SKILL.md Phase 2 "Build the prompt" block: steps 2 and 3 (addendum loops) are gone; "Frameworks detected" line in additional context is gone
- Re-read file-analyzer-prompt.md: new "Language and Framework Quick Reference" section appears before Critical Constraints; no reference to addendum files
- Confirm Phase 4 "Build the combined prompt template" (lines 163–167) is **unchanged** — addendums still apply there

### Step 4: Commit

```bash
git add understand-anything-plugin/skills/understand/SKILL.md \
        understand-anything-plugin/skills/understand/file-analyzer-prompt.md
git commit -m "perf(understand): remove addendum injection from Phase 2 batches, add compact inline hints to file-analyzer"
```

---

## Task 5: C1a — Extend scanner to pre-resolve imports

Adds a new Step 8 to the project scanner script: parse import statements from every source file and resolve relative imports against the discovered file list. The resolved map is written into `scan-result.json` as `importMap`. This is the data that lets us eliminate `allProjectFiles` from every batch in Task 7.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/project-scanner-prompt.md`

### Step 1: Add Step 8 to the scanner script requirements

Open `project-scanner-prompt.md`. Find "**Step 7 -- Project Name**" (around line 100). After its content (the priority list), add a new step:

```markdown
**Step 8 -- Import Resolution**

For each file in the discovered source list, extract and resolve relative import statements. The goal is to produce a map from each file's path to the list of project-internal files it imports. External package imports are ignored.

For each file, read its content and extract import paths using language-appropriate patterns:

| Language | Import patterns to match |
|---|---|
| TypeScript/JavaScript | `import ... from './...'` or `'../'`, `require('./...')` or `require('../...')` |
| Python | `from .x import y`, `from ..x import y`, `import .x` (relative only) |
| Go | Paths in `import (...)` blocks that start with the module path from `go.mod` |
| Rust | `use crate::`, `use super::`, `mod x` (within the same crate) |
| Java/Kotlin | Not resolvable by path — skip import resolution for these languages |
| Ruby | `require_relative '...'` paths |

For each extracted import path:
1. Compute the resolved file path relative to project root:
   - For relative imports (`./x`, `../x`): resolve from the importing file's directory
   - Try these extension variants in order if the import has no extension: `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.js`, `/index.tsx`, `/index.jsx`, `.py`, `.go`, `.rs`, `.rb`
2. Check if the resolved path exists in the discovered file list
3. If yes: add to this file's resolved imports list
4. If no: skip (external, unresolvable, or dynamic import)

Output format in the script result:
```json
"importMap": {
  "src/index.ts": ["src/utils.ts", "src/config.ts"],
  "src/utils.ts": [],
  "src/components/App.tsx": ["src/hooks/useAuth.ts", "src/store/index.ts"]
}
```

Keys are project-relative paths. Values are arrays of resolved project-relative paths. Every key in the file list must appear in `importMap` (use an empty array `[]` if no imports were resolved). External packages and unresolvable imports are omitted entirely.
```

### Step 2: Update the scanner script output format

Find the "### Script Output Format" section (around line 109) and update the example JSON to include `importMap`:

Find this in the example:
```json
{
  "scriptCompleted": true,
  "name": "project-name",
  ...
  "estimatedComplexity": "moderate"
}
```

Add `importMap` to the example:
```json
{
  "scriptCompleted": true,
  "name": "project-name",
  "rawDescription": "...",
  "readmeHead": "...",
  "languages": ["javascript", "typescript"],
  "frameworks": ["React", "Vite"],
  "files": [
    {"path": "src/index.ts", "language": "typescript", "sizeLines": 150}
  ],
  "totalFiles": 42,
  "estimatedComplexity": "moderate",
  "importMap": {
    "src/index.ts": ["src/utils.ts", "src/config.ts"],
    "src/utils.ts": []
  }
}
```

Also update the field documentation list below the example to add:
```
- `importMap` (object) — map from every source file path to its list of resolved project-internal import paths; empty array if no resolved imports; external packages excluded
```

### Step 3: Update the final assembly section to preserve importMap

Find "## Phase 2 -- Description and Final Assembly" (around line 153). Find the IMPORTANT note:
```
**IMPORTANT:** The final output must NOT contain the `scriptCompleted`, `rawDescription`, or `readmeHead` fields.
```

Update it to:
```
**IMPORTANT:** The final output must NOT contain the `scriptCompleted`, `rawDescription`, or `readmeHead` fields. All other fields — including `importMap` — MUST be preserved exactly as output by the script.
```

Also update the final output example to include `importMap`:
```json
{
  "name": "project-name",
  "description": "...",
  "languages": ["typescript"],
  "frameworks": ["React"],
  "files": [...],
  "totalFiles": 42,
  "estimatedComplexity": "moderate",
  "importMap": {
    "src/index.ts": ["src/utils.ts"]
  }
}
```

### Step 4: Verify

Re-read `project-scanner-prompt.md` and confirm:
- Step 8 is present with full import resolution logic
- Script output format includes `importMap`
- Field documentation includes `importMap`
- Final assembly section preserves `importMap` in output

### Step 5: Commit

```bash
git add understand-anything-plugin/skills/understand/project-scanner-prompt.md
git commit -m "perf(understand): extend scanner to pre-resolve imports, output importMap in scan-result.json"
```

---

## Task 6: C1b — Update file-analyzer to use batchImportData

Removes `allProjectFiles` from the file-analyzer input schema and replaces it with `batchImportData` (pre-resolved imports for this batch's files only). Updates the extraction script section to skip import resolution entirely (already done by scanner). Updates the edge creation step to use `batchImportData` directly.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/file-analyzer-prompt.md`

### Step 1: Update the input JSON schema (Script Requirements, step 1)

Find the input schema block around line 19:
```json
{
  "projectRoot": "/path/to/project",
  "allProjectFiles": ["src/index.ts", "src/utils.ts", "..."],
  "batchFiles": [
    {"path": "src/index.ts", "language": "typescript", "sizeLines": 150},
    {"path": "src/utils.ts", "language": "typescript", "sizeLines": 80}
  ]
}
```

Replace with:
```json
{
  "projectRoot": "/path/to/project",
  "batchFiles": [
    {"path": "src/index.ts", "language": "typescript", "sizeLines": 150},
    {"path": "src/utils.ts", "language": "typescript", "sizeLines": 80}
  ],
  "batchImportData": {
    "src/index.ts": ["src/utils.ts", "src/config.ts"],
    "src/utils.ts": []
  }
}
```

Update the field descriptions:
- Remove: `allProjectFiles` description
- Add: `batchImportData` (object) — map from each batch file's project-relative path to its list of pre-resolved project-internal imports. Produced by the project scanner. Use this directly for import edge creation — do NOT attempt to re-resolve imports yourself.

### Step 2: Remove the imports extraction from "What the Script Must Extract"

Find the "**Imports:**" subsection under "What the Script Must Extract" (around lines 49–53):
```
**Imports:**
- Source module path (exactly as written in the import statement)
- Imported specifiers (named imports, default import, namespace import)
- Line number
- For relative imports (starting with `./` or `../`), compute the resolved path...
```

Replace this entire subsection with:
```markdown
**Imports:**
- Do NOT extract imports in the script. Import resolution has already been performed by the project scanner.
- The pre-resolved imports for each file are provided in `batchImportData` in the input JSON.
- Do not include an `imports` field in the script output — import edges will be created in Phase 2 using `batchImportData` directly.
```

### Step 3: Update the script output format to remove imports

Find the `results` array in the script output format (around line 67). The current `imports` array in the output:
```json
"imports": [
  {"source": "./utils", "resolvedPath": "src/utils.ts", "specifiers": ["formatDate"], "line": 1, "isExternal": false},
  {"source": "express", "resolvedPath": null, "specifiers": ["default"], "line": 2, "isExternal": true}
],
```

Remove the `imports` array from the script output format entirely. The result for each file should be:
```json
{
  "path": "src/index.ts",
  "language": "typescript",
  "totalLines": 150,
  "nonEmptyLines": 120,
  "functions": [...],
  "classes": [...],
  "exports": [...],
  "metrics": {
    "importCount": 5,
    "exportCount": 3,
    "functionCount": 4,
    "classCount": 1
  }
}
```

Keep `metrics.importCount` (derived from `batchImportData[path].length`) as a useful metric.

Update the metrics description to say:
```
- `importCount` (integer) — use `batchImportData[file.path].length` from the input JSON
```

### Step 4: Update "Preparing the Script Input" section

Find the `cat` command around line 113 that creates the input JSON:
```bash
cat > $PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<batchIndex>.json << 'ENDJSON'
{
  "projectRoot": "<project-root>",
  "allProjectFiles": [<full file list from scan>],
  "batchFiles": [<this batch's files>]
}
ENDJSON
```

Replace with:
```bash
cat > $PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<batchIndex>.json << 'ENDJSON'
{
  "projectRoot": "<project-root>",
  "batchFiles": [<this batch's files>],
  "batchImportData": <batchImportData JSON object — provided in your dispatch prompt>
}
ENDJSON
```

### Step 5: Update Step 3 (Create Edges) — Import edge creation rule

Find the "**Import edge creation rule:**" in the "Step 3 -- Create Edges" section (around line 213):
```
**Import edge creation rule:** For each import in the script output where `isExternal` is `false` and `resolvedPath` is non-null, create an `imports` edge from the current file node to `file:<resolvedPath>`. Do NOT create edges for external package imports.
```

Replace with:
```markdown
**Import edge creation rule:** For each resolved path in `batchImportData[filePath]` (provided in the input JSON), create an `imports` edge from the current file node to `file:<resolvedPath>`. The `batchImportData` values contain only resolved project-internal paths — external packages have already been filtered out. Do NOT attempt to re-resolve imports from source.
```

### Step 6: Remove `allProjectFiles` references from Critical Constraints

Find the last bullet in "## Critical Constraints" (around line 304):
```
- For import edges, use the script's `resolvedPath` field directly. Do NOT attempt to resolve import paths yourself -- the script already did this deterministically.
```

Replace with:
```markdown
- For import edges, use `batchImportData[filePath]` directly from the input JSON. Do NOT attempt to resolve import paths yourself -- the project scanner already did this deterministically.
```

### Step 7: Verify

Re-read `file-analyzer-prompt.md` and confirm:
- Input schema has `batchImportData`, no `allProjectFiles`
- Script "What to Extract" section: imports extraction replaced with "do not extract"
- Script output format: no `imports` array per file
- Preparing the Script Input: cat command has no `allProjectFiles`
- Import edge creation rule: uses `batchImportData` not script output
- Critical Constraints: no reference to `resolvedPath` from script

### Step 8: Commit

```bash
git add understand-anything-plugin/skills/understand/file-analyzer-prompt.md
git commit -m "perf(understand): replace allProjectFiles with batchImportData in file-analyzer — import resolution now done by scanner"
```

---

## Task 7: C1c + C2 — Update SKILL.md Phase 2 orchestration

Wires up the `importMap` from Phase 1 into per-batch `batchImportData` slices. Increases batch size from 5-10 to 20-30 files. Increases concurrency from 3 to 5. Removes `allProjectFiles` from the dispatch prompt.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (Phase 0, Phase 1, Phase 2)

### Step 1: Update Phase 1 to note importMap is now in scan-result.json

Find Phase 1 (around line 62) where it says:
```
After the subagent completes, read `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts
- Complexity estimate
```

Add one item to the list:
```
- Import map (`importMap`): pre-resolved project-internal imports per file
```

Also add a note:
```
Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 2 batch construction.
```

### Step 2: Change batch size and concurrency in Phase 2

Find line 100:
```
Batch the file list from Phase 1 into groups of **5-10 files each** (aim for balanced batch sizes).
```

Replace with:
```
Batch the file list from Phase 1 into groups of **20-30 files each** (aim for ~25 files per batch for balanced sizes).
```

Find line 102:
```
For each batch, dispatch a subagent using the prompt template at `./file-analyzer-prompt.md`. Run up to **3 subagents concurrently** using parallel dispatch.
```

Replace with:
```
For each batch, dispatch a subagent using the prompt template at `./file-analyzer-prompt.md`. Run up to **5 subagents concurrently** using parallel dispatch.
```

### Step 3: Add batchImportData construction to the dispatch block

Find the dispatch prompt block (around lines 119–134):
```
Fill in batch-specific parameters below and dispatch:

> Analyze these source files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch index: `<batchIndex>`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json`
>
> All project files (for import resolution):
> `<full file path list from scan>`
>
> Files to analyze in this batch:
> 1. `<path>` (<sizeLines> lines)
> ...
```

Replace with:
```markdown
Before dispatching each batch, construct `batchImportData` from `$IMPORT_MAP`:
```json
batchImportData = {}
for each file in this batch:
  batchImportData[file.path] = $IMPORT_MAP[file.path] ?? []
```

Fill in batch-specific parameters below and dispatch:

> Analyze these source files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch index: `<batchIndex>`
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.json`
>
> Pre-resolved import data for this batch (use this for all import edge creation — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON>
> ```
>
> Files to analyze in this batch:
> 1. `<path>` (<sizeLines> lines)
> 2. `<path>` (<sizeLines> lines)
> ...
```

### Step 4: Update incremental update path

Find "### Incremental update path" (around line 140):
```
Use the changed files list from Phase 0. Batch and dispatch file-analyzer subagents using the same process as above, but only for changed files.
```

Update to clarify that batchImportData still applies:
```
Use the changed files list from Phase 0. Batch and dispatch file-analyzer subagents using the same process as above (20-30 files per batch, up to 5 concurrent, with batchImportData constructed from $IMPORT_MAP), but only for changed files.
```

### Step 5: Verify all Phase 2 changes

Re-read SKILL.md Phase 2 in full and confirm:
- Batch size says "20-30 files"
- Concurrency says "5 subagents concurrently"
- "Build the prompt" block: only step 1 (read base template), no addendum steps
- Additional context block: no "Frameworks detected" line, no addendum reference
- Dispatch prompt: has `batchImportData` injection, no `allProjectFiles`
- Incremental path: mentions batchImportData

### Step 6: Commit

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "perf(understand): wire importMap into batchImportData per batch, increase batch size 5-10→20-30, concurrency 3→5"
```

---

## Task 8: Version bump

Per project convention, all four version files must stay in sync when changes are pushed.

**Files:**
- Modify: `understand-anything-plugin/package.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.cursor-plugin/plugin.json`

### Step 1: Read current version

```bash
node -e "const p = require('./understand-anything-plugin/package.json'); console.log(p.version)"
```

Expected: `1.2.1` (or whatever the current version is).

### Step 2: Bump patch version in all four files

New version: `1.2.2` (patch bump — internal optimization, no API changes).

Update each file:
- `understand-anything-plugin/package.json`: `"version": "1.2.2"`
- `.claude-plugin/marketplace.json`: `"version": "1.2.2"` in `plugins[0]`
- `.claude-plugin/plugin.json`: `"version": "1.2.2"`
- `.cursor-plugin/plugin.json`: `"version": "1.2.2"`

### Step 3: Verify all four files match

```bash
grep -r '"version"' understand-anything-plugin/package.json .claude-plugin/marketplace.json .claude-plugin/plugin.json .cursor-plugin/plugin.json
```

All four should show `"version": "1.2.2"`.

### Step 4: Commit

```bash
git add understand-anything-plugin/package.json \
        .claude-plugin/marketplace.json \
        .claude-plugin/plugin.json \
        .cursor-plugin/plugin.json
git commit -m "chore: bump version to 1.2.2"
```

---

## Task 9: Build and smoke test

Verifies all changes work end-to-end by running `/understand --full` against a real project.

**Files:** None (testing only)

### Step 1: Build the packages

```bash
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
```

Expected: both build without errors.

### Step 2: Find installed plugin version and copy to cache

```bash
ls ~/.claude/plugins/cache/understand-anything/understand-anything/
```

Note the version (e.g., `1.0.1`). Copy local build into the cache:

```bash
VERSION=$(node -e "const p = require('./understand-anything-plugin/package.json'); console.log(p.version)")
rm -rf ~/.claude/plugins/cache/understand-anything/understand-anything/$VERSION
cp -R ./understand-anything-plugin ~/.claude/plugins/cache/understand-anything/understand-anything/$VERSION
```

### Step 3: Smoke test on a small project (~20 files)

Open a fresh Claude Code session in a small TypeScript project. Run:
```
/understand --full
```

Verify:
- Phases 0–7 complete without errors
- `knowledge-graph.json` is created
- Node count and edge count are reasonable
- Layers and tour are present
- No "allProjectFiles" or addendum errors in the output

### Step 4: Smoke test on a larger project (~100+ files)

Run `/understand --full` on a medium/large TypeScript+React project.

Verify:
- Batch count is ~4-6 (at 20-30 files per batch for 100 files), not 10-20
- No errors about missing import resolution
- `importMap` is present in `scan-result.json` (check `.understand-anything/intermediate/` before cleanup, or add a temporary debug log)
- Graph quality is comparable to before (summaries are descriptive, layers are correct)

### Step 5: Test `--review` flag

Run `/understand --full --review` on the same project.

Verify:
- Phase 6 now dispatches the LLM graph-reviewer subagent (not the inline script)
- `review.json` is produced with `approved` field
- Pipeline completes normally

### Step 6: Final commit (if any fixes needed from smoke test)

```bash
git add -A
git commit -m "fix(understand): smoke test fixes for token reduction changes"
```

---

## Summary

| Task | Change | Risk |
|---|---|---|
| 1 | C5: Gate reviewer | Low |
| 2 | C4a: Slim Phase 4 payload | Low |
| 3 | C4b: Slim Phase 5 payload | Low |
| 4 | C3: Remove addendums from batches | Low |
| 5 | C1a: Scanner import resolution | Medium |
| 6 | C1b: File-analyzer uses batchImportData | Medium |
| 7 | C1c+C2: SKILL.md orchestration + batch size | Medium |
| 8 | Version bump | Low |
| 9 | Smoke test | — |

Tasks 1–4 are independent of Tasks 5–7. They can be shipped separately if needed. Tasks 5, 6, and 7 are tightly coupled (scanner produces importMap → SKILL.md passes batchImportData → file-analyzer consumes it) and must be shipped together.

# Auto-Update Knowledge Graph (Internal — Hook-Triggered)

Incrementally update the knowledge graph using deterministic structural fingerprinting to minimize token usage. This prompt is triggered automatically by the post-commit hook when `autoUpdate` is enabled. It is NOT a user-facing skill.

**Key principle:** Spend zero LLM tokens when changes are cosmetic (formatting, internal logic). Only invoke LLM agents when structural changes (new/removed functions, classes, imports, exports) are detected.

---

## Phase 0 — Pre-flight (Zero Token Cost)

1. Set `PROJECT_ROOT` to the current working directory. **Resolve the data directory `$UA_DIR`** once and reuse it for every read and write below: `UA_DIR="$PROJECT_ROOT/$([ -d "$PROJECT_ROOT/.understand-anything" ] && echo .understand-anything || echo .ua)"` — this selects the legacy `.understand-anything/` when it already exists, otherwise the new `.ua/`. Because each phase may run in a fresh shell, carry `$UA_DIR` forward like `$PROJECT_ROOT`, re-resolving it with the same line if a later command block needs it. Scripts written below that run in Node resolve the same rule in JavaScript.

2. Check that `$UA_DIR/knowledge-graph.json` exists.
   - If not: report "No existing knowledge graph found. Run `/understand` first to create one." and **STOP**.

3. Check that `$UA_DIR/meta.json` exists and read `gitCommitHash`.
   - If not: report "No analysis metadata found. Run `/understand` to create a baseline." and **STOP**.

4. Get current commit hash:
   ```bash
   git rev-parse HEAD
   ```

5. If commit hashes match and `--force` is NOT in `$ARGUMENTS`: report "Knowledge graph is already up to date." and **STOP**.

6. Get changed files:
   ```bash
   git diff "<lastCommitHash>..HEAD" --name-only
   ```
   If no files changed: update `meta.json` with the new commit hash and **STOP**.

7. Filter to source files only (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.cpp`, `.c`, `.h`, `.cs`, `.swift`, `.kt`, `.php`).
   If no source files changed: update `meta.json` with the new commit hash, report "Only non-source files changed. Metadata updated." and **STOP**.

8. Create intermediate directory:
   ```bash
   mkdir -p "$UA_DIR/intermediate"
   ```

9. **Apply `.understandignore` exclusions** (same semantics as `/understand` Step 2.5 in `agents/project-scanner.md`).

   Without this step, files in user-excluded paths (migrations, vendored code, tests) are counted as structural changes and can spuriously escalate the action to `FULL_UPDATE` even when the real change set is tiny.

   1. If neither `$UA_DIR/.understandignore` nor `$PROJECT_ROOT/.understandignore` exists, the step 7 extension filter is sufficient — skip to Phase 1.

   2. Write the step 7 file list to `$UA_DIR/intermediate/changed-files-pre.json` as a JSON array of relative paths.

   3. Resolve `$PLUGIN_ROOT`:
      - Use `$CLAUDE_PLUGIN_ROOT` if set (Claude Code's hook context sets this).
      - Otherwise try `$HOME/.understand-anything-plugin`.
      - Validate the chosen candidate by checking `$candidate/packages/core/dist/ignore-filter.js` exists.
      - If neither resolves: report "Cannot locate plugin install at `$CLAUDE_PLUGIN_ROOT` or `$HOME/.understand-anything-plugin`; auto-update aborted. Run `/understand` to re-baseline." and **STOP**. Do **not** silently skip — silent skip reproduces issue #153.

   4. Write `$UA_DIR/intermediate/ignore-filter.mjs`:
      ```javascript
      import { readFileSync, writeFileSync, existsSync } from 'node:fs';
      import { pathToFileURL } from 'node:url';
      import path from 'node:path';

      const PROJECT_ROOT = process.cwd();
      // Data directory: legacy `.understand-anything/` when present, else new `.ua/`.
      const UA_DIR = existsSync(path.join(PROJECT_ROOT, '.understand-anything')) ? '.understand-anything' : '.ua';
      const PLUGIN_ROOT = process.argv[2];
      const inputPath = process.argv[3];

      const modUrl = pathToFileURL(
        path.join(PLUGIN_ROOT, 'packages/core/dist/ignore-filter.js'),
      ).href;
      const { createIgnoreFilter } = await import(modUrl);
      const filter = createIgnoreFilter(PROJECT_ROOT);

      const input = JSON.parse(readFileSync(inputPath, 'utf-8'));
      const kept = input.filter((p) => !filter.isIgnored(p));
      const removed = input.length - kept.length;

      writeFileSync(
        path.join(PROJECT_ROOT, UA_DIR, 'intermediate/changed-files.json'),
        JSON.stringify({ kept, removed, total: input.length }, null, 2),
      );
      console.log(`.understandignore: kept ${kept.length}/${input.length} (removed ${removed})`);
      ```

   5. Run it:
      ```bash
      node "$UA_DIR/intermediate/ignore-filter.mjs" \
        "$PLUGIN_ROOT" \
        "$UA_DIR/intermediate/changed-files-pre.json"
      ```

   6. Read `$UA_DIR/intermediate/changed-files.json`. Pass the `kept` array as the input file list for Phase 1's fingerprint-check script.

   7. If `kept.length === 0`: update `meta.json` with the new commit hash, report "All changed source files are in ignored paths. Metadata updated." and **STOP**.

---

## Phase 1 — Structural Fingerprint Check (Zero LLM Tokens)

This phase runs a deterministic Node.js script that compares file structures against stored fingerprints. It costs **zero LLM tokens** — only the script execution cost.

1. Write and execute a Node.js script (`$UA_DIR/intermediate/fingerprint-check.mjs`):

```javascript
// The script should:
// 1. Read fingerprints.json from the data directory (.ua/fingerprints.json, or .understand-anything/fingerprints.json when that legacy directory is present — resolve UA_DIR the same way as the other scripts)
// 2. For each changed source file:
//    a. Read the file content
//    b. Compute SHA-256 content hash
//    c. If content hash matches stored hash → NONE (skip)
//    d. Extract structural elements via regex:
//       - Functions: match patterns like `function NAME(`, `const NAME = (`, `export function NAME(`
//       - Classes: match `class NAME`, `export class NAME`
//       - Imports: match `import ... from '...'`, `import '...'`
//       - Exports: match `export { ... }`, `export default`, `export function`, `export class`, `export const`
//    e. Compare extracted elements against stored fingerprint
//    f. Classify as NONE, COSMETIC, or STRUCTURAL
// 3. For new files (not in fingerprints.json): classify as STRUCTURAL
// 4. For deleted files (in fingerprints.json but not on disk): classify as STRUCTURAL
// 5. Determine overall decision:
//    - All NONE/COSMETIC → action: "SKIP"
//    - Some STRUCTURAL, ≤10 files, same directories → action: "PARTIAL_UPDATE"
//    - New/deleted directories or >10 structural files → action: "ARCHITECTURE_UPDATE"
//    - >30 structural files or >50% of graph → action: "FULL_UPDATE"
// 6. Write result to <UA_DIR>/intermediate/change-analysis.json (.ua/, or .understand-anything/ when that legacy directory is present)
```

The output JSON should have this shape:
```json
{
  "action": "SKIP | PARTIAL_UPDATE | ARCHITECTURE_UPDATE | FULL_UPDATE",
  "filesToReanalyze": ["src/new-feature.ts"],
  "rerunArchitecture": false,
  "rerunTour": false,
  "reason": "1 file has structural changes (new function added)",
  "fileChanges": [
    { "filePath": "src/utils.ts", "changeLevel": "COSMETIC", "details": ["internal logic changed"] },
    { "filePath": "src/new-feature.ts", "changeLevel": "STRUCTURAL", "details": ["new function: handleRequest"] }
  ]
}
```

2. Read `$UA_DIR/intermediate/change-analysis.json`.

3. **Decision gate:**

   | Action | What to do |
   |---|---|
   | `SKIP` | Update `meta.json` with new commit hash. Report: "No structural changes detected. Graph metadata updated. Zero tokens spent." **STOP.** |
   | `FULL_UPDATE` | Report: "Major structural changes detected (reason). Recommend running `/understand --full` for a complete rebuild." **STOP.** |
   | `PARTIAL_UPDATE` | Proceed to Phase 2 with `filesToReanalyze` |
   | `ARCHITECTURE_UPDATE` | Proceed to Phase 2 with `filesToReanalyze`, flag architecture re-run |

---

## Phase 2 — Targeted Re-Analysis (Minimal Token Cost)

Only re-analyze files with structural changes. This is the **only** phase that costs LLM tokens.

1. Read the existing knowledge graph from `$UA_DIR/knowledge-graph.json`.

2. Batch the files from `filesToReanalyze` (from Phase 1). Use a single batch if ≤10 files, otherwise batch into groups of 5-10.

3. For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Append:

   > **Additional context from main session:**
   >
   > Project: `<projectName from existing graph>` — `<projectDescription>`
   > Frameworks detected: `<frameworks from existing graph>`
   > Languages: `<languages from existing graph>`
   >
   > **IMPORTANT:** This is an incremental update. Only the files listed below have structural changes. Analyze them thoroughly but do not invent nodes for files not in this batch.

   Fill in batch-specific parameters:

   > Analyze these source files and produce GraphNode and GraphEdge objects.
   > Project root: `$PROJECT_ROOT`
   > Project: `<projectName>`
   > Languages: `<languages>`
   > Batch index: `1`
   > Write output to: `$UA_DIR/intermediate/batch-1.json`
   >
   > All project files (for import resolution):
   > `<file list from existing graph nodes>`
   >
   > Files to analyze in this batch:
   > 1. `<path>` (`<sizeLines>` lines)
   > ...

4. After batch(es) complete, read each `batch-<N>.json` and merge results.

5. **Merge with existing graph:**
   - Remove old nodes whose `filePath` matches any file in `filesToReanalyze` or in the deleted files list
   - **Prune by source only:** Keep each existing edge iff its `source` node survives. Edges whose `target` was removed are intentionally retained — this preserves inbound edges from unchanged files (`U imports F`, `U calls F`, `U tests F`) that the unchanged U will never regenerate. A naive `source OR target` prune silently erodes inbound edges on every incremental run.
   - Add new nodes and edges from the fresh analysis
   - Deduplicate nodes by ID (keep latest), edges by `source + target + type`
   - Remove any edge with dangling `source` or `target` references — this is the safety net that drops inbound function-level edges into since-deleted functions inside changed files

---

## Phase 3 — Conditional Architecture/Tour + Save

### 3a. Architecture update (only if `rerunArchitecture === true`)

If the change analysis flagged `ARCHITECTURE_UPDATE`:

1. Dispatch a subagent using the `architecture-analyzer` agent definition (at `agents/architecture-analyzer.md`), passing the full merged node set and import edges. Include previous layer definitions for naming consistency:

   > Previous layer definitions (for naming consistency):
   > ```json
   > [previous layers from existing graph]
   > ```
   > Maintain the same layer names and IDs where possible. Only add/remove layers if the file structure has materially changed.

2. After completion, read and normalize layers (same normalization as `/understand` Phase 4).

3. Optionally re-run tour builder if layers changed significantly.

### 3b. Lite layer update (if `rerunArchitecture === false`)

If only a partial update:
1. For **new files**: assign them to the most likely existing layer based on directory path matching
2. For **deleted files**: remove their IDs from layer `nodeIds` arrays
3. Remove any layer that ends up with zero nodeIds

### 3c. Lite validation

Perform lightweight validation (no graph-reviewer agent):
1. Remove any edge with dangling `source` or `target`
2. Remove any layer `nodeIds` entry that doesn't exist in the node set
3. Ensure every file node appears in exactly one layer (add to a catch-all layer if missing)

### 3d. Save

1. Write the final knowledge graph to `$UA_DIR/knowledge-graph.json`.

2. Write updated metadata to `$UA_DIR/meta.json`:
   ```json
   {
     "lastAnalyzedAt": "<ISO 8601 timestamp>",
     "gitCommitHash": "<current commit hash>",
     "version": "1.0.0",
     "analyzedFiles": <total file count in graph>
   }
   ```

3. **Update fingerprints (LOAD-PATCH-SAVE, not OVERWRITE).**

   The most common failure mode here: writing only the freshly-computed batch entries to `fingerprints.json`, discarding every other file's fingerprint. The next auto-update then sees all those files as new (no stored fingerprint), classifies them as STRUCTURAL, and escalates to FULL_UPDATE permanently (issue #152). The script must LOAD ALL existing entries, PATCH only the re-analyzed ones, and SAVE the full dict back.

   Write and execute a Node.js script in this exact ordering:

   ```javascript
   import { readFileSync, writeFileSync, existsSync } from 'node:fs';
   import { createHash } from 'node:crypto';
   import path from 'node:path';

   const UA_DIR = existsSync(path.join(PROJECT_ROOT, '.understand-anything')) ? '.understand-anything' : '.ua';
   const fpPath = path.join(PROJECT_ROOT, UA_DIR, 'fingerprints.json');
   const existedAndNonEmpty = existsSync(fpPath) && readFileSync(fpPath, 'utf-8').trim().length > 0;

   // 1. LOAD ALL existing entries (NEVER skip — preserves un-analyzed files)
   const all = existedAndNonEmpty
     ? JSON.parse(readFileSync(fpPath, 'utf-8'))
     : {};
   const before = Object.keys(all).length;

   // 2. PATCH (file still exists) or REMOVE (file deleted) for each re-analyzed path.
   //    `filesToReanalyze` may include paths that were deleted in this commit —
   //    handle both branches inline rather than expecting a separate deleted list.
   for (const filePath of filesToReanalyze) {
     const fullPath = path.join(PROJECT_ROOT, filePath);
     if (!existsSync(fullPath)) {
       delete all[filePath];
       continue;
     }
     const content = readFileSync(fullPath, 'utf-8');
     const contentHash = createHash('sha256').update(content).digest('hex');
     // Extract functions, classes, imports, exports via the same regex as Phase 1.
     all[filePath] = { contentHash, functions, classes, imports, exports };
   }

   // 3. GUARD against silent load failure: if fingerprints.json existed and was
   //    non-empty but `before` came out as 0, refuse to overwrite — something
   //    went wrong reading the file and writing now would clobber every entry.
   if (existedAndNonEmpty && before === 0) {
     throw new Error('fingerprints.json existed and was non-empty but loaded as {} — refusing to overwrite');
   }

   // 4. SAVE ALL entries back (full dict — not just the patched subset)
   writeFileSync(fpPath, JSON.stringify(all, null, 2));
   console.log(`Fingerprints: ${before} → ${Object.keys(all).length}`);
   ```

   The `existedAndNonEmpty && before === 0` guard catches the silent-load-failure case before it corrupts the store. If the count shrinks from N to a small number that matches the batch size, the LOAD step was skipped — abort the write rather than persist the wrong dict.

4. Clean up intermediate files:
   ```bash
   INTERMEDIATE_DIR="$UA_DIR/intermediate"
   if [ -n "$PROJECT_ROOT" ] && [ -d "$INTERMEDIATE_DIR" ]; then
     rm -rf "$INTERMEDIATE_DIR"
   fi
   ```

5. Report a summary:
   - Files checked: N (total changed)
   - Structural changes found: N files
   - Cosmetic-only changes: N files (skipped)
   - Nodes updated: N
   - Action taken: PARTIAL_UPDATE / ARCHITECTURE_UPDATE
   - Path to output: `$UA_DIR/knowledge-graph.json`

---

## Error Handling

- If the fingerprint check script fails: fall back to treating all changed files as STRUCTURAL (conservative approach).
- If `fingerprints.json` doesn't exist: treat all changed files as STRUCTURAL and regenerate fingerprints after the update.
- If a subagent dispatch fails: retry once. If it fails again, save partial results and report the error.
- ALWAYS save partial results — a partially updated graph is better than no update.

---

## Notes

- This skill reuses the same `file-analyzer` and `architecture-analyzer` agent definitions as `/understand` — no separate agent prompts needed.
- The fingerprint comparison in Phase 1 uses regex-based extraction (not tree-sitter) because it runs as a temporary Node.js script and doesn't need full AST accuracy — just signature-level detection.
- The authoritative fingerprints stored in `fingerprints.json` are generated by `/understand` Phase 7 using the core `fingerprint.ts` module (which uses tree-sitter for precise extraction).

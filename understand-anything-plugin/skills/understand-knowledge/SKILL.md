---
name: understand-knowledge
description: Analyze a Karpathy-pattern LLM wiki knowledge base and generate an interactive knowledge graph with entity extraction, implicit relationships, and topic clustering. Supports --full to force regeneration, --clean to remove intermediate files after success, and --scan-only to skip LLM analysis.
argument-hint: ["[wiki-directory] [--full] [--clean] [--scan-only] [--profile auto|generic|prd-wiki]"]
disable-model-invocation: true
---

# /understand-knowledge

Analyzes a Karpathy-pattern LLM wiki — a three-layer knowledge base with raw sources, wiki markdown, and a schema file — and produces an interactive knowledge graph dashboard.

## What It Detects

The **Karpathy LLM wiki pattern** (see https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
- **Raw sources** — immutable source documents (articles, papers, data files)
- **Wiki** — LLM-generated markdown files with wikilinks (`[[target]]` syntax)
- **Schema** — CLAUDE.md, AGENTS.md, or similar configuration file
- **index.md** — content catalog organized by categories
- **log.md** — chronological operation log

Detection signals: has `index.md` + multiple `.md` files with wikilinks. May have `raw/` directory and schema file.

The **PRD wiki profile** detects product requirement knowledge bases with `wiki/summaries`, `wiki/testcases`, `raw/prd`, or `raw/testcase`. It emits `requirement` and `testcase` nodes, preserves raw PRD/testcase provenance, and links requirements to matching testcases with `tested_by` edges.

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force full regeneration: delete `intermediate/` before processing and re-analyze all batches
  - `--clean` — Remove `intermediate/` after successful completion (preserved by default for checkpoint/resume)
  - `--scan-only` — Skip Phase 3 (LLM analysis) entirely: only run the deterministic parse and merge scripts. Ideal for LLM-compiled wikis (e.g. llm-wiki skill output) where wiki content is already LLM-enriched with explicit links, structured frontmatter, and concept pages — running a second LLM pass would be redundant. The graph will contain all article/requirement/testcase/source/topic nodes and all explicit link edges, but no implicit entities or claims.
  - `--profile auto|generic|prd-wiki` — Select detection profile. `auto` is the default; `prd-wiki` emits `requirement`/`testcase` nodes and provenance for raw PRD and testcase files.
  - A wiki directory path — analyze the given directory instead of the current working directory

Intermediate files are preserved by default for checkpoint/resume. Use `--clean` to remove them after successful completion.

## Instructions

### Phase 1: DETECT

1. Determine the target directory:
   - If the user provided a path argument, use that
   - Otherwise, use the current working directory

2. Run the format detection script bundled with this skill:
   ```
   python3 <SKILL_DIR>/parse-knowledge-base.py <TARGET_DIR> [--profile auto|generic|prd-wiki]
   ```
   - If the script exits with an error, tell the user this doesn't appear to be a Karpathy-pattern wiki and explain what was expected
   - If successful, proceed. The script writes `scan-manifest.json` to `<TARGET_DIR>/.understand-anything/intermediate/`

3. Read the scan-manifest.json and announce the results:
   - "Detected Karpathy wiki: N articles, N sources, N topics, N wikilinks (N unresolved)"
   - "Profile: auto-detected profile from manifest (`generic` or `prd-wiki`)"
   - List the categories found from index.md

### Phase 2: SCAN (already done)

The parse script in Phase 1 already performed the deterministic scan. The scan-manifest.json contains:
- Article nodes (one per wiki .md file) with extracted wikilinks, headings, frontmatter
- Source nodes (one per raw/ file)
- Topic nodes (from index.md section headings)
- `related` edges (from wikilinks)
- `categorized_under` edges (from index.md sections)

No additional scanning is needed. Proceed to Phase 3 (or skip to Phase 4 if `--scan-only`).

### Phase 3: ANALYZE

**If `--scan-only` is in `$ARGUMENTS`**, skip this entire phase and proceed directly to Phase 4. The deterministic scan from Phase 1 already captures all explicit structure (nodes, links, categories, frontmatter). This is the recommended mode for LLM-compiled wikis where the wiki content itself was already produced by LLM extraction (e.g. the llm-wiki skill).

Dispatch `article-analyzer` subagents to extract implicit knowledge:

0. **If `--full` is in `$ARGUMENTS`**, delete the intermediate directory before processing:
   ```
   rm -rf <TARGET_DIR>/.understand-anything/intermediate
   mkdir -p <TARGET_DIR>/.understand-anything/intermediate
   ```
   Then re-run Phase 1's parse script to regenerate `scan-manifest.json`. Skip this step when `--full` is not specified (default resume behavior applies).

1. Read the scan-manifest.json to get the article list

2. Prepare batches of 10-15 articles each, grouped by category when possible (articles in the same category are more likely to have implicit cross-references)

3. **Before dispatching**, detect already-analyzed batches by checking if `analysis-batch-{N}.json` exists and is non-empty in the intermediate directory. Skip batches that already have output (this enables automatic resume when a previous run was interrupted). If an output file exists but contains invalid JSON (e.g. truncated from a crash), treat it as incomplete and re-process. If all batches are complete, skip directly to Phase 4. When `--full` was specified, no prior batch outputs exist and all batches are processed.

4. For each remaining batch, dispatch an `article-analyzer` subagent with:
   - The batch of articles (id, name, summary, wikilinks, category, content from knowledgeMeta)
   - The full list of existing node IDs (so the agent can reference them)
   - The batch number for output file naming
   - The intermediate directory path: `$INTERMEDIATE_DIR = <TARGET_DIR>/.understand-anything/intermediate`
   
   The agent will write `analysis-batch-{N}.json` to the intermediate directory.

5. Run up to 3 batches concurrently. Wait for all batches to complete.

6. If any batch fails, log a warning but continue — the scan-manifest provides a solid base graph even without LLM analysis.

### Phase 4: MERGE

1. Run the merge script bundled with this skill:
   ```
   python3 <SKILL_DIR>/merge-knowledge-graph.py <TARGET_DIR>
   ```

2. The script:
   - Combines scan-manifest.json + all analysis-batch-*.json files
   - Deduplicates entities (case-insensitive name matching)
   - Normalizes node/edge types via alias maps
   - Builds layers from index.md categories
   - Builds a tour from index.md section ordering
   - Writes `assembled-graph.json` to the intermediate directory

3. Read the merge report from stderr and announce:
   - Total nodes, edges, layers, tour steps
   - How many entities/claims the LLM analysis added

### Phase 5: SAVE

1. Read the assembled-graph.json

2. Run the validation script bundled with this skill:
   ```
   python3 <SKILL_DIR>/validate-knowledge-graph.py <TARGET_DIR>
   ```
   The script checks:
   - Every edge source/target references an existing node
   - Every node has required fields: id, type, name, summary, tags, complexity
   - Every node `summary` is a non-empty string
   - Every edge `type` is in the allowed set (matching `EdgeTypeSchema` from core)
   - No duplicate node IDs
   
   If validation errors are found, re-run with `--fix` to auto-remove invalid edges:
   ```
   python3 <SKILL_DIR>/validate-knowledge-graph.py <TARGET_DIR> --fix
   ```
   If any validation check fails after fix: log warnings and record `"status": "degraded"` plus a `"degradedReason"` string in meta.json (see step 4)

3. Copy the validated graph to `<TARGET_DIR>/.understand-anything/knowledge-graph.json`

4. Write metadata to `<TARGET_DIR>/.understand-anything/meta.json`:
   ```json
   {
     "lastAnalyzedAt": "<ISO timestamp>",
     "gitCommitHash": "<from git rev-parse HEAD or empty>",
     "version": "1.0.0",
     "analyzedFiles": <number of wiki articles>,
     "status": "complete"
   }
   ```
   When validation produced warnings, set `"status": "degraded"` and add `"degradedReason": "<summary of validation failures>"`.

5. **Intermediate cleanup (default: preserve):** Keep `<TARGET_DIR>/.understand-anything/intermediate/` intact so future runs can resume from checkpoints. Only when `--clean` is in `$ARGUMENTS`:
   ```
   rm -rf <TARGET_DIR>/.understand-anything/intermediate
   ```

6. Report summary to the user:
   - "Knowledge graph saved: N articles, N entities, N topics, N claims, N sources"
   - "Profile: generic|prd-wiki"
   - If profile is `prd-wiki`: "N requirements, N testcases, N raw PRDs, N raw testcase files"
   - "N edges (N wikilink, N categorized, N implicit)"
   - "N layers, N tour steps"

7. Auto-trigger the dashboard:
   ```
   /understand-dashboard <TARGET_DIR>
   ```

## Notes

- The parse script handles ALL deterministic extraction (wikilinks, headings, frontmatter, categories from index.md). The LLM agents only add implicit knowledge that requires inference.
- For LLM-compiled wikis (built by the llm-wiki skill), `--scan-only` is sufficient because the wiki pages already contain LLM-extracted entities, concepts, relationships, and structured metadata. The deterministic parse captures this structure without a redundant second LLM pass.
- Categories and taxonomy come from index.md section headings, NOT from filename prefixes. The Karpathy spec is intentionally abstract about naming conventions.
- The graph uses `kind: "knowledge"` to signal the dashboard to use force-directed layout instead of hierarchical dagre.
- Source nodes from raw/ are lightweight (filename + size only) — we don't parse PDFs or binary files.

---
name: understand-book
description: Convert an EPUB book into a chapter-aware wiki scaffold and root knowledge graph for the dashboard.
argument-hint: [book.epub] [--language <lang>] [--output <dir>]
---

# /understand-book

Analyze an EPUB book by converting it into a deterministic Karpathy-style wiki, reusing the existing knowledge graph parser/merger, and saving a dashboard-ready graph.

## Instructions

### Phase 1: Resolve arguments

1. Parse `$ARGUMENTS`:
   - First non-flag token: EPUB input path.
   - `--language <lang>`: optional output language, defaults to EPUB metadata or `unknown`.
   - `--output <dir>`: optional output directory, defaults to `.understand-book`.
2. If no EPUB path is provided, ask the user for one.
3. Resolve relative paths against the current working directory.
4. Verify the input exists and ends with `.epub`.

### Phase 2: Run deterministic book pipeline

Run the bundled pipeline script:

```bash
python3 <SKILL_DIR>/run-understand-book.py <EPUB_PATH> --output <OUTPUT_DIR> --language <LANGUAGE>
```

It performs:

```text
EPUB
  → wiki scaffold
  → understand-knowledge parse
  → understand-knowledge merge
  → <OUTPUT_DIR>/.understand-anything/knowledge-graph.json
  → <OUTPUT_DIR>/.understand-anything/meta.json
  → <OUTPUT_DIR>/book-report.md
```

Expected progress output:

```text
[understand-book] input: ...
[understand-book] output: ...
[1/4] Convert EPUB to wiki scaffold...
[1/4] Manifest ready: N chapters, M assets
[2/4] Parse wiki scaffold...
[3/4] Merge knowledge graph...
[4/4] Save root graph and metadata...
Done.
```

### Phase 3: Verify output

Check these files exist:

```text
<OUTPUT_DIR>/raw/<book.epub>
<OUTPUT_DIR>/wiki/index.md
<OUTPUT_DIR>/wiki/chapters/ch01.md
<OUTPUT_DIR>/.understand-anything/intermediate/book-manifest.json
<OUTPUT_DIR>/.understand-anything/knowledge-graph.json
<OUTPUT_DIR>/.understand-anything/meta.json
<OUTPUT_DIR>/book-report.md
```

If validation fails, report the exact `ERR_*` message from the script and stop.

### Phase 4: Open dashboard

Run:

```text
/understand-dashboard <OUTPUT_DIR>
```

## Notes

- EPUB only. Do not accept PDF/DOCX/OCR yet.
- The deterministic path uses Python stdlib only: zip, XML, HTML parsing, JSON, subprocess.
- This first pipeline produces a structural book graph from chapters/categories. Rich LLM chapter analysis can be layered in later via `analysis-batch-*.json` or a dedicated analyzer.
- Evidence comes from generated chapter markdown pages in EPUB spine order.

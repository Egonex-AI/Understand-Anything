## Phase 2 — Deterministic Assembly Pipeline

Report: `[Phase 2/5] Running deterministic assembly...`

After wiki-worker writes raw content to `$PROJECT_ROOT/.understand-anything/intermediate/wiki/`, the deterministic pipeline validates, indexes, and assembles the final wiki output.

### Pipeline Sequence

Three scripts run in strict order:

#### Script 1: Schema Validation (`validate-wiki-schema.mjs`)

```bash
node "$SKILL_DIR/validate-wiki-schema.mjs" \
  "$PROJECT_ROOT/.understand-anything/intermediate/wiki" \
  --service-root="$SERVICE_ROOT"
```

**Behavior:**
- Validates `service.json` and all `domains/*.json` against core TypeScript schemas
- Auto-fixes recoverable issues in-place (string entities → objects, missing summaries, step ordering, flow IDs)
- Writes `wiki-validation-report.json` alongside intermediate directory
- Exit 0 = passed (may have auto-fixes), Exit 1 = errors found

**On failure:** Log errors. If `--continue-on-error`, proceed with warnings. Otherwise, halt and report.

#### Script 2: Index Building (`build-wiki-index.py`)

```bash
python3 "$SKILL_DIR/build-wiki-index.py" \
  "$PROJECT_ROOT/.understand-anything/intermediate/wiki" \
  --service-name="$SERVICE_NAME"
```

**Behavior:**
- Scans intermediate wiki directory to compute `index.json` from actual files
- Deterministically generates entries: one `service` entry from `service.json`, one `domain` entry per `domains/*.json`, one `flow` entry per flow within each domain (with `domain` parent link)
- Writes `index.json` into the intermediate directory
- Replaces any LLM-generated index

#### Script 3: Assembly (`assemble-wiki.py`)

```bash
CURRENT_COMMIT=$(git -C "$SERVICE_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
python3 "$SKILL_DIR/assemble-wiki.py" \
  "$PROJECT_ROOT/.understand-anything/intermediate/wiki" \
  "$PROJECT_ROOT/.understand-anything/wiki" \
  "$CURRENT_COMMIT" \
  --output-language="$OUTPUT_LANGUAGE"
```

**Behavior:**
- Copies validated files from `intermediate/wiki/` to final `wiki/` directory
- Skips unchanged domain files (via SHA-256 content fingerprinting against previous `meta.json`)
- Generates `meta.json` with content hashes, quality metrics, and validation warnings
- Reports copy/skip counts and quality grade

### Incremental Path

When running in incremental mode (only dirty domains regenerated):
1. Before dispatching wiki-worker, copy unchanged domain files from `wiki/domains/` to `intermediate/wiki/domains/`
2. Run wiki-worker for dirty domains only (writes to intermediate)
3. Run the full pipeline on intermediate directory
4. Assembler detects unchanged files via fingerprints and skips them

### Error Handling

| Script | Error | Action |
|--------|-------|--------|
| validate-wiki-schema.mjs | Auto-fixable issues | Fix in-place, log as warnings |
| validate-wiki-schema.mjs | Hard schema errors | Log, proceed with warnings (warn-then-continue) |
| build-wiki-index.py | No wiki files found | Write empty index, log warning |
| assemble-wiki.py | Validation report has errors | Proceed with partial results, include errors in meta |

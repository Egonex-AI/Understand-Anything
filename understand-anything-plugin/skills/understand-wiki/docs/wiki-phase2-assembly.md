## Phase 2 — Deterministic Assembly Pipeline

Report: `[Phase 2/5] Running deterministic assembly...`

After wiki-worker writes raw content to `$PROJECT_ROOT/.understand-anything/intermediate/wiki/`, the deterministic pipeline validates, indexes, and assembles the final wiki output.

### Pipeline Sequence

Five steps run in strict order (Script 0b is conditional on endpoint extraction success):

#### Script 0: Endpoint Extraction (`extract-endpoints.py`)

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/intermediate/wiki/endpoints"
python3 "$SKILL_DIR/extract-endpoints.py" \
  "$SERVICE_ROOT/.understand-anything/tmp" \
  "$SERVICE_NAME" \
  --output="$PROJECT_ROOT/.understand-anything/intermediate/wiki/endpoints/$SERVICE_NAME.json" \
  --project-root="$SERVICE_ROOT"
```

**Behavior:**
- Reads `ua-file-extract-results-*.json` from the extraction directory
- Detects MoaProvider, DubboService, GrpcService, FeignClient, KafkaListener annotations
- Produces `ServiceEndpointDoc` JSON with `providers`, `consumers`, and `kafkaTopics` arrays
- When `--project-root` is provided, extracts Javadoc descriptions from interface source files and enriches each method with a `description` field (interface files are checked first, then falls back to implementation classes)
- Skips gracefully if extraction directory is missing or empty

**On failure:** Log warning and continue (endpoint data is optional for wiki assembly).

#### Script 0b: LLM Description Enrichment (`enrich-endpoint-descriptions.py`)

```bash
ENDPOINT_FILE="$PROJECT_ROOT/.understand-anything/intermediate/wiki/endpoints/$SERVICE_NAME.json"
if [ -f "$ENDPOINT_FILE" ]; then
  PROMPT_FILE="$PROJECT_ROOT/.understand-anything/tmp/ua-endpoint-enrich-prompt-$SERVICE_NAME.json"
  RESPONSE_FILE="$PROJECT_ROOT/.understand-anything/tmp/ua-endpoint-enrich-response-$SERVICE_NAME.json"

  # Step 1: Generate prompt for undescribed methods
  python3 "$SKILL_DIR/enrich-endpoint-descriptions.py" generate-prompt \
    "$ENDPOINT_FILE" \
    --project-root="$SERVICE_ROOT" \
    --output="$PROMPT_FILE"

  # Step 2: Feed prompt to LLM sub-agent, save output as RESPONSE_FILE
  # (The sub-agent reads PROMPT_FILE, generates JSON array of descriptions,
  #  writes to RESPONSE_FILE)

  # Step 3: Merge LLM responses back into endpoint JSON
  python3 "$SKILL_DIR/enrich-endpoint-descriptions.py" merge-responses \
    "$ENDPOINT_FILE" \
    "$RESPONSE_FILE"
fi
```

**Behavior:**
- `generate-prompt`: Reads the endpoint JSON, collects methods without descriptions, reads source code context around each method, and outputs a structured JSON prompt for the LLM
- The LLM sub-agent generates concise Chinese descriptions (≤30 chars) for each undescribed method based on method signature + source context
- `merge-responses`: Merges LLM-generated descriptions back into the endpoint JSON
- Methods that already have Javadoc descriptions (from Script 0) are skipped

**Quality gate (after merge):**

```bash
python3 "$SKILL_DIR/enrich-endpoint-descriptions.py" validate \
  "$ENDPOINT_FILE" \
  --prompt-json="$PROMPT_FILE"
```

Checks:
- **Coverage**: every method has a description (error if missing)
- **Language**: descriptions contain CJK characters (warn if not)
- **Length**: descriptions between 2–50 chars (warn if out of range)
- **Specificity**: no placeholder text like "TODO", "待补充" (error if found)
- **Enrichment gap**: methods from the prompt that still lack descriptions after merge (error if any)

Exit 0 = PASS (proceed), Exit 1 = FAIL (log issues, retry LLM once with feedback).

**On failure:** Log warning and continue — endpoint enrichment is best-effort.

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

**After auto-fix, re-validate to confirm fixes resolved the issues:**

```bash
# First pass: validate + auto-fix
node "$SKILL_DIR/validate-wiki-schema.mjs" \
  "$PROJECT_ROOT/.understand-anything/intermediate/wiki" \
  --service-root="$SERVICE_ROOT"
FIX_EXIT=$?

# Second pass: verify fixes (read-only — no further auto-fix)
if [ $FIX_EXIT -eq 0 ]; then
  node "$SKILL_DIR/validate-wiki-schema.mjs" \
    "$PROJECT_ROOT/.understand-anything/intermediate/wiki" \
    --service-root="$SERVICE_ROOT" \
    --verify-only
  VERIFY_EXIT=$?
  if [ $VERIFY_EXIT -ne 0 ]; then
    echo "[understand-wiki] WARNING: Post-fix verification failed. Auto-fix may have introduced new issues."
  fi
fi
```

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

**Pre-assembly domain coverage check** — verify all expected domain pages exist before assembling:

```bash
# Extract expected domains from domain-graph.json
EXPECTED_DOMAINS=$(python3 -c "
import json, sys
with open('$SERVICE_ROOT/.understand-anything/domain-graph.json') as f:
    dg = json.load(f)
domains = set()
for n in dg.get('nodes', []):
    if n.get('type') == 'domain':
        domains.add(n['id'].replace('domain:', ''))
for d in sorted(domains):
    print(d)
")
INTERMEDIATE_WIKI="$PROJECT_ROOT/.understand-anything/intermediate/wiki/domains"
MISSING_DOMAINS=""
for domain in $EXPECTED_DOMAINS; do
  if [ ! -f "$INTERMEDIATE_WIKI/$domain.json" ]; then
    MISSING_DOMAINS="$MISSING_DOMAINS $domain"
  fi
done
if [ -n "$MISSING_DOMAINS" ]; then
  echo "[understand-wiki] ERROR: Missing domain pages:$MISSING_DOMAINS"
  echo "[understand-wiki] Wiki assembly blocked — domain coverage incomplete."
  echo "[understand-wiki] Re-run with --full to regenerate all domains."
  exit 1
fi
```

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
| extract-endpoints.py | Extraction dir missing or empty | Log warning, skip (endpoint data optional) |
| enrich-endpoint-descriptions.py | LLM sub-agent fails or times out | Log warning, skip (enrichment is best-effort) |
| validate-wiki-schema.mjs | Auto-fixable issues | Fix in-place, re-validate with `--verify-only`, log as warnings |
| validate-wiki-schema.mjs | Hard schema errors | **Halt** — log errors, do not proceed to assembly. Fix the root cause or use `--continue-on-error` to override |
| build-wiki-index.py | No wiki files found | Write empty index, log warning |
| assemble-wiki.py | Missing expected domain pages | **Halt** — domain coverage gap means Wiki is incomplete. Report which domains are missing |
| assemble-wiki.py | Validation report has non-domain errors | Proceed with partial results, include errors in meta |

---
name: understand-business
description: Aggregate server + client wiki into a unified business-landscape with cross-facet domain matching, interaction documents, and business rules.
argument-hint: ["[--full] [--cascade] [--cascade=deep] [--dry-run] [--budget <tokens>] [--language <lang>]"]
---

# /understand-business

Generate a cross-facet business-landscape by reading server and client wiki data, matching domains across facets, and producing interaction documents that describe end-to-end business flows.

## Deprecation Notice

For `client_server` and `multi_client` scenarios, the **domain-centric Phase 4 output** (`domains.json` + `domains/*.json`) is **deprecated**. That view was built on flawed 1:1 domain matching (treating client domains as equivalents to server domains).

**Primary output** for cross-facet business understanding:

- `business-features.json` — feature-centric M:N associations between client features and server domains
- `feature-interactions/` — per-feature interaction documents describing end-to-end flows

The old domain documents are retained for backward compatibility but **must not be referenced as authoritative**. Use `business-features.json` and the feature-graph wiki entry (`type: "feature-graph"`) instead.

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force full regeneration, ignoring all checkpoints
  - `--cascade` — Auto-trigger missing dependency generation (one level deep)
  - `--cascade=deep` — Auto-trigger full dependency chain generation
  - `--dry-run` — Preview what would be generated without running any LLM calls
  - `--budget <tokens>` — Maximum token budget for LLM calls; pause and prompt if exceeded
  - `--language <lang>` — Generate content in specified language (ISO 639-1 or friendly name)

---

## Progress Reporting

Report progress at each phase transition:
> `[Phase N/5] <phase name>...`

Phase completion:
> `Phase N complete. <one-line summary>`

---

## Prerequisites

- Server wiki must exist at `<server-facet-path>/.understand-anything/wiki/meta.json`
- Client wiki should exist at `<client-facet-path>/.understand-anything/wiki/meta.json` (degraded mode without it)
- `system.json` must exist at project root with `facets[]` declaration

### Platform Type Configuration (`system.json`)

Platform types (`ios`, `android`, `flutter`) are determined once at `system.json` generation time and shared by all downstream skills. The mobile facet should declare:

```json
{
  "type": "mobile",
  "path": "mobile",
  "subPaths": ["Amar", "ddoversea", "ddoversea_flutter"],
  "services": [
    {"name": "Amar", "path": "mobile/Amar", "platform": "ios"},
    {"name": "ddoversea", "path": "mobile/ddoversea", "platform": "android"},
    {"name": "ddoversea_flutter", "path": "mobile/ddoversea_flutter", "platform": "flutter"}
  ],
  "platformMapping": {"ios": "Amar", "android": "ddoversea", "flutter": "ddoversea_flutter"}
}
```

- **`services[]`** — canonical list of mobile clients with `{name, path, platform}`
- **`platformMapping`** — standard platform name → repository name (used by business-landscape and cross-facet tools)
- **`subPaths`** — retained for backward compatibility with tools that only read subdirectory names

**Source of truth:** `system.json` is authoritative for platform types. `init_config.py` auto-detects platforms when generating a new `system.json` (via `Podfile`/`*.xcodeproj` → `ios`, `build.gradle`/`AndroidManifest.xml` → `android`, `pubspec.yaml` → `flutter`). If `platform` fields are missing, `detect_platforms.py` falls back to the same deterministic file-structure checks.

**Downstream consumers:** `/understand-business`, `/understand-wiki`, `/understand-domain`, and `/understand-query` should read `system.json.facets[].services[].platform` (or `platformMapping`) rather than re-detecting platforms locally.

---

## Workflow Phases

### Phase 0 — Configuration & Input Detection

Report: `[Phase 0/5] Checking facet availability...`

```bash
python3 "$SKILL_DIR/check_facets.py" "$PROJECT_ROOT"
```

Read the output at `$PROJECT_ROOT/.understand-anything/intermediate/facet-status.json`.

**If `--cascade` and a facet is missing:**
- Backend missing: dispatch `/understand-wiki --batch` subagent for server facet
- Mobile missing: dispatch `/understand-wiki --repo-type=mobile` subagent for client facet
- Wait for subagent completion, then re-run check_facets.py

**If no cascade and a facet is missing:**
- Log warning: `WARNING: <facet> wiki not available — business-landscape will be degraded`
- Continue with available facets

**If zero facets available:**
- Report error and STOP: `ERROR: No facet wiki data available. Run /understand-wiki first.`

**Scenario Detection (routing Phase 2 strategy):**

```bash
python3 "$SKILL_DIR/scenario_detector.py" "$PROJECT_ROOT"
```

This determines the project scenario and Phase 2 strategy:
- `server_only` → Phase 2 uses **Strategy A (Pairwise Match)**
- `client_server` → Phase 2 uses **Strategy B (Association Discovery)**
- `multi_client` → Phase 2 uses **Strategy B (Association Discovery)**

Report: `Phase 0 complete. Scenario: <scenario>, Phase 2 strategy: <strategy>.`

### Phase 1 — Deterministic Domain Matching

Report: `[Phase 1/5] Matching domains across facets...`

```bash
python3 "$SKILL_DIR/domain_matcher.py" "$PROJECT_ROOT"
```

Read the output at `$PROJECT_ROOT/.understand-anything/intermediate/phase1-matches.json`.

Matching layers (executed in order):
1. **API endpoint exact match** — client API call path matches server endpoint path
2. **Domain name exact match** — normalized case-insensitive name equality
3. **Fuzzy CJK match** — substring containment, common prefix (≥2 chars, ≥50%), or character bigram Jaccard (≥0.4)
4. **Manual mapping** — from `domain-mapping.json`

**IMPORTANT**: `system.json` must include `subPaths` for each facet (list of subdirectory names containing individual services). For mobile facets, also include `services[]` with `platform` fields and a `platformMapping` object — see **Platform Type Configuration** above. Without `subPaths`, only the parent-level wiki domains are loaded.

Report: `Phase 1 complete. <N> domains matched deterministically, <M> candidates for LLM verification.`

### Phase 2 — LLM Domain Match & Association Discovery

Report: `[Phase 2/5] Verifying domain match candidates and discovering associations...`

**Skip if no candidates from Phase 1.**

Phase 2 uses two LLM strategies:

#### Strategy A: Pairwise Match (same as before)
For each candidate pair in `phase1-matches.json.candidates[]`:

1. Check checkpoint: `intermediate/match-{server}-{client}.json`
   - If exists and `_checkpoint.status == "complete"` → skip (already verified)
   - If exists and `_checkpoint.status == "degraded"` or `"failed"` → re-verify

2. Prompt LLM with both domains' data:

```
Given these two domains from different facets, determine if they represent the same business concept:

Server domain: "<name>"
  Summary: <summary>
  Endpoints: <endpoint list>

Client domain: "<name>"
  Summary: <summary>
  API calls: <API call list>

Respond with JSON only:
{
  "match": true/false,
  "confidence": 0.0-1.0,
  "reason": "one sentence explanation"
}
```

3. Validate LLM output: must be valid JSON with `match` (boolean), `confidence` (number 0-1), `reason` (string)
4. Write checkpoint using `checkpoint-writer.mjs` pattern:
   - `{ match, confidence, reason, _checkpoint: { status: "complete" } }`

#### Strategy B: Association Discovery (for client_server / multi_client scenarios)

**Triggered when:** Scenario Detector returns `client_server` or `multi_client`.

Instead of N×M pairwise "same domain?" questions, this strategy asks N per-feature queries: "Which server domains does this client feature depend on?" This reduces LLM calls from O(N×M) to O(N) and correctly models M:N consumer-provider relationships.

```bash
python3 "$SKILL_DIR/association_discovery.py" "$PROJECT_ROOT"
```

For each consolidated client feature from Phase 1:

1. Build prompt with feature context (name, summary, platforms) + ALL server domain summaries
2. Ask LLM: "Which server domains does this feature call/depend on?"

```
以下是一个客户端业务功能:
功能名: <feature name>
实现类型: <cross-platform|flutter-only|native-specific>
覆盖平台: <platforms>
描述: <merged summary>

以下是后端所有业务域的摘要:
  - <domain> (service: <svc>)
    Summary: <summary>
    Endpoints: <endpoints>

请判断这个客户端功能会调用/依赖哪些后端域。
返回严格 JSON 格式:
{
  "primaryServer": {"domain": "<name>", "service": "<svc>", "confidence": 0.0-1.0},
  "supportingServers": [
    {"domain": "<name>", "service": "<svc>", "relationship": "calls|depends_on|displays", "confidence": 0.0-1.0}
  ]
}
```

3. Parse response, filter by `confidence >= 0.5`
4. Write to `intermediate/phase2-associations.json`

**Output format:**
```json
{
  "associations": [
    {
      "featureName": "<client feature>",
      "primaryServer": {"domain": "...", "service": "...", "confidence": 0.9},
      "supportingServers": [{"domain": "...", "relationship": "depends_on", "confidence": 0.7}]
    }
  ],
  "featureCount": N,
  "serverDomainCount": M,
  "llmCalls": N
}
```

#### Strategy B Legacy Fallback: Batch Association (deprecated)
When Strategy A yields 0 matches AND scenario is `server_only`, fall back to the legacy batch prompt:

1. Collect ALL server domain summaries + endpoints AND ALL client domain summaries + API calls
2. Prompt LLM with the full picture to identify which client domains CALL or DEPEND ON which server domains
3. For associations with `confidence >= 0.6`:
   - Create a merged domain entry with `matchType: "llm-association"`
   - Use the server domain name as canonical

4. Write to `intermediate/phase2-associations.json`

Report: `Phase 2 complete. <N> candidates verified, <M> auto-matched (confidence ≥ 0.7), <K> associations discovered, <L> unmapped.`

### Assembly Routing (Post Phase 2)

After Phase 2, determine which output pipeline to execute. The routing is **deterministic** — no LLM calls.

```bash
python3 "$SKILL_DIR/route_phase3.py" "$PROJECT_ROOT"
```

Read the JSON output: `{"route": "feature_centric" | "domain_centric", "reason": "..."}`

| Condition | Route | Phases to run |
|-----------|-------|---------------|
| `phase2_strategy == "association_discovery"` (client_server / multi_client) — `phase2-associations.json` contains `featureCount` or `phase3_compatible` | **feature_centric** | SKIP Phase 3 + Phase 4 → run Phase 4b + 4c + cross_reference |
| `phase2_strategy == "pairwise"` (server_only) — no `featureCount`/`phase3_compatible` in associations file, or file missing | **domain_centric** | run Phase 3 + Phase 4; Phase 4b/4c NOT applicable |

Report: `Assembly route: <route> — <reason>`

---

#### Feature-Centric Path (`route == "feature_centric"`)

For `client_server` and `multi_client` scenarios. The old domain-centric output (`domains.json` + `domains/*.json`) is **skipped** — use the feature-centric output instead.

##### Phase 4b — Feature Assembly

Report: `[Phase 4b/5] Assembling business features...`

```bash
python3 "$SKILL_DIR/assemble_business_features.py" "$PROJECT_ROOT"
```

Reads `intermediate/phase2-associations.json` (association_discovery format) and writes:
- `business-landscape/business-features.json` — feature-centric M:N associations with `clientLayer` + `serverLayer`

Report: `Phase 4b complete. <N> features assembled, <M> with server associations.`

##### Phase 4c — Feature Interaction Generation

Report: `[Phase 4c/5] Generating feature interaction documents...`

```bash
python3 "$SKILL_DIR/build_feature_interactions.py" "$PROJECT_ROOT"
```

For each feature in `business-features.json`:

1. Build deterministic interaction skeleton (client → sdk/bridge → server layers)
2. Generate LLM prompt for end-to-end flow document
3. Write skeleton + prompt to `business-landscape/feature-interactions/feature-<slug>.json`
4. **LLM generation:** Complete each interaction document from the skeleton prompt
5. **Validate & retry** on failure (max 2 retries); degrade on persistent failure

Report: `Phase 4c complete. <N>/<total> feature interaction documents generated.`

##### Cross-Reference — Bidirectional Linking

Report: `[Cross-reference] Linking features to domain metadata...`

```bash
python3 "$SKILL_DIR/cross_reference.py" "$PROJECT_ROOT"
```

Writes bidirectional `relatedFeatures` / `relatedDomainDocs` fields between `business-features.json` and available domain metadata.

Report: `Cross-reference complete. <N> domains linked, <M> features linked.`

##### Wiki Ref Enrichment — Drill-Down Links

Report: `[Wiki-ref] Enriching domain wikiRef paths...`

```bash
python3 "$SKILL_DIR/enrich_wiki_refs.py" "$PROJECT_ROOT"
```

Resolves `wikiRef` and `flowCount` for each server domain and client platform in `business-features.json`, enabling single-click drill-down to per-service wiki domain files.

Report: `Wiki-ref enrichment complete. <N>/<total> enriched, <M> not found.`

**Do NOT run** `assemble_landscape.py` or the old Phase 4 domain interaction generation on this path.

---

#### Domain-Centric Path (`route == "domain_centric"`)

For `server_only` scenarios (pairwise matching). Phase 4b/4c are **not applicable** (no client features).

### Phase 3 — Output Assembly & Index Generation (domain_centric only)

Report: `[Phase 3/5] Assembling business-landscape index...`

**Skip this phase when `route == "feature_centric"`.**

```bash
python3 "$SKILL_DIR/assemble_landscape.py" "$PROJECT_ROOT"
```

Read output files:
- `intermediate/domains.json` — domain index with stats
- `intermediate/cross-facet-links.json` — cross-facet API endpoint mappings
- `domain-mapping.json` — updated at project root for future runs

#### Domain File Naming Convention (MANDATORY)

All domain files under `business-landscape/domains/` MUST follow this format:
- **Prefix**: Always `domain-` (e.g. `domain-user-profile.json`)
- **Slug**: English kebab-case only (e.g. `domain-user-profile.json`, NOT `domain-用户资料.json`)
- **`--language` controls content only**: The `--language` flag determines the language of JSON content (name, summary, steps), NOT filenames
- **No CJK in filenames**: Filenames must be ASCII kebab-case for cross-platform compatibility
- **No duplicates**: Each domain ID maps to exactly one file

`validate_landscape.py` enforces these rules in Phase 5.

Report: `Phase 3 complete. <N> domains mapped (<coverage>% coverage), <M> unmapped.`

### Phase 4 — Cross-Facet Interaction Document Generation (domain_centric only)

Report: `[Phase 4/5] Generating interaction documents...`

**Skip this phase when `route == "feature_centric"`.**

For each domain in `intermediate/domains.json.domains[]`:

1. Check checkpoint: `intermediate/domain-{name}.json` (use domain `name` field, not raw `id`; apply the naming convention from Phase 3)
   - If exists and `_checkpoint.status == "complete"` → skip
   - If exists and `_checkpoint.status == "degraded"` or `"failed"` → re-generate

2. **Deterministic extraction:** Read each facet's wiki flow data for this domain. Build step skeleton from existing flow steps.

3. **LLM generation:** Given the step skeletons from all facets, generate the interaction document:

```
Given these wiki flow data from server and client facets for the "<domain name>" business domain, generate a cross-facet interaction document.

Server flows:
<server wiki domain flows JSON>

Client flows:
<client wiki domain flows JSON>

Generate a JSON document with this structure:
{
  "id": "domain:<slug>",
  "name": "<domain name>",
  "summary": "<3-5 sentence overview>",
  "interactions": [
    {
      "id": "flow:<slug>",
      "name": "<flow name>",
      "steps": [
        {
          "id": "step:<N>",
          "facet": "server|client|frontend",
          "description": "<what happens>",
          "after": ["step:<previous>"],
          "branches": [{ "condition": "<condition>", "next": ["step:<N>"] }],
          "parallel": ["step:<N>"],
          "terminal": true/false,
          "relatedRules": ["rule:<id>"]
        }
      ]
    }
  ],
  "businessRules": [
    {
      "id": "rule:<slug>",
      "rule": "<human-readable rule>",
      "enforcedBy": ["server/<service>"],
      "observedBy": ["client"],
      "relatedFlows": ["flow:<slug>"]
    }
  ],
  "facets": {
    "server": { "service": "<service>", "domainRef": "<path>" },
    "client": { ... }
  }
}

IMPORTANT:
- Steps use DAG structure via "after" field, NOT linear array order
- Each interaction MUST have at least one step with "terminal": true
- "branches" represent conditional paths; "parallel" represents concurrent execution
- All step ID references in "after", "branches.next", "parallel" must reference valid step IDs within the same interaction
```

4. **Validate:** Run `validate_domain.py` on LLM output
5. **Retry on failure:** Re-prompt with validation errors (max 2 retries)
6. **Degrade on persistent failure:** Write checkpoint with `status: "degraded"`

Report after each domain: `  Domain <N>/<total>: <domain-name> — <complete|degraded>`

Report: `Phase 4 complete. <N>/<total> domains with interaction documents (<M> degraded).`

### Phase 5 — Validation & Final Output

Report: `[Phase 5/5] Validating and finalizing...`

**Domain-centric path** (`route == "domain_centric"`):

```bash
python3 "$SKILL_DIR/validate_landscape.py" "$PROJECT_ROOT"
```

Validates `domains.json`, `cross-facet-links.json`, and `domains/*.json`.

**Feature-centric path** (`route == "feature_centric"`):

Validate the feature-centric output (do NOT require deprecated `domains.json` / `domains/*.json`):

1. **business-features.json** must exist at `business-landscape/business-features.json` with:
   - `features` array (non-empty)
   - Each feature has `id`, `name`, `clientLayer`, `serverLayer`
   - `stats.totalFeatures` matches actual feature count
2. **feature-interactions/** must contain one `feature-<slug>.json` per feature
3. Each interaction document must have at least one flow with a terminal step
4. Run `validate_landscape.py` only for shared artifacts (wiki panorama, cross-facet-links if present) — skip domain-centric file requirements

If validation passes (domain-centric):
1. Move files from `intermediate/` to `business-landscape/`:
   - `intermediate/domains.json` → `business-landscape/domains.json`
   - `intermediate/cross-facet-links.json` → `business-landscape/cross-facet-links.json`
   - `intermediate/domain-*.json` → `business-landscape/domains/*.json`

If validation passes (feature-centric):
1. Confirm `business-landscape/business-features.json` and `business-landscape/feature-interactions/*.json` are in place (written directly by Phase 4b/4c)
2. Confirm cross-reference fields (`relatedFeatures`, `relatedDomainDocs`) are populated
2. Generate `business-landscape/meta.json`:
```json
{
  "contentHash": "sha256:<hash of all output files>",
  "sourceHashes": {
    "server/system-graph": "sha256:<from system-graph.json>",
    "client/client-graph": "sha256:<from client-graph.json>"
  },
  "generatedAt": "<ISO 8601>",
  "version": "1.0",
  "status": "complete",
  "_checkpoint": { "status": "complete" }
}
```
3. Clean up intermediate files (keep if `--keep-intermediate`)
4. **Build system topology registry** (Dashboard service discovery):

   a. **Generate `system-graph.json`** — use the canonical `build-system-graph.py` script (do NOT manually merge facet graphs):

   ```bash
   WIKI_SKILL_DIR="$(dirname "$SKILL_DIR")/../.understand-anything-plugin/skills/understand-wiki"
   # Fallback: check common plugin install paths
   if [ ! -f "$WIKI_SKILL_DIR/build-system-graph.py" ]; then
     WIKI_SKILL_DIR="$HOME/.understand-anything-plugin/skills/understand-wiki"
   fi
   python3 "$WIKI_SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"
   ```

   This script automatically:
   - Reads `system.json` facets to discover all services (server + mobile)
   - Uses `microservice:` prefix for service node IDs (CRITICAL: never use `service:` prefix)
   - Generates `facet` group nodes and `contains` edges linking facets to their services
   - Matches RPC edges across services via `provides_rpc`/`consumes_rpc` in each service's KG
   - Enriches from `wiki/architecture.json` cross-service calls if available
   - Writes to `$PROJECT_ROOT/.understand-anything/system-graph.json`

   **Validate immediately after generation:**
   ```bash
   node -e "const{validateSystemGraph}=require('@understand-anything/core/system-graph');const d=require('$PROJECT_ROOT/.understand-anything/system-graph.json');const r=validateSystemGraph(d);console.log(r.valid?'PASS':'FAIL',r.issues.length,'issues');if(!r.valid)console.log(r.issues.join('\n'))"
   ```

   If validation fails, check:
   - Node ID prefix mismatch (must be `microservice:`, not `service:`)
   - Missing mobile/client nodes (check `system.json` facet paths)
   - Edge targets referencing non-existent nodes

   b. **Generate `wiki/` directory** — build root-level wiki entry points for Dashboard navigation:
   - `wiki/meta.json`: `{ "generatedAt": "<ISO>", "version": "1.0.0", "outputLanguage": "<lang>", "serviceCount": <N> }`
   - `wiki/overview.json`: system overview with `facets[]` array grouping services by facet, including services and techStack
   - `wiki/index.json`: navigation entries linking to each service wiki, MUST include entries for business panorama:
     ```json
     { "id": "wiki:business", "name": "跨端业务全景", "type": "cross-domain", "summary": "<N>个已匹配的跨端业务域" }
     ```
     For feature-centric routes, also include a feature-graph entry:
     ```json
     { "id": "wiki:feature-graph", "name": "业务功能全景", "type": "feature-graph", "summary": "<N>个客户端业务功能" }
     ```
   - `wiki/domains/business.json`: cross-platform business panorama document:
     ```json
     {
       "id": "cross-domain:business",
       "name": "跨端业务全景",
       "summary": "<describe cross-platform communication>",
       "services": ["<all services involved>"],
       "steps": [
         { "order": 1, "service": "<svc>", "description": "<cross-platform step>", "crossServiceCall": {"interface": "...", "method": "...", "type": "bridge|http|moa_rpc"} }
       ],
       "architecture": {
         "layers": [{ "name": "<layer>", "services": ["..."], "description": "..." }],
         "communications": [{ "from": "<svc>", "to": "<svc>", "protocol": "<protocol>", "description": "..." }]
       }
     }
     ```
     This document shows the CROSS-PLATFORM interactions (mobile↔backend), NOT copies of internal per-facet flows. Build it from the domain matching results and cross-facet-links.
     **Validated by** `validate_landscape.py` → `validate_business_panorama()` (checks required fields, step structure, architecture communications).

   - `wiki/architecture.json`: top-level system architecture (SERVICE perspective, facet-grouped):
     ```json
     {
       "facets": [
         { "name": "mobile", "label": "移动客户端", "services": ["ddoversea", "ddoversea_flutter"], "description": "..." },
         { "name": "backend", "label": "后端微服务", "services": ["ultron-relation", "ultron-basic-user"], "description": "..." }
       ],
       "crossServiceCalls": ["<merged from per-facet architecture.json — see note below>"],
       "eventFlows": [],
       "sharedResources": []
     }
     ```

     **CRITICAL: Populating `crossServiceCalls`**:
     Read each facet's wiki `architecture.json` (e.g. `<facet-path>/.understand-anything/wiki/architecture.json`) and merge their `crossServiceCalls` arrays into the root-level file. The server facet's architecture typically contains all intra-backend RPC calls — include ALL of them here (the Dashboard's `architectureToMarkdown` function handles cross-facet filtering automatically via the `facets` field). Without this data, the architecture page will only show a service name table with no Mermaid diagram.

     The `facets` field enables the Dashboard to render Mermaid subgraphs grouped by facet type. Intra-facet calls remain visible in each facet's own architecture page.

   The Dashboard reads `system-graph.json` as its authoritative service registry (no directory scanning).

If validation fails:
- Report errors
- Set `meta.json.status = "degraded"`
- Still produce output (degraded is better than nothing)
- Still generate system-graph.json and wiki/ (topology is independent of business-landscape quality)

Print final summary:

**Domain-centric:**
```
╔══════════════════════════════════════════════════╗
║          /understand-business Complete            ║
╠══════════════════════════════════════════════════╣
║ Route:      domain_centric                       ║
║ Domains:    <mapped> mapped / <total> total      ║
║ Coverage:   <rate>%                              ║
║ Unmapped:   <count> domains                      ║
║ Interactions: <count> documents generated        ║
║ Status:     <complete|degraded>                  ║
║                                                  ║
║ Output: .understand-anything/business-landscape/ ║
║         .understand-anything/system-graph.json   ║
║         .understand-anything/wiki/               ║
╚══════════════════════════════════════════════════╝
```

**Feature-centric:**
```
╔══════════════════════════════════════════════════╗
║          /understand-business Complete            ║
╠══════════════════════════════════════════════════╣
║ Route:      feature_centric                      ║
║ Features:   <total> client features              ║
║ With server: <count> features linked             ║
║ Interactions: <count> feature docs generated     ║
║ Cross-links: <N> feature↔domain links           ║
║ Status:     <complete|degraded>                  ║
║                                                  ║
║ Output: .understand-anything/business-landscape/ ║
║         business-features.json                   ║
║         feature-interactions/                    ║
║         .understand-anything/system-graph.json   ║
║         .understand-anything/wiki/               ║
╚══════════════════════════════════════════════════╝
```

---

## Platform-Aware Query Guide（平台感知查询指南）

After `/understand-business` completes the feature-centric path, agents answer user questions by drilling through layered artifacts — from `system.json` platform truth down to per-platform wiki flows and source-level `sourceRef`. Use `/understand-query` CLI (`business`, `wiki`, `ask`) as the query interface; see `/understand-query` for full flag reference.

### 数据架构概览（Data Architecture Overview）

```
system.json (platform source of truth)
  ↓ facets[].services[].platform (ios / android / flutter / java-spring / …)
  ↓ facets[].platformMapping (standard → repo name)

business-features.json (feature panorama)
  ↓ features[].clientLayer.platforms[repo].standardPlatform
  ↓ features[].clientLayer.platforms[repo].wikiRef
  ↓ features[].serverLayer.*.wikiRef + flowCount

wiki/domains/*.json (per-platform implementation detail)
  ↓ flows[].steps[].sourceRef (code-level)
```

| Layer | File / Field | Agent Use |
|-------|--------------|-----------|
| Platform registry | `system.json` → `services[].platform`, `platformMapping` | Resolve user platform names (`android`) to repo paths (`ddoversea`) |
| Feature panorama | `business-features.json` → `features[]` | Cross-platform feature overview + server dependency graph |
| Client drill-down | `clientLayer.platforms[repo].wikiRef` | One-hop link to platform-specific wiki domain |
| Server drill-down | `serverLayer.primaryDomain/supportingDomains[].wikiRef` | One-hop link to backend service wiki domain |
| Implementation detail | `wiki/domains/*.json` → `flows[].steps[].sourceRef` | Flow steps with code pointers for source verification |

### Agent 查询模式（Query Patterns for Agents）

| User Question | Query Path | Expected Data |
|---------------|------------|---------------|
| "语聊房在 Android 怎么实现的？" | `business --domain "语聊房" --platform android` | Platform wiki domain: N flows, M steps, `sourceRef` per step |
| "这个功能有哪些后端依赖？" | `business --domain "语聊房"` | `primaryDomain` + `supportingDomains` with `wikiRef`, `flowCount`, `relationship` |
| "PK 对战的服务端流程？" | `wiki --service ultron-room --domain "PK 对战"` (via `wikiRef`) | Server wiki domain: flows, steps/flow |
| "所有功能概览" | `business --features` | All features with client/server layer stats |
| "哪个后端服务被最多依赖？" | `business --features` → `serverIndex` | `refCount` ranking across services |

**CLI examples:**

```bash
# Platform-specific client implementation (one-step drill-down)
python ua_query.py --format md business --domain "语聊房" --platform android

# Feature overview with server associations
python ua_query.py --format md business --features

# Server-side flow detail (follow wikiRef from business output)
python ua_query.py --format md wiki --service ultron-room --domain "PK 对战"

# End-to-end verified answer (auto-traces to source)
python ua_query.py --format md ask --query "语聊房,voice room" --depth full
```

**Agent usage rules:**

1. **Start at `business` layer** for feature/domain questions — it already aggregates cross-facet associations.
2. **Follow `wikiRef`** from `business-features.json` to fetch platform- or service-specific wiki detail; do not guess repo paths.
3. **Use `--platform` with standard names only** (`android`, not `ddoversea`); CLI resolves via `platformMapping`.
4. **Verify factual claims** with `ask --depth full` or `trace --source` before presenting implementation details to the user.

### Agent 决策树（Agent Decision Tree）

```
User asks about a feature:
  → Does user specify a platform?
    Yes → business --domain X --platform Y   (one-step drill-down to client wiki)
    No  → business --domain X                (all platforms + server deps)

User asks about backend service:
  → Read serverLayer.*.wikiRef from business output
  → wiki --service S --domain D

User asks about code-level implementation:
  → ask --query X --depth full               (auto-discovers service, traces source)
  → OR trace --service S --query X --source  (when service is already known)
```

**Depth guidance** (from `/understand-query`):

| Question Type | Recommended Path |
|---------------|------------------|
| "有哪些功能？" | `business --features` |
| "X 怎么实现的？" (no platform) | `business --domain X` → follow `wikiRef` per platform |
| "X 在 Android 怎么实现的？" | `business --domain X --platform android` |
| "后端怎么处理 X？" | `business --domain X` → `wiki --service S --domain D` |
| "代码在哪？" | `ask --query X --depth full` |

### 平台标准值（Platform Standard Values）

Platform values are **standardized** — agents and users query with standard names, never repository names.

**Client platforms** (from `system.json` mobile facet `services[].platform`):

| Standard Value | Typical Indicators |
|----------------|-------------------|
| `ios` | `Podfile`, `*.xcodeproj` |
| `android` | `build.gradle`, `AndroidManifest.xml` |
| `flutter` | `pubspec.yaml` |
| `react-native` | `metro.config.js`, `react-native.config.js` |
| `kotlin-multiplatform` | `*.kts` multi-target build |
| `web` | Web frontend in mobile facet |

**Server platforms** (from `system.json` backend facet `services[].platform`):

| Standard Value | Typical Indicators |
|----------------|-------------------|
| `java` | `pom.xml` (non-Spring) |
| `java-spring` | `pom.xml` + Spring annotations |
| `kotlin` | Kotlin-dominant backend |
| `go` | `go.mod` |
| `python` | `pyproject.toml`, `requirements.txt` |
| `node` | `package.json` (server) |
| `dotnet` | `*.csproj` |
| `rust` | `Cargo.toml` |

**Resolution chain:**

1. `system.json` is authoritative — `facets[].services[].platform` declares each service's standard platform.
2. `platformMapping` maps standard → repo name (e.g. `"android": "ddoversea"`).
3. `detect_platforms.py` enriches `business-features.json` with `standardPlatform` on each `clientLayer.platforms[repo]` entry.
4. `/understand-query business --platform <standard>` resolves through `platformMapping` — **never pass repo names as `--platform` values**.

See **Platform Type Configuration** (Prerequisites) for `system.json` schema example.

### Pipeline 增强顺序（Pipeline Enrichment Order）

Feature-centric path execution order. Steps 1–8 are documented in **Workflow Phases** above; step 9 completes platform standardization for query-time `--platform` resolution.

| Step | Script | Phase | Output |
|------|--------|-------|--------|
| 1 | `scenario_detector.py` | Phase 0 | Project scenario (`client_server`, `multi_client`, `server_only`) |
| 2 | `domain_matcher.py` (+ consolidation) | Phase 1 | `phase1-matches.json` — deterministic + consolidated client features |
| 3 | `association_discovery.py` | Phase 2 | `phase2-associations.json` — M:N client→server associations |
| 4 | `route_phase3.py` | Routing | `feature_centric` or `domain_centric` route decision |
| 5 | `assemble_business_features.py` | Phase 4b | `business-features.json` — `clientLayer` + `serverLayer` |
| 6 | `build_feature_interactions.py` | Phase 4c | `feature-interactions/feature-*.json` — end-to-end flow docs |
| 7 | `cross_reference.py` | Cross-ref | Bidirectional `relatedFeatures` / `relatedDomainDocs` |
| 8 | `enrich_wiki_refs.py` | Wiki-ref | `wikiRef` + `flowCount` on client platforms and server domains |
| 9 | `detect_platforms.py` | Platform | `standardPlatform` on each platform entry + `platformMapping` in output |

```bash
# Step 9 — run after enrich_wiki_refs (feature-centric path only)
python3 "$SKILL_DIR/detect_platforms.py" "$PROJECT_ROOT"
```

**Dependency rule:** Step 9 requires steps 5 and 8 — `business-features.json` must exist with `wikiRef` fields before platform names can be standardized. Query-time `--platform` drill-down is only available when both `platformMapping` and `standardPlatform` are present.

---

## Error Handling

| Scenario | Action |
|----------|--------|
| system.json missing | Report error, STOP |
| All facet wikis missing | Report error, STOP |
| Some facet wikis missing | Degrade: generate with available data, mark `degraded: true` |
| Phase 1 script fails | Report error, STOP (deterministic should not fail) |
| Phase 2 LLM call fails | Skip candidate → unmapped list |
| Phase 2 LLM output invalid | Skip candidate → unmapped list |
| Phase 4 LLM call fails (domain_centric) | Retry 2x → degrade domain |
| Phase 4 validation fails (domain_centric) | Retry 2x → degrade domain |
| Phase 4c LLM call fails (feature_centric) | Retry 2x → degrade feature interaction |
| Phase 5 validation fails | Report errors, produce degraded output |
| Disk write fails | STOP immediately (data consistency) |

**Never silently drop errors.** Every failure must appear in the final report.

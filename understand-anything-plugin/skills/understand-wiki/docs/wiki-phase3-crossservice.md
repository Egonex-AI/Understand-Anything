## Phase 3 — Cross-Service Relationship Identification + Parent Wiki Generation

Report: `[Phase 3/5] Generating parent orchestration Wiki...`

**Trigger condition:** At least 2 services have Wiki (`.understand-anything/wiki/meta.json` exists).

If only 1 service is integrated: skip Phase 3 entirely with message:
> `Phase 3 skipped. Cross-service Wiki requires 2+ integrated services (current: 1).`

### Step 1 — Collect Integrated Services

```bash
INTEGRATED_SERVICES=()
for dir in "$PROJECT_ROOT"/*/; do
  if [ -f "$dir/.understand-anything/wiki/meta.json" ]; then
    INTEGRATED_SERVICES+=("$(basename "$dir")")
  fi
done
echo "[understand-wiki] Integrated services: ${#INTEGRATED_SERVICES[@]}"
printf "  - %s\n" "${INTEGRATED_SERVICES[@]}"
```

### Step 2 — Run Cross-Service Matcher Script (Layer 1)

**Branching by REPO_TYPE:**

```
IF REPO_TYPE == "mobile":
  → Run feature-parity-matcher.py (see Mobile Mode below)
ELSE:
  → Run cross-service-matcher.py (backend default)
```

#### Backend Mode (default)

```bash
python3 "$SKILL_DIR/cross-service-matcher.py" "$PROJECT_ROOT" \
  --services="${INTEGRATED_SERVICES[*]}" \
  --output="$PROJECT_ROOT/.understand-anything/tmp/cross-service-candidates.json"
```

The script reads KG files from all integrated services and performs deterministic matching:
- Matches `consumes_rpc` → `provides_rpc` across services (by interface name)
- Matches Kafka topic `publishes` → `subscribes` across services
- Matches shared database table access patterns
- Outputs:
  - `relationships[]`: RPC and database matches (caller/callee format, for `crossServiceCalls`)
  - `eventFlows[]`: Kafka/event matches **pre-aggregated by topic** (topic/publisher/subscribers format, directly usable in `architecture.json`)

#### Mobile Mode (REPO_TYPE=mobile)

```bash
python3 "$SKILL_DIR/feature-parity-matcher.py" "$PROJECT_ROOT" \
  --services="${INTEGRATED_SERVICES[*]}" \
  --output="$PROJECT_ROOT/.understand-anything/tmp/cross-service-candidates.json"
```

The script analyzes cross-platform feature relationships (NOT RPC/Event/DB):
- Matches domains across platforms by name similarity (exact, fuzzy, semantic)
- Detects shared SDKs (PhotonIM, Agora, Firebase, etc.) across platforms
- Detects Flutter↔Native bridge channels (FlutterBoost, MethodChannel)
- Outputs:
  - `domainMappings[]`: Cross-platform domain equivalence candidates
  - `sharedSdks[]`: SDKs shared across platforms
  - `bridgeChannels[]`: Native bridge communication channels

### Step 3 — LLM Review + Supplement + Organize (Layer 2, Always Execute)

The main skill (YOU, the executing agent) performs the LLM layer directly — no separate agent dispatch needed because the data is lightweight.

**Branching by REPO_TYPE:**

#### Backend Mode (default)

**Input for LLM analysis:**
- Script output: `relationships` (RPC/DB) and `eventFlows` (events) with evidence
- Per-service summaries: from each service's `wiki/index.json` entries
- Per-service endpoints: from each service's KG (`endpoint:` nodes)
- Per-service RPC interfaces: from each service's KG (`provides_rpc` / `consumes_rpc` edges)
- Per-service domain info: from each service's `wiki/service.json`

**LLM tasks:**
1. **Verify** script matches — confirm they are real interactions (remove false positives)
2. **Discover** missed relationships — identify cross-service calls the script couldn't detect (non-standard RPC, dynamic dispatch, event-driven patterns)
3. **Organize** into business flows — group related cross-service calls into end-to-end process flows (e.g., "Order Creation Flow" spanning order-service → payment-service → inventory-service)

#### Mobile Mode (REPO_TYPE=mobile)

**Input for LLM analysis:**
- Script output `confirmedMappings`: exact slug matches (high confidence, pre-verified)
- Script output `candidateMappings`: fuzzy/semantic matches (need LLM verification)
- Script output `domainSummaries`: per-platform domain summaries WITH descriptions — **this is the primary input for semantic matching**
- Script output `sharedSdks` and `bridgeChannels`

**LLM tasks:**
1. **Verify** candidate mappings — using domain summaries, confirm whether fuzzy/semantic matches truly represent the same feature. Remove false positives (e.g., "audio_chatroom" matched "account-profile" by token overlap is clearly wrong)
2. **Discover** missed mappings — review ALL domain summaries across platforms and identify feature equivalences the script missed. Focus on domains with:
   - Completely different naming but same business function (use summaries to determine)
   - Split domains on one platform that map to a single domain on another
   - Example: "即时通讯" (iOS: PhotonIM + WCDB) ↔ "即时通讯与私信" (Android: PhotonIM + MVVM) — same feature despite different domain names
3. **Enrich** feature parity matrix — for each confirmed mapping, produce `featureParity` entries with implementation detail descriptions drawn from domain summaries
4. **Organize** shared infrastructure — consolidate shared SDK usage and bridge channel information

**Key principle:** The script provides candidates and context (summaries); the LLM does the semantic reasoning. This division avoids false positives from naive text matching while leveraging the script's ability to quickly scan all data.

### Step 4 — Generate Parent Wiki

Create the parent-level Wiki at `$PROJECT_ROOT/.understand-anything/wiki/`:

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/wiki/domains"
```

**Files to generate:**

1. **`overview.json`** — System overview:

**Single-facet projects** (backend-only or mobile-only):
```json
{
  "name": "<project/system name>",
  "description": "<what this system does as a whole>",
  "services": [
    { "name": "order-service", "description": "<from wiki/service.json>", "domains": ["order-management"] },
    { "name": "payment-service", "description": "<from wiki/service.json>", "domains": ["payment-processing"] }
  ],
  "techStack": ["Java", "Spring Boot", "MOA RPC", "MySQL", "Kafka"]
}
```

**Multi-facet projects** (server + mobile, etc.) — use `facets[]` with `services` as **object arrays** (NOT strings):
```json
{
  "name": "<project name>",
  "description": "<what this system does>",
  "facets": [
    {
      "name": "server",
      "label": "<display label, e.g. 后端微服务>",
      "services": [
        { "name": "svc-a", "description": "<from facet overview>", "domains": ["domain-1", "domain-2"] }
      ],
      "description": "<facet-level description>"
    },
    {
      "name": "mobile",
      "label": "<display label, e.g. 移动客户端>",
      "services": [
        { "name": "app-a", "description": "<from facet overview>", "domains": ["domain-3"] }
      ],
      "description": "<facet-level description>"
    }
  ],
  "techStack": ["Java", "Kotlin", "Flutter"]
}
```

> **CRITICAL — `facets[].services[]` must be object arrays**, not string arrays.
> Each service entry MUST have `{ "name": "...", "description": "...", "domains": [...] }`.
> String-only entries like `"svc-name"` will cause the dashboard to render empty service tables.
> When generating multi-facet overview, merge service details from each facet's own `overview.json`.

2. **`architecture.json`** — Cross-service architecture:

**Backend Mode:**
```json
{
  "crossServiceCalls": [
    {
      "caller": { "service": "order-service", "node": "function:...", "file": "...", "method": "OrderService.createOrder()" },
      "callee": { "service": "payment-service", "node": "service:...", "interface": "PaymentFacade", "method": "createPayment()" },
      "type": "moa_rpc",
      "evidence": "script-matched",
      "detail": "@MoaConsumer PaymentFacade in OrderService matched to @MoaProvider in payment-service"
    }
  ],
  "sharedResources": [],
  "eventFlows": [
    {
      "topic": "order.created",
      "publisher": "order-service",
      "subscribers": ["payment-service", "inventory-service"],
      "evidence": "script-matched",
      "detail": "Topic 'order.created' published by OrderService (order-service) consumed by payment-service, inventory-service"
    }
  ]
}
```

> **CRITICAL — `eventFlows[]` schema constraint:**
> `eventFlows[]` entries MUST use `topic` / `publisher` / `subscribers` fields.
> They MUST NOT use `caller` / `callee` — those fields are only valid inside `crossServiceCalls[]`.
> The quality gate will reject `eventFlows` entries that use the wrong schema.

**Mobile Mode (REPO_TYPE=mobile):**
```json
{
  "crossServiceCalls": [],
  "sharedResources": [],
  "eventFlows": [],
  "featureParity": [
    {
      "feature": "即时通讯",
      "platforms": {
        "ios": { "service": "Amar", "domain": "instant-messaging", "impl": "PhotonIM SDK + WCDB 本地持久化" },
        "android": { "service": "ddoversea", "domain": "im-chat", "impl": "PhotonIM SDK + MVVM 架构" },
        "flutter": { "service": "ddoversea_flutter", "domain": "group-chat", "impl": "MethodChannel 桥接原生 IM SDK" }
      }
    }
  ],
  "sharedInfrastructure": [
    { "type": "im_sdk", "resource": "PhotonIM SDK", "platforms": ["ios", "android"], "detail": "双端共享 PhotonIM 即时通讯 SDK" }
  ],
  "nativeBridge": [
    { "type": "flutter_channel", "from": "ddoversea", "to": "ddoversea_flutter", "mechanism": "FlutterBoost + MethodChannel", "detail": "Flutter 模块通过 FlutterBoost 嵌入 Android 壳" }
  ],
  "domainMapping": [
    { "canonicalFeature": "即时通讯", "mappings": { "Amar": "domain:instant-messaging", "ddoversea": "domain:im-chat" } }
  ]
}
```

> **Mobile Mode Notes:**
> - `crossServiceCalls[]` and `eventFlows[]` are kept as empty arrays for schema compatibility.
> - `featureParity[]` is the core mobile cross-platform view — each entry shows how the same feature is implemented differently across platforms.
> - `sharedInfrastructure[]` documents SDKs/APIs shared across platforms.
> - `nativeBridge[]` documents Flutter↔Native communication channels.
> - `domainMapping[]` provides machine-readable cross-platform domain equivalences for Dashboard navigation.
> - The Quality Gate validates `featureParity` structure when present.

3. **`domains/<cross-domain>.json`** — Cross-service business flow pages **(Backend Mode only)**:

> **Mobile Mode:** Skip cross-domain page generation entirely. Mobile platforms don't have cross-service business flows — the "cross-platform" relationship is captured in `featureParity[]` within `architecture.json`.

```json
{
  "id": "cross-domain:order-creation",
  "name": "Order Creation (End-to-End)",
  "summary": "Complete order creation flow spanning order, payment, and inventory services.",
  "services": ["order-service", "payment-service", "inventory-service"],
  "steps": [
    {
      "order": 1,
      "service": "order-service",
      "description": "OrderController receives order request → OrderService.createOrder() validates and persists",
      "wikiRef": "order-service/domains/order-management#flow:create-order"
    },
    {
      "order": 2,
      "service": "order-service",
      "description": "OrderService calls PaymentFacade.createPayment() via MOA RPC",
      "crossServiceCall": { "interface": "PaymentFacade", "method": "createPayment()", "type": "moa_rpc" }
    },
    {
      "order": 3,
      "service": "payment-service",
      "description": "PaymentFacadeImpl processes payment, publishes payment.completed event",
      "wikiRef": "payment-service/domains/payment-processing#flow:process-payment"
    }
  ]
}
```

### Parent Wiki Quality Gate (after Phase 3 output)

After generating all parent-level files, run the parent wiki quality gate:

```bash
python3 "$SKILL_DIR/wiki_quality_gate.py" --parent \
  "$PROJECT_ROOT/.understand-anything/wiki" \
  "$PROJECT_ROOT/.understand-anything/tmp/ua-wiki-${WIKI_SESSION_ID}-parent-qg-result.json"
```

This validates:
- `overview.json`: name, description, non-empty services array with required fields
- `architecture.json`: crossServiceCalls structure (caller/callee/type), eventFlows entries (topic/publisher/subscribers — rejects caller/callee schema)
- `domains/*.json` (cross-domain pages): services array, steps with order/service/description

If `passed: false`, report issues but continue to Phase 4 (index construction) — parent wiki issues are non-blocking since service wikis remain valid independently.

### Mobile Mode — Client Graph Generation (REPO_TYPE=mobile)

When `REPO_TYPE=mobile` and at least 2 platforms have wiki (`meta.json` exists):

```bash
python3 "$SKILL_DIR/build-client-graph.py" "$PROJECT_ROOT"
```

This produces `client-graph.json` at `<client-facet-path>/.understand-anything/client-graph.json` with:
- `platforms[]` — list of integrated platforms (e.g., ["android", "ios"])
- `crossPlatformFrameworks[]` — detected cross-platform frameworks (e.g., ["flutter"])
- `featureMap[]` — per-domain implementation classification (`cross-platform` | `platform-specific` | `mixed`)

If the script fails, log a warning and continue — the client graph is needed for M2 but not a prerequisite for wiki completion.

**Trigger logic:**
```
IF REPO_TYPE == "mobile" AND integrated_platforms >= 2:
  python3 "$SKILL_DIR/build-client-graph.py" "$PROJECT_ROOT"
ELIF REPO_TYPE == "backend":
  python3 "$SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"  (existing behavior)
ELIF REPO_TYPE == "frontend":
  Skip Phase 3 (single repo, no aggregation needed)
```

### Step 5 — Update System Graph

After parent wiki generation, update the system-level graph for Dashboard's SystemOverview tab:

```bash
python3 "$SKILL_DIR/build-system-graph.py" "$PROJECT_ROOT"
```

This synchronizes `system-graph.json` with the latest cross-service analysis from `architecture.json`. The system graph enables the Dashboard's System tab, showing an interactive service topology with drill-down navigation.

If the script fails, log a warning and continue — the system graph is a convenience feature, not a prerequisite for wiki completion.

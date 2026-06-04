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

```bash
python3 "$SKILL_DIR/cross-service-matcher.py" "$PROJECT_ROOT" \
  --services="${INTEGRATED_SERVICES[*]}" \
  --output="$PROJECT_ROOT/.understand-anything/tmp/cross-service-candidates.json"
```

The script reads KG files from all integrated services and performs deterministic matching:
- Matches `consumes_rpc` → `provides_rpc` across services (by interface name)
- Matches Kafka topic `publishes` → `subscribes` across services
- Matches shared database table access patterns
- Outputs: candidate relationship list with evidence

### Step 3 — LLM Review + Supplement + Organize (Layer 2, Always Execute)

The main skill (YOU, the executing agent) performs the LLM layer directly — no separate agent dispatch needed because the data is lightweight.

**Input for LLM analysis:**
- Script output: candidate relationships with evidence
- Per-service summaries: from each service's `wiki/index.json` entries
- Per-service endpoints: from each service's KG (`endpoint:` nodes)
- Per-service RPC interfaces: from each service's KG (`provides_rpc` / `consumes_rpc` edges)
- Per-service domain info: from each service's `wiki/service.json`

**LLM tasks:**
1. **Verify** script matches — confirm they are real interactions (remove false positives)
2. **Discover** missed relationships — identify cross-service calls the script couldn't detect (non-standard RPC, dynamic dispatch, event-driven patterns)
3. **Organize** into business flows — group related cross-service calls into end-to-end process flows (e.g., "Order Creation Flow" spanning order-service → payment-service → inventory-service)

### Step 4 — Generate Parent Wiki

Create the parent-level Wiki at `$PROJECT_ROOT/.understand-anything/wiki/`:

```bash
mkdir -p "$PROJECT_ROOT/.understand-anything/wiki/domains"
```

**Files to generate:**

1. **`overview.json`** — System overview:
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

2. **`architecture.json`** — Cross-service architecture:
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
  "eventFlows": []
}
```

3. **`domains/<cross-domain>.json`** — Cross-service business flow pages:
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
- `architecture.json`: crossServiceCalls structure (caller/callee/type)
- `domains/*.json` (cross-domain pages): services array, steps with order/service/description

If `passed: false`, report issues but continue to Phase 4 (index construction) — parent wiki issues are non-blocking since service wikis remain valid independently.

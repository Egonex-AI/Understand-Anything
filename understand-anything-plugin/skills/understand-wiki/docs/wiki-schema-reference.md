## Reference: Wiki File Schema Summary

### Service-Level Files

| File | Required Fields |
|---|---|
| `meta.json` | `gitCommitHash`, `generatedAt`, `version`, `outputLanguage`, `domainHashes` (content fingerprints), `sourceRefCoverage` (step traceability), `qualityScore` (schema/sourceRef/depth/grade) |
| `index.json` | `entries[]` each with `id`, `name`, `type`, `summary`; domain entries MUST include `service`; flow entries MUST include `service` + `domain` (parent domain id) |
| `service.json` | `name`, `description`, `techStack[]`, `modules[]`, `entryPoints[]` |
| `domains/<slug>.json` | `id`, `name`, `summary`, `entities[]`, `flows[]` |

### Domain Page Structure (Bounded Context Canvas)

Each domain page should function as a self-contained **Bounded Context Canvas** — an engineer should understand the business domain completely from reading this page alone.

**Required sections:** `id`, `name`, `summary`, `entities`, `flows`

**Optional sections (recommended):** `ubiquitousLanguage`, `businessRules`, `integrationPoints`, `errorCatalog`

> **Language note:** All `name`, `summary`, `description` fields must be written in the configured `outputLanguage`. The `id` field and entity class names stay in English. The examples below show English for structural reference — when generating non-English content, translate `name` fields accordingly (e.g., `"Order Management"` → `"订单管理"` for zh).

```json
{
  "id": "domain:<slug>",
  "name": "<domain display name>",
  "summary": "<3-5 sentence overview: business capability, key entities, invariants, external dependencies>",

  "ubiquitousLanguage": [
    { "term": "<domain-specific term>", "definition": "<what it means in THIS domain>" }
  ],

  "businessRules": [
    {
      "id": "BR-001",
      "rule": "<human-readable business rule statement>",
      "enforcement": "<class or method that enforces this rule>",
      "sourceRef": { "file": "<relative path>", "lineRange": [start, end] }
    }
  ],

  "entities": [
    {
      "name": "<entity name>",
      "description": "<what this entity represents, its role in the domain>",
      "keyFields": ["<field1>", "<field2>"],
      "lifecycleStates": ["<STATE1>", "<STATE2>"],
      "invariants": ["<constraint that must always hold>"]
    }
  ],

  "integrationPoints": {
    "inbound": [
      { "source": "<caller service or client>", "type": "<REST|RPC|event|cron>", "endpoint": "<method or topic>", "description": "<what it does>" }
    ],
    "outbound": [
      { "target": "<target service>", "type": "<REST|RPC|event>", "endpoint": "<method or topic>", "description": "<what it does>" }
    ]
  },

  "errorCatalog": [
    {
      "exception": "<exception class name>",
      "trigger": "<when this error occurs>",
      "handling": "<how the system handles it>",
      "severity": "<user_error|transient|fatal>"
    }
  ],

  "flows": [
    {
      "id": "flow:<slug>",
      "name": "<display name>",
      "summary": "<2-3 sentences: business purpose, key mechanisms, cross-service interactions>",
      "steps": [
        {
          "order": 1,
          "name": "<step name>",
          "description": "<detailed: business rules, validation, exceptions, side effects, parameters/returns>",
          "sourceRef": { "file": "<relative path>", "lineRange": [start, end] }
        }
      ]
    }
  ]
}
```

> **Backward compatibility:** `ubiquitousLanguage`, `businessRules`, `integrationPoints`, and `errorCatalog` are optional. Existing domain pages without these sections remain valid. The content depth quality gate rewards pages that include them.

### wikiRef Format

See [wikiRef Specification](./wikiref-spec.md) for the canonical format.

### Parent-Level Files

| File | Purpose |
|---|---|
| `overview.json` | System-wide summary, service list with descriptions |
| `architecture.json` | Cross-service call relationships, shared resources, event flows |
| `domains/<cross-domain>.json` | End-to-end business flow pages spanning multiple services |
| `index.json` | Parent-level navigation index |
| `meta.json` | Parent-level metadata with serviceCount |

#### `architecture.json` Schema

```json
{
  "crossServiceCalls": [
    {
      "caller": { "service": "order-service", "node": "...", "file": "...", "method": "..." },
      "callee": { "service": "payment-service", "node": "...", "interface": "PaymentFacade", "method": "..." },
      "type": "moa_rpc | dubbo_rpc | http | kafka | database | unknown",
      "evidence": "script-matched | llm-inferred",
      "detail": "human-readable description"
    }
  ],
  "sharedResources": [
    { "type": "database | cache | queue | storage", "name": "orders_db", "services": ["svc-a", "svc-b"] }
  ],
  "eventFlows": [
    {
      "topic": "order.created",
      "publisher": "order-service",
      "subscribers": ["payment-service", "notification-service"],
      "evidence": "script-matched",
      "detail": "human-readable description"
    }
  ]
}
```

> **`eventFlows[]` MUST use `topic`/`publisher`/`subscribers`.**
> Do NOT use `caller`/`callee` — those are only valid in `crossServiceCalls[]`.
> The quality gate rejects entries with the wrong schema.

---

### Content Depth Quality: Good vs Shallow Examples

The quality gate (`wiki_structure_validator.py --depth`) scores domain pages on a 0-100 scale based on summary depth, sourceRef coverage, and business rule/exception/side effect indicators.

#### Shallow Domain Page (score ~20)

```json
{
  "id": "domain:order-management",
  "name": "Order Management",
  "summary": "Handles orders.",
  "entities": ["Order"],
  "flows": [
    {
      "id": "flow:create-order",
      "name": "Create Order",
      "summary": "Creates an order.",
      "steps": [
        { "order": 1, "name": "Receive request", "description": "Gets the request." },
        { "order": 2, "name": "Save order", "description": "Saves to database." }
      ]
    }
  ]
}
```

Problems: summary is 1 sentence (16 chars); no entities with descriptions; step descriptions are vague one-liners; no sourceRef; no mention of business rules, validation, exceptions, or side effects.

#### Good Domain Page (score ~85)

```json
{
  "id": "domain:order-management",
  "name": "Order Management",
  "summary": "Manages the complete lifecycle of customer orders from creation through fulfillment. Enforces amount validation (minimum ¥1, maximum ¥500,000), idempotency via unique order number generation, and status-based state machine transitions (DRAFT → SUBMITTED → PAID → SHIPPED → COMPLETED). Key invariant: once an order reaches PAID status, it cannot be modified — only cancelled with mandatory refund initiation.",
  "entities": [
    { "name": "Order", "description": "Core aggregate root representing a customer purchase. Fields: orderId, userId, totalAmount (BigDecimal), status (enum), items[], shippingAddress, createdAt, updatedAt. Status transitions are validated by OrderStateMachine — invalid transitions throw IllegalStateTransitionException." },
    { "name": "OrderItem", "description": "Line item within an order. References productId and snapshotted price at time of order creation to prevent price drift affecting settled orders." }
  ],
  "flows": [
    {
      "id": "flow:create-order",
      "name": "Create Order",
      "summary": "Processes a new order submission from the web/mobile frontend. Validates cart contents against current inventory, calculates pricing with applicable promotions, and persists the order in DRAFT status before triggering payment initiation via MOA RPC to payment-service.",
      "steps": [
        {
          "order": 1,
          "name": "Validate cart contents",
          "description": "OrderService.createOrder() receives CreateOrderRequest from OrderController. Validates: all items exist in product catalog (calls ProductQueryService.batchQuery()), quantities > 0 and <= 99 per item, total item count <= 200. Throws InvalidCartException with specific field errors on validation failure.",
          "sourceRef": { "file": "src/main/java/com/example/order/service/OrderService.java", "lineRange": [45, 82] }
        },
        {
          "order": 2,
          "name": "Calculate pricing and apply promotions",
          "description": "PricingEngine.calculate() resolves unit prices from product snapshots, applies matching promotion rules (first-match strategy from PromotionRuleRepository), calculates shipping fee based on region. Side effect: inserts PriceCalculationLog for audit trail. Business rule: if promotion discount exceeds 50% of original price, requires manager approval flag.",
          "sourceRef": { "file": "src/main/java/com/example/order/service/PricingEngine.java", "lineRange": [30, 95] }
        },
        {
          "order": 3,
          "name": "Persist order and initiate payment",
          "description": "OrderRepository.save() persists Order aggregate with status=DRAFT in t_order table, then publishes OrderCreatedEvent via Kafka topic 'order.created'. OrderPaymentInitiator calls PaymentFacade.createPayment() via MOA RPC to payment-service with orderId and totalAmount. On RPC timeout, order remains in DRAFT and a retry task is scheduled (max 3 attempts, 30s interval).",
          "sourceRef": { "file": "src/main/java/com/example/order/service/OrderService.java", "lineRange": [84, 130] }
        }
      ]
    }
  ]
}
```

Qualities: summary is a full paragraph (340+ chars) with invariants and constraints; entities have rich descriptions with field details and behaviors; step descriptions include business rules, validation logic, exception types, side effects, and cross-service interactions; every step has sourceRef.

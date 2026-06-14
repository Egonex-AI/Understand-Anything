# Business & Domain Queries

Detailed reference for business landscape, wiki, and domain graph queries using `business`, `wiki`, `domain`, and the new `ask` subcommands.

> **Quick start:** For business questions, use `ask` (auto-discovers service, traces, verifies source):
> ```bash
> python ua_query.py --format md ask --query "关键词,keyword" --depth full
> ```
>
> For manual business context, use `business --search`:
> ```bash
> python ua_query.py business --search "关键词,keyword"
> ```

---

## Query Paths

### Path 4: Cross-Platform Debugging

**When:** "Client and server don't sync" or "cross-service flow is wrong"

```bash
python ua_query.py business --panorama
python ua_query.py business --domain X --type interactions
python ua_query.py business --links --domain X
python ua_query.py wiki --service server-svc --domain X
python ua_query.py wiki --service client-svc --domain X
```

**Flow:** Panorama shows all facets → interactions list cross-service steps → links show facet wiring → compare server and client wiki for the same domain.

### Path 5: Architecture Understanding

**When:** "How is the system structured?" or onboarding to a new repo

```bash
python ua_query.py wiki --architecture
python ua_query.py services --list
python ua_query.py kg --service S --layers
python ua_query.py kg --service S --tour
```

**Flow:** Architecture wiki for high-level map → services list for per-service readiness → KG layers for package/module structure → tour for guided walkthrough.

---

## Drill-Down: From Business to Source Code

Business/domain queries often reveal concepts you need to inspect at the code level. Follow this progression:

### Scenario A: Found a business domain, need implementation details

```bash
# 1. Understand the business interactions
python ua_query.py business --domain "order" --type interactions
# → Shows: "OrderService validates inventory, then calls PaymentService"

# 2. Read wiki for implementation summary
python ua_query.py wiki --service order-svc --domain order
# → Wiki shows: key classes, RPC endpoints, data flows

# 3. Trace to the actual code (switch to source-code layer)
python ua_query.py trace --service order-svc --query "OrderService,createOrder" --source --business

# 4. Need method signatures? Use structure
python ua_query.py structure --service order-svc --file OrderServiceImpl.java
```

### Scenario B: Found a domain flow, need to trace its implementation

```bash
# 1. List flows and inspect steps
python ua_query.py domain --service order-svc --flows
python ua_query.py domain --service order-svc --flow checkout-flow --steps
# → Steps show: "validate → lock-inventory → create-order → process-payment"

# 2. Each step references code — trace the key step
python ua_query.py trace --service order-svc --query "processPayment,PaymentProcessor" --source

# 3. Check who else calls this class
python ua_query.py kg --service order-svc --neighbors PaymentProcessor --direction inbound
```

### Scenario C: Cross-service flow investigation

```bash
# 1. Business panorama → find cross-facet links
python ua_query.py business --links --domain order
# → Shows: order-service → payment-service via RPC

# 2. Endpoint documentation for the RPC contract
python ua_query.py wiki --endpoint-index --protocol rpc

# 3. Trace provider side
python ua_query.py trace --service payment-svc --query "PaymentService,processPayment" --source

# 4. Trace consumer side
python ua_query.py trace --service order-svc --query "PaymentRpcClient,PaymentClient" --source

# 5. Check annotations on the RPC interface
python ua_query.py structure --service payment-svc --annotation MoaProvider
```

**Key principle:** Business context tells you WHAT → Wiki tells you HOW (summary) → KG/trace tells you WHERE (code) → Structure tells you TYPE details (signatures).

---

## `ask` — Business Question Answering (NEW)

Answers business questions end-to-end with a single command. Auto-discovers the target service, runs KG trace, fetches wiki domain detail, retrieves domain flows, and verifies against source code.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--query Q` | string | required | Natural language question or comma-separated keywords |
| `--depth LEVEL` | string | `standard` | `quick`, `standard`, or `full` |
| `--service S` | string | auto | Override service auto-discovery |
| `--limit N` | int | 5 | Max matched nodes |
| `--fusion MODE` | string | `rrf` | Search fusion: `rrf` (default) or `none` |

**Depth levels:**

- **quick**: Business landscape search only — fast domain overview
- **standard**: + KG trace + wiki domain detail — understanding a feature
- **full**: + domain flows + source code verification — **verified factual answers (recommended)**

**Examples:**

```bash
# Full verified answer (recommended for any factual question)
python ua_query.py --format md ask --query "火箭,rocket,RocketReward" --depth full

# Quick domain check
python ua_query.py ask --query "亲密度,intimacy" --depth quick

# Override service when you know which one
python ua_query.py ask --query "家族,Family" --service ultron-relation --depth standard
```

**Auto-discovery strategy:**

0. **Class-name matching (highest priority):** If keywords contain PascalCase class-like names (e.g., `ClosedFriendService`), search all service KGs for exact class matches. Services owning the Impl class receive a decisive vote boost (20 points). Early exit if score >= 15.
1. **Wiki search:** Search wiki across all services for keyword matches.
2. **Business landscape:** Search business domains for matching services.
3. **KG scan:** Scan KG of all services with data layers.
4. Select service with highest vote count.

**Source verification (--depth full):**

The response includes a `sourceReads` array with source code for the top 3 matched nodes (up to 300 lines each). This allows agents to confirm that wiki/domain descriptions match the actual implementation.

**Cross-service RPC follow (--depth full):**

When matched nodes inject RPC interfaces (`consumes_rpc` edges), `ask --depth full` auto-detects the provider service and performs a secondary trace there. Results appear in `crossServiceTrace` — include these findings when the actual implementation lives in a different service.

---

## `business` — Business Landscape Queries

Query cross-facet business-landscape data generated by `/understand-business`.

| Flag | Type | Description |
|------|------|-------------|
| `--list` | boolean | List all business domains with summaries and facet coverage |
| `--domain SLUG` | string | Full domain detail (interactions, rules, facets) |
| `--type TYPE` | string | Filter domain detail: `interactions` or `rules` |
| `--facet NAME` | string | Specific facet data for a domain (requires `--domain`) |
| `--search QUERY` | string | Full-text search across domain names and summaries |
| `--links` | boolean | Cross-facet links; optional `--domain` filter |
| `--panorama` | boolean | Full business panorama (all facets and services) |
| `--meta` | boolean | Business-landscape generation metadata |

**Examples:**

```bash
# List all domains
python ua_query.py business --list

# Search for checkout-related domains (comma-separated for OR match)
python ua_query.py business --search "checkout,下单"

# Domain interactions (supports Chinese domain names directly)
python ua_query.py business --domain order --type interactions
python ua_query.py business --domain "挚友关系建立（端到端）" --type interactions

# Business rules only
python ua_query.py business --domain payment --type rules

# Cross-facet links for a domain
python ua_query.py business --links --domain order

# System-wide panorama
python ua_query.py business --panorama

# Business layer metadata
python ua_query.py business --meta
```

---

## `wiki` — Wiki Data Queries

Query wiki pages generated by `/understand-wiki`. Some flags are global (no `--service`); others require `--service`.

| Flag | Type | Description |
|------|------|-------------|
| `--service NAME` | string | Target service (required for service-scoped queries) |
| `--type TYPE` | string | Section type: `endpoint` (others via `--domain`, `--flow`) |
| `--domain NAME` | string | Domain page within a service; also used with `--related` |
| `--search QUERY` | string | Full-text search across wiki content |
| `--overview` | boolean | Wiki overview (no `--service` needed) |
| `--architecture` | boolean | System architecture wiki (no `--service` needed) |
| `--cross-domain SLUG` | string | Cross-domain wiki page by slug (no `--service` needed) |
| `--endpoint-index` | boolean | Global endpoint index (no `--service` needed) |
| `--protocol NAME` | string | Filter endpoint index by protocol (with `--endpoint-index`) |
| `--flow ID` | string | Flow detail page for a service |
| `--related` | boolean | Related domains for `--domain` (cross-service) |

**Examples:**

```bash
# Service wiki index
python ua_query.py wiki --service order-service

# Domain implementation page (supports Chinese domain names)
python ua_query.py wiki --service order-service --domain order
python ua_query.py wiki --service ultron-relation --domain "亲密度"

# Endpoint documentation
python ua_query.py wiki --service order-service --type endpoint

# Search wiki
python ua_query.py wiki --service order-service --search "payment callback"

# Global architecture overview
python ua_query.py wiki --architecture

# Wiki overview and quality stats
python ua_query.py wiki --overview

# Cross-domain page
python ua_query.py wiki --cross-domain order-checkout

# All endpoints indexed by protocol
python ua_query.py wiki --endpoint-index
python ua_query.py wiki --endpoint-index --protocol grpc

# Flow page
python ua_query.py wiki --service order-service --flow checkout-flow

# Related domains (cross-service)
python ua_query.py wiki --service order-service --domain order --related
```

---

## `domain` — Domain Graph Queries

Query the domain graph generated by `/understand-domain`. Prefer targeted queries over full graph download.

| Flag | Type | Description |
|------|------|-------------|
| `--service NAME` | string | Target service name (required) |
| `--domain NAME` | string | Filter nodes by domain name or ID substring |
| `--search QUERY` | string | Search domain node names and summaries |
| `--neighbors NODE` | string | Neighbor traversal from a domain node |
| `--edge-type TYPE` | string | Filter neighbor edges (e.g., `cross_domain`, `depends_on`) |
| `--flows` | boolean | List flow nodes only (compact) |
| `--flow ID` | string | Get a single flow node by id or name |
| `--steps` | boolean | With `--flow`: ordered steps in the flow |

**Examples:**

```bash
# List flows only (preferred over full graph)
python ua_query.py domain --service order-service --flows

# Flow with ordered steps
python ua_query.py domain --service order-service --flow checkout-flow --steps

# Find domain nodes
python ua_query.py domain --service order-service --domain order

# Search domains
python ua_query.py domain --service order-service --search "user"

# Cross-domain neighbors
python ua_query.py domain --service order-service --neighbors payment-domain --edge-type cross_domain
```

**Avoid:** `python ua_query.py domain --service S` with no filters — returns the entire domain graph.

---

## Cross-Platform Query Recipe

For features spanning client + server (e.g., order creation, payment flow):

```bash
# 1. Business context — shows BOTH client and server interaction steps
python ua_query.py business --domain "target-domain" --type interactions

# 2. Server-side implementation (usually well-indexed)
python ua_query.py trace --service backend-service --query "featureName,FeatureService" --source --business

# 3. Client-side attempt — may return empty if client code not in KG
python ua_query.py trace --service client-service --query "FeatureCreate,featureCreate" --source

# 4. If client trace is empty (hint provided), fall back to workspace grep

# 5. API contract — use --toc to see all methods first, then read specific ones
python ua_query.py kg --service backend-service --file "FeatureServiceImpl.java" --toc
python ua_query.py kg --service backend-service --file "FeatureServiceImpl.java" --start 100 --end 150
```

**Key insight:** Business `interactions` is the ONLY layer that consistently shows both client and server steps. When KG returns empty for a service, check if the code lives in a Flutter/React/mobile module not covered by that service's analysis.

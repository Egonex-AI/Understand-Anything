# Graph Analysis Commands

Server-side graph analysis tools: impact analysis, call graph navigation, hotspot scoring, and test discovery.

---

## `impact` — Transitive Impact Analysis

Server-side BFS traversal via `/api/graph-query/impact`. Finds all transitively affected or depending code from a symbol. Returns the center node, affected nodes with distance and path, and total impact radius.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--service NAME` | string | required | Target service |
| `--symbol NAME` | string | required | Symbol to analyze (class, function, etc.) |
| `--depth N` | int | 3 | Max traversal depth (1–10) |
| `--direction DIR` | string | `inbound` | `inbound` (who depends on X), `outbound` (what X depends on), or `both` |
| `--edge-type TYPE` | string | — | Optional edge filter: `calls`, `consumes_rpc`, `implements`, etc. |

**Examples:**

```bash
# Who is transitively affected if I change OrderService? (3 hops)
python ua_query.py impact --service order-svc --symbol OrderService --depth 3 --direction inbound

# What does PaymentRpcClient transitively depend on?
python ua_query.py impact --service order-svc --symbol PaymentRpcClient --depth 2 --direction outbound

# Call-graph-only impact
python ua_query.py impact --service order-svc --symbol OrderController --depth 3 --direction inbound --edge-type calls
```

**Response shape:**

```json
{
  "service": "order-svc",
  "center": {"id": "...", "name": "OrderService", "type": "class"},
  "depth": 3,
  "direction": "inbound",
  "impactRadius": 14,
  "affectedNodes": [
    {"id": "...", "name": "OrderController", "type": "class", "distance": 1, "path": ["OrderService", "OrderController"]},
    {"id": "...", "name": "CheckoutFlow", "type": "class", "distance": 2, "path": ["OrderService", "OrderController", "CheckoutFlow"]}
  ]
}
```

**When to use:** Prefer `impact` over manual `kg --neighbors` loops when you need transitive reach, distance ordering, or path tracing. Use `--edge-type calls` to restrict to call-graph edges only.

---

## `callers` / `callees` — Call Graph Navigation

Shortcuts for call-graph traversal. Equivalent to `kg --neighbors` with `--edge-type calls` pre-set. If no `calls` edges are found, automatically retries with `--edge-type injects` to capture Spring DI dependencies.

### `callers` — Who calls this symbol?

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--service NAME` | string | required | Target service |
| `--symbol NAME` | string | required | Symbol to find callers of |
| `--depth N` | int | 1 | Traversal depth (1–3) |

```bash
python ua_query.py callers --service order-svc --symbol OrderService --depth 1
python ua_query.py callers --service order-svc --symbol createOrder --depth 2
```

### `callees` — What does this symbol call?

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--service NAME` | string | required | Target service |
| `--symbol NAME` | string | required | Symbol to find callees of |
| `--depth N` | int | 1 | Traversal depth (1–3) |

```bash
python ua_query.py callees --service order-svc --symbol OrderService --depth 1
python ua_query.py callees --service order-svc --symbol OrderController --depth 2
```

**Response shape:**

```json
{
  "service": "order-svc",
  "center": {"id": "...", "name": "OrderService", "type": "class"},
  "depth": 1,
  "callers": [{"name": "OrderController", "type": "class", "edgeType": "calls", "direction": "inbound"}],
  "total": 3
}
```

(`callees` response uses `"callees"` instead of `"callers"`.)

---

## `hotspots` — Code Hotspot Scoring

Server-side computation via `/api/graph-query/hotspots`. Computes fan-in/fan-out scores across the KG to identify the most critical nodes. Score formula: `fanIn * 2 + fanOut` (high fan-in weighted more heavily — many dependents = higher risk).

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--service NAME` | string | required | Target service |
| `--limit N` | int | 20 | Max results to return |
| `--type TYPE` | string | — | Optional node type filter: `class`, `function`, `interface`, etc. |

**Examples:**

```bash
# Top 20 most critical nodes in the service
python ua_query.py hotspots --service order-svc --limit 20

# Most critical classes only
python ua_query.py hotspots --service order-svc --limit 10 --type class
```

**Response shape:**

```json
{
  "service": "order-svc",
  "totalNodes": 842,
  "hotspots": [
    {"id": "...", "name": "OrderService", "type": "class", "fanIn": 12, "fanOut": 5, "score": 29, "filePath": "src/..."}
  ]
}
```

**When to use:** Before refactoring, identify high-fan-in classes that will have wide impact. Combine with `impact` on the top hotspot for detailed path analysis.

---

## `affected` — Affected Test Discovery

Traces inbound KG dependencies from changed source files to find test files that should be re-run. Matches test files by path pattern (`*Test.java`, `*_test.go`, etc.) or `tested_by` edges.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--service NAME` | string | required | Target service |
| `--files PATHS` | string | required | Comma-separated file paths (suffix match supported) |
| `--depth N` | int | 2 | Inbound traversal depth from each changed file |

**Examples:**

```bash
python ua_query.py affected --service order-svc --files src/OrderService.java,src/PaymentRpc.java --depth 2
python ua_query.py affected --service order-svc --files OrderServiceImpl.java --depth 3
```

**Response shape:**

```json
{
  "service": "order-svc",
  "changedFiles": ["src/OrderService.java", "src/PaymentRpc.java"],
  "affectedTests": [
    {"testFile": "src/test/OrderServiceTest.java", "reason": "tested_by edge from src/OrderService.java", "relatedSymbol": "OrderServiceTest"},
    {"testFile": "src/test/PaymentIntegrationTest.java", "reason": "inbound dependency on changed file src/PaymentRpc.java", "relatedSymbol": "PaymentRpcClient"}
  ]
}
```

**When to use:** After editing production code, run `affected` to get a minimal test set before full CI. Pair with `impact` to understand production blast radius separately from test coverage.

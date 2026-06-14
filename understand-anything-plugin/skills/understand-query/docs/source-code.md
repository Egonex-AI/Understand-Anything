# Source-Level Code Queries

Strategy guide and command index for source code investigation.

> **Quick start:** For any "How does X work?" question, use `trace` first:
> ```bash
> python ua_query.py trace --service S --query "原词,EnglishName,Synonym" --source --business
> ```

---

## Command Reference (by file)

| Command | Purpose | Docs |
|---------|---------|------|
| `kg` | KG traversal: neighbors, edges, file read, summary | [kg-trace.md](kg-trace.md#kg--knowledge-graph-queries) |
| `trace` | Aggregated search→neighbors→source (1-call) | [kg-trace.md](kg-trace.md#trace--aggregated-searchneighborssource-recommended-for-agents) |
| `kg --file` | TOC + batch read pattern | [kg-trace.md](kg-trace.md#kg---file-toc--batch-read-recommended-pattern) |
| `structure` | Signatures, annotations, types, symbol search + source | [structure-commands.md](structure-commands.md) |
| `impact` | Server-side BFS impact analysis (depth 1–10) | [graph-analysis.md](graph-analysis.md#impact--transitive-impact-analysis) |
| `callers` / `callees` | Call graph navigation | [graph-analysis.md](graph-analysis.md#callers--callees--call-graph-navigation) |
| `hotspots` | Server-side fan-in/fan-out scoring | [graph-analysis.md](graph-analysis.md#hotspots--code-hotspot-scoring) |
| `affected` | Affected test discovery | [graph-analysis.md](graph-analysis.md#affected--affected-test-discovery) |

---

## Query Paths

### Path 1: Feature Location

**When:** "I need to find code for feature X" or "where is X implemented?"

```bash
python ua_query.py business --search "keyword"
python ua_query.py services --list
python ua_query.py wiki --service S --domain D
python ua_query.py kg --service S --search "keyword" --verbose
```

**Flow:** Search business landscape for domain context → confirm service has kg/wiki → read wiki domain page for implementation summary → search KG for concrete classes/files.

### Path 2: Bug Investigation

**When:** "An API is broken" or "this endpoint returns wrong data"

```bash
python ua_query.py wiki --service S --type endpoint
python ua_query.py kg --service S --neighbors InterfaceName --edge-type consumes_rpc --direction inbound
python ua_query.py kg --service S --neighbors ControllerName --edge-type calls --direction outbound
python ua_query.py kg --service S --file src/path/File.java
```

**Flow:** Read endpoint wiki → trace RPC consumers (who calls this interface?) → trace outbound calls from controller → read annotated source file.

### Path 3: Dependency / Impact Analysis

**When:** "What will changing X break?" or "who depends on this class?"

```bash
# Preferred: transitive BFS impact with distance + path
python ua_query.py impact --service S --symbol TargetClass --depth 3 --direction inbound

# Quick call-graph shortcuts
python ua_query.py callers --service S --symbol TargetClass --depth 2
python ua_query.py callees --service S --symbol TargetClass --depth 1

# Legacy: direct neighbors only
python ua_query.py kg --service S --neighbors TargetClass --direction inbound
python ua_query.py kg --service S --neighbors TargetClass --direction outbound
python ua_query.py domain --service S --neighbors target-domain --edge-type cross_domain
```

**Flow:** `impact` performs BFS from the target symbol and returns all transitively affected nodes with distance and path. Use `callers`/`callees` for call-graph-only navigation. Domain cross-domain edges reveal business-level coupling across services.

### Path 7: Code-Level Detail (Signatures & Annotations)

**When:** "Find all @MoaProvider services", "What type does this method return?", "Which classes implement this interface?"

```bash
python ua_query.py structure --service S --annotation MoaProvider
python ua_query.py structure --service S --param-type UserDTO
python ua_query.py structure --service S --return-type OrderResponse
python ua_query.py structure --service S --interface IOrderService
python ua_query.py structure --service S --file ServiceImpl.java
```

**Flow:** Use `structure` when KG search found a class/function but you need type-level detail (params, return types, annotations, interfaces) that KG nodes don't contain.

### Path 8: Inheritance & Implementation

**When:** "What are the subclasses of BaseEntity?", "Who implements IUserService?", "What's the full inheritance chain?"

```bash
python ua_query.py structure --service S --chain VipUserEntity --direction up
python ua_query.py structure --service S --chain BaseEntity --direction down
python ua_query.py structure --service S --implementors IUserService
```

**Flow:** `--chain up` gives you the full hierarchy from a class to its root. `--chain down` shows all descendants. `--implementors` lists every class implementing a given interface.

---

## Drill-Down: From Business Context to Source Code

When business/domain queries reveal a feature you need to inspect at the code level, follow this progression:

```bash
# 1. Business query found a relevant domain
python ua_query.py business --domain "order" --type interactions
# → Interactions list mentions: "OrderService.createOrder() processes payment"

# 2. Trace to find the implementation class
python ua_query.py trace --service order-svc --query "OrderService,createOrder" --source --business

# 3. Need more detail? Check method signatures and annotations
python ua_query.py structure --service order-svc --file OrderServiceImpl.java

# 4. Deeper: check all classes using the same DTO
python ua_query.py structure --service order-svc --param-type OrderDTO

# 5. Dependency impact: who calls this service?
python ua_query.py callers --service order-svc --symbol OrderServiceImpl --depth 2
```

**Key principle:** Business → Wiki → KG → Structure → Source. Each layer adds precision; only go deeper when needed.

---

## Combination Recipes: Reducing Tool Calls

These recipes show how to combine capabilities to answer complex questions with fewer tool calls than naive sequential querying.

### Recipe 0: "What is X business function?" (1 call — NEW)

**Naive approach (5+ calls):** services → business → trace → wiki → domain → source  
**Optimized:**

```bash
python ua_query.py --format md ask --query "中文名,EnglishName,Synonym" --depth full
```

### Recipe 1: "How does feature X work end-to-end?" (1–2 calls)

**Naive approach (5+ calls):** search → neighbors → source → business → structure  
**Optimized:**

```bash
python ua_query.py trace --auto-discover --query "中文名,ClassName,Synonym" --source --business --wiki --domain-flows
```

If `trace` returns `matchedNodes` with `filePath` + `lineRange`, you have everything. Only call `structure --file` if you need param/return types.

### Recipe 2: "Find all RPC entry points and their types" (2 calls)

**Naive approach (N+1 calls):** search for each annotation individually  
**Optimized:**

```bash
# Call 1: Find all RPC-annotated classes with type resolution
python ua_query.py structure --service S --annotation MoaProvider

# Call 2 (optional): Get KG edges for RPC relationships
python ua_query.py kg --service S --edges --type consumes_rpc
```

The `structure` search results include `typeRef` auto-resolution — if an `@MoaProvider` class returns `OrderDTO`, `typeRef` tells you where `OrderDTO` is defined without an extra lookup.

### Recipe 3: "What will changing class X break?" (2 calls)

**Naive approach (4+ calls):** KG inbound → KG outbound → structure for types → structure for implementors  
**Optimized:**

```bash
# Call 1: Transitive impact with distance + path (replaces manual BFS)
python ua_query.py impact --service S --symbol TargetClass --depth 3 --direction inbound

# Call 2: Structure search shows who uses TargetClass as a dependency
python ua_query.py structure --service S --property-type TargetClass
```

The `propertyType` search with `typeRef` reveals all classes injecting `TargetClass` AND where `TargetClass` is defined — the "impact surface" in one call.

### Recipe 3b: "What's the blast radius of X?" (2 calls)

**Naive approach (5+ calls):** trace → kg neighbors → repeat for each match  
**Optimized:**

```bash
# Call 1: Quick triage — check blastRadius on top matches
python ua_query.py trace --service S --query "TargetClass" --limit 3

# Call 2: Full transitive impact from the confirmed symbol
python ua_query.py impact --service S --symbol TargetClass --depth 3 --direction both
```

Use `trace` `blastRadius` on matched nodes for a quick direct-dependency count; follow with `impact` when you need transitive reach and paths.

### Recipe 3c: "Which tests should I run after editing these files?" (1 call)

```bash
python ua_query.py affected --service S --files src/OrderService.java,src/PaymentRpc.java --depth 2
```

Combine with `impact` on the same symbols if you also need production dependency analysis.

### Recipe 4: "Understand a class's inheritance and implementations" (2 calls)

**Naive approach (3+ calls):** search for superclass → search for interface → search implementors  
**Optimized:**

```bash
# Call 1: Full inheritance chain in one call
python ua_query.py structure --service S --chain VipUserEntity --direction up
# Returns: VipUserEntity → UserEntity → BaseEntity (with file paths)

# Call 2: Find all implementors of its interface
python ua_query.py structure --service S --implementors IUserService
```

### Recipe 5: "Read a large file efficiently" (2 calls)

**Naive approach (N calls):** reading chunks blindly  
**Optimized:**

```bash
# Call 1: Get method index (no source code, very cheap)
python ua_query.py kg --service S --file ServiceImpl.java --toc

# Call 2: Batch-read relevant methods in one range
python ua_query.py kg --service S --file ServiceImpl.java --start 120 --end 350
```

### Recipe 6: "Cross-service dependency tracing" (3 calls)

**Naive approach (6+ calls):** wiki in each service, KG in each service  
**Optimized:**

```bash
# Call 1: Business panorama for cross-service overview
python ua_query.py business --panorama

# Call 2: Trace the method in source service
python ua_query.py trace --service source-svc --query "RpcClient,目标服务" --source

# Call 3: Find the implementation in target service
python ua_query.py trace --service target-svc --query "RpcImpl,接口名" --source
```

### Recipe 7: "From business domain to source code" (3 calls)

**Naive approach (5+ calls):** business → wiki → kg search → kg neighbors → source  
**Optimized:**

```bash
# Call 1: Business context
python ua_query.py business --search "订单" --type interactions

# Call 2: Trace directly (includes search + neighbors + source + business)
python ua_query.py trace --service order-svc --query "Order,订单,OrderService" --source --business

# Call 3 (only if needed): Type-level details
python ua_query.py structure --service order-svc --file OrderServiceImpl.java
```

---

## Decision Matrix: Which Tool First?

| Question Type | Start With | Then (if needed) |
|---------------|-----------|------------------|
| "What is X business function?" | `ask --depth full` | Nothing — one call covers all |
| "How does X work?" | `ask --depth full` or `trace --auto-discover --source --business --wiki` | `structure --file` for types |
| "Find all @Annotation classes" | `structure --annotation` | `kg --neighbors` for relationships |
| "Who calls X?" | `callers --symbol X` | `impact --symbol X --direction inbound` for transitive |
| "What does X call?" | `callees --symbol X` | `impact --symbol X --direction outbound` for transitive |
| "What will changing X break?" | `impact --symbol X --depth 3` | `structure --property-type X` |
| "What's the blast radius of X?" | `trace --query X` (check `blastRadius`) | `impact --symbol X --depth 3` |
| "Which tests to run?" | `affected --files F1,F2` | `impact --symbol X` for prod deps |
| "Most critical classes?" | `hotspots --type class` | `impact --symbol` on top result |
| "Find symbol across files" | `structure --symbol NAME` | `trace --query NAME --grouped --source` |
| "Show me source of X" | `structure --symbol X --source` | `kg --file F --start N --end M` for context |
| "File overview before reading source" | `kg --file F --summary` | `kg --file F --toc` → batch read |
| "What's the class hierarchy?" | `structure --chain X` | `structure --implementors` |
| "What services have feature Y?" | `ask --depth quick` or `business --search Y` | `trace` per service |
| "Read this source file" | `kg --file F --toc` | `kg --file F --start N --end M` |
| "Cross-service dependency?" | `business --panorama` | `trace` in source + target service |
| "Which DTO is used where?" | `structure --param-type DTO` | `typeRef` in results (no extra call) |

# Technical Reference

Infrastructure subcommands, search algorithm details, error handling, and output format reference.

---

## `services` — Service Discovery

List services from `system-graph.json` with per-layer readiness (kg, domain, wiki, business).

| Flag | Type | Description |
|------|------|-------------|
| `--list` | boolean | List all services (default behavior when no other flags) |
| `--name NAME` | string | Filter to a single service by exact name |
| `--has LAYERS` | string | Comma-separated required layers: `kg`, `domain`, `wiki`, `business` |

**Examples:**

```bash
python ua_query.py services --list
python ua_query.py services --name order-service
python ua_query.py services --has wiki,kg
python ua_query.py --format md services --list
```

**Response shape:** `{ "services": [...], "totalServices": N }` — each service includes `name`, `basePath`, `facet`, and `dataLayers`.

---

## `meta` — Cross-Layer Freshness

Check project-wide layer availability and git freshness across kg, domain, wiki, and business data.

| Flag | Type | Description |
|------|------|-------------|
| `--stale` | boolean | Return only stale layer names (out of sync with current commit) |

**Examples:**

```bash
python ua_query.py meta
python ua_query.py meta --stale
```

**Response includes:** `project`, `layers` (availability, counts, timestamps), `freshness.currentCommit`, `freshness.stale`.

---

## Search Algorithm & Cross-Language Matching

All search endpoints (wiki, kg, domain, business) forward to unified `/api/search?scope=...` with consistent MiniSearch scoring. Structure search uses `/api/structure/search` with its own MiniSearch index.

### MiniSearch (BM25 + code-aware tokenization)

All `--search` and `trace --query` use MiniSearch with intelligent tokenization:
- **CamelCase/snake_case splitting**: `OrderPaymentService` → [order, payment, service], `get_user` → [get, user]
- **Multi-word queries**: `"sendInvite acceptInvite"` matches nodes containing either term
- **Fuzzy matching**: typos tolerated (fuzzy=0.2 edit distance)
- **Prefix matching**: `"Auth"` finds `AuthenticationService`
- **Field-weighted scoring**: KG: name (3×), tags (2.5×), summary (2×), type (0.5×); Wiki: name (3×), summary (2×), content (1×)
- **CJK segmentation** (jieba with bigram fallback): `"订单支付"` → [订单, 支付] for matching against non-English summaries
- **Mixed queries**: `"Order创建"` → [order] + CJK words
- **Number extraction**: `v2` → [v2], `123` → [123]

### Filtering & Pagination

`/api/search` supports server-side filtering to avoid post-filtering in CLI:
- **type**: Filter by node type (class, endpoint, function, etc.)
- **tag**: Filter by tag (auth, service, domain, business, etc.)
- **offset**: Pagination offset for large result sets
- **facets**: Response includes type/service/layer distribution counts

`/api/structure/search` supports precise filtering:
- **q**: Fuzzy search across name, annotations, paramTypes, returnType, content
- **annotation/paramType/returnType/interface/propertyType**: Precise filters
- **sectionKey/sectionValue**: Filter by section name or content substring
- **pathPattern**: Filter by file path substring
- **symbol**: Post-filter by symbol name substring
- **offset**: Pagination offset
- **facets**: Response includes type/service distribution counts

### RRF Fusion (trace default)

`trace` defaults to `fusion=rrf`, combining MiniSearch text relevance with KG graph traversal signals:
- Surfaces structurally related nodes even without text match — e.g. searching `"AuthService"` also boosts `UserRepository` connected via KG edges
- Standard formula: score = Σ 1/(60 + rank_i)
- Disable with `--fusion none` for pure text search

### Domain-Flow Auto-Fallback

When non-English keywords have no KG match, `trace` automatically:
1. Searches domain graph flows via MiniSearch (flow summaries often contain non-English text)
2. Extracts English code keywords from the matching flow name (e.g., "Create Order Flow" → "CreateOrder")
3. Re-searches KG with extracted English keyword → success!

```
trace --query "非英文关键词"
  → KG MiniSearch: 0 matches (KG nodes are English-named)
  → Domain flow MiniSearch: finds flow whose summary matches
  → Extract keyword from flow name: "EnglishCodeKeyword"
  → KG re-search: ServiceImpl, ManagerClass, ...
  → Response: discoveredVia: "domain-flow:<flow-name>"
```

### Agent Pre-Query Translation Guide

**Rule: ALWAYS expand to multi-keyword BEFORE calling `trace`. Include original term + English translation + synonym in one comma-separated query.**

1. **Translate the concept**: If user asks in Chinese/non-English, think "what English word would a developer use for this concept?"
   - Domain concepts → English nouns (PascalCase for classes, camelCase for methods)
   - Actions → English verbs (create, send, bind, update, check)
   - Compound terms → multiple word combinations (e.g., "好友关系" → "Friend,Friendship,FriendRelation")

2. **Include code naming variants**: Developers often use abbreviations:
   - Full word + abbreviation: `"Message,Msg,IM"`
   - Service suffix patterns: `"Payment,PaymentService,PayService"`
   - Verb+noun: `"sendGift,GiftSender"`

3. **Keep the original**: Always include the user's original term — MiniSearch with jieba CJK segmentation + domain-flow fallback can match it.

**Rule: ALWAYS pass multiple keywords in one `trace` call. This searches all variants in parallel and returns the best matches — no retry needed.**

---

## Known Limits

### Recently Fixed (2026-06-10)

| Issue | Fix | Impact |
|-------|-----|--------|
| `/api/search` crashed Vite server on large codebases | Per-service try-catch + middleware safety net | Search no longer crashes server |
| `business --search "A,B"` returned empty results | API splits comma-separated keywords with OR logic | Multi-keyword business search works |
| `business --domain slug` returned 404 for valid slugs | API fallback: tries `domain-${slug}.json` | Unprefixed slugs resolve correctly |
| `business --domain "中文名"` returned 404 | API fallback: looks up domain by name/id in `domains.json` | Chinese domain names work directly |
| `wiki --domain "中文名"` returned 404 | `getServiceDomain` falls back to index name matching | Chinese wiki domain names work |
| Replaced Fuse.js/LumoSearch with MiniSearch | Single lightweight engine: BM25 + code-aware tokenizer + jieba CJK + RRF graph fusion + server-side type/tag filtering | Faster, fewer deps, consistent scoring |

### Current Limits

| Constraint | Detail |
|------------|--------|
| `kg --file` max per request | 500 lines (use `--start`/`--end` to paginate larger files) |
| `trace --source` auto-range | Uses KG `lineRange` if available; otherwise first 500 lines |
| KG coverage per service | Only modules analyzed by `/understand`; Flutter/client modules may be in a separate service |
| Token in KG nodes | Individual method bodies are NOT in KG; only metadata. Use `--file` or `trace --source` to read actual code |

---

## Error Handling

| Exit Code | Meaning | Recommended Action |
|-----------|---------|-------------------|
| 0 | Success | Output printed to stdout |
| 1 | Client error | Check arguments; API returned 4xx or runtime error |
| 2 | Server unavailable | Start API server: `pnpm run serve` |

**Error messages go to stderr.** Successful JSON/markdown output goes to stdout.

| Scenario | Behavior |
|----------|----------|
| Server not reachable | Exit 2 with startup instructions |
| Subcommand requires `--service` but not provided | Exit 1 with `SystemExit` message |
| Wiki `--related` without `--domain` | Exit 1: `--related requires --domain` |
| Domain `--flow` not found | Exit 1: `Flow 'X' not found` with fuzzy suggestions |
| API returns 404 (data not generated) | Exit 1, HTTP error printed |
| Node not found in graph query | Exit 1: `node not found` + **"Did you mean"** suggestions |

### Fuzzy Matching Behavior

| Operation | Exact Match | Fuzzy Fallback |
|-----------|-------------|----------------|
| `kg --node NAME` | Returns exact match | Substring search on name/id, returns all matches |
| `kg --neighbors NAME` | Traverses from exact node | Returns up to 10 suggestions (token-scored) |
| `kg --edges --source/--target` | Filters by exact node | Suggestions on miss |
| `domain --flow NAME` | Returns exact flow | Substring suggestions from flow nodes |

**Agent pattern:** When you don't know the exact node name, use `--search` first to find candidates, then use the precise name from results with `--neighbors`.

```bash
# Step 1: Fuzzy search to find candidate names
python ua_query.py kg --service S --search "intimacy" --type class

# Step 2: Use exact name from results for neighbors
python ua_query.py kg --service S --neighbors UserIntimacyService --direction both
```

---

## Output Formats

### JSON (default)

Standard JSON with `indent=2`, suitable for piping to `jq` or programmatic consumption:

```bash
python ua_query.py business --list | jq '.domains[].name'
python ua_query.py meta --stale | jq '.stale[]'
python ua_query.py services --has kg | jq '.services[].name'
```

### Markdown (`--format md`)

Human-readable markdown for embedding in agent responses:

- Domain lists → `## Domain Name` headings with summaries
- Search results → bullet list with bold names
- Other data → fenced JSON code block

```bash
python ua_query.py --format md business --list
python ua_query.py --format md business --search "order"
```

---

## Server Configuration

The CLI defaults to `http://172.18.228.71:3001`. Override with `UNDERSTAND_SERVER` env var or `--server` flag.

If the server is unreachable, the CLI exits with code 2 and prints startup instructions. Agents should report this to the user rather than attempting to auto-start or probe alternative addresses.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `UNDERSTAND_SERVER` | API server base URL | `http://172.18.228.71:3001` |

---

## Script Location

```
understand-anything-plugin/skills/understand-query/ua_query.py
```

**Dependencies:** Python 3.10+ stdlib only. No external packages required.

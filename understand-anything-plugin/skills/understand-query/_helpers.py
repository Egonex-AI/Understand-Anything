"""Search, graph traversal, scoring, and pure logic helpers."""
from __future__ import annotations
import re
from typing import Any
from _utils import fetch_json, build_url, _IMPL_SUFFIXES, _CONFIG_SUFFIXES

def _score_node_relevance(node: dict[str, Any], query: str) -> float:
    """Score a node's relevance to the query using language-agnostic structural signals."""
    q = query.lower()
    name = node.get("name", "").lower()
    node_id = node.get("id", "").lower()
    score = 0.0

    # 名称匹配
    if q == name:
        score += 15.0
    elif q in name:
        score += 5.0 + (len(q) / max(len(name), 1))

    # ID 匹配
    if q in node_id:
        score += 2.0

    # 类型加权
    node_type = node.get("type", "")
    type_bonus = {"class": 2, "function": 1.5, "interface": 2, "module": 1, "endpoint": 2, "service": 2.5}.get(node_type, 0)
    score += type_bonus

    # 文件路径和行号
    if node.get("filePath"):
        score += 1.5
    if node.get("lineRange"):
        score += 1.0

    # 实现类加权
    raw_name = node.get("name", "")
    if any(raw_name.endswith(s) for s in _IMPL_SUFFIXES):
        score += 3.0
    elif any(raw_name.endswith(s) for s in _CONFIG_SUFFIXES):
        score -= 2.0

    # 新增：标签匹配
    tags = node.get("tags", [])
    if tags:
        tag_text = " ".join(tags).lower()
        if q in tag_text:
            score += 4.0

    # 新增：摘要匹配
    summary = node.get("summary", "").lower()
    if summary and q in summary:
        score += 3.0

    return max(score, 0.0)


def _extract_code_keywords(flow_name: str) -> list[str]:
    """Extract PascalCase/camelCase keywords from a flow name like 'Bind Closed Friend' or 'bind-closed-friend'.
    Order: full pascal → individual long words → suffixes."""
    parts = re.split(r"[-_:.\s]+", flow_name)
    parts = [p for p in parts if p and p.lower() not in ("flow", "domain", "step")]
    if parts:
        pascal = "".join(p.capitalize() for p in parts)
        keywords = [pascal]
        for p in parts:
            cap = p.capitalize()
            if len(cap) >= 7 and cap not in keywords:
                keywords.append(cap)
        for i in range(1, len(parts)):
            suffix = "".join(p.capitalize() for p in parts[i:])
            if len(suffix) > 5 and suffix not in keywords:
                keywords.append(suffix)
        return keywords
    return []


def _search_api(server: str, query: str, service: str | None = None, scope: str = "kg", limit: int = 50, fusion: str = "none", type: str | None = None, tag: str | None = None, offset: int = 0) -> list[dict]:
    """Call the unified /api/search endpoint and return results."""
    params: dict[str, str] = {"q": query, "scope": scope, "limit": str(limit)}
    if service:
        params["service"] = service
    if fusion != "none":
        params["fusion"] = fusion
    if type:
        params["type"] = type
    if tag:
        params["tag"] = tag
    if offset > 0:
        params["offset"] = str(offset)
    data = fetch_json(build_url(server, "/api/search", params))
    return data.get("results", [])


def _find_symbol_node(server: str, service: str, symbol: str) -> dict[str, Any]:
    """Search KG for a symbol and return the best-matching node.

    Precision logic:
    1. If the specified service has an exact name match, return it immediately.
    2. If it only has fuzzy matches, do a global search. If another service
       has an exact match (especially an Impl class), prefer that cross-service result.
    3. If the specified service has no matches at all, fall back to cross-service search.
    """
    results = _search_api(server, symbol, service=service, scope="kg", limit=30)

    if results:
        exact_local = [n for n in results if n.get("name", "").lower() == symbol.lower()]
        if exact_local:
            exact_local.sort(key=lambda n: _score_node_relevance(n, symbol), reverse=True)
            return exact_local[0]

        # Local service has only fuzzy matches — check if another service has exact match
        global_exact = _cross_service_symbol_search(server, service, symbol, exact_only=True)
        if global_exact:
            node = global_exact["node"]
            node["crossServiceOrigin"] = {
                "originalService": service,
                "actualService": global_exact["service"],
                "hint": (
                    f"'{symbol}' 在 '{service}' 中仅有模糊匹配，"
                    f"精确实现在 '{global_exact['service']}' 中 ('{node.get('name', symbol)}')。"
                ),
            }
            return node

        # No exact match anywhere — return best local fuzzy match
        results.sort(key=lambda n: _score_node_relevance(n, symbol), reverse=True)
        return results[0]

    # No results in specified service — full cross-service fallback
    found_in = _cross_service_symbol_search(server, service, symbol, exact_only=False)
    if found_in:
        node = found_in["node"]
        node["crossServiceOrigin"] = {
            "originalService": service,
            "actualService": found_in["service"],
            "hint": (
                f"'{symbol}' 未在 '{service}' 中找到，"
                f"已在 '{found_in['service']}' 中定位到 '{node.get('name', symbol)}'。"
            ),
        }
        return node

    raise RuntimeError(f"No KG node found for symbol '{symbol}' in service '{service}' or any other indexed service")


def _cross_service_symbol_search(server: str, exclude_service: str, symbol: str, *, exact_only: bool = False) -> dict[str, Any] | None:
    """Single global search to find a symbol across all services (O(1) HTTP call)."""
    try:
        hits = _search_api(server, symbol, scope="kg", limit=30)
    except RuntimeError as e:
        sys.stderr.write(f"[ua_query] cross-service search failed: {e}")
        return None

    # Filter out results from the excluded service
    candidates = [h for h in hits if h.get("service", "") != exclude_service]
    if not candidates:
        return None

    if exact_only:
        candidates = [h for h in candidates if h.get("name", "").lower() == symbol.lower()]
        if not candidates:
            return None

    # Score with implementation class bonus
    def _impl_score(node: dict) -> float:
        base = _score_node_relevance(node, symbol)
        name = node.get("name", "")
        if any(name.endswith(suf) for suf in _IMPL_SUFFIXES):
            base += 10.0
        if node.get("type") == "class":
            base += 2.0
        return base

    candidates.sort(key=_impl_score, reverse=True)
    best = candidates[0]
    return {"service": best.get("service", ""), "node": best}


def _effective_service(node: dict[str, Any], fallback_service: str) -> str:
    """Return the actual service to query — respects cross-service resolution."""
    origin = node.get("crossServiceOrigin")
    if origin and origin.get("actualService"):
        return origin["actualService"]
    return fallback_service


def _fetch_neighbors(
    server: str,
    service: str,
    node_id: str,
    direction: str = "both",
    depth: int = 1,
    edge_type: str | None = None,
) -> dict[str, Any]:
    params: dict[str, str] = {
        "service": service,
        "graph": "kg",
        "node": node_id,
        "direction": direction,
        "depth": str(depth),
    }
    if edge_type:
        params["edgeType"] = edge_type
    return fetch_json(build_url(server, "/api/graph-query/neighbors", params))


def _neighbor_entries(nbr_data: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for n in nbr_data.get("neighbors", []):
        node = n.get("node") or {}
        edge = n.get("edge") or {}
        entries.append({
            "id": node.get("id", ""),
            "name": node.get("name", node.get("id", "?")),
            "type": node.get("type", ""),
            "filePath": node.get("filePath", ""),
            "direction": n.get("direction", ""),
            "edgeType": edge.get("type", ""),
        })
    return entries


def _nodes_for_file(nodes: list[dict[str, Any]], file_path: str) -> list[dict[str, Any]]:
    fp_norm = file_path.replace("\\", "/").lower()
    matched: list[dict[str, Any]] = []
    for n in nodes:
        nfp = n.get("filePath", "").replace("\\", "/")
        if not nfp:
            continue
        nfp_lower = nfp.lower()
        if nfp_lower == fp_norm or nfp_lower.endswith("/" + fp_norm) or fp_norm in nfp_lower or nfp_lower.endswith(fp_norm):
            matched.append(n)
    return matched


def _is_test_path(file_path: str) -> bool:
    return any(marker in file_path for marker in ("test", "Test", "spec"))


def _auto_discover_service(server: str, query: str) -> tuple[str | None, list[dict]]:
    """Search wiki + business landscape + KG to find which service hosts a feature. Returns (service_name, biz_results)."""
    service_votes: dict[str, int] = {}
    biz_results: list[dict] = []
    parts = [p.strip() for p in query.split(",") if p.strip()]
    short_parts = [p for p in parts if len(p) <= 20]
    search_query = " ".join(short_parts[:3]) if short_parts else " ".join(parts[:2])

    # Strategy 0: Exact class name matching — highest priority for PascalCase identifiers.
    # When keywords contain class-like names (PascalCase), search KG for exact class/service
    # nodes across all services. A service owning the Impl/DomainService class gets a
    # decisive vote boost, solving the "found reporter not implementer" problem.
    class_keywords = [p for p in parts if p[0:1].isupper() and len(p) > 5 and any(c.islower() for c in p)]
    if class_keywords:
        try:
            svc_list = fetch_json(build_url(server, "/api/services", {}))
            for class_kw in class_keywords[:3]:
                for svc in svc_list.get("services", []):
                    svc_name = svc.get("name", "")
                    layers = svc.get("dataLayers", {})
                    if not (layers.get("kg")):
                        continue
                    try:
                        hits = _search_api(server, class_kw, service=svc_name, scope="kg", limit=5)
                        for h in hits:
                            node_name = h.get("name", "")
                            node_type = h.get("type", "")
                            if node_name == class_kw and node_type in ("class", "service", "function"):
                                bonus = 20 if any(s in node_name for s in _IMPL_SUFFIXES) else 15
                                service_votes[svc_name] = service_votes.get(svc_name, 0) + bonus
                                break
                            elif class_kw.lower() in node_name.lower() and node_type in ("class", "service"):
                                service_votes[svc_name] = service_votes.get(svc_name, 0) + 8
                    except RuntimeError:
                        continue
        except RuntimeError:
            pass
        if service_votes:
            best = max(service_votes, key=lambda k: service_votes[k])
            if service_votes[best] >= 15:
                return best, biz_results

    # Strategy 1: Wiki search — fast even on cold server, returns service associations directly
    try:
        wiki_results = _search_api(server, search_query, scope="wiki", limit=10)
        for r in wiki_results:
            svc_name = r.get("service", "")
            if svc_name:
                service_votes[svc_name] = service_votes.get(svc_name, 0) + 2
        if wiki_results:
            biz_results = wiki_results
    except RuntimeError:
        pass

    # Strategy 2: Business landscape search (slower on cold start, supplements wiki)
    if not service_votes:
        try:
            biz_hits = _search_api(server, search_query, scope="business", limit=10)
            for r in biz_hits:
                for svc in r.get("services", []):
                    svc_name = svc if isinstance(svc, str) else svc.get("name", "")
                    if svc_name:
                        service_votes[svc_name] = service_votes.get(svc_name, 0) + 3
                facets = r.get("facets", {})
                if isinstance(facets, dict):
                    for _facet_name, facet_data in facets.items():
                        if isinstance(facet_data, dict):
                            for svc in facet_data.get("services", []):
                                svc_name = svc if isinstance(svc, str) else svc.get("name", "")
                                if svc_name:
                                    service_votes[svc_name] = service_votes.get(svc_name, 0) + 2
            if biz_hits and not biz_results:
                biz_results = biz_hits
        except RuntimeError:
            pass

    # Strategy 3: KG search across all services with wiki/kg data
    if not service_votes:
        try:
            svc_list = fetch_json(build_url(server, "/api/services", {}))
            for svc in svc_list.get("services", []):
                svc_name = svc.get("name", "")
                layers = svc.get("dataLayers", {})
                if not (layers.get("wiki") or layers.get("kg")):
                    continue
                try:
                    kg_hits = _search_api(server, search_query, service=svc_name, scope="kg", limit=3)
                    if kg_hits:
                        best_score = max(_score_node_relevance(n, search_query) for n in kg_hits)
                        if best_score > 3.0:
                            service_votes[svc_name] = service_votes.get(svc_name, 0) + int(best_score)
                except RuntimeError:
                    continue
        except RuntimeError:
            pass

    if service_votes:
        best = max(service_votes, key=lambda k: service_votes[k])
        return best, biz_results
    return None, biz_results


def _fetch_wiki_domain(server: str, service: str, query: str) -> dict | None:
    """Try to find and fetch wiki domain detail matching the query."""
    try:
        wiki_results = _search_api(server, query, service=service, scope="wiki", limit=5)
        domain_names = [r.get("name", r.get("id", "")) for r in wiki_results if r.get("type") in ("domain", None, "")]
        if not domain_names:
            domain_names = [r.get("name", r.get("id", "")) for r in wiki_results[:3]]
        for name in domain_names:
            if not name:
                continue
            slug = name.replace(" ", "-").lower()
            try:
                svc_encoded = url_quote(service, safe="")
                domain_encoded = url_quote(slug, safe="")
                return fetch_json(build_url(server, f"/api/wiki/service/{svc_encoded}/domain/{domain_encoded}", {}))
            except RuntimeError:
                continue
        return None
    except RuntimeError:
        return None


def _fetch_domain_flows(server: str, service: str, query: str) -> list[dict] | None:
    """Fetch domain graph flows matching the query."""
    try:
        params: dict[str, str] = {"service": service, "file": "domain-graph.json"}
        data = fetch_json(build_url(server, "/api/graph", params))
        flows = [n for n in data.get("nodes", []) if n.get("type") == "flow"]
        if not flows:
            return None
        q_lower = query.lower()
        keywords = [k.strip().lower() for k in query.split(",") if k.strip()]
        relevant = []
        for f in flows:
            name = f.get("name", "").lower()
            summary = f.get("summary", "").lower()
            if any(kw in name or kw in summary for kw in keywords):
                relevant.append(f)
        if not relevant:
            relevant = flows[:10]
        flow_details = []
        edges = data.get("edges", [])
        nodes = data.get("nodes", [])
        for flow in relevant[:5]:
            step_edges = sorted(
                [e for e in edges if e.get("source") == flow["id"] and e.get("type") == "flow_step"],
                key=lambda e: e.get("weight", 0),
            )
            step_ids = [e["target"] for e in step_edges]
            steps = [n for n in nodes if n["id"] in step_ids]
            flow_details.append({"flow": flow, "steps": steps})
        return flow_details
    except RuntimeError:
        return None



def _extract_symbol(content: str, symbol: str) -> str | None:
    """Extract a method/class block from source content by symbol name."""
    lines = content.split("\n")
    start_idx = None
    for i, line in enumerate(lines):
        if symbol in line and ("(" in line or "{" in line or "class " in line):
            start_idx = i
            break
    if start_idx is None:
        return None

    # Find the end of the block by tracking braces
    brace_count = 0
    end_idx = start_idx
    started = False
    for i in range(start_idx, min(len(lines), start_idx + 150)):
        for ch in lines[i]:
            if ch == "{":
                brace_count += 1
                started = True
            elif ch == "}":
                brace_count -= 1
        end_idx = i
        if started and brace_count <= 0:
            break

    context_start = max(0, start_idx - 3)
    return "\n".join(lines[context_start:end_idx + 1])



def _cmd_structure_symbol(args: argparse.Namespace) -> Any:
    symbol = args.symbol
    limit = max(args.limit, 1)
    include_source = getattr(args, "source", False)

    if include_source:
        params: dict[str, str] = {
            "service": args.service,
            "symbol": symbol,
            "limit": str(limit),
        }
        if args.path:
            params["pathPattern"] = args.path
        data = fetch_json(build_url(args.server, "/api/structure/symbol-source", params))
        return {"symbol": symbol, "matches": data.get("results", [])}

    params: dict[str, str] = {
        "service": args.service,
        "symbol": symbol,
        "limit": str(limit),
    }
    if args.path:
        params["pathPattern"] = args.path
    data = fetch_json(build_url(args.server, "/api/structure/search", params))
    results = data.get("results", [])
    matches = [
        {
            "name": r.get("name", ""),
            "kind": r.get("kind", ""),
            "filePath": r.get("filePath", ""),
            "lineRange": r.get("lineRange"),
            "match": r.get("match", {}),
        }
        for r in results
    ]
    return {"symbol": symbol, "matches": matches}


def _kg_file_toc(args: argparse.Namespace, graph_data: dict[str, Any]) -> list[dict[str, Any]]:
    file_key = args.file.lower()
    symbols = [
        {"name": n["name"], "type": n.get("type", ""), "lineRange": n.get("lineRange"), "summary": n.get("summary", "")[:80]}
        for n in graph_data.get("nodes", [])
        if file_key in n.get("filePath", "").lower() or file_key in n.get("id", "").lower()
    ]
    symbols.sort(key=lambda s: (s.get("lineRange") or [9999])[0])
    return symbols



#!/usr/bin/env python3
"""HTTP CLI for querying Understand-Anything API Server (stdlib only)."""
import argparse
import json
import os
import sys
from typing import Any
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode

DEFAULT_SERVER = "http://localhost:3001"
DEFAULT_TIMEOUT = 30


class ServerUnavailableError(RuntimeError):
    pass


def fetch_json(url: str, timeout: int = DEFAULT_TIMEOUT) -> Any:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body}
        suggestions = err.get("suggestions", [])
        msg = f"HTTP {e.code}: {err.get('error', body)}"
        if suggestions:
            msg += "\n\nDid you mean:\n" + "\n".join(
                f"  - {s.get('name', s.get('id', '?'))} ({s.get('type', '?')})" for s in suggestions[:8]
            )
        raise RuntimeError(msg) from e
    except URLError as e:
        raise ServerUnavailableError(
            f"API Server unavailable at {url.split('?')[0]}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e


def build_url(server: str, path: str, params: dict[str, str] | None = None) -> str:
    base = server.rstrip("/")
    encoded_path = quote(path, safe="/:@")
    if params:
        return f"{base}{encoded_path}?{urlencode(params)}"
    return f"{base}{encoded_path}"


def format_output(data: Any, fmt: str) -> str:
    if fmt == "md":
        return _format_markdown(data)
    return json.dumps(data, ensure_ascii=False, indent=2)


def _format_markdown(data: Any) -> str:
    if isinstance(data, dict) and "domains" in data:
        lines = ["# Business Domains", ""]
        for d in data["domains"]:
            lines.append(f"## {d.get('name', d.get('id', '?'))}")
            lines.append(d.get("summary", ""))
            lines.append("")
        return "\n".join(lines)
    if isinstance(data, dict) and "results" in data:
        lines = ["# Search Results", ""]
        for r in data["results"]:
            lines.append(f"- **{r.get('name', r.get('id'))}**: {r.get('match', r.get('summary', ''))}")
        return "\n".join(lines)
    return f"```json\n{json.dumps(data, ensure_ascii=False, indent=2)}\n```"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query Understand-Anything API")
    parser.add_argument("--server", default=os.environ.get("UNDERSTAND_SERVER", DEFAULT_SERVER))
    parser.add_argument("--format", choices=["json", "md"], default="json")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    kg = sub.add_parser("kg", help="Knowledge graph queries")
    kg.add_argument("--service")
    kg.add_argument("--type")
    kg.add_argument("--node")
    kg.add_argument("--search")
    kg.add_argument("--file")
    kg.add_argument("--start", type=int, help="Start line (for --file)")
    kg.add_argument("--end", type=int, help="End line (for --file)")
    kg.add_argument("--neighbors")
    kg.add_argument("--edge-type")
    kg.add_argument("--direction", choices=["inbound", "outbound", "both"], default="both")
    kg.add_argument("--depth", type=int, default=1)
    kg.add_argument("--edges", action="store_true")
    kg.add_argument("--source")
    kg.add_argument("--target")
    kg.add_argument("--layers", action="store_true")
    kg.add_argument("--tour", action="store_true")
    kg.add_argument("--toc", action="store_true", help="Return file's method index (name+type+lineRange) instead of source")
    kg.add_argument("--verbose", action="store_true")

    domain = sub.add_parser("domain", help="Domain graph queries")
    domain.add_argument("--service")
    domain.add_argument("--domain")
    domain.add_argument("--search")
    domain.add_argument("--neighbors")
    domain.add_argument("--edge-type")
    domain.add_argument("--flows", action="store_true")
    domain.add_argument("--flow")
    domain.add_argument("--steps", action="store_true")

    wiki = sub.add_parser("wiki", help="Wiki queries")
    wiki.add_argument("--service")
    wiki.add_argument("--type")
    wiki.add_argument("--domain")
    wiki.add_argument("--search")
    wiki.add_argument("--overview", action="store_true")
    wiki.add_argument("--architecture", action="store_true")
    wiki.add_argument("--cross-domain")
    wiki.add_argument("--endpoint-index", action="store_true")
    wiki.add_argument("--protocol")
    wiki.add_argument("--flow")
    wiki.add_argument("--related", action="store_true")

    biz = sub.add_parser("business", help="Business landscape queries")
    biz.add_argument("--domain")
    biz.add_argument("--type")
    biz.add_argument("--facet")
    biz.add_argument("--list", action="store_true")
    biz.add_argument("--search")
    biz.add_argument("--links", action="store_true")
    biz.add_argument("--panorama", action="store_true")
    biz.add_argument("--meta", action="store_true")

    svc = sub.add_parser("services", help="Service discovery and readiness")
    svc.add_argument("--list", action="store_true")
    svc.add_argument("--name")
    svc.add_argument("--has")

    meta_cmd = sub.add_parser("meta", help="Cross-layer freshness check")
    meta_cmd.add_argument("--stale", action="store_true")

    trace = sub.add_parser("trace", help="Aggregate: search→neighbors→source in one call")
    trace.add_argument("--service", required=True)
    trace.add_argument("--query", required=True, help="Search keywords (comma-separated for multi-keyword: '挚友,ClosedFriend')")
    trace.add_argument("--type", help="Filter matched nodes by type (class, function, file...)")
    trace.add_argument("--limit", type=int, default=5, help="Max matched nodes to return")
    trace.add_argument("--source", action="store_true", help="Include source code of top match")
    trace.add_argument("--symbol", help="Extract specific method/class from source (use with --source)")
    trace.add_argument("--business", action="store_true", help="Include business context search")

    return parser.parse_args(argv)


# --- Subcommand handlers ---

def cmd_kg(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("kg requires --service")
    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "kg", "node": args.neighbors, "direction": args.direction, "depth": str(args.depth)}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return fetch_json(build_url(args.server, "/api/graph-query/neighbors", params))
    if args.edges:
        params = {"service": args.service, "graph": "kg"}
        if args.type:
            params["type"] = args.type
        if args.source:
            params["source"] = args.source
        if args.target:
            params["target"] = args.target
        return fetch_json(build_url(args.server, "/api/graph-query/edges", params))
    if args.layers:
        return fetch_json(build_url(args.server, "/api/graph-query/layers", {"service": args.service}))
    if args.tour:
        return fetch_json(build_url(args.server, "/api/graph-query/tour", {"service": args.service}))
    if args.file:
        if args.toc:
            graph_params: dict[str, str] = {"service": args.service, "file": "knowledge-graph.json"}
            graph_data = fetch_json(build_url(args.server, "/api/graph", graph_params))
            file_key = args.file.lower()
            symbols = [
                {"name": n["name"], "type": n.get("type", ""), "lineRange": n.get("lineRange"), "summary": n.get("summary", "")[:80]}
                for n in graph_data.get("nodes", [])
                if file_key in n.get("filePath", "").lower() or file_key in n.get("id", "").lower()
            ]
            symbols.sort(key=lambda s: (s.get("lineRange") or [9999])[0])
            return {"file": args.file, "totalSymbols": len(symbols), "symbols": symbols}
        params: dict[str, str] = {"file": args.file, "service": args.service, "mode": "graph"}
        if args.start:
            params["start"] = str(args.start)
        if args.end:
            params["end"] = str(args.end)
        return fetch_json(build_url(args.server, "/api/source", params))
    if args.search:
        search_results = _search_api(args.server, args.search, service=args.service, scope="kg", limit=30)
        if args.type and args.type != "node":
            search_results = [n for n in search_results if n.get("type") == args.type]
        return {"nodes": search_results, "edges": None}
    params = {"service": args.service, "file": "knowledge-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params))
    nodes = data.get("nodes", [])
    if args.node:
        exact = [n for n in nodes if n.get("name") == args.node]
        if exact:
            nodes = exact
        else:
            q = args.node.lower()
            nodes = [n for n in nodes if q in n.get("name", "").lower() or q in n.get("id", "").lower()]
    elif args.type and args.type != "node":
        nodes = [n for n in nodes if n.get("type") == args.type]
    return {"nodes": nodes, "edges": data.get("edges", []) if args.verbose else None}


def cmd_domain(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("domain requires --service")
    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "domain", "node": args.neighbors, "direction": "both"}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return fetch_json(build_url(args.server, "/api/graph-query/neighbors", params))
    params = {"service": args.service, "file": "domain-graph.json"}
    data = fetch_json(build_url(args.server, "/api/graph", params))
    if args.flows:
        nodes = [n for n in data.get("nodes", []) if n.get("type") == "flow"]
        return {"flows": nodes}
    if args.flow:
        flow_id = args.flow
        nodes = data.get("nodes", [])
        flow_node = next((n for n in nodes if n.get("id") == flow_id or n.get("name") == flow_id), None)
        if not flow_node:
            q = flow_id.lower()
            candidates = [n for n in nodes if n.get("type") == "flow" and q in n.get("name", "").lower()]
            if candidates:
                msg = f"Flow '{flow_id}' not found. Did you mean:\n" + "\n".join(f"  - {c['name']}" for c in candidates[:8])
                raise SystemExit(msg)
            raise SystemExit(f"Flow '{flow_id}' not found")
        if args.steps:
            edges = data.get("edges", [])
            step_edges = sorted(
                [e for e in edges if e.get("source") == flow_node["id"] and e.get("type") == "flow_step"],
                key=lambda e: e.get("weight", 0),
            )
            step_ids = [e["target"] for e in step_edges]
            steps = [n for n in nodes if n["id"] in step_ids]
            return {"flow": flow_node, "steps": steps}
        return {"flow": flow_node}
    if args.domain:
        nodes = [n for n in data.get("nodes", []) if args.domain in n.get("id", "") or args.domain in n.get("name", "")]
        return {"nodes": nodes}
    if args.search:
        q = args.search.lower()
        nodes = [n for n in data.get("nodes", []) if q in n.get("name", "").lower() or q in n.get("summary", "").lower()]
        return {"nodes": nodes}
    return data


def cmd_wiki(args: argparse.Namespace) -> Any:
    if args.overview:
        return fetch_json(build_url(args.server, "/api/wiki/overview", {}))
    if args.architecture:
        return fetch_json(build_url(args.server, "/api/wiki/architecture", {}))
    if args.cross_domain:
        slug = quote(args.cross_domain, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/domain/{slug}", {}))
    if args.endpoint_index:
        data = fetch_json(build_url(args.server, "/api/wiki/endpoints/index", {}))
        if args.protocol:
            by_proto = data.get("byProtocol", {})
            return {"protocol": args.protocol, "entries": by_proto.get(args.protocol, [])}
        return data
    if not args.service:
        raise SystemExit("wiki requires --service (or use --overview/--architecture/--cross-domain/--endpoint-index)")
    svc = quote(args.service, safe="")
    if args.flow:
        flow_id = quote(args.flow, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/flow/{flow_id}", {}))
    if args.related:
        if not args.domain:
            raise SystemExit("--related requires --domain")
        domain_id = quote(args.domain, safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/{domain_id}/related", {}))
    if args.search:
        return fetch_json(build_url(args.server, "/api/wiki/search", {"q": args.search, "limit": "20"}))
    if args.domain:
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/domain/{quote(args.domain, safe='')}", {}))
    if args.type == "endpoint":
        return fetch_json(build_url(args.server, f"/api/wiki/endpoints/{svc}", {}))
    return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}", {}))


def cmd_business(args: argparse.Namespace) -> Any:
    if args.meta:
        return fetch_json(build_url(args.server, "/api/business/meta", {}))
    if args.panorama:
        return fetch_json(build_url(args.server, "/api/business/panorama", {}))
    if args.links:
        params: dict[str, str] = {}
        if args.domain:
            params["domain"] = args.domain
        return fetch_json(build_url(args.server, "/api/business/cross-facet-links", params))
    if args.list:
        return fetch_json(build_url(args.server, "/api/business/domains", {}))
    if args.search:
        return fetch_json(build_url(args.server, "/api/business/search", {"q": args.search}))
    if args.domain:
        slug = args.domain.replace("domain:", "").replace(" ", "-").lower()
        data = fetch_json(build_url(args.server, f"/api/business/domains/{slug}", {}))
        if args.type == "interactions":
            return {"interactions": data.get("interactions", [])}
        if args.type == "rules":
            return {"businessRules": data.get("businessRules", [])}
        if args.facet:
            return {"facets": data.get("facets", {}).get(args.facet, {})}
        return data
    return fetch_json(build_url(args.server, "/api/business/overview", {}))


def cmd_services(args: argparse.Namespace) -> Any:
    params: dict[str, str] = {}
    if args.name:
        params["name"] = args.name
    if args.has:
        params["has"] = args.has
    return fetch_json(build_url(args.server, "/api/services", params))


def cmd_meta(args: argparse.Namespace) -> Any:
    data = fetch_json(build_url(args.server, "/api/meta", {}))
    if args.stale:
        return {"stale": data.get("freshness", {}).get("stale", [])}
    return data


def _score_node_relevance(node: dict[str, Any], query: str) -> float:
    """Score a node's relevance to the query. Higher = more relevant."""
    q = query.lower()
    name = node.get("name", "").lower()
    node_id = node.get("id", "").lower()
    score = 0.0
    if q == name:
        score += 15.0
    elif q in name:
        score += 5.0 + (len(q) / max(len(name), 1))
    if q in node_id:
        score += 2.0
    node_type = node.get("type", "")
    type_bonus = {"class": 3, "function": 2, "interface": 2.5, "module": 1.5, "endpoint": 2}.get(node_type, 0)
    score += type_bonus
    raw_name = node.get("name", "")
    if any(suffix in raw_name for suffix in ("ServiceImpl", "WebService", "Service", "Controller", "Manager", "Handler")):
        score += 4.0
    elif any(suffix in raw_name for suffix in ("Dto", "DTO", "Req", "Resp", "Po", "PO", "Vo", "VO")):
        score -= 1.5
    if node.get("filePath"):
        score += 1.0
    if node.get("lineRange"):
        score += 1.0
    return score


def _extract_code_keywords(flow_name: str) -> list[str]:
    """Extract PascalCase/camelCase keywords from a flow name like 'Bind Closed Friend' or 'bind-closed-friend'.
    Order: full pascal → individual long words → suffixes."""
    import re
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


def _search_api(server: str, query: str, service: str | None = None, scope: str = "kg", limit: int = 50) -> list[dict]:
    """Call the unified /api/search endpoint and return results."""
    params: dict[str, str] = {"q": query, "scope": scope, "limit": str(limit)}
    if service:
        params["service"] = service
    data = fetch_json(build_url(server, "/api/search", params))
    return data.get("results", [])


def cmd_trace(args: argparse.Namespace) -> Any:
    """Aggregate command: search → neighbors → source in one call."""
    if not args.service:
        raise SystemExit("trace requires --service")
    if not args.query:
        raise SystemExit("trace requires --query")

    keywords = [k.strip() for k in args.query.split(",") if k.strip()]
    result: dict[str, Any] = {"service": args.service, "query": args.query, "keywords": keywords}

    # Step 1: Search KG via server-side BM25 with ALL keywords
    seen_ids: dict[str, tuple[dict, float, str]] = {}  # id -> (node, best_score, best_keyword)
    for kw in keywords:
        kw_matched = _search_api(args.server, kw, service=args.service, scope="kg", limit=50)
        if args.type:
            kw_matched = [n for n in kw_matched if n.get("type") == args.type]
        for node in kw_matched:
            nid = node.get("id", "")
            score = _score_node_relevance(node, kw)
            if nid not in seen_ids or score > seen_ids[nid][1]:
                seen_ids[nid] = (node, score, kw)
    matched = [item[0] for item in seen_ids.values()]
    best_keyword = keywords[0] if keywords else args.query

    # Step 1b: Domain-flow fallback when multi-keyword search yields no results
    if not matched:
        try:
            combined_query = " ".join(keywords)
            flow_matches = _search_api(args.server, combined_query, service=args.service, scope="domain", limit=5)
            flow_matches = [n for n in flow_matches if n.get("type") == "flow"]
            if flow_matches:
                best_flow = flow_matches[0]
                code_keywords = _extract_code_keywords(best_flow.get("name", ""))
                best_kw, best_matched, best_top_score = "", [], 0.0
                for kw in code_keywords:
                    re_matched = _search_api(args.server, kw, service=args.service, scope="kg", limit=50)
                    if re_matched:
                        top_score = max(_score_node_relevance(n, kw) for n in re_matched[:10])
                        specificity = len(kw) / 10.0
                        adjusted = top_score * specificity
                        if adjusted > best_top_score:
                            best_kw, best_matched, best_top_score = kw, re_matched, adjusted
                if best_matched:
                    matched = best_matched
                    best_keyword = best_kw
                    result["discoveredVia"] = f"domain-flow:{best_flow.get('name', '')}"
                    result["discoveryKeyword"] = best_kw
        except RuntimeError:
            pass

    # Determine best scoring keyword for final ranking
    if not result.get("discoveryKeyword"):
        if len(keywords) > 1 and seen_ids:
            kw_top_scores: dict[str, float] = {}
            for _nid, (_, sc, kw) in seen_ids.items():
                if kw not in kw_top_scores or sc > kw_top_scores[kw]:
                    kw_top_scores[kw] = sc
            best_keyword = max(kw_top_scores, key=lambda k: kw_top_scores[k])
        else:
            best_keyword = keywords[0] if keywords else args.query

    score_query = result.get("discoveryKeyword", best_keyword)
    matched.sort(key=lambda n: _score_node_relevance(n, score_query), reverse=True)
    matched = matched[:args.limit]
    result["matchedNodes"] = [{"id": n["id"], "name": n["name"], "type": n.get("type", ""), "summary": n.get("summary", ""), "filePath": n.get("filePath", ""), "lineRange": n.get("lineRange"), "relevance": round(_score_node_relevance(n, score_query), 1)} for n in matched]

    # Empty result guidance
    if not matched:
        result["hint"] = (
            f"No KG nodes matched '{args.query}' in service '{args.service}'. "
            f"Try: (1) grep workspace for '{args.query}' directly, "
            f"(2) check if Flutter/client code is in a separate module not indexed in this service's KG, "
            f"(3) use 'business --search \"{args.query}\"' for domain-level context."
        )
        if args.business:
            try:
                biz_data = fetch_json(build_url(args.server, "/api/business/search", {"q": args.query}))
                result["businessContext"] = biz_data.get("results", [])[:5]
            except RuntimeError:
                result["businessContext"] = None
        return result

    # Step 2: Get neighbors for top match (most relevant node)
    top = matched[0]
    try:
        nbr_params: dict[str, str] = {"service": args.service, "graph": "kg", "node": top["id"], "direction": "both", "depth": "1"}
        nbr_data = fetch_json(build_url(args.server, "/api/graph-query/neighbors", nbr_params))
        result["neighbors"] = {
            "center": {"id": nbr_data["center"]["id"], "name": nbr_data["center"]["name"], "type": nbr_data["center"].get("type", "")},
            "totalEdges": nbr_data.get("totalEdges", 0),
            "neighbors": [{"direction": n["direction"], "name": n["node"]["name"], "type": n["node"]["type"], "edgeType": n["edge"]["type"]} for n in nbr_data.get("neighbors", [])[:20]],
        }
    except RuntimeError:
        result["neighbors"] = None

    # Step 3: Read source — use lineRange from KG for precision
    file_path = top.get("filePath")
    line_range = top.get("lineRange")
    if not file_path:
        if top.get("type") == "file":
            file_path = top.get("id", "").replace("file:", "", 1)
        else:
            node_id = top["id"]
            parts = node_id.split(":")
            if len(parts) >= 2:
                candidate = parts[1].split(":")[0] if ":" in parts[1] else parts[1]
                if "/" in candidate and "." in candidate.split("/")[-1]:
                    file_path = candidate

    if file_path and args.source:
        try:
            src_params: dict[str, str] = {"file": file_path, "service": args.service, "mode": "graph"}
            if line_range and isinstance(line_range, list) and len(line_range) == 2:
                start = max(1, line_range[0] - 3)
                end = line_range[1] + 2
                if end - start > 495:
                    end = start + 495
                src_params["start"] = str(start)
                src_params["end"] = str(end)
            elif args.symbol:
                pass  # will extract from content
            src_data = fetch_json(build_url(args.server, "/api/source", src_params))
            content = src_data.get("content", "")
            line_count = src_data.get("lineCount", 0)

            if args.symbol and not line_range:
                symbol_lines = _extract_symbol(content, args.symbol)
                if symbol_lines:
                    content = symbol_lines
            elif not line_range and line_count > 500:
                content = content[:8000] + f"\n\n... [truncated, {line_count} total lines. Use --start/--end for specific ranges]"
            result["source"] = {"file": file_path, "lineCount": line_count, "content": content}
            if line_range:
                result["source"]["lineRange"] = line_range
        except RuntimeError:
            result["source"] = None
    elif not args.source:
        result["source"] = "omitted (use --source to include)"

    # Step 4: Business context
    if args.business:
        try:
            biz_data = fetch_json(build_url(args.server, "/api/business/search", {"q": args.query}))
            result["businessContext"] = biz_data.get("results", [])[:5]
        except RuntimeError:
            result["businessContext"] = None

    return result


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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        handlers = {"kg": cmd_kg, "domain": cmd_domain, "wiki": cmd_wiki, "business": cmd_business, "services": cmd_services, "meta": cmd_meta, "trace": cmd_trace}
        data = handlers[args.command](args)
        print(format_output(data, args.format))
        return 0
    except ServerUnavailableError as e:
        print(str(e), file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

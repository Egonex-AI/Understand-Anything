"""Command handlers for all ua_query subcommands."""
from __future__ import annotations
import argparse
import json
import re
import sys
from typing import Any
from urllib.parse import quote as url_quote
from _utils import (
    build_url, format_output, _detect_server,
    ServerUnavailableError, _IMPL_SUFFIXES, _CONFIG_SUFFIXES,
    DEFAULT_SERVER, DEFAULT_TIMEOUT, _short_type_name,
)
import _helpers
from _helpers import (
    _search_api, _find_symbol_node, _cross_service_symbol_search,
    _auto_discover_service, _fetch_neighbors, _neighbor_entries,
    _fetch_wiki_domain, _fetch_domain_flows, _score_node_relevance,
    _extract_code_keywords, _effective_service, _nodes_for_file,
    _is_test_path, _extract_symbol, _kg_file_toc, _cmd_structure_symbol,
)

def _cmd_kg_file_summary(args: argparse.Namespace) -> Any:
    try:
        graph_data = _helpers.fetch_json(build_url(args.server, "/api/graph", {
            "service": args.service,
            "file": "knowledge-graph.json",
        }))
    except RuntimeError as e:
        raise RuntimeError(f"Failed to load knowledge graph: {e}") from e

    symbols = _kg_file_toc(args, graph_data)
    file_key = args.file.lower()
    file_nodes = [
        n for n in graph_data.get("nodes", [])
        if n.get("type") == "file"
        and (file_key in n.get("filePath", "").lower() or file_key in n.get("id", "").lower())
    ]
    file_symbols = [n for n in graph_data.get("nodes", []) if file_key in n.get("filePath", "").lower()]

    full_path = ""
    if file_nodes:
        full_path = file_nodes[0].get("filePath", "") or file_nodes[0].get("id", "").replace("file:", "", 1)
    elif file_symbols:
        full_path = file_symbols[0].get("filePath", "")

    center_node = file_nodes[0] if file_nodes else (file_symbols[0] if file_symbols else None)

    callers: list[dict[str, Any]] = []
    callees: list[dict[str, Any]] = []
    inbound = 0
    outbound = 0
    if center_node:
        try:
            nbr_data = _fetch_neighbors(args.server, args.service, center_node["id"], "both", 1)
            seen_callers: set[str] = set()
            seen_callees: set[str] = set()
            for n in nbr_data.get("neighbors", []):
                node = n.get("node") or {}
                edge = n.get("edge") or {}
                edge_type = edge.get("type", "")
                direction = n.get("direction", "")
                name = node.get("name", node.get("id", "?"))
                entry = {"name": name, "type": node.get("type", ""), "edgeType": edge_type}
                if direction == "inbound":
                    inbound += 1
                    if edge_type == "calls" and name not in seen_callers:
                        seen_callers.add(name)
                        callers.append(entry)
                elif direction == "outbound":
                    outbound += 1
                    if edge_type == "calls" and name not in seen_callees:
                        seen_callees.add(name)
                        callees.append(entry)
        except RuntimeError as e:
            sys.stderr.write(f"[ua_query] fetch_neighbors failed: {e}")

    imports: list[str] = []
    try:
        struct_data = _helpers.fetch_json(build_url(args.server, "/api/structure/file", {
            "service": args.service,
            "path": args.file,
        }))
        for imp in struct_data.get("imports", []):
            raw = imp.get("name", imp) if isinstance(imp, dict) else imp
            short = _short_type_name(str(raw))
            if short and short not in imports:
                imports.append(short)
    except RuntimeError as e:
        sys.stderr.write(f"[ua_query] structure/file fetch failed: {e}")

    return {
        "file": args.file,
        "fullPath": full_path,
        "totalSymbols": len(symbols),
        "symbols": [{"name": s["name"], "type": s["type"], "lineRange": s["lineRange"]} for s in symbols],
        "imports": imports,
        "callers": callers,
        "callees": callees,
        "blastRadius": {"inbound": inbound, "outbound": outbound},
    }


def cmd_kg(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("kg requires --service")
    if args.file and args.summary:
        return _cmd_kg_file_summary(args)
    if args.neighbors:
        params: dict[str, str] = {"service": args.service, "graph": "kg", "node": args.neighbors, "direction": args.direction, "depth": str(args.depth)}
        if args.edge_type:
            params["edgeType"] = args.edge_type
        return _helpers.fetch_json(build_url(args.server, "/api/graph-query/neighbors", params))
    if args.edges:
        params = {"service": args.service, "graph": "kg"}
        if args.type:
            params["type"] = args.type
        if args.source:
            params["source"] = args.source
        if args.target:
            params["target"] = args.target
        return _helpers.fetch_json(build_url(args.server, "/api/graph-query/edges", params))
    if args.layers:
        return _helpers.fetch_json(build_url(args.server, "/api/graph-query/layers", {"service": args.service}))
    if args.tour:
        return _helpers.fetch_json(build_url(args.server, "/api/graph-query/tour", {"service": args.service}))
    if args.file:
        if args.toc:
            graph_params: dict[str, str] = {"service": args.service, "file": "knowledge-graph.json"}
            graph_data = _helpers.fetch_json(build_url(args.server, "/api/graph", graph_params))
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
        return _helpers.fetch_json(build_url(args.server, "/api/source", params))
    if args.search:
        type_filter = args.type if args.type and args.type != "node" else None
        search_results = _search_api(args.server, args.search, service=args.service, scope="kg", limit=30, type=type_filter, tag=getattr(args, "tag", None), offset=getattr(args, "offset", 0))
        return {"nodes": search_results, "edges": None}
    params = {"service": args.service, "file": "knowledge-graph.json"}
    data = _helpers.fetch_json(build_url(args.server, "/api/graph", params))
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
        return _helpers.fetch_json(build_url(args.server, "/api/graph-query/neighbors", params))
    params = {"service": args.service, "file": "domain-graph.json"}
    data = _helpers.fetch_json(build_url(args.server, "/api/graph", params))
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
        return _helpers.fetch_json(build_url(args.server, "/api/wiki/overview", {}))
    if args.architecture:
        return _helpers.fetch_json(build_url(args.server, "/api/wiki/architecture", {}))
    if args.cross_domain:
        cross_domain = url_quote(args.cross_domain or "", safe="")
        return _helpers.fetch_json(build_url(args.server, f"/api/wiki/domain/{cross_domain}", {}))
    if args.endpoint_index:
        data = _helpers.fetch_json(build_url(args.server, "/api/wiki/endpoints/index", {}))
        if args.protocol:
            by_proto = data.get("byProtocol", {})
            return {"protocol": args.protocol, "entries": by_proto.get(args.protocol, [])}
        return data
    if not args.service:
        raise SystemExit("wiki requires --service (or use --overview/--architecture/--cross-domain/--endpoint-index)")
    svc = url_quote(args.service or "", safe="")
    if args.flow:
        flow = url_quote(args.flow or "", safe="")
        return _helpers.fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/flow/{flow}", {}))
    if args.related:
        if not args.domain:
            raise SystemExit("--related requires --domain")
        domain = url_quote(args.domain or "", safe="")
        return _helpers.fetch_json(build_url(args.server, f"/api/wiki/{domain}/related", {}))
    if args.search:
        return _search_api(args.server, args.search, scope="wiki", limit=20)
    if args.domain:
        domain = url_quote(args.domain or "", safe="")
        return _helpers.fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/domain/{domain}", {}))
    if args.type == "endpoint":
        return _helpers.fetch_json(build_url(args.server, f"/api/wiki/endpoints/{svc}", {}))
    return _helpers.fetch_json(build_url(args.server, f"/api/wiki/service/{svc}", {}))


def cmd_business(args: argparse.Namespace) -> Any:
    if args.meta:
        return _helpers.fetch_json(build_url(args.server, "/api/business/meta", {}))
    if args.panorama:
        return _helpers.fetch_json(build_url(args.server, "/api/business/panorama", {}))
    if args.features:
        return _helpers.fetch_json(build_url(args.server, "/api/business/features", {}))
    if args.links:
        params: dict[str, str] = {}
        if args.domain:
            params["domain"] = args.domain
        return _helpers.fetch_json(build_url(args.server, "/api/business/cross-facet-links", params))
    if args.list:
        return _helpers.fetch_json(build_url(args.server, "/api/business/domains", {}))
    if args.search:
        return {"results": _search_api(args.server, args.search, scope="business")}
    if args.domain and args.platform:
        encoded_domain = url_quote(args.domain, safe="")
        params: dict[str, str] = {"platform": args.platform}
        if args.flow:
            params["flow"] = args.flow
        return _helpers.fetch_json(build_url(
            args.server,
            f"/api/business/domains/{encoded_domain}",
            params,
        ))
    if args.domain:
        slug = args.domain.replace("domain:", "").replace(" ", "-").lower()
        slug = url_quote(slug, safe="")
        data = _helpers.fetch_json(build_url(args.server, f"/api/business/domains/{slug}", {}))
        if args.type == "interactions":
            return {"interactions": data.get("interactions", [])}
        if args.type == "rules":
            return {"businessRules": data.get("businessRules", [])}
        if args.facet:
            return {"facets": data.get("facets", {}).get(args.facet, {})}
        return data
    overview = _helpers.fetch_json(build_url(args.server, "/api/business/overview", {}))
    try:
        features_data = _helpers.fetch_json(build_url(args.server, "/api/business/features", {}))
        overview["features"] = {
            "featureCount": len(features_data.get("features", [])),
            "stats": features_data.get("stats", {}),
        }
    except RuntimeError:
        pass
    return overview


def cmd_services(args: argparse.Namespace) -> Any:
    params: dict[str, str] = {}
    if args.name:
        params["name"] = args.name
    if args.has:
        params["has"] = args.has
    return _helpers.fetch_json(build_url(args.server, "/api/services", params))


def cmd_meta(args: argparse.Namespace) -> Any:
    data = _helpers.fetch_json(build_url(args.server, "/api/layers/freshness", {}))
    if args.stale:
        return {"stale": data.get("freshness", {}).get("stale", [])}
    return data



def cmd_trace(args: argparse.Namespace) -> Any:
    """Aggregate command: search → neighbors → source in one call."""
    if not args.service and not getattr(args, "auto_discover", False):
        raise SystemExit("trace requires --service (or use --auto-discover)")
    if not args.query:
        raise SystemExit("trace requires --query")

    keywords = [k.strip() for k in args.query.split(",") if k.strip()]

    # Auto-discover service if needed
    service = args.service
    auto_biz: list[dict] = []
    if not service and getattr(args, "auto_discover", False):
        service, auto_biz = _auto_discover_service(args.server, args.query)
        if not service:
            return {"error": f"Could not auto-discover service for '{args.query}'. Use --service explicitly.", "businessSearch": auto_biz}

    result: dict[str, Any] = {"service": service, "query": args.query, "keywords": keywords}
    if auto_biz:
        result["autoDiscovered"] = True
        result["businessSearchHits"] = len(auto_biz)

    # Step 1: Search KG — try batch first, fallback to per-keyword on server error
    seen_ids: dict[str, tuple[dict, float, str]] = {}
    best_keyword = keywords[0] if keywords else args.query

    batch_query = " ".join(keywords[:4])
    try:
        batch_matched = _search_api(args.server, batch_query, service=service, scope="kg", limit=50, fusion=args.fusion, type=args.type)
        for node in batch_matched:
            nid = node.get("id", "")
            score = _score_node_relevance(node, best_keyword)
            if nid not in seen_ids or score > seen_ids[nid][1]:
                seen_ids[nid] = (node, score, best_keyword)
    except RuntimeError:
        # Batch query failed (e.g. server 500 on certain char combos) — fallback per keyword
        for kw in keywords[:3]:
            try:
                kw_matched = _search_api(args.server, kw, service=service, scope="kg", limit=50, fusion=args.fusion, type=args.type)
                for node in kw_matched:
                    nid = node.get("id", "")
                    score = _score_node_relevance(node, kw)
                    if nid not in seen_ids or score > seen_ids[nid][1]:
                        seen_ids[nid] = (node, score, kw)
                if seen_ids:
                    best_keyword = kw
                    break
            except RuntimeError:
                continue

    # Supplemental search with best ASCII keyword for broader coverage
    eng_kws = [k for k in keywords if k.isascii() and len(k) > 3]
    if eng_kws and eng_kws[0] != batch_query and not seen_ids:
        try:
            sup = _search_api(args.server, eng_kws[0], service=service, scope="kg", limit=50, fusion=args.fusion, type=args.type)
            for node in sup:
                nid = node.get("id", "")
                score = _score_node_relevance(node, eng_kws[0])
                if nid not in seen_ids or score > seen_ids[nid][1]:
                    seen_ids[nid] = (node, score, eng_kws[0])
            if seen_ids:
                best_keyword = eng_kws[0]
        except RuntimeError:
            pass
    matched = [item[0] for item in seen_ids.values()]

    # Step 1b: Domain-flow fallback when multi-keyword search yields no results
    if not matched:
        try:
            combined_query = " ".join(keywords)
            flow_matches = _search_api(args.server, combined_query, service=service, scope="domain", limit=5)
            flow_matches = [n for n in flow_matches if n.get("type") == "flow"]
            if flow_matches:
                best_flow = flow_matches[0]
                code_keywords = _extract_code_keywords(best_flow.get("name", ""))
                best_kw, best_matched, best_top_score = "", [], 0.0
                for kw in code_keywords:
                    re_matched = _search_api(args.server, kw, service=service, scope="kg", limit=50, fusion=args.fusion)
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
    result["matchedNodes"] = [
        {
            "id": n.get("id", ""),
            "name": n.get("name", ""),
            "type": n.get("type", ""),
            "summary": n.get("summary", ""),
            "filePath": n.get("filePath", ""),
            "lineRange": n.get("lineRange"),
            "relevance": round(_score_node_relevance(n, score_query), 1),
        }
        for n in matched
    ]

    for node_entry in result["matchedNodes"][1:3]:
        try:
            nbr_params = {"service": service, "graph": "kg", "node": node_entry["id"], "direction": "both", "depth": "1"}
            nbr = _helpers.fetch_json(build_url(args.server, "/api/graph-query/neighbors", nbr_params))
            inbound = sum(1 for n in nbr.get("neighbors", []) if n.get("direction") == "inbound")
            outbound = sum(1 for n in nbr.get("neighbors", []) if n.get("direction") == "outbound")
            node_entry["blastRadius"] = {"inbound": inbound, "outbound": outbound, "total": inbound + outbound}
        except RuntimeError:
            pass

    # Empty result — cross-service fallback with auto-trace
    if not matched:
        cross_svc_fallback = None
        class_keywords = [k for k in keywords if k[0:1].isupper() and len(k) > 5]
        if class_keywords:
            for ck in class_keywords[:2]:
                found = _cross_service_symbol_search(args.server, service, ck, exact_only=False)
                if found and ck.lower() in found["node"].get("name", "").lower():
                    cross_svc_fallback = {"service": found["service"], "matchedClass": found["node"].get("name"), "keyword": ck}
                    break

        if cross_svc_fallback:
            target_svc = cross_svc_fallback["service"]
            result["hint"] = (
                f"'{args.query}' 未在 '{service}' 中找到，"
                f"在 '{target_svc}' 中发现 '{cross_svc_fallback['matchedClass']}'，正在自动追踪..."
            )
            result["crossServiceSuggestion"] = cross_svc_fallback

            # Auto-trace in the target service
            try:
                follow_args = argparse.Namespace(
                    server=args.server, service=target_svc,
                    query=cross_svc_fallback["keyword"],
                    limit=args.limit, business=False,
                    wiki=getattr(args, "wiki", False),
                    domain_flows=getattr(args, "domain_flows", False),
                    auto_discover=False,
                    fusion=getattr(args, "fusion", "rrf"),
                    format=getattr(args, "format", "json"),
                    type=getattr(args, "type", None),
                    source=getattr(args, "source", False),
                    grouped=getattr(args, "grouped", False),
                    symbol=getattr(args, "symbol", None),
                )
                follow_result = cmd_trace(follow_args)
                result["crossServiceTrace"] = {
                    "targetService": target_svc,
                    "traceResult": follow_result,
                }
            except (RuntimeError, SystemExit) as e:
                sys.stderr.write(f"[ua_query] cross-service trace failed: {e}")
        else:
            result["hint"] = (
                f"No KG nodes matched '{args.query}' in service '{service}'. "
                f"Try: (1) grep workspace for '{args.query}' directly, "
                f"(2) check if Flutter/client code is in a separate module not indexed in this service's KG, "
                f"(3) use 'business --search \"{args.query}\"' for domain-level context."
            )
        if args.business:
            try:
                biz_results = _search_api(args.server, args.query, scope="business", limit=5)
                result["businessContext"] = biz_results[:5]
            except RuntimeError:
                result["businessContext"] = None
        return result

    # Step 2: Get neighbors for top match (most relevant node)
    top = matched[0]
    nbr_data = None
    try:
        nbr_params: dict[str, str] = {"service": service, "graph": "kg", "node": top["id"], "direction": "both", "depth": "1"}
        nbr_data = _helpers.fetch_json(build_url(args.server, "/api/graph-query/neighbors", nbr_params))
        center = nbr_data.get("center") or {}
        result["neighbors"] = {
            "center": {"id": center.get("id", ""), "name": center.get("name", ""), "type": center.get("type", "")},
            "totalEdges": nbr_data.get("totalEdges", 0),
            "neighbors": [
                {
                    "direction": n.get("direction", ""),
                    "name": (n.get("node") or {}).get("name", n.get("node", {}).get("id", "?")),
                    "type": (n.get("node") or {}).get("type", ""),
                    "edgeType": (n.get("edge") or {}).get("type", ""),
                }
                for n in nbr_data.get("neighbors", [])[:20]
            ],
        }
    except RuntimeError:
        result["neighbors"] = None

    if result.get("matchedNodes") and nbr_data:
        inbound = sum(1 for n in nbr_data.get("neighbors", []) if n.get("direction") == "inbound")
        outbound = sum(1 for n in nbr_data.get("neighbors", []) if n.get("direction") == "outbound")
        result["matchedNodes"][0]["blastRadius"] = {"inbound": inbound, "outbound": outbound, "total": inbound + outbound}

    if getattr(args, "grouped", False) and matched and args.source:
        matched_ids = {n.get("id") for n in matched}
        by_file: dict[str, list[dict[str, Any]]] = {}
        for node in matched:
            fp = node.get("filePath")
            if not fp:
                continue
            by_file.setdefault(fp, []).append(node)

        source_by_file: dict[str, dict[str, Any]] = {}
        for fp, file_nodes in by_file.items():
            symbols = [
                {
                    "id": n.get("id", ""),
                    "name": n.get("name", ""),
                    "type": n.get("type", ""),
                    "lineRange": n.get("lineRange"),
                }
                for n in file_nodes
            ]
            starts: list[int] = []
            ends: list[int] = []
            for n in file_nodes:
                lr = n.get("lineRange")
                if lr and isinstance(lr, list) and len(lr) == 2:
                    starts.append(lr[0])
                    ends.append(lr[1])
            src_params: dict[str, str] = {"file": fp, "service": service, "mode": "graph"}
            file_line_range: list[int] | None = None
            if starts and ends:
                start = max(1, min(starts) - 3)
                end = max(ends) + 2
                if end - start > 495:
                    end = start + 495
                src_params["start"] = str(start)
                src_params["end"] = str(end)
                file_line_range = [start, end]
            try:
                src_data = _helpers.fetch_json(build_url(args.server, "/api/source", src_params))
                entry: dict[str, Any] = {
                    "symbols": symbols,
                    "source": src_data.get("content", ""),
                    "lineCount": src_data.get("lineCount", 0),
                }
                if file_line_range:
                    entry["lineRange"] = file_line_range
                source_by_file[fp] = entry
            except RuntimeError:
                source_by_file[fp] = {"symbols": symbols, "source": None, "error": "failed to read source"}

        result["sourceByFile"] = source_by_file

        relationship_map: list[dict[str, Any]] = []
        if nbr_data:
            for n in nbr_data.get("neighbors", []):
                node = n.get("node") or {}
                nid = node.get("id", "")
                if nid not in matched_ids or nid == top.get("id"):
                    continue
                relationship_map.append({
                    "from": top.get("id", ""),
                    "fromName": top.get("name", ""),
                    "to": nid,
                    "toName": node.get("name", node.get("id", "?")),
                    "direction": n.get("direction", ""),
                    "edgeType": (n.get("edge") or {}).get("type", ""),
                })
        result["relationshipMap"] = relationship_map

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

    if file_path and args.source and not getattr(args, "grouped", False):
        try:
            src_params: dict[str, str] = {"file": file_path, "service": service, "mode": "graph"}
            if line_range and isinstance(line_range, list) and len(line_range) == 2:
                start = max(1, line_range[0] - 3)
                end = line_range[1] + 2
                if end - start > 495:
                    end = start + 495
                src_params["start"] = str(start)
                src_params["end"] = str(end)
            elif args.symbol:
                pass  # will extract from content
            src_data = _helpers.fetch_json(build_url(args.server, "/api/source", src_params))
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

    # Step 4: Business context — single batch search
    if args.business:
        try:
            if auto_biz:
                result["businessContext"] = auto_biz[:5]
            else:
                biz_query = " ".join(keywords[:3]) if keywords else args.query
                try:
                    biz_hits = _search_api(args.server, biz_query, scope="business", limit=5)
                except RuntimeError:
                    biz_hits = []
                result["businessContext"] = biz_hits[:5]
        except RuntimeError:
            result["businessContext"] = None

    # Step 5: Wiki domain detail
    if getattr(args, "wiki", False):
        wiki_data = _fetch_wiki_domain(args.server, service, args.query)
        if wiki_data:
            result["wikiDomain"] = wiki_data

    # Step 6: Domain flows with steps
    if getattr(args, "domain_flows", False):
        flow_data = _fetch_domain_flows(args.server, service, args.query)
        if flow_data:
            result["domainFlows"] = flow_data

    # Step 7: Source reads — return actual source code for top matches so agent can reason about it
    if args.source and matched:
        sources = result.get("source")
        existing_file = sources.get("file") if isinstance(sources, dict) else None
        verify_targets = [n for n in matched[:3] if n.get("filePath") and n.get("filePath") != existing_file]
        source_reads = []
        for node in verify_targets:
            fp = node.get("filePath")
            lr = node.get("lineRange")
            if not fp:
                continue
            try:
                vp: dict[str, str] = {"file": fp, "service": service, "mode": "graph"}
                if lr and isinstance(lr, list) and len(lr) == 2:
                    vp["start"] = str(max(1, lr[0] - 5))
                    vp["end"] = str(min(lr[1] + 5, lr[0] + 300))
                else:
                    vp["start"] = "1"
                    vp["end"] = "150"
                src = _helpers.fetch_json(build_url(args.server, "/api/source", vp))
                source_reads.append({
                    "node": node.get("name", ""),
                    "type": node.get("type", ""),
                    "file": fp,
                    "lineRange": lr,
                    "lineCount": src.get("lineCount", 0),
                    "content": src.get("content", ""),
                })
            except RuntimeError:
                continue
        if source_reads:
            result["sourceReads"] = source_reads

    # Cross-service RPC detection: always run when neighbors exist (cheap metadata lookup)
    if result.get("neighbors"):
        _RPC_PATTERNS = ("MoaService", "MoaWebService", "FeignClient", "Feign", "GrpcService", "RpcService")
        rpc_outbound = [
            n for n in result["neighbors"].get("neighbors", [])
            if n.get("direction") == "outbound"
            and (
                n.get("edgeType") in ("consumes_rpc",)
                or (n.get("edgeType") == "injects" and any(p in n.get("name", "") for p in _RPC_PATTERNS))
            )
        ]
        if rpc_outbound:
            rpc_names = [n.get("name", "") for n in rpc_outbound if n.get("name")]
            if rpc_names:
                rpc_details: list[dict[str, str]] = []
                for rpc_name in rpc_names[:5]:
                    impl_name = rpc_name + "Impl" if not rpc_name.endswith("Impl") else rpc_name
                    found = _cross_service_symbol_search(args.server, service, impl_name, exact_only=False)
                    if not found:
                        found = _cross_service_symbol_search(args.server, service, rpc_name, exact_only=False)
                    if found:
                        rpc_details.append({"interface": rpc_name, "implementedIn": found["service"], "implClass": found["node"].get("name", "")})
                    else:
                        rpc_details.append({"interface": rpc_name, "implementedIn": "unknown", "implClass": ""})

                result["crossServiceRpcHint"] = {
                    "message": (
                        f"当前类注入了远程 RPC 接口: {', '.join(rpc_names[:5])}。"
                    ),
                    "rpcInterfaces": rpc_details,
                }

    return result


def _detect_and_follow_cross_service_rpc(
    server: str, current_service: str, query: str, trace_result: dict
) -> dict | None:
    """Detect outbound RPC calls in trace neighbors and follow to the target service.

    When auto-discovery lands on a service that only *consumes* an RPC interface
    (e.g., a data reporter), this function identifies the provider service and
    performs a secondary trace there to surface the actual implementation.
    """
    neighbors = trace_result.get("neighbors")
    if not neighbors:
        return None

    rpc_edges = [
        n for n in neighbors.get("neighbors", [])
        if n.get("edgeType") in ("consumes_rpc", "provides_rpc")
        and n.get("direction") == "outbound"
    ]
    if not rpc_edges:
        return None

    rpc_interface_names: list[str] = []
    for edge in rpc_edges:
        name = edge.get("name", "")
        if name:
            rpc_interface_names.append(name)

    if not rpc_interface_names:
        return None

    # Search for provider services via cross-service KG lookup
    target_service: str | None = None
    target_interface: str = rpc_interface_names[0]

    try:
        svc_list = _helpers.fetch_json(build_url(server, "/api/services", {}))
        for svc in svc_list.get("services", []):
            svc_name = svc.get("name", "")
            if svc_name == current_service:
                continue
            layers = svc.get("dataLayers", {})
            if not (layers.get("wiki") or layers.get("kg")):
                continue
            try:
                hits = _search_api(server, target_interface, service=svc_name, scope="kg", limit=5)
                for h in hits:
                    node_name = h.get("name", "")
                    node_summary = h.get("summary", "")
                    if (target_interface.lower() in node_name.lower()
                            and ("impl" in node_name.lower()
                                 or "provider" in node_summary.lower()
                                 or h.get("type") in ("class", "service"))):
                        target_service = svc_name
                        break
                if target_service:
                    break
            except RuntimeError:
                continue
    except RuntimeError:
        pass

    if not target_service:
        return {
            "hint": (
                f"检测到当前服务 '{current_service}' 通过 RPC 调用了外部接口: "
                f"{', '.join(rpc_interface_names[:3])}。"
                f"该接口的实现可能在其他服务中，建议使用 --service 指定目标服务追踪。"
            ),
            "rpcInterfaces": rpc_interface_names[:5],
            "targetService": None,
        }

    # Follow: run trace in target service
    try:
        rpc_keywords = [target_interface]
        parts = [p.strip() for p in query.split(",") if p.strip()]
        rpc_keywords.extend(parts[:2])
        rpc_query = ",".join(rpc_keywords)

        class _NS:
            pass
        follow_args = _NS()
        follow_args.server = server
        follow_args.service = target_service
        follow_args.query = rpc_query
        follow_args.type = None
        follow_args.limit = 5
        follow_args.source = True
        follow_args.symbol = None
        follow_args.business = False
        follow_args.wiki = True
        follow_args.domain_flows = True
        follow_args.auto_discover = False
        follow_args.fusion = "rrf"
        follow_args.format = "json"
        follow_args.grouped = False

        follow_result = cmd_trace(follow_args)

        return {
            "hint": (
                f"当前服务 '{current_service}' 仅消费 RPC 接口 '{target_interface}'，"
                f"实际实现位于 '{target_service}'。以下为目标服务的追踪结果。"
            ),
            "rpcInterfaces": rpc_interface_names[:5],
            "targetService": target_service,
            "targetTrace": {
                "matchedNodes": follow_result.get("matchedNodes", []),
                "source": follow_result.get("source"),
                "sourceReads": follow_result.get("sourceReads"),
                "wikiDomain": follow_result.get("wikiDomain"),
                "domainFlows": follow_result.get("domainFlows"),
            },
        }
    except (RuntimeError, SystemExit):
        return {
            "hint": (
                f"检测到 '{current_service}' 消费 RPC 接口 '{target_interface}'，"
                f"实现服务为 '{target_service}'，但追踪失败。建议手动执行: "
                f"python ua_query.py trace --service {target_service} --query \"{target_interface}\" --source"
            ),
            "rpcInterfaces": rpc_interface_names[:5],
            "targetService": target_service,
        }


def cmd_ask(args: argparse.Namespace) -> Any:
    """Answer a business question end-to-end: auto-discover → trace → wiki → domain → source-verify."""
    query = args.query
    depth = getattr(args, "depth", "standard")

    result: dict[str, Any] = {"question": query, "depth": depth}

    # Step 1: Auto-discover service (or use provided)
    service = args.service
    biz_results: list[dict] = []
    if not service:
        service, biz_results = _auto_discover_service(args.server, query)
    if not service:
        result["error"] = f"Could not determine which service contains '{query}'. Provide --service."
        result["businessSearch"] = biz_results
        return result

    result["service"] = service
    result["autoDiscovered"] = not args.service

    # Step 2: Business context
    if not biz_results:
        try:
            biz_parts = [p.strip() for p in query.split(",") if p.strip() and len(p.strip()) <= 20]
            biz_q = " ".join(biz_parts[:3]) if biz_parts else query.split(",")[0][:20]
            biz_results = _search_api(args.server, biz_q, scope="business", limit=5)
        except RuntimeError:
            pass
    result["businessContext"] = biz_results[:5] if biz_results else []

    if depth == "quick":
        return result

    # Step 3: Trace (KG search + neighbors + source)
    class _NS:
        pass
    trace_args = _NS()
    trace_args.server = args.server
    trace_args.service = service
    trace_args.query = query
    trace_args.type = None
    trace_args.limit = getattr(args, "limit", 5)
    trace_args.source = depth == "full"
    trace_args.symbol = None
    trace_args.business = False
    trace_args.wiki = True
    trace_args.domain_flows = depth == "full"
    trace_args.auto_discover = False
    trace_args.fusion = getattr(args, "fusion", "rrf")
    trace_args.format = getattr(args, "format", "json")

    trace_result = cmd_trace(trace_args)

    result["matchedNodes"] = trace_result.get("matchedNodes", [])
    result["neighbors"] = trace_result.get("neighbors")
    if trace_result.get("wikiDomain"):
        result["wikiDomain"] = trace_result["wikiDomain"]
    if trace_result.get("domainFlows"):
        result["domainFlows"] = trace_result["domainFlows"]
    if trace_result.get("source"):
        result["source"] = trace_result["source"]
    if trace_result.get("sourceReads"):
        result["sourceReads"] = trace_result["sourceReads"]
    if trace_result.get("discoveredVia"):
        result["discoveredVia"] = trace_result["discoveredVia"]

    # Step 4: Cross-service RPC follow (depth=full only)
    if depth == "full":
        cross_svc = _detect_and_follow_cross_service_rpc(
            args.server, service, query, trace_result
        )
        if cross_svc:
            result["crossServiceTrace"] = cross_svc

    return result


def cmd_impact(args: argparse.Namespace) -> Any:
    center = _find_symbol_node(args.server, args.service, args.symbol)
    center_id = center["id"]
    effective_service = _effective_service(center, args.service)
    max_depth = min(max(args.depth, 1), 10)
    direction = args.direction

    params: dict[str, str] = {
        "service": effective_service,
        "graph": "kg",
        "node": center_id,
        "direction": direction,
        "depth": str(max_depth),
    }
    if args.edge_type:
        params["edgeType"] = args.edge_type
    data = _helpers.fetch_json(build_url(args.server, "/api/graph-query/impact", params))
    affected = [
        {
            "id": n.get("id", ""),
            "name": n.get("name", ""),
            "type": n.get("type", ""),
            "distance": n.get("depth", 0),
            "path": [center.get("name", center_id), n.get("name", "")],
        }
        for n in data.get("impacted", [])
    ]
    result: dict[str, Any] = {
        "service": effective_service,
        "center": {"id": center_id, "name": center.get("name", ""), "type": center.get("type", "")},
        "depth": max_depth,
        "direction": direction,
        "impactRadius": len(affected),
        "affectedNodes": affected,
    }
    if center.get("crossServiceOrigin"):
        result["crossServiceOrigin"] = center["crossServiceOrigin"]
    return result


def cmd_callers(args: argparse.Namespace) -> Any:
    center = _find_symbol_node(args.server, args.service, args.symbol)
    effective_service = _effective_service(center, args.service)
    depth = min(max(args.depth, 1), 3)
    nbr_data = _fetch_neighbors(args.server, effective_service, center["id"], "inbound", depth, "calls")
    callers = _neighbor_entries(nbr_data)

    # Fallback: if no "calls" edges, try "injects" (classes that inject this one)
    if not callers:
        nbr_data = _fetch_neighbors(args.server, effective_service, center["id"], "inbound", depth, "injects")
        callers = _neighbor_entries(nbr_data)
        if callers:
            for c in callers:
                c["edgeType"] = "injects"

    result: dict[str, Any] = {
        "service": effective_service,
        "center": {"id": center["id"], "name": center.get("name", ""), "type": center.get("type", "")},
        "depth": depth,
        "callers": callers,
        "total": len(callers),
    }
    if center.get("crossServiceOrigin"):
        result["crossServiceOrigin"] = center["crossServiceOrigin"]
    return result


def cmd_callees(args: argparse.Namespace) -> Any:
    center = _find_symbol_node(args.server, args.service, args.symbol)
    effective_service = _effective_service(center, args.service)
    depth = min(max(args.depth, 1), 3)
    nbr_data = _fetch_neighbors(args.server, effective_service, center["id"], "outbound", depth, "calls")
    callees = _neighbor_entries(nbr_data)

    # Fallback: if no "calls" edges, try "injects" (Spring DI dependencies)
    if not callees:
        nbr_data = _fetch_neighbors(args.server, effective_service, center["id"], "outbound", depth, "injects")
        callees = _neighbor_entries(nbr_data)
        if callees:
            for c in callees:
                c["edgeType"] = "injects"

    result: dict[str, Any] = {
        "service": effective_service,
        "center": {"id": center["id"], "name": center.get("name", ""), "type": center.get("type", "")},
        "depth": depth,
        "callees": callees,
        "total": len(callees),
    }
    if center.get("crossServiceOrigin"):
        result["crossServiceOrigin"] = center["crossServiceOrigin"]
    return result


def cmd_hotspots(args: argparse.Namespace) -> Any:
    params: dict[str, str] = {
        "service": args.service,
        "graph": "kg",
        "limit": str(max(args.limit, 1)),
    }
    if args.type:
        params["type"] = args.type
    data = _helpers.fetch_json(build_url(args.server, "/api/graph-query/hotspots", params))
    return {
        "service": args.service,
        "totalNodes": data.get("total", 0),
        "hotspots": data.get("hotspots", []),
    }


def cmd_affected(args: argparse.Namespace) -> Any:
    files = [f.strip() for f in args.files.split(",") if f.strip()]
    if not files:
        raise SystemExit("affected requires --files with at least one path")

    depth = max(args.depth, 1)
    graph_data = _helpers.fetch_json(build_url(args.server, "/api/graph", {"service": args.service, "file": "knowledge-graph.json"}))
    nodes = graph_data.get("nodes", [])

    affected_tests: list[dict[str, Any]] = []
    seen: set[str] = set()

    for file_path in files:
        matching = _nodes_for_file(nodes, file_path)
        if not matching:
            continue
        for node in matching:
            try:
                nbr_data = _fetch_neighbors(args.server, args.service, node["id"], "inbound", depth)
            except RuntimeError:
                continue
            for n in nbr_data.get("neighbors", []):
                neighbor = n.get("node") or {}
                edge = n.get("edge") or {}
                edge_type = edge.get("type", "")
                nbr_fp = neighbor.get("filePath", "")
                if not nbr_fp:
                    continue
                is_tested_by = edge_type == "tested_by"
                is_test_file = _is_test_path(nbr_fp)
                if not (is_test_file or is_tested_by):
                    continue
                if nbr_fp in seen:
                    continue
                seen.add(nbr_fp)
                if is_tested_by:
                    reason = f"tested_by edge from {file_path}"
                else:
                    reason = f"inbound dependency on changed file {file_path}"
                affected_tests.append({
                    "testFile": nbr_fp,
                    "reason": reason,
                    "relatedSymbol": neighbor.get("name", neighbor.get("id", "")),
                })

    return {"service": args.service, "changedFiles": files, "affectedTests": affected_tests}


def cmd_structure(args: argparse.Namespace) -> Any:
    if not args.service:
        raise SystemExit("structure requires --service")
    if args.symbol:
        return _cmd_structure_symbol(args)
    if args.chain:
        params: dict[str, str] = {"service": args.service, "class": args.chain, "direction": args.direction}
        return _helpers.fetch_json(build_url(args.server, "/api/structure/chain", params))
    if args.implementors:
        params = {"service": args.service, "interface": args.implementors}
        return _helpers.fetch_json(build_url(args.server, "/api/structure/implementors", params))
    if args.files:
        return _helpers.fetch_json(build_url(args.server, "/api/structure/files", {"service": args.service}))
    if args.file:
        params = {"service": args.service, "path": args.file}
        result = _helpers.fetch_json(build_url(args.server, "/api/structure/file", params))
        if getattr(args, "source", False):
            src_params: dict[str, str] = {"file": args.file, "service": args.service, "mode": "graph"}
            if getattr(args, "start", None):
                src_params["start"] = str(args.start)
            if getattr(args, "end", None):
                src_params["end"] = str(args.end)
            try:
                src_data = _helpers.fetch_json(build_url(args.server, "/api/source", src_params))
                result["sourceContent"] = src_data.get("content", src_data.get("source", ""))
                result["lineCount"] = src_data.get("lineCount", src_data.get("totalLines", 0))
            except RuntimeError:
                pass
        return result
    search_params: dict[str, str] = {"service": args.service, "limit": str(args.limit)}
    if args.annotation:
        search_params["annotation"] = args.annotation
    if args.param_type:
        search_params["paramType"] = args.param_type
    if args.return_type:
        search_params["returnType"] = args.return_type
    if args.interface:
        search_params["interface"] = args.interface
    if args.property_type:
        search_params["propertyType"] = args.property_type
    if args.path:
        search_params["pathPattern"] = args.path
    if getattr(args, "section_key", None):
        search_params["sectionKey"] = args.section_key
    if getattr(args, "section_value", None):
        search_params["sectionValue"] = args.section_value
    if getattr(args, "q", None):
        search_params["q"] = args.q
    if getattr(args, "offset", 0) > 0:
        search_params["offset"] = str(args.offset)
    if len(search_params) <= 2:
        raise SystemExit("structure search requires at least one filter: --q, --annotation, --param-type, --return-type, --interface, --property-type, --section-key, --section-value")
    return _helpers.fetch_json(build_url(args.server, "/api/structure/search", search_params))



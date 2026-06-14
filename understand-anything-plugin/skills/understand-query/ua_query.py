#!/usr/bin/env python3
"""HTTP CLI for querying Understand-Anything API Server (stdlib only)."""
import argparse
import json
import os
import sys
from typing import Any

# Re-export from sub-modules so tests can import from ua_query directly
from _utils import (
    DEFAULT_SERVER, DEFAULT_TIMEOUT, _IMPL_SUFFIXES, _CONFIG_SUFFIXES,
    ServerUnavailableError, fetch_json, build_url, _detect_server,
    format_output, _format_markdown, _short_type_name,
)
from _helpers import (
    _score_node_relevance, _extract_code_keywords, _search_api,
    _find_symbol_node, _cross_service_symbol_search, _effective_service,
    _fetch_neighbors, _neighbor_entries, _fetch_wiki_domain,
    _fetch_domain_flows, _nodes_for_file, _is_test_path,
    _auto_discover_service, _extract_symbol, _kg_file_toc,
    _cmd_structure_symbol,
)
from _commands import (
    _cmd_kg_file_summary, cmd_kg, cmd_domain, cmd_wiki, cmd_business,
    cmd_services, cmd_meta, cmd_trace, _detect_and_follow_cross_service_rpc,
    cmd_ask, cmd_impact, cmd_callers, cmd_callees, cmd_hotspots,
    cmd_affected, cmd_structure,
)

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
    kg.add_argument("--tag", help="Filter by tag (e.g. 'auth', 'service')")
    kg.add_argument("--offset", type=int, default=0, help="Pagination offset")
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
    kg.add_argument("--summary", action="store_true", help="Return file-level overview with relationships")
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
    trace.add_argument("--service", help="Target service (omit with --auto-discover)")
    trace.add_argument("--query", required=True, help="Search keywords (comma-separated for multi-keyword: '挚友,ClosedFriend')")
    trace.add_argument("--type", help="Filter matched nodes by type (class, function, file...)")
    trace.add_argument("--limit", type=int, default=5, help="Max matched nodes to return")
    trace.add_argument("--source", action="store_true", help="Include source code of matched nodes (top 1 inline + top 3 as sourceReads)")
    trace.add_argument("--grouped", action="store_true", help="Group source code by file for all matched nodes (use with --source)")
    trace.add_argument("--symbol", help="Extract specific method/class from source (use with --source)")
    trace.add_argument("--business", action="store_true", help="Include business context search")
    trace.add_argument("--wiki", action="store_true", help="Include wiki domain detail for matched feature")
    trace.add_argument("--domain-flows", action="store_true", help="Include domain flow steps for matched feature")
    trace.add_argument("--auto-discover", action="store_true", help="Auto-detect service via business landscape search")
    trace.add_argument("--fusion", choices=["none", "rrf"], default="rrf", help="Search fusion strategy (default: rrf)")

    ask = sub.add_parser("ask", help="Answer a business question: auto-discover service, trace, wiki, domain, source")
    ask.add_argument("--query", required=True, help="Natural language question (Chinese or English)")
    ask.add_argument("--depth", choices=["quick", "standard", "full"], default="standard", help="Depth: quick=business only, standard=+trace+wiki, full=+domain+source-verify")
    ask.add_argument("--service", help="Override auto-discovery with specific service")
    ask.add_argument("--limit", type=int, default=5, help="Max matched nodes")
    ask.add_argument("--fusion", choices=["none", "rrf"], default="rrf", help="Search fusion strategy")

    struct = sub.add_parser("structure", help="Code structure: signatures, annotations, types")
    struct.add_argument("--service", required=True)
    struct.add_argument("--file", help="Get structure for a specific file path (exact or suffix match)")
    struct.add_argument("--start", type=int, help="Start line for --file --source (1-based)")
    struct.add_argument("--end", type=int, help="End line for --file --source (1-based)")
    struct.add_argument("--files", action="store_true", help="List all indexed file paths")
    struct.add_argument("--annotation", help="Search by class/function annotation name")
    struct.add_argument("--param-type", help="Search by function parameter type")
    struct.add_argument("--return-type", help="Search by function return type")
    struct.add_argument("--interface", help="Search by implemented interface")
    struct.add_argument("--property-type", help="Search by class property type")
    struct.add_argument("--section-key", help="Filter by section name (function/class name substring)")
    struct.add_argument("--section-value", help="Filter by section content (content substring)")
    struct.add_argument("--q", help="Fuzzy search query (searches name, annotations, params, return type)")
    struct.add_argument("--path", help="Filter results by path pattern (substring match)")
    struct.add_argument("--limit", type=int, default=50, help="Max results to return")
    struct.add_argument("--offset", type=int, default=0, help="Pagination offset")
    struct.add_argument("--chain", help="Traverse inheritance chain for a class name")
    struct.add_argument("--direction", choices=["up", "down"], default="up", help="Chain direction: up=superclasses, down=subclasses")
    struct.add_argument("--implementors", help="Find all classes implementing an interface")
    struct.add_argument("--symbol", help="Search for a specific symbol (function or class) across all files")
    struct.add_argument("--source", action="store_true", help="Include source code when using --symbol")

    impact = sub.add_parser("impact", help="Transitive impact analysis via BFS")
    impact.add_argument("--service", required=True)
    impact.add_argument("--symbol", required=True)
    impact.add_argument("--depth", type=int, default=3)
    impact.add_argument("--direction", choices=["inbound", "outbound", "both"], default="inbound")
    impact.add_argument("--edge-type")

    callers = sub.add_parser("callers", help="Who calls this symbol?")
    callers.add_argument("--service", required=True)
    callers.add_argument("--symbol", required=True)
    callers.add_argument("--depth", type=int, default=1)

    callees = sub.add_parser("callees", help="What does this symbol call?")
    callees.add_argument("--service", required=True)
    callees.add_argument("--symbol", required=True)
    callees.add_argument("--depth", type=int, default=1)

    hotspots = sub.add_parser("hotspots", help="Fan-in/fan-out scoring")
    hotspots.add_argument("--service", required=True)
    hotspots.add_argument("--limit", type=int, default=20)
    hotspots.add_argument("--type")

    affected = sub.add_parser("affected", help="Find affected test files")
    affected.add_argument("--service", required=True)
    affected.add_argument("--files", required=True, help="Comma-separated file paths")
    affected.add_argument("--depth", type=int, default=2)

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.server = _detect_server(args.server)
    try:
        handlers = {
            "kg": cmd_kg, "domain": cmd_domain, "wiki": cmd_wiki, "business": cmd_business,
            "services": cmd_services, "meta": cmd_meta, "trace": cmd_trace, "structure": cmd_structure,
            "ask": cmd_ask, "impact": cmd_impact, "callers": cmd_callers, "callees": cmd_callees,
            "hotspots": cmd_hotspots, "affected": cmd_affected,
        }
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

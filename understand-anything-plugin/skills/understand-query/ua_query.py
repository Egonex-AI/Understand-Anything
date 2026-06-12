#!/usr/bin/env python3
"""HTTP CLI for querying Understand-Anything API Server (stdlib only)."""
import argparse
import json
import os
import re
import sys
from typing import Any
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import quote as url_quote, urlencode

DEFAULT_SERVER = "http://172.18.228.71:3001"
DEFAULT_TIMEOUT = 5

_IMPL_SUFFIXES = ("ServiceImpl", "WebServiceImpl", "WebService", "Service", "Controller", "Handler", "Manager", "Facade")
_CONFIG_SUFFIXES = ("Properties", "Config", "Configuration", "Constants", "Enum", "DTO", "BO", "VO", "Request", "Response", "Param")


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
    except (TimeoutError, OSError) as e:
        if "timed out" in str(e).lower() or isinstance(e, TimeoutError):
            raise RuntimeError(f"Request timed out ({timeout}s): {url.split('?')[0]}") from e
        raise ServerUnavailableError(
            f"API Server unavailable at {url.split('?')[0]}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e
    except URLError as e:
        raise ServerUnavailableError(
            f"API Server unavailable at {url.split('?')[0]}. "
            f"Start it with: cd understand-anything-plugin/packages/dashboard && pnpm run serve\n"
            f"Detail: {e}"
        ) from e


def _detect_server(configured: str) -> str:
    """Verify configured server is reachable. If env var is set, use it directly."""
    if os.environ.get("UNDERSTAND_SERVER"):
        return configured
    return configured


def build_url(server: str, path: str, params: dict[str, str] | None = None) -> str:
    base = server.rstrip("/")
    if params:
        return f"{base}{path}?{urlencode(params)}"
    return f"{base}{path}"


def format_output(data: Any, fmt: str) -> str:
    if fmt == "md":
        return _format_markdown(data)
    return json.dumps(data, ensure_ascii=False, indent=2)


def _format_markdown(data: Any) -> str:
    if isinstance(data, dict) and "domains" in data and not data.get("question"):
        lines = ["# Business Domains", ""]
        for d in data["domains"]:
            lines.append(f"## {d.get('name', d.get('id', '?'))}")
            lines.append(d.get("summary", ""))
            lines.append("")
        return "\n".join(lines)
    if isinstance(data, dict) and "results" in data and not data.get("matchedNodes"):
        lines = ["# Search Results", ""]
        for r in data["results"]:
            lines.append(f"- **{r.get('name', r.get('id'))}**: {r.get('match', r.get('summary', ''))}")
        return "\n".join(lines)

    # Trace result rendering
    if isinstance(data, dict) and "matchedNodes" in data:
        lines = []
        svc = data.get("service", "?")
        q = data.get("query", data.get("question", "?"))
        lines.append(f"# Trace: {q} (service: {svc})")
        if data.get("autoDiscovered"):
            lines.append(f"> Auto-discovered service: **{svc}**")
        lines.append("")

        # Matched nodes
        nodes = data.get("matchedNodes", [])
        if nodes:
            lines.append(f"## Matched Nodes ({len(nodes)})")
            for n in nodes:
                fp = n.get("filePath", "")
                lr = n.get("lineRange", "")
                loc = f" `{fp}:{lr}`" if fp else ""
                br = n.get("blastRadius")
                br_str = f", blast={br['total']}" if br else ""
                lines.append(f"- **{n.get('name', '?')}** ({n.get('type', '?')}, relevance={n.get('relevance', '?')}{br_str}){loc}")
                if n.get("summary"):
                    lines.append(f"  {n['summary'][:120]}")
            lines.append("")

        # Neighbors
        nbr = data.get("neighbors")
        if nbr and nbr.get("neighbors"):
            lines.append(f"## Neighbors (center: {nbr.get('center', {}).get('name', '?')}, edges: {nbr.get('totalEdges', 0)})")
            for n in nbr["neighbors"][:15]:
                lines.append(f"- [{n.get('direction', '?')}] **{n.get('name', '?')}** ({n.get('type', '?')}) via _{n.get('edgeType', '?')}_")
            lines.append("")

        # Business context
        biz = data.get("businessContext", [])
        if biz:
            lines.append("## Business Context")
            for b in biz[:5]:
                lines.append(f"- **{b.get('name', b.get('id', '?'))}**: {b.get('summary', b.get('match', ''))[:150]}")
            lines.append("")

        # Wiki domain
        wiki = data.get("wikiDomain")
        if wiki:
            lines.append("## Wiki Domain Detail")
            lines.append(f"**{wiki.get('name', wiki.get('domain', '?'))}**")
            if wiki.get("summary"):
                lines.append(f"\n{wiki['summary'][:500]}")
            rules = wiki.get("businessRules", [])
            if rules:
                lines.append("\n### Business Rules")
                for r in rules[:10]:
                    rid = r.get("id", "?")
                    lines.append(f"- **{rid}**: {r.get('description', r.get('rule', ''))[:200]}")
            entities = wiki.get("entities", [])
            if entities:
                lines.append("\n### Entities")
                for e in entities[:10]:
                    lines.append(f"- **{e.get('name', '?')}**: {e.get('description', '')[:100]}")
            lines.append("")

        # Domain flows
        flows = data.get("domainFlows", [])
        if flows:
            lines.append("## Domain Flows")
            for fd in flows:
                flow = fd.get("flow", {})
                steps = fd.get("steps", [])
                lines.append(f"\n### {flow.get('name', '?')}")
                if flow.get("summary"):
                    lines.append(flow["summary"][:200])
                for i, s in enumerate(steps, 1):
                    lines.append(f"  {i}. {s.get('name', '?')} — {s.get('summary', '')[:100]}")
            lines.append("")

        # Source by file (grouped mode)
        source_by_file = data.get("sourceByFile")
        if source_by_file:
            lines.append("## Source by File")
            rel_map = data.get("relationshipMap", [])
            if rel_map:
                lines.append(f"### Relationships ({len(rel_map)} edges between matched nodes)")
                for edge in rel_map[:20]:
                    lines.append(
                        f"- **{edge.get('fromName', edge.get('from', '?'))}** "
                        f"→ **{edge.get('toName', edge.get('to', '?'))}** "
                        f"via _{edge.get('edgeType', '?')}_ ({edge.get('direction', '?')})"
                    )
                lines.append("")
            for fp, entry in source_by_file.items():
                lr = entry.get("lineRange", "")
                symbols = entry.get("symbols", [])
                sym_names = ", ".join(s.get("name", "?") for s in symbols)
                lines.append(f"### `{fp}` (lines {lr})")
                lines.append(f"Symbols: {sym_names}")
                ext = fp.rsplit(".", 1)[-1] if "." in fp else "java"
                lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart"}.get(ext, ext)
                content = entry.get("source", "")[:4000]
                lines.append(f"```{lang}\n{content}\n```")
                lines.append("")

        # Source
        src = data.get("source")
        if isinstance(src, dict) and src.get("content"):
            lines.append(f"## Source: {src.get('file', '?')} (lines {src.get('lineRange', '?')})")
            lines.append(f"```java\n{src['content'][:4000]}\n```")
            lines.append("")

        # Source reads (full source for agent reasoning)
        sv = data.get("sourceReads", [])
        if sv:
            lines.append("## Source Code Reads")
            for v in sv:
                lr = v.get("lineRange", "")
                ext = v.get("file", "").rsplit(".", 1)[-1] if "." in v.get("file", "") else "java"
                lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart"}.get(ext, ext)
                lines.append(f"\n### {v.get('node', '?')} ({v.get('type', '?')}) — `{v.get('file', '?')}:{lr}`")
                lines.append(f"```{lang}\n{v.get('content', '')}\n```")
            lines.append("")

        return "\n".join(lines)

    if isinstance(data, dict) and "symbol" in data and "matches" in data:
        lines = [f"# Symbol: {data.get('symbol', '?')}", ""]
        for m in data.get("matches", []):
            lr = m.get("lineRange", [])
            lr_str = f"L{lr[0]}-{lr[1]}" if lr and len(lr) == 2 else ""
            lines.append(f"## {m.get('kind', '?')} `{m.get('name', '?')}` — `{m.get('filePath', '?')}:{lr_str}`")
            source = m.get("source")
            if source:
                ext = m.get("filePath", "").rsplit(".", 1)[-1] if "." in m.get("filePath", "") else "java"
                lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart"}.get(ext, ext)
                lines.append(f"```{lang}\n{source}\n```")
            lines.append("")
        return "\n".join(lines)

    if isinstance(data, dict) and "impactRadius" in data and "affectedNodes" in data:
        center = data.get("center", {})
        lines = [
            f"# Impact Analysis: {center.get('name', '?')}",
            f"Service: {data.get('service', '?')} | Depth: {data.get('depth', '?')} | Direction: {data.get('direction', '?')} | Radius: {data.get('impactRadius', 0)}",
            "",
        ]
        for n in data.get("affectedNodes", [])[:30]:
            path = " → ".join(n.get("path", []))
            lines.append(f"- **{n.get('name', '?')}** ({n.get('type', '?')}, d={n.get('distance', '?')}) — {path}")
        if len(data.get("affectedNodes", [])) > 30:
            lines.append(f"\n... and {len(data['affectedNodes']) - 30} more")
        return "\n".join(lines)

    if isinstance(data, dict) and ("callers" in data or "callees" in data):
        label = "Callers" if "callers" in data else "Callees"
        center = data.get("center", {})
        items = data.get("callers") or data.get("callees") or []
        lines = [f"# {label}: {center.get('name', '?')}", f"Total: {data.get('total', len(items))}", ""]
        for n in items[:25]:
            fp = n.get("filePath", "")
            loc = f" `{fp}`" if fp else ""
            lines.append(f"- **{n.get('name', '?')}** ({n.get('type', '?')}) via _{n.get('edgeType', '?')}_{loc}")
        return "\n".join(lines)

    if isinstance(data, dict) and "hotspots" in data:
        lines = [f"# Hotspots ({data.get('service', '?')})", f"Total nodes: {data.get('totalNodes', '?')}", ""]
        lines.append("| Name | Type | Fan In | Fan Out | Score | File |")
        lines.append("|------|------|--------|---------|-------|------|")
        for h in data.get("hotspots", [])[:20]:
            fp = h.get("filePath", "") or ""
            if len(fp) > 40:
                fp = "..." + fp[-37:]
            lines.append(f"| {h.get('name', '?')} | {h.get('type', '?')} | {h.get('fanIn', 0)} | {h.get('fanOut', 0)} | {h.get('score', 0)} | {fp} |")
        return "\n".join(lines)

    if isinstance(data, dict) and "affectedTests" in data:
        lines = ["# Affected Tests", f"Changed files: {', '.join(data.get('changedFiles', []))}", ""]
        for t in data.get("affectedTests", []):
            lines.append(f"- **{t.get('testFile', '?')}** — {t.get('reason', '?')} (via {t.get('relatedSymbol', '?')})")
        if not data.get("affectedTests"):
            lines.append("_No affected tests found._")
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
    trace.add_argument("--source", action="store_true", help="Include source code of top match")
    trace.add_argument("--grouped", action="store_true", help="Group source code by file for all matched nodes (use with --source)")
    trace.add_argument("--symbol", help="Extract specific method/class from source (use with --source)")
    trace.add_argument("--business", action="store_true", help="Include business context search")
    trace.add_argument("--wiki", action="store_true", help="Include wiki domain detail for matched feature")
    trace.add_argument("--domain-flows", action="store_true", help="Include domain flow steps for matched feature")
    trace.add_argument("--verify-source", action="store_true", help="Force source code read to verify wiki/domain claims")
    trace.add_argument("--auto-discover", action="store_true", help="Auto-detect service via business landscape search")
    trace.add_argument("--fusion", choices=["none", "rrf"], default="rrf", help="Search fusion strategy (default: rrf)")

    ask = sub.add_parser("ask", help="Answer a business question: auto-discover service, trace, wiki, domain, verify source")
    ask.add_argument("--query", required=True, help="Natural language question (Chinese or English)")
    ask.add_argument("--depth", choices=["quick", "standard", "full"], default="standard", help="Depth: quick=business only, standard=+trace+wiki, full=+domain+source-verify")
    ask.add_argument("--service", help="Override auto-discovery with specific service")
    ask.add_argument("--limit", type=int, default=5, help="Max matched nodes")
    ask.add_argument("--fusion", choices=["none", "rrf"], default="rrf", help="Search fusion strategy")

    struct = sub.add_parser("structure", help="Code structure: signatures, annotations, types")
    struct.add_argument("--service", required=True)
    struct.add_argument("--file", help="Get structure for a specific file path (exact or suffix match)")
    struct.add_argument("--files", action="store_true", help="List all indexed file paths")
    struct.add_argument("--annotation", help="Search by class/function annotation name")
    struct.add_argument("--param-type", help="Search by function parameter type")
    struct.add_argument("--return-type", help="Search by function return type")
    struct.add_argument("--interface", help="Search by implemented interface")
    struct.add_argument("--property-type", help="Search by class property type")
    struct.add_argument("--path", help="Filter results by path pattern (substring match)")
    struct.add_argument("--limit", type=int, default=50, help="Max results to return")
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


# --- Subcommand handlers ---

def _short_type_name(name: str) -> str:
    return name.rsplit(".", 1)[-1]


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


def _cmd_kg_file_summary(args: argparse.Namespace) -> Any:
    try:
        graph_data = fetch_json(build_url(args.server, "/api/graph", {
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
        except RuntimeError:
            pass

    imports: list[str] = []
    try:
        struct_data = fetch_json(build_url(args.server, "/api/structure/file", {
            "service": args.service,
            "path": args.file,
        }))
        for imp in struct_data.get("imports", []):
            raw = imp.get("name", imp) if isinstance(imp, dict) else imp
            short = _short_type_name(str(raw))
            if short and short not in imports:
                imports.append(short)
    except RuntimeError:
        pass

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
        cross_domain = url_quote(args.cross_domain or "", safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/domain/{cross_domain}", {}))
    if args.endpoint_index:
        data = fetch_json(build_url(args.server, "/api/wiki/endpoints/index", {}))
        if args.protocol:
            by_proto = data.get("byProtocol", {})
            return {"protocol": args.protocol, "entries": by_proto.get(args.protocol, [])}
        return data
    if not args.service:
        raise SystemExit("wiki requires --service (or use --overview/--architecture/--cross-domain/--endpoint-index)")
    svc = url_quote(args.service or "", safe="")
    if args.flow:
        flow = url_quote(args.flow or "", safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/flow/{flow}", {}))
    if args.related:
        if not args.domain:
            raise SystemExit("--related requires --domain")
        domain = url_quote(args.domain or "", safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/{domain}/related", {}))
    if args.search:
        return _search_api(args.server, args.search, scope="wiki", limit=20)
    if args.domain:
        domain = url_quote(args.domain or "", safe="")
        return fetch_json(build_url(args.server, f"/api/wiki/service/{svc}/domain/{domain}", {}))
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
        return {"results": _search_api(args.server, args.search, scope="business")}
    if args.domain:
        slug = args.domain.replace("domain:", "").replace(" ", "-").lower()
        slug = url_quote(slug, safe="")
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
    data = fetch_json(build_url(args.server, "/api/layers/freshness", {}))
    if args.stale:
        return {"stale": data.get("freshness", {}).get("stale", [])}
    return data


def _score_node_relevance(node: dict[str, Any], query: str) -> float:
    """Score a node's relevance to the query using language-agnostic structural signals."""
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
    type_bonus = {"class": 2, "function": 1.5, "interface": 2, "module": 1, "endpoint": 2, "service": 2.5}.get(node_type, 0)
    score += type_bonus
    if node.get("filePath"):
        score += 1.5
    if node.get("lineRange"):
        score += 1.0

    raw_name = node.get("name", "")
    if any(raw_name.endswith(s) for s in _IMPL_SUFFIXES):
        score += 3.0
    elif any(raw_name.endswith(s) for s in _CONFIG_SUFFIXES):
        score -= 2.0
    return score


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


def _search_api(server: str, query: str, service: str | None = None, scope: str = "kg", limit: int = 50, fusion: str = "none") -> list[dict]:
    """Call the unified /api/search endpoint and return results."""
    params: dict[str, str] = {"q": query, "scope": scope, "limit": str(limit)}
    if service:
        params["service"] = service
    if fusion != "none":
        params["fusion"] = fusion
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
    except RuntimeError:
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
        batch_matched = _search_api(args.server, batch_query, service=service, scope="kg", limit=50, fusion=args.fusion)
        if args.type:
            batch_matched = [n for n in batch_matched if n.get("type") == args.type]
        for node in batch_matched:
            nid = node.get("id", "")
            score = _score_node_relevance(node, best_keyword)
            if nid not in seen_ids or score > seen_ids[nid][1]:
                seen_ids[nid] = (node, score, best_keyword)
    except RuntimeError:
        # Batch query failed (e.g. server 500 on certain char combos) — fallback per keyword
        for kw in keywords[:3]:
            try:
                kw_matched = _search_api(args.server, kw, service=service, scope="kg", limit=50, fusion=args.fusion)
                if args.type:
                    kw_matched = [n for n in kw_matched if n.get("type") == args.type]
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
            sup = _search_api(args.server, eng_kws[0], service=service, scope="kg", limit=50, fusion=args.fusion)
            if args.type:
                sup = [n for n in sup if n.get("type") == args.type]
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
            nbr = fetch_json(build_url(args.server, "/api/graph-query/neighbors", nbr_params))
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
                    verify_source=getattr(args, "verify_source", False),
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
            except (RuntimeError, SystemExit):
                pass
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
        nbr_data = fetch_json(build_url(args.server, "/api/graph-query/neighbors", nbr_params))
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
                src_data = fetch_json(build_url(args.server, "/api/source", src_params))
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
    if getattr(args, "wiki", False) or getattr(args, "verify_source", False):
        wiki_data = _fetch_wiki_domain(args.server, service, args.query)
        if wiki_data:
            result["wikiDomain"] = wiki_data

    # Step 6: Domain flows with steps
    if getattr(args, "domain_flows", False):
        flow_data = _fetch_domain_flows(args.server, service, args.query)
        if flow_data:
            result["domainFlows"] = flow_data

    # Step 7: Source reads — return actual source code for top matches so agent can reason about it
    if getattr(args, "verify_source", False) and matched:
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
                src = fetch_json(build_url(args.server, "/api/source", vp))
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

    # Cross-service RPC detection: find injected RPC interfaces and locate their implementations
    if result.get("neighbors") and getattr(args, "verify_source", False):
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
        svc_list = fetch_json(build_url(server, "/api/services", {}))
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
        follow_args.verify_source = True
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
                f"python ua_query.py trace --service {target_service} --query \"{target_interface}\" --source --verify-source"
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
    trace_args.verify_source = depth == "full"
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
    data = fetch_json(build_url(args.server, "/api/graph-query/impact", params))
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
    data = fetch_json(build_url(args.server, "/api/graph-query/hotspots", params))
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
    graph_data = fetch_json(build_url(args.server, "/api/graph", {"service": args.service, "file": "knowledge-graph.json"}))
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
        return fetch_json(build_url(args.server, "/api/structure/chain", params))
    if args.implementors:
        params = {"service": args.service, "interface": args.implementors}
        return fetch_json(build_url(args.server, "/api/structure/implementors", params))
    if args.files:
        return fetch_json(build_url(args.server, "/api/structure/files", {"service": args.service}))
    if args.file:
        params = {"service": args.service, "path": args.file}
        return fetch_json(build_url(args.server, "/api/structure/file", params))
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
    if len(search_params) <= 2:
        raise SystemExit("structure search requires at least one filter: --annotation, --param-type, --return-type, --interface, --property-type")
    return fetch_json(build_url(args.server, "/api/structure/search", search_params))


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

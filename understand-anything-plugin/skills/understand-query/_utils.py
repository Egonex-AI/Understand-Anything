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

    # Ask result at quick depth (no matchedNodes yet)
    if isinstance(data, dict) and "question" in data and "depth" in data and "matchedNodes" not in data:
        lines = [f"# Ask: {data.get('question', '?')}", f"Depth: {data.get('depth', '?')} | Service: {data.get('service', 'auto')}", ""]
        if data.get("autoDiscovered"):
            lines.append(f"> Auto-discovered service: **{data.get('service', '?')}**")
            lines.append("")
        if data.get("error"):
            lines.append(f"**Error:** {data['error']}")
            lines.append("")
        biz = data.get("businessContext", [])
        if biz:
            lines.append("## Business Context")
            for b in biz[:10]:
                lines.append(f"- **{b.get('name', b.get('id', '?'))}**: {b.get('summary', b.get('match', ''))[:200]}")
            lines.append("")
        biz_search = data.get("businessSearch", [])
        if biz_search and not biz:
            lines.append("## Business Search")
            for b in biz_search[:10]:
                lines.append(f"- **{b.get('name', b.get('id', '?'))}**: {b.get('summary', b.get('match', ''))[:200]}")
            lines.append("")
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
            src_ext = src.get("file", "").rsplit(".", 1)[-1] if "." in src.get("file", "") else "java"
            src_lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart", "xml": "xml", "yml": "yaml", "yaml": "yaml", "json": "json", "gradle": "groovy", "sql": "sql"}.get(src_ext, src_ext)
            lines.append(f"## Source: {src.get('file', '?')} (lines {src.get('lineRange', '?')})")
            lines.append(f"```{src_lang}\n{src['content'][:4000]}\n```")
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

        # Cross-service RPC hint
        rpc_hint = data.get("crossServiceRpcHint")
        if rpc_hint:
            lines.append("## Cross-Service RPC Dependencies")
            lines.append(rpc_hint.get("message", ""))
            lines.append("")
            for rpc in rpc_hint.get("rpcInterfaces", []):
                if isinstance(rpc, dict):
                    impl_svc = rpc.get("implementedIn", "unknown")
                    lines.append(f"- **{rpc.get('interface', '?')}** → service: `{impl_svc}`, impl: `{rpc.get('implClass', '?')}`")
                else:
                    lines.append(f"- {rpc}")
            lines.append("")

        # Cross-service trace result (from ask or auto-follow)
        cross = data.get("crossServiceTrace")
        if cross and isinstance(cross, dict):
            lines.append("## Cross-Service Trace")
            if cross.get("hint"):
                lines.append(cross["hint"])
                lines.append("")
            target_svc = cross.get("targetService", "?")
            target = cross.get("targetTrace") or cross.get("traceResult") or {}
            if target.get("matchedNodes"):
                lines.append(f"### Target: {target_svc} — Matched Nodes ({len(target['matchedNodes'])})")
                for n in target["matchedNodes"][:5]:
                    fp = n.get("filePath", "")
                    loc = f" `{fp}`" if fp else ""
                    lines.append(f"- **{n.get('name', '?')}** ({n.get('type', '?')}, relevance={n.get('relevance', '?')}){loc}")
                lines.append("")
            t_wiki = target.get("wikiDomain")
            if t_wiki:
                lines.append(f"### Target Wiki: {t_wiki.get('name', t_wiki.get('domain', '?'))}")
                if t_wiki.get("summary"):
                    lines.append(t_wiki["summary"][:400])
                lines.append("")
            t_src = target.get("source")
            if isinstance(t_src, dict) and t_src.get("content"):
                ext = t_src.get("file", "").rsplit(".", 1)[-1] if "." in t_src.get("file", "") else "java"
                lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart"}.get(ext, ext)
                lines.append(f"### Target Source: `{t_src.get('file', '?')}`")
                lines.append(f"```{lang}\n{t_src.get('content', '')[:4000]}\n```")
                lines.append("")
            t_reads = target.get("sourceReads", [])
            for v in t_reads[:3]:
                ext = v.get("file", "").rsplit(".", 1)[-1] if "." in v.get("file", "") else "java"
                lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart"}.get(ext, ext)
                lines.append(f"### {v.get('node', '?')} — `{v.get('file', '?')}`")
                lines.append(f"```{lang}\n{v.get('content', '')[:3000]}\n```")
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

    # Services list (from services --list, each item has dataLayers)
    if isinstance(data, dict) and "services" in data and isinstance(data["services"], list) and data["services"] and isinstance(data["services"][0], dict) and "dataLayers" in data["services"][0]:
        lines = ["# Services", ""]
        lines.append("| Service | KG | Wiki | Domain | Business |")
        lines.append("|---------|-----|------|--------|----------|")
        for s in data["services"]:
            name = s.get("name", "?")
            layers = s.get("dataLayers", {})
            kg = "✓" if layers.get("kg") else "—"
            wiki = "✓" if layers.get("wiki") else "—"
            domain = "✓" if layers.get("domain") else "—"
            biz = "✓" if layers.get("business") else "—"
            lines.append(f"| {name} | {kg} | {wiki} | {domain} | {biz} |")
        return "\n".join(lines)

    # Wiki service overview (wiki --service S returns {index, overview})
    if isinstance(data, dict) and "overview" in data and isinstance(data["overview"], dict):
        ov = data["overview"]
        lines = [f"# Wiki: {ov.get('name', '?')}", ""]
        if ov.get("description"):
            lines.append(ov["description"][:1000])
            lines.append("")
        tech = ov.get("techStack", [])
        if tech:
            lines.append("## Tech Stack")
            for t in tech:
                if isinstance(t, dict):
                    lines.append(f"- **{t.get('name', '?')}**: {t.get('role', t.get('description', ''))[:150]}")
                else:
                    lines.append(f"- {t}")
            lines.append("")
        modules = ov.get("modules", [])
        if modules:
            lines.append("## Modules")
            for m in modules:
                if isinstance(m, dict):
                    lines.append(f"- **{m.get('name', '?')}**: {m.get('description', m.get('role', ''))[:150]}")
                else:
                    lines.append(f"- {m}")
            lines.append("")
        eps = ov.get("entryPoints", [])
        if eps:
            lines.append("## Entry Points")
            for ep in eps:
                if isinstance(ep, dict):
                    lines.append(f"- **{ep.get('name', '?')}** ({ep.get('type', '?')}): {ep.get('description', '')[:150]}")
                else:
                    lines.append(f"- {ep}")
            lines.append("")
        idx = data.get("index", {})
        entries = idx.get("entries", []) if isinstance(idx, dict) else []
        if entries:
            lines.append(f"## Domains ({len(entries)})")
            for e in entries:
                if isinstance(e, dict):
                    lines.append(f"- **{e.get('name', e.get('domain', '?'))}**: {e.get('summary', '')[:200]}")
                else:
                    lines.append(f"- {e}")
            lines.append("")
        return "\n".join(lines)

    # Business panorama / domain detail (must come BEFORE architecture — both can have "facets")
    if isinstance(data, dict) and ("interactions" in data or "businessRules" in data):
        lines = []
        name = data.get("name", data.get("domain", ""))
        if name:
            lines.append(f"# Business: {name}")
        else:
            lines.append("# Business Overview")
        lines.append("")
        if data.get("summary"):
            lines.append(data["summary"][:500])
            lines.append("")
        interactions = data.get("interactions", [])
        if interactions:
            lines.append("## Interactions")
            for it in interactions[:15]:
                if isinstance(it, dict):
                    lines.append(f"- **{it.get('name', it.get('id', '?'))}**: {it.get('description', it.get('summary', ''))[:200]}")
                else:
                    lines.append(f"- {it}")
            lines.append("")
        rules = data.get("businessRules", [])
        if rules:
            lines.append("## Business Rules")
            for r in rules[:15]:
                if isinstance(r, dict):
                    lines.append(f"- **{r.get('id', '?')}**: {r.get('description', r.get('rule', ''))[:200]}")
                else:
                    lines.append(f"- {r}")
            lines.append("")
        facets = data.get("facets", {})
        if isinstance(facets, dict) and facets:
            lines.append("## Facets")
            for facet_name, facet_data in facets.items():
                if isinstance(facet_data, dict):
                    svcs = facet_data.get("services", [])
                    svc_names = ", ".join(s.get("name", s) if isinstance(s, dict) else str(s) for s in svcs)
                    lines.append(f"- **{facet_name}**: {svc_names}")
                else:
                    lines.append(f"- **{facet_name}**: {facet_data}")
            lines.append("")
        return "\n".join(lines)

    # Business panorama (has services + architecture, no interactions)
    if isinstance(data, dict) and "architecture" in data and "services" in data and isinstance(data["services"], list) and "matchedNodes" not in data:
        lines = []
        name = data.get("name", "")
        if name:
            lines.append(f"# Panorama: {name}")
        else:
            lines.append("# Business Panorama")
        lines.append("")
        if data.get("summary"):
            lines.append(data["summary"][:500])
            lines.append("")
        svcs = data.get("services", [])
        if svcs:
            lines.append(f"## Services ({len(svcs)})")
            for s in svcs:
                if isinstance(s, dict):
                    lines.append(f"- **{s.get('name', '?')}**: {s.get('description', s.get('role', ''))[:150]}")
                else:
                    lines.append(f"- {s}")
            lines.append("")
        arch = data.get("architecture", {})
        if isinstance(arch, dict):
            layers = arch.get("layers", [])
            if layers:
                lines.append("## Architecture Layers")
                for la in layers:
                    if isinstance(la, dict):
                        lines.append(f"- **{la.get('name', '?')}**: {la.get('description', '')[:150]}")
                    else:
                        lines.append(f"- {la}")
                lines.append("")
            comms = arch.get("communications", [])
            if comms:
                lines.append("## Communications")
                for cm in comms:
                    if isinstance(cm, dict):
                        lines.append(f"- **{cm.get('name', cm.get('type', '?'))}**: {cm.get('description', '')[:150]}")
                    else:
                        lines.append(f"- {cm}")
                lines.append("")
        steps = data.get("steps", [])
        if steps:
            lines.append("## Steps")
            for i, st in enumerate(steps, 1):
                if isinstance(st, dict):
                    lines.append(f"  {i}. **{st.get('name', '?')}**: {st.get('description', '')[:150]}")
                else:
                    lines.append(f"  {i}. {st}")
            lines.append("")
        return "\n".join(lines)

    # Wiki architecture (crossServiceCalls at top level — from wiki --architecture)
    if isinstance(data, dict) and ("crossServiceCalls" in data or ("facets" in data and isinstance(data.get("facets"), list))):
        lines = ["# Architecture", ""]
        facets = data.get("facets", [])
        if facets and isinstance(facets, list):
            lines.append("## Facets")
            for f in facets:
                if isinstance(f, dict):
                    svc_list = f.get("services", [])
                    svc_names = ", ".join(s.get("name", s) if isinstance(s, dict) else str(s) for s in svc_list)
                    lines.append(f"- **{f.get('name', '?')}**: {svc_names}")
            lines.append("")
        calls = data.get("crossServiceCalls", [])
        if calls:
            lines.append(f"## Cross-Service Calls ({len(calls)})")
            for c in calls[:30]:
                if isinstance(c, dict):
                    caller = c.get("caller", {})
                    callee = c.get("callee", {})
                    caller_svc = caller.get("service", c.get("from", "?"))
                    callee_svc = callee.get("service", c.get("to", "?"))
                    iface = callee.get("interface", "")
                    call_type = c.get("type", c.get("protocol", "?"))
                    detail = c.get("detail", c.get("description", ""))
                    if iface:
                        lines.append(f"- `{caller_svc}` → `{callee_svc}` via **{iface}** ({call_type})")
                    else:
                        lines.append(f"- `{caller_svc}` → `{callee_svc}` ({call_type}): {detail[:80]}")
                else:
                    lines.append(f"- {c}")
            if len(calls) > 30:
                lines.append(f"\n... and {len(calls) - 30} more")
            lines.append("")
        events = data.get("eventFlows", [])
        if events:
            lines.append(f"## Event Flows ({len(events)})")
            for e in events[:20]:
                if isinstance(e, dict):
                    lines.append(f"- **{e.get('name', e.get('event', '?'))}**: {e.get('producer', e.get('from', '?'))} → {e.get('consumer', e.get('to', '?'))}")
                else:
                    lines.append(f"- {e}")
            lines.append("")
        return "\n".join(lines)

    # Domain graph: flows or nodes
    if isinstance(data, dict) and ("flows" in data or ("nodes" in data and isinstance(data.get("nodes"), list))):
        lines = ["# Domain Graph", ""]
        flows = data.get("flows", [])
        if flows:
            lines.append("## Flows")
            for f in flows:
                lines.append(f"- **{f.get('name', '?')}**: {f.get('summary', '')[:200]}")
            lines.append("")
        nodes = data.get("nodes", [])
        if nodes and not flows:
            lines.append("## Nodes")
            for n in nodes[:30]:
                lines.append(f"- **{n.get('name', '?')}** ({n.get('type', '?')}): {n.get('summary', '')[:150]}")
            if len(nodes) > 30:
                lines.append(f"\n... and {len(nodes) - 30} more")
            lines.append("")
        flow = data.get("flow")
        if flow:
            lines.append(f"## Flow: {flow.get('name', '?')}")
            if flow.get("summary"):
                lines.append(flow["summary"][:300])
            steps = data.get("steps", [])
            if steps:
                lines.append("")
                for i, s in enumerate(steps, 1):
                    lines.append(f"  {i}. **{s.get('name', '?')}** — {s.get('summary', '')[:150]}")
            lines.append("")
        edges = data.get("edges", [])
        if edges and not flows and not nodes:
            lines.append(f"## Edges ({len(edges)})")
            for e in edges[:20]:
                lines.append(f"- `{e.get('source', '?')}` → `{e.get('target', '?')}` ({e.get('type', '?')})")
            lines.append("")
        return "\n".join(lines)

    # Freshness / meta
    if isinstance(data, dict) and ("freshness" in data or "stale" in data):
        lines = ["# Data Freshness", ""]
        stale = data.get("stale", [])
        if stale:
            lines.append("## Stale Layers")
            for s in stale:
                lines.append(f"- **{s.get('service', '?')}** / {s.get('layer', '?')}: last updated {s.get('age', '?')}")
            lines.append("")
        freshness = data.get("freshness", {})
        if freshness and not stale:
            for key, val in freshness.items():
                if isinstance(val, list):
                    lines.append(f"## {key}")
                    for item in val[:10]:
                        if isinstance(item, dict):
                            lines.append(f"- **{item.get('service', '?')}** / {item.get('layer', '?')}")
                        else:
                            lines.append(f"- {item}")
                    lines.append("")
                else:
                    lines.append(f"**{key}:** {val}")
        return "\n".join(lines)

    # KG file source read
    if isinstance(data, dict) and "content" in data and "file" in data:
        ext = data.get("file", "").rsplit(".", 1)[-1] if "." in data.get("file", "") else "java"
        lang = {"kt": "kotlin", "java": "java", "py": "python", "ts": "typescript", "js": "javascript", "dart": "dart"}.get(ext, ext)
        lines = [f"# Source: {data.get('file', '?')}", f"Lines: {data.get('lineCount', '?')}", ""]
        lines.append(f"```{lang}\n{data.get('content', '')[:6000]}\n```")
        return "\n".join(lines)

    # Generic dict fallback — render as structured markdown instead of raw JSON
    if isinstance(data, dict):
        lines = []
        for key, value in data.items():
            if value is None or value == [] or value == {}:
                continue
            header = key.replace("_", " ").replace("-", " ").title()
            if isinstance(value, str):
                if len(value) > 300:
                    lines.append(f"## {header}")
                    lines.append(value[:1000])
                    lines.append("")
                else:
                    lines.append(f"**{header}:** {value}")
            elif isinstance(value, (int, float, bool)):
                lines.append(f"**{header}:** {value}")
            elif isinstance(value, list):
                lines.append(f"## {header} ({len(value)})")
                for item in value[:20]:
                    if isinstance(item, dict):
                        name = item.get("name", item.get("id", item.get("service", "")))
                        summary = item.get("summary", item.get("description", item.get("match", "")))
                        if name:
                            lines.append(f"- **{name}**: {str(summary)[:200]}")
                        else:
                            lines.append(f"- {json.dumps(item, ensure_ascii=False)[:200]}")
                    else:
                        lines.append(f"- {item}")
                if len(value) > 20:
                    lines.append(f"  _... and {len(value) - 20} more_")
                lines.append("")
            elif isinstance(value, dict):
                lines.append(f"## {header}")
                for k, v in value.items():
                    if isinstance(v, (str, int, float, bool)):
                        lines.append(f"- **{k}:** {v}")
                    elif isinstance(v, list):
                        lines.append(f"- **{k}:** ({len(v)} items)")
                    elif v is not None:
                        lines.append(f"- **{k}:** {json.dumps(v, ensure_ascii=False)[:200]}")
                lines.append("")
        if lines:
            return "\n".join(lines)

    if isinstance(data, list):
        lines = [f"# Results ({len(data)})", ""]
        for item in data[:30]:
            if isinstance(item, dict):
                name = item.get("name", item.get("id", item.get("service", "")))
                summary = item.get("summary", item.get("description", item.get("match", "")))
                if name:
                    lines.append(f"- **{name}**: {str(summary)[:200]}")
                else:
                    lines.append(f"- {json.dumps(item, ensure_ascii=False)[:200]}")
            else:
                lines.append(f"- {item}")
        if len(data) > 30:
            lines.append(f"\n... and {len(data) - 30} more")
        return "\n".join(lines)

    return f"```json\n{json.dumps(data, ensure_ascii=False, indent=2)}\n```"


def _short_type_name(name: str) -> str:
    return name.rsplit(".", 1)[-1]



#!/usr/bin/env python3
"""
build-system-graph.py — Generate a system-level graph from per-service KGs.

Scans child directories for knowledge-graph.json files, extracts service
metadata, endpoints, and RPC edges. Outputs system-graph.json.

Usage:
    python build-system-graph.py <project-root> [--services="svc1 svc2"] [--output=<path>]
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SKIP_DIR_NAMES = frozenset({"node_modules", "dist", "build", "target"})
FILE_NODE_TYPES = frozenset({
    "file",
    "config",
    "document",
    "service",
    "pipeline",
    "table",
    "schema",
    "resource",
    "endpoint",
})


def discover_services(
    project_root: str,
    exclude: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Discover child services that have a knowledge graph.

    Returns list of dicts: {name, path, kg_path}
    """
    root = Path(project_root)
    exclude_set = set(exclude or [])

    parent_config = root / ".understand-anything" / "config.json"
    if parent_config.exists():
        try:
            cfg = json.loads(parent_config.read_text(encoding="utf-8"))
            for svc in cfg.get("excludeServices", []):
                exclude_set.add(svc)
        except (json.JSONDecodeError, OSError):
            pass

    services: list[dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        name = entry.name
        if name.startswith(".") or name in SKIP_DIR_NAMES:
            continue
        if name in exclude_set:
            continue

        kg_path = entry / ".understand-anything" / "knowledge-graph.json"
        if kg_path.is_file():
            services.append({
                "name": name,
                "path": str(entry),
                "kg_path": str(kg_path),
            })

    return services


def extract_service_info(service_name: str, kg: dict[str, Any]) -> dict[str, Any]:
    """Extract high-level info from a service's knowledge graph."""
    project = kg.get("project", {})
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])

    endpoints = [n for n in nodes if n.get("type") == "endpoint"]
    rpc_provides = [e for e in edges if e.get("type") == "provides_rpc"]
    rpc_consumes = [e for e in edges if e.get("type") == "consumes_rpc"]
    file_count = sum(1 for n in nodes if n.get("type") in FILE_NODE_TYPES)

    return {
        "name": service_name,
        "project_name": project.get("description", service_name),
        "languages": project.get("languages", []),
        "frameworks": project.get("frameworks", []),
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "files": file_count,
        },
        "endpoints": endpoints,
        "rpc_provides": rpc_provides,
        "rpc_consumes": rpc_consumes,
        "kg_commit": project.get("gitCommitHash", ""),
    }


def _interface_from_detail(detail: str) -> str:
    return detail.split(".")[0].strip() if detail else ""


def _match_rpc_edges(service_infos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Match consumes_rpc → provides_rpc across services to build cross-service edges."""
    providers: dict[str, str] = {}
    for info in service_infos:
        for edge in info["rpc_provides"]:
            iface = _interface_from_detail(edge.get("detail", ""))
            if iface:
                providers[iface] = info["name"]

    rpc_edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for info in service_infos:
        for edge in info["rpc_consumes"]:
            detail = edge.get("detail", "")
            iface = _interface_from_detail(detail)
            target_svc = providers.get(iface)
            if target_svc and target_svc != info["name"]:
                key = (info["name"], target_svc, iface)
                if key not in seen:
                    seen.add(key)
                    rpc_edges.append({
                        "source": f"microservice:{info['name']}",
                        "target": f"microservice:{target_svc}",
                        "type": "rpc_call",
                        "weight": 0.8,
                        "detail": {
                            "interface": iface,
                            "method": detail,
                            "rpcType": "rpc",
                            "evidence": "kg-matched",
                        },
                    })

    return rpc_edges


def build_system_graph(
    project_root: str,
    services: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the system-level graph from per-service KGs."""
    if services is None:
        services = discover_services(project_root)

    if not services:
        return {
            "version": "1.0.0",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "project": {
                "name": Path(project_root).name,
                "serviceCount": 0,
                "totalNodes": 0,
                "totalEdges": 0,
            },
            "nodes": [],
            "edges": [],
            "serviceIndex": {},
        }

    service_infos: list[dict[str, Any]] = []
    for svc in services:
        try:
            kg = json.loads(Path(svc["kg_path"]).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  Warning: skipping {svc['name']}: {exc}", file=sys.stderr)
            continue
        service_infos.append(extract_service_info(svc["name"], kg))

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    service_index: dict[str, dict[str, Any]] = {}
    total_nodes = 0
    total_edges = 0

    for info in service_infos:
        svc_id = f"microservice:{info['name']}"
        svc_path = str(Path(project_root) / info["name"])
        ua_path = os.path.join(svc_path, ".understand-anything")

        nodes.append({
            "id": svc_id,
            "type": "microservice",
            "name": info["project_name"],
            "summary": info["project_name"],
            "languages": info["languages"],
            "frameworks": info["frameworks"],
            "stats": info["stats"],
            "kgPath": f"{info['name']}/.understand-anything/knowledge-graph.json",
            "wikiPath": f"{info['name']}/.understand-anything/wiki/",
            "domainPath": f"{info['name']}/.understand-anything/domain-graph.json",
        })

        for ep in info["endpoints"][:5]:
            ep_id = f"endpoint:{info['name']}:{ep.get('name', ep['id'])}"
            nodes.append({
                "id": ep_id,
                "type": "endpoint",
                "name": ep.get("name", ""),
                "summary": ep.get("summary", ""),
                "service": info["name"],
            })
            edges.append({
                "source": svc_id,
                "target": ep_id,
                "type": "contains",
                "weight": 1.0,
            })

        total_nodes += info["stats"]["nodes"]
        total_edges += info["stats"]["edges"]

        service_index[info["name"]] = {
            "hasKg": True,
            "hasWiki": os.path.exists(os.path.join(ua_path, "wiki", "meta.json")),
            "hasDomain": os.path.exists(os.path.join(ua_path, "domain-graph.json")),
            "kgCommit": info["kg_commit"],
        }

    edges.extend(_match_rpc_edges(service_infos))

    return {
        "version": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": {
            "name": Path(project_root).name,
            "serviceCount": len(service_infos),
            "totalNodes": total_nodes,
            "totalEdges": total_edges,
        },
        "nodes": nodes,
        "edges": edges,
        "serviceIndex": service_index,
    }


def enrich_from_wiki(graph: dict[str, Any], project_root: str) -> dict[str, Any]:
    """Enrich system graph with cross-service data from wiki architecture.json."""
    arch_path = Path(project_root) / ".understand-anything" / "wiki" / "architecture.json"
    if arch_path.exists():
        try:
            arch = json.loads(arch_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            arch = None
        if arch is not None:
            node_ids = {n["id"] for n in graph.get("nodes", [])}
            existing_edges = {
                (e["source"], e["target"], e["type"]) for e in graph.get("edges", [])
            }

            for call in arch.get("crossServiceCalls", []):
                caller_svc = call.get("caller", {}).get("service", "")
                callee_svc = call.get("callee", {}).get("service", "")
                source_id = f"microservice:{caller_svc}"
                target_id = f"microservice:{callee_svc}"

                if source_id not in node_ids or target_id not in node_ids:
                    continue

                edge_key = (source_id, target_id, "rpc_call")
                if edge_key in existing_edges:
                    continue

                iface = call.get("callee", {}).get("interface", "")
                method = call.get("callee", {}).get("method", "")
                graph["edges"].append({
                    "source": source_id,
                    "target": target_id,
                    "type": "rpc_call",
                    "weight": 0.8,
                    "detail": {
                        "interface": iface,
                        "method": f"{iface}.{method}" if iface and method else method,
                        "rpcType": call.get("type", "rpc"),
                        "evidence": "wiki-enriched",
                    },
                })
                existing_edges.add(edge_key)

    ovw_path = Path(project_root) / ".understand-anything" / "wiki" / "overview.json"
    if ovw_path.exists():
        try:
            ovw = json.loads(ovw_path.read_text(encoding="utf-8"))
            if "project" not in graph:
                graph["project"] = {}
            if ovw.get("name"):
                graph["project"]["name"] = ovw["name"]
            if ovw.get("description") is not None:
                graph["project"]["description"] = ovw["description"]
        except (OSError, json.JSONDecodeError):
            pass

    return graph


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Build system-graph.json from per-service KGs")
    parser.add_argument("project_root", help="Parent directory containing service subdirectories")
    parser.add_argument(
        "--services",
        default=None,
        help='Space-separated service names (default: auto-discover)',
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path (default: <project_root>/.understand-anything/system-graph.json)",
    )
    args = parser.parse_args()

    project_root = os.path.abspath(args.project_root)
    if args.services:
        names = args.services.split()
        services = [
            {
                "name": name,
                "path": os.path.join(project_root, name),
                "kg_path": os.path.join(
                    project_root, name, ".understand-anything", "knowledge-graph.json"
                ),
            }
            for name in names
        ]
    else:
        services = None

    graph = build_system_graph(project_root, services)
    graph = enrich_from_wiki(graph, project_root)

    output = args.output or os.path.join(
        project_root, ".understand-anything", "system-graph.json"
    )
    os.makedirs(os.path.dirname(output), exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
        f.write("\n")

    svc_count = graph["project"].get("serviceCount", 0)
    node_count = len(graph["nodes"])
    edge_count = len(graph["edges"])
    print(
        f"[system-graph] Generated: {svc_count} services, "
        f"{node_count} nodes, {edge_count} edges",
        file=sys.stderr,
    )
    print(f"[system-graph] Written to {output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

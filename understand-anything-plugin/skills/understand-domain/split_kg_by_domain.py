#!/usr/bin/env python3
"""
split-kg-by-domain.py — Split a full KG into per-domain subsets using domain discovery results.

Input: knowledge-graph.json + intermediate/domain-discovery.json
Output: intermediate/domain-<id>.json for each domain
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _file_matches_modules(file_path: str, modules: list[str]) -> bool:
    """Check if a file path starts with any of the domain's modules."""
    normalized = file_path.replace("\\", "/")
    return any(normalized.startswith(m.rstrip("/") + "/") or normalized == m for m in modules)


def _node_module(node: dict) -> str:
    fp = node.get("filePath") or ""
    if not fp:
        node_id = node.get("id", "")
        for prefix in ("file:", "class:", "function:", "endpoint:", "service:", "config:"):
            if node_id.startswith(prefix):
                fp = node_id[len(prefix):]
                break
    return fp.replace("\\", "/")


def split_kg_by_domain(kg: dict[str, Any], discovery: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Split KG nodes and edges by domain. Returns {domain_id: {domain, nodes, edges, stats}}."""
    domains = discovery.get("domains", [])
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])

    node_to_domain: dict[str, str] = {}
    for domain in domains:
        domain_id = domain["id"]
        modules = domain.get("modules", [])
        for node in nodes:
            fp = _node_module(node)
            if _file_matches_modules(fp, modules):
                node_to_domain[node["id"]] = domain_id

    result: dict[str, dict[str, Any]] = {}
    for domain in domains:
        domain_id = domain["id"]
        domain_nodes = [n for n in nodes if node_to_domain.get(n["id"]) == domain_id]
        domain_node_ids = {n["id"] for n in domain_nodes}

        domain_edges = [
            e for e in edges
            if e.get("source") in domain_node_ids or e.get("target") in domain_node_ids
        ]

        result[domain_id] = {
            "domain": {"id": domain_id, "name": domain.get("name", ""), "summary": domain.get("summary", "")},
            "nodes": domain_nodes,
            "edges": domain_edges,
            "stats": {"nodes": len(domain_nodes), "edges": len(domain_edges)},
        }

    return result


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python split-kg-by-domain.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    kg_path = project_root / ".understand-anything" / "knowledge-graph.json"
    discovery_path = project_root / ".understand-anything" / "intermediate" / "domain-discovery.json"
    out_dir = project_root / ".understand-anything" / "intermediate"

    if not kg_path.exists():
        print(f"[split-kg] KG not found: {kg_path}", file=sys.stderr)
        return 1
    if not discovery_path.exists():
        print(f"[split-kg] Domain discovery not found: {discovery_path}", file=sys.stderr)
        return 1

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))

    splits = split_kg_by_domain(kg, discovery)

    for domain_id, data in splits.items():
        safe_name = domain_id.replace("domain:", "")
        out_path = out_dir / f"domain-{safe_name}.json"
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[split-kg] {domain_id}: {data['stats']['nodes']} nodes, {data['stats']['edges']} edges")

    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Domain-scoped knowledge graph filter for incremental wiki-worker dispatch.

Usage:
    python3 wiki_kg_filter.py <kg_path> <dg_path> <domain_id> [--max-nodes=200]

Outputs filtered knowledge-graph JSON to stdout (same schema, fewer nodes/edges).
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

RPC_EDGE_TYPES = frozenset({"provides_rpc", "consumes_rpc"})
CONNECTED_NODE_TYPES = frozenset({"endpoint", "service"})


def _extract_domain_steps(dg: dict, domain_id: str) -> set[str]:
    """Return step node IDs belonging to the given domain."""
    flow_ids: set[str] = set()
    step_ids: set[str] = set()

    for edge in dg.get("edges", []):
        if edge.get("type") == "contains_flow" and edge.get("source") == domain_id:
            flow_ids.add(edge["target"])

    for edge in dg.get("edges", []):
        if edge.get("type") == "flow_step" and edge.get("source") in flow_ids:
            step_ids.add(edge["target"])

    return step_ids


def _step_file_paths(dg: dict, step_ids: set[str]) -> set[str]:
    nodes_by_id = {n["id"]: n for n in dg.get("nodes", []) if n.get("id")}
    paths: set[str] = set()
    for step_id in step_ids:
        step = nodes_by_id.get(step_id)
        if step and step.get("type") == "step" and step.get("filePath"):
            paths.add(step["filePath"])
    return paths


def _nodes_for_file_paths(kg: dict, file_paths: set[str]) -> set[str]:
    if not file_paths:
        return set()
    ids: set[str] = set()
    for node in kg.get("nodes", []):
        node_id = node.get("id")
        if not node_id:
            continue
        fp = node.get("filePath")
        if fp and fp in file_paths:
            ids.add(node_id)
    return ids


def _edge_expands_subgraph(
    edge: dict, node_ids: set[str], nodes_by_id: dict[str, dict]
) -> bool:
    src, tgt = edge.get("source"), edge.get("target")
    if src not in node_ids and tgt not in node_ids:
        return False
    if edge.get("type") in RPC_EDGE_TYPES:
        return True
    if edge.get("type") == "handled_by":
        return True
    other = tgt if src in node_ids else src
    return nodes_by_id.get(other, {}).get("type") in CONNECTED_NODE_TYPES


def _expand_with_special_edges(
    kg: dict, node_ids: set[str]
) -> tuple[set[str], list[dict]]:
    """Add endpoint/service nodes and RPC edges touching the current node set."""
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", []) if n.get("id")}
    edges_out: list[dict] = []
    seen_edges: set[tuple[str, str, str]] = set()

    def add_edge(edge: dict) -> None:
        key = (edge["source"], edge["target"], edge.get("type", ""))
        if key not in seen_edges:
            seen_edges.add(key)
            edges_out.append(edge)

    changed = True
    while changed:
        changed = False
        for edge in kg.get("edges", []):
            if not _edge_expands_subgraph(edge, node_ids, nodes_by_id):
                continue
            src, tgt = edge["source"], edge["target"]
            for end in (src, tgt):
                if end not in node_ids:
                    node_ids.add(end)
                    changed = True
            add_edge(edge)

    return node_ids, edges_out


def _internal_edges(kg: dict, node_ids: set[str]) -> list[dict]:
    return [
        e
        for e in kg.get("edges", [])
        if e.get("source") in node_ids and e.get("target") in node_ids
    ]


def _trim_to_max_nodes(
    kg: dict,
    node_ids: set[str],
    edges: list[dict],
    max_nodes: int,
    preferred_file_paths: set[str],
) -> set[str]:
    if len(node_ids) <= max_nodes:
        return node_ids

    nodes_by_id = {n["id"]: n for n in kg.get("nodes", []) if n.get("id")}
    degree: dict[str, int] = {nid: 0 for nid in node_ids}
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if src in degree:
            degree[src] += 1
        if tgt in degree:
            degree[tgt] += 1

    def _in_domain_files(nid: str) -> bool:
        fp = nodes_by_id.get(nid, {}).get("filePath")
        return bool(fp and fp in preferred_file_paths)

    ranked = sorted(
        node_ids,
        key=lambda nid: (
            0 if _in_domain_files(nid) else 1,
            -degree.get(nid, 0),
            nid,
        ),
    )
    return set(ranked[:max_nodes])


def filter_kg_for_domain(
    kg: dict,
    dg: dict,
    domain_id: str,
    *,
    max_nodes: int = 200,
) -> dict:
    """Return a KG subset scoped to one domain's step file paths and related edges."""
    domain_ids = {
        n["id"] for n in dg.get("nodes", []) if n.get("type") == "domain" and n.get("id")
    }
    if domain_id not in domain_ids:
        return _empty_filtered_kg(kg)

    step_ids = _extract_domain_steps(dg, domain_id)
    file_paths = _step_file_paths(dg, step_ids)
    node_ids = _nodes_for_file_paths(kg, file_paths)

    node_ids, special_edges = _expand_with_special_edges(kg, node_ids)
    all_edges = _internal_edges(kg, node_ids)
    # Merge special edges (may duplicate internal; dedupe by key)
    edge_keys = {(e["source"], e["target"], e.get("type", "")) for e in all_edges}
    for edge in special_edges:
        key = (edge["source"], edge["target"], edge.get("type", ""))
        if key not in edge_keys:
            edge_keys.add(key)
            all_edges.append(edge)

    if max_nodes > 0 and len(node_ids) > max_nodes:
        node_ids = _trim_to_max_nodes(
            kg, node_ids, all_edges, max_nodes, file_paths
        )
        all_edges = [
            e
            for e in all_edges
            if e.get("source") in node_ids and e.get("target") in node_ids
        ]

    nodes_by_id = {n["id"]: n for n in kg.get("nodes", []) if n.get("id")}
    filtered_nodes = [copy.deepcopy(nodes_by_id[nid]) for nid in sorted(node_ids) if nid in nodes_by_id]
    filtered_edges = [copy.deepcopy(e) for e in all_edges]

    result = {
        k: copy.deepcopy(v)
        for k, v in kg.items()
        if k not in ("nodes", "edges")
    }
    result["nodes"] = filtered_nodes
    result["edges"] = filtered_edges
    return result


def _empty_filtered_kg(kg: dict) -> dict:
    result = {
        k: copy.deepcopy(v)
        for k, v in kg.items()
        if k not in ("nodes", "edges")
    }
    result["nodes"] = []
    result["edges"] = []
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Filter knowledge-graph.json to nodes relevant to one domain."
    )
    parser.add_argument("kg_path", help="Path to knowledge-graph.json")
    parser.add_argument("dg_path", help="Path to domain-graph.json")
    parser.add_argument("domain_id", help="Target domain node ID")
    parser.add_argument(
        "--max-nodes",
        type=int,
        default=200,
        help="Maximum nodes to retain (most-connected kept when trimming)",
    )
    args = parser.parse_args(argv)

    kg = json.loads(Path(args.kg_path).read_text(encoding="utf-8"))
    dg = json.loads(Path(args.dg_path).read_text(encoding="utf-8"))
    filtered = filter_kg_for_domain(
        kg, dg, args.domain_id, max_nodes=args.max_nodes
    )
    json.dump(filtered, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

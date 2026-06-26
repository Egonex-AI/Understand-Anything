#!/usr/bin/env python3
"""
combine-graphs.py — Namespace + union per-repo knowledge graphs into one combined graph.

Usage:
    python combine-graphs.py <out> <repo1>:<ns1> <repo2>:<ns2> ...

For each <repo>:<ns> arg:
  - Loads <repo>/.understand-anything/knowledge-graph.json
  - Namespaces every node id and filePath with <ns>/
  - Rewrites all edge endpoints through the per-repo id map
  - Discards the repo's internal layers; creates one layer:<ns> per repo
  - Adds a module:<ns> anchor node per repo

Union + dedup across all repos:
  - Nodes by id (last wins)
  - Edges by (source, target, type) — higher weight wins

Output:
    <out>/.understand-anything/intermediate/combined-graph.json
    <out>/.understand-anything/intermediate/id-map.json

Task 3 of /understand-crossrepo. Task 5 adds cross-repo edges to this substrate.
"""

import json
import sys
from pathlib import Path
from typing import Any


_SCAN_ARTIFACT_MARKERS = (".understand-anything", ".trash-")


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _namespace_id(node_id: str, ns: str) -> str:
    """Insert <ns>/ after the FIRST colon only.

    file:Dockerfile                  → file:<ns>/Dockerfile
    endpoint:api/x.py                → endpoint:<ns>/api/x.py
    function:api/x.py:foo            → function:<ns>/api/x.py:foo
    """
    kind, rest = node_id.split(":", 1)
    return f"{kind}:{ns}/{rest}"


def _is_scan_artifact(node: dict) -> bool:
    fp = node.get("filePath", "") or ""
    nid = node.get("id", "") or ""
    for marker in _SCAN_ARTIFACT_MARKERS:
        if marker in fp or marker in nid:
            return True
    return False


def _is_top_level(namespaced_id: str) -> bool:
    """True for file/endpoint/service nodes — not function/class members."""
    kind = namespaced_id.split(":")[0]
    return kind in ("file", "endpoint", "service")


def load_graph(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Warning: skipping {path}: {e}", file=sys.stderr)
        return None
    if not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        print(f"  Warning: skipping {path}: missing nodes or edges", file=sys.stderr)
        return None
    return data


def namespace_repo(graph: dict, ns: str) -> tuple[dict, dict]:
    """Namespace all ids in `graph` for `ns`. Returns (namespaced_graph, id_map).

    id_map: old_id → new_id (for this repo only — no global collision risk).
    """
    id_map: dict[str, str] = {}

    # Phase 1: drop scan artifacts, build id_map for survivors
    kept_nodes: list[dict] = []
    for node in graph.get("nodes", []):
        if _is_scan_artifact(node):
            continue
        old_id = node.get("id", "")
        if not old_id:
            continue
        new_id = _namespace_id(old_id, ns)
        id_map[old_id] = new_id
        kept_nodes.append(node)

    # Phase 2: rewrite node fields
    ns_nodes: list[dict] = []
    for node in kept_nodes:
        n = dict(node)
        n["id"] = id_map[node["id"]]
        if "filePath" in n and n["filePath"]:
            n["filePath"] = f"{ns}/{n['filePath']}"
        # Tag with repo
        tags = list(n.get("tags") or [])
        if f"repo:{ns}" not in tags:
            tags.append(f"repo:{ns}")
        n["tags"] = tags
        n["repo"] = ns
        ns_nodes.append(n)

    # Phase 3: rewrite edges, drop dangling (apply id_map; same split rule for unknowns)
    dropped_edges = 0
    ns_edges: list[dict] = []
    for edge in graph.get("edges", []):
        src_old = edge.get("source", "")
        tgt_old = edge.get("target", "")

        if src_old in id_map:
            new_src = id_map[src_old]
        else:
            # Dangling: apply split rule best-effort, then drop
            dropped_edges += 1
            continue

        if tgt_old in id_map:
            new_tgt = id_map[tgt_old]
        else:
            dropped_edges += 1
            continue

        e = dict(edge)
        e["source"] = new_src
        e["target"] = new_tgt
        ns_edges.append(e)

    if dropped_edges:
        print(f"  [{ns}] dropped {dropped_edges} dangling edges", file=sys.stderr)

    return {"nodes": ns_nodes, "edges": ns_edges}, id_map


def build_layer(ns: str, ns_nodes: list[dict]) -> dict:
    """One layer:<ns> whose nodeIds = file-level nodes + module:<ns> anchor."""
    top_level_ids = sorted(
        n["id"] for n in ns_nodes if _is_top_level(n["id"])
    )
    anchor_id = f"module:{ns}"
    node_ids = sorted(set(top_level_ids + [anchor_id]))
    return {
        "id": f"layer:{ns}",
        "name": ns,
        "nodeIds": node_ids,
    }


def build_module_anchor(ns: str) -> dict:
    return {
        "id": f"module:{ns}",
        "type": "module",
        "name": ns,
        "repo": ns,
    }


def combine(out: Path, repo_ns_pairs: list[tuple[Path, str]]) -> None:
    intermediate = out / ".understand-anything" / "intermediate"
    intermediate.mkdir(parents=True, exist_ok=True)

    all_id_maps: dict[str, dict] = {}  # ns → {old → new}
    # Global union structures
    nodes_by_id: dict[str, dict] = {}
    edges_by_key: dict[tuple, dict] = {}  # (src, tgt, type) → edge
    layers: list[dict] = []

    for repo, ns in repo_ns_pairs:
        kg_path = repo / ".understand-anything" / "knowledge-graph.json"
        graph = load_graph(kg_path)
        if graph is None:
            print(f"  Skipping {ns} (could not load {kg_path})", file=sys.stderr)
            continue

        ns_graph, id_map = namespace_repo(graph, ns)
        all_id_maps[ns] = id_map

        # Add module anchor node
        anchor = build_module_anchor(ns)
        ns_graph["nodes"].append(anchor)

        # Union nodes (last wins on collision)
        for node in ns_graph["nodes"]:
            nodes_by_id[node["id"]] = node

        # Union edges (higher weight wins on collision)
        for edge in ns_graph["edges"]:
            key = (edge.get("source", ""), edge.get("target", ""), edge.get("type", ""))
            existing = edges_by_key.get(key)
            if existing is None or _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
                edges_by_key[key] = edge

        # Build per-repo layer (pass ns_nodes without anchor to avoid double-add in _is_top_level)
        layers.append(build_layer(ns, ns_graph["nodes"]))

    # Drop edges referencing nodes not in the union (cross-repo dangling — Task 5 adds those)
    node_ids_set = set(nodes_by_id.keys())
    valid_edges = [
        e for e in edges_by_key.values()
        if e["source"] in node_ids_set and e["target"] in node_ids_set
    ]

    # Stable sort for determinism
    sorted_nodes = sorted(nodes_by_id.values(), key=lambda n: n["id"])
    sorted_edges = sorted(valid_edges, key=lambda e: (e["source"], e["target"], e.get("type", "")))
    sorted_layers = sorted(layers, key=lambda l: l["id"])

    combined = {
        "version": "1.0.0",
        "project": {"name": "combined", "repos": [ns for _, ns in repo_ns_pairs]},
        "nodes": sorted_nodes,
        "edges": sorted_edges,
        "layers": sorted_layers,
    }

    (intermediate / "combined-graph.json").write_text(
        json.dumps(combined, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (intermediate / "id-map.json").write_text(
        json.dumps(all_id_maps, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(
        f"combined-graph: {len(sorted_nodes)} nodes, {len(sorted_edges)} edges, "
        f"{len(sorted_layers)} layers → {intermediate / 'combined-graph.json'}",
        file=sys.stderr,
    )


def parse_args(argv: list[str]) -> tuple[Path, list[tuple[Path, str]]]:
    if len(argv) < 3:
        print(
            "Usage: python combine-graphs.py <out> <repo1>:<ns1> <repo2>:<ns2> ...",
            file=sys.stderr,
        )
        sys.exit(1)

    out = Path(argv[1]).resolve()
    pairs: list[tuple[Path, str]] = []
    for arg in argv[2:]:
        if ":" in arg:
            # Split on the LAST colon that separates path from ns
            # (paths on Windows may have drive letters, but we're on POSIX anyway)
            # Use the FIRST colon only if arg looks like /abs/path:ns or rel/path:ns
            # Safest: rsplit on ":" with maxsplit=1
            repo_str, ns = arg.rsplit(":", 1)
        else:
            repo_str = arg
            ns = Path(arg).name
        pairs.append((Path(repo_str).resolve(), ns))

    return out, pairs


def main() -> None:
    out, pairs = parse_args(sys.argv)
    combine(out, pairs)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
condense_kg_for_domain.py — Condense a full KG into module-level summary for domain discovery.

Input: knowledge-graph.json (2000+ nodes)
Output: intermediate/kg-summary.json (~15k tokens)
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

KEY_NODE_TYPES = frozenset({"endpoint", "service", "pipeline", "table", "schema"})
MAX_SUMMARIES_PER_MODULE = 3
MAX_EDGE_SAMPLES = 3
_VERB_PREFIXES = frozenset({
    "get", "create", "update", "delete", "find", "list", "save",
    "load", "remove", "add", "set", "check", "validate", "build",
    "handle", "process", "fetch", "send", "receive",
})


def _get_module(path_or_id: str) -> str:
    """Extract top-level module from a file path or node ID."""
    clean = path_or_id
    for prefix in ("file:", "class:", "function:", "endpoint:", "service:", "config:", "document:"):
        if clean.startswith(prefix):
            clean = clean[len(prefix):]
            break
    parts = clean.replace("\\", "/").split("/")
    # Return first two significant directory segments (e.g., "src/order")
    significant = [p for p in parts if p and p != "."]
    if len(significant) >= 3:
        return "/".join(significant[:2])
    elif len(significant) >= 2:
        return significant[0]
    return "(root)"


def _extract_entity_nouns(node_names: list[str]) -> list[str]:
    """Extract core entity nouns from node names by stripping common verb prefixes."""
    import re as _re
    nouns: set[str] = set()
    for name in node_names:
        # Split on separators and CamelCase boundaries
        parts = _re.split(r"[_\-/]|(?<=[a-z])(?=[A-Z])", name)
        for part in parts:
            if part.lower() not in _VERB_PREFIXES and len(part) > 2:
                nouns.add(part)
    return sorted(nouns)


def _build_capability_clusters(modules: list[dict], key_nodes: list[dict]) -> list[dict]:
    """Group keyNodes within a module by entity noun to identify capability clusters."""
    mod_keynodes: dict[str, list[dict]] = defaultdict(list)
    for kn in key_nodes:
        mod_keynodes[kn["module"]].append(kn)

    enriched_modules = []
    for mod in modules:
        path = mod["path"]
        kns = mod_keynodes.get(path, [])
        if not kns:
            mod["candidateCapabilityClusters"] = []
            enriched_modules.append(mod)
            continue

        clusters: dict[str, list[str]] = defaultdict(list)
        for kn in kns:
            nouns = _extract_entity_nouns([kn["name"]])
            if nouns:
                clusters[nouns[0]].append(kn["name"])
            else:
                clusters["_unclassified"].append(kn["name"])

        mod["candidateCapabilityClusters"] = [
            {"entityNoun": noun, "keyNodeNames": names}
            for noun, names in sorted(clusters.items())
            if len(names) >= 1
        ]
        enriched_modules.append(mod)

    return enriched_modules


def condense_kg(kg: dict[str, Any]) -> dict[str, Any]:
    """Condense a full KG into a module-level summary."""
    nodes = kg.get("nodes", [])
    edges = kg.get("edges", [])
    project = kg.get("project", {})
    layers = kg.get("layers", [])

    # Group nodes by module
    module_data: dict[str, dict] = defaultdict(lambda: {
        "nodeCount": 0,
        "typeBreakdown": Counter(),
        "tags": set(),
        "summaries": [],
        "files": [],
    })

    key_nodes: list[dict] = []

    for node in nodes:
        fp = node.get("filePath") or node.get("id", "")
        mod = _get_module(fp)
        md = module_data[mod]
        md["nodeCount"] += 1
        md["typeBreakdown"][node.get("type", "unknown")] += 1
        for tag in node.get("tags", []):
            md["tags"].add(tag)
        summary = node.get("summary", "")
        if summary and len(md["summaries"]) < MAX_SUMMARIES_PER_MODULE:
            md["summaries"].append(summary)
        name = node.get("name", "")
        if name:
            md["files"].append(name)

        if node.get("type") in KEY_NODE_TYPES:
            key_nodes.append({
                "id": node["id"],
                "name": node.get("name", ""),
                "summary": node.get("summary", ""),
                "tags": node.get("tags", []),
                "module": mod,
            })

    # Build module list
    modules = []
    for path, md in sorted(module_data.items()):
        modules.append({
            "path": path,
            "nodeCount": md["nodeCount"],
            "typeBreakdown": dict(md["typeBreakdown"]),
            "tags": sorted(md["tags"]),
            "summaries": md["summaries"],
            "files": md["files"][:20],  # limit file list
        })

    # Cross-module edges
    edge_groups: dict[tuple, dict] = defaultdict(lambda: {"count": 0, "samples": []})
    for edge in edges:
        src_mod = _get_module(edge.get("source", ""))
        tgt_mod = _get_module(edge.get("target", ""))
        if src_mod != tgt_mod:
            key = (src_mod, tgt_mod, edge.get("type", "unknown"))
            eg = edge_groups[key]
            eg["count"] += 1
            desc = edge.get("description", "")
            if desc and len(eg["samples"]) < MAX_EDGE_SAMPLES:
                eg["samples"].append(desc)

    cross_module_edges = []
    for (src, tgt, etype), data in sorted(edge_groups.items()):
        cross_module_edges.append({
            "sourceModule": src,
            "targetModule": tgt,
            "type": etype,
            "count": data["count"],
            "samples": data["samples"],
        })

    modules = _build_capability_clusters(modules, key_nodes)

    return {
        "project": project,
        "stats": {"totalNodes": len(nodes), "totalEdges": len(edges)},
        "modules": modules,
        "keyNodes": key_nodes,
        "crossModuleEdges": cross_module_edges,
        "layers": layers,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python condense_kg_for_domain.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    kg_path = project_root / ".understand-anything" / "knowledge-graph.json"

    if not kg_path.exists():
        print(f"[condense-kg] KG not found: {kg_path}", file=sys.stderr)
        return 1

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    summary = condense_kg(kg)

    out_dir = project_root / ".understand-anything" / "intermediate"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "kg-summary.json"
    out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[condense-kg] Condensed {summary['stats']['totalNodes']} nodes → {len(summary['modules'])} modules, {len(summary['keyNodes'])} key nodes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

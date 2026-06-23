#!/usr/bin/env python3
"""
merge-subdomain-graphs.py — Merge subdomain knowledge-graph files into one.

Auto-discovers *knowledge-graph*.json files in .understand-anything/
(excluding knowledge-graph.json itself), loads the existing
knowledge-graph.json as a base if present, and merges everything
into a single knowledge-graph.json.

Usage:
    python merge-subdomain-graphs.py <project-root> [file1.json file2.json ...]

If no files are specified, auto-discovers subdomain graphs. The main
knowledge-graph.json is loaded as a base but never as a discovery input
(prevents self-merging on repeated runs).

Output:
    <project-root>/.understand-anything/knowledge-graph.json
"""

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def _num(v: Any) -> float:
    """Coerce a value to float for safe comparison (handles string weights)."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_graph(path: Path) -> dict[str, Any] | None:
    """Load and minimally validate a knowledge graph JSON file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Skipping {path.name}: {e}", file=sys.stderr)
        return None

    # Must have at minimum nodes and edges arrays
    if not isinstance(data.get("nodes"), list) or not isinstance(data.get("edges"), list):
        print(f"  Skipping {path.name}: missing nodes or edges array", file=sys.stderr)
        return None

    return data


def merge_graphs(graphs: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """Merge multiple knowledge graph dicts into one. Returns (merged, report_lines)."""

    # ── Pattern counters for "Fixed" report ──────────────────────────
    node_dedup_by_type: Counter[str] = Counter()

    # ── Detail lists for "Could not fix" report ──────────────────────
    unfixable: list[str] = []

    total_input_nodes = sum(len(g.get("nodes", [])) for g in graphs)
    total_input_edges = sum(len(g.get("edges", [])) for g in graphs)

    # ── Nodes: deduplicate by id, later occurrence wins ───────────────
    nodes_by_id: dict[str, dict] = {}
    for g in graphs:
        for node in g.get("nodes", []):
            nid = node.get("id")
            if not nid:
                unfixable.append(f"Node with no 'id' (name={node.get('name', '?')}, type={node.get('type', '?')})")
                continue
            if nid in nodes_by_id:
                node_type = node.get("type", "?")
                node_dedup_by_type[node_type] += 1
            nodes_by_id[nid] = node

    # ── Edges: deduplicate by (source, target, type), higher weight wins
    edge_dedup_count = 0
    edges_by_key: dict[tuple[str, str, str], dict] = {}
    for g in graphs:
        for edge in g.get("edges", []):
            key = (edge.get("source", ""), edge.get("target", ""), edge.get("type", ""))
            existing = edges_by_key.get(key)
            if existing is None:
                edges_by_key[key] = edge
            else:
                edge_dedup_count += 1
                if _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
                    edges_by_key[key] = edge

    # Drop edges referencing missing nodes
    node_ids = set(nodes_by_id.keys())
    valid_edges: list[dict] = []
    for e in edges_by_key.values():
        src, tgt = e.get("source", ""), e.get("target", "")
        if src in node_ids and tgt in node_ids:
            valid_edges.append(e)
        else:
            missing = []
            if src not in node_ids:
                missing.append(f"source '{src}'")
            if tgt not in node_ids:
                missing.append(f"target '{tgt}'")
            unfixable.append(f"Edge {src} → {tgt} ({e.get('type', '?')}): dropped, missing {', '.join(missing)}")

    # ── Layers: merge by id, union nodeIds ────────────────────────────
    layers_by_id: dict[str, dict] = {}
    for g in graphs:
        for layer in g.get("layers", []):
            lid = layer.get("id", "")
            if lid in layers_by_id:
                existing_ids = set(layers_by_id[lid].get("nodeIds", []))
                existing_ids.update(layer.get("nodeIds", []))
                layers_by_id[lid]["nodeIds"] = list(existing_ids)
            else:
                layers_by_id[lid] = {**layer}

    # Drop dangling layer nodeIds
    dropped_layer_refs = 0
    for layer in layers_by_id.values():
        before = len(layer.get("nodeIds", []))
        layer["nodeIds"] = [nid for nid in layer.get("nodeIds", []) if nid in node_ids]
        diff = before - len(layer["nodeIds"])
        if diff:
            dropped_layer_refs += diff

    # ── Tour: concatenate, merge steps with same title ─────────────────
    all_tour_steps: list[dict] = []
    title_to_step: dict[str, dict] = {}
    for g in graphs:
        for step in g.get("tour", []):
            title = step.get("title", "")
            if title in title_to_step:
                # Merge nodeIds from duplicate-titled steps (e.g. both
                # subdomains produce a "Project Overview" step 1)
                existing = title_to_step[title]
                for nid in step.get("nodeIds", []):
                    if nid not in existing.get("nodeIds", []):
                        existing.setdefault("nodeIds", []).append(nid)
                # Keep the longer description
                if len(step.get("description", "")) > len(existing.get("description", "")):
                    existing["description"] = step["description"]
            else:
                new_step = {**step}
                title_to_step[title] = new_step
                all_tour_steps.append(new_step)

    # Drop dangling tour nodeIds and re-number
    dropped_tour_refs = 0
    for i, step in enumerate(all_tour_steps, start=1):
        step["order"] = i
        before = len(step.get("nodeIds", []))
        step["nodeIds"] = [nid for nid in step.get("nodeIds", []) if nid in node_ids]
        diff = before - len(step["nodeIds"])
        if diff:
            dropped_tour_refs += diff

    # ── Project metadata: merge ───────────────────────────────────────
    languages: list[str] = []
    frameworks: list[str] = []
    descriptions: list[str] = []
    latest_at = ""
    latest_hash = ""
    project_name = ""

    for g in graphs:
        proj = g.get("project", {})
        project_name = proj.get("name", "") or project_name
        for lang in proj.get("languages", []):
            if lang not in languages:
                languages.append(lang)
        for fw in proj.get("frameworks", []):
            if fw not in frameworks:
                frameworks.append(fw)
        desc = proj.get("description", "")
        if desc and desc not in descriptions:
            descriptions.append(desc)
        analyzed = proj.get("analyzedAt", "")
        if analyzed > latest_at:
            latest_at = analyzed
            latest_hash = proj.get("gitCommitHash", latest_hash)

    # ── Build report ─────────────────────────────────────────────────
    report: list[str] = []
    report.append(f"Input: {total_input_nodes} nodes, {total_input_edges} edges (from {len(graphs)} graphs)")

    # Fixed section
    fixed_lines: list[str] = []
    if node_dedup_by_type:
        for ntype, count in node_dedup_by_type.most_common():
            fixed_lines.append(f"  {count:>4} × duplicate '{ntype}' nodes removed (kept later)")
    if edge_dedup_count:
        fixed_lines.append(f"  {edge_dedup_count:>4} × duplicate edges removed (kept higher weight)")
    if dropped_layer_refs:
        fixed_lines.append(f"  {dropped_layer_refs:>4} × dangling layer nodeId refs removed")
    if dropped_tour_refs:
        fixed_lines.append(f"  {dropped_tour_refs:>4} × dangling tour nodeId refs removed")

    if fixed_lines:
        total_fixed = sum(node_dedup_by_type.values()) + edge_dedup_count + dropped_layer_refs + dropped_tour_refs
        report.append("")
        report.append(f"Fixed ({total_fixed} corrections):")
        report.extend(fixed_lines)

    # Could not fix section
    if unfixable:
        report.append("")
        report.append(f"Could not fix ({len(unfixable)} issues — needs agent review):")
        for detail in unfixable:
            report.append(f"  - {detail}")

    # Output stats
    report.append("")
    report.append(f"Output: {len(nodes_by_id)} nodes, {len(valid_edges)} edges, {len(layers_by_id)} layers, {len(all_tour_steps)} tour steps")

    merged: dict[str, Any] = {
        "version": "1.0.0",
        "project": {
            "name": project_name,
            "languages": languages,
            "frameworks": frameworks,
            "description": " | ".join(descriptions) if len(descriptions) > 1 else (descriptions[0] if descriptions else ""),
            "analyzedAt": latest_at,
            "gitCommitHash": latest_hash,
        },
        "nodes": list(nodes_by_id.values()),
        "edges": valid_edges,
        "layers": list(layers_by_id.values()),
        "tour": all_tour_steps,
    }

    return merged, report


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python merge-subdomain-graphs.py <project-root> [file1.json file2.json ...]", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    ua_dir = project_root / ".understand-anything"

    if not ua_dir.is_dir():
        print(f"Error: {ua_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    output_path = ua_dir / "knowledge-graph.json"

    # Determine which files to merge
    if len(sys.argv) > 2:
        # Explicit file list
        graph_files = [Path(f).resolve() for f in sys.argv[2:]]
    else:
        # Auto-discover subdomain graphs — exclude the main output file
        # to avoid self-merging on repeated runs
        graph_files = sorted(
            p for p in ua_dir.glob("*knowledge-graph*.json")
            if p.name != "knowledge-graph.json"
        )

    if not graph_files:
        print("No subdomain graphs found to merge", file=sys.stderr)
        sys.exit(0)

    print(f"Found {len(graph_files)} subdomain graphs:", file=sys.stderr)
    for f in graph_files:
        print(f"  - {f.name}", file=sys.stderr)

    # Load subdomain graphs
    graphs: list[dict[str, Any]] = []
    for f in graph_files:
        g = load_graph(f)
        if g is not None:
            graphs.append(g)
            node_count = len(g.get("nodes", []))
            edge_count = len(g.get("edges", []))
            print(f"    Loaded {f.name}: {node_count} nodes, {edge_count} edges", file=sys.stderr)

    if not graphs:
        print("Error: no valid subdomain graphs loaded", file=sys.stderr)
        sys.exit(1)

    # Load the existing main graph as base (if it exists)
    if output_path.exists():
        base = load_graph(output_path)
        if base:
            node_count = len(base.get("nodes", []))
            edge_count = len(base.get("edges", []))
            print(f"    Loaded base knowledge-graph.json: {node_count} nodes, {edge_count} edges", file=sys.stderr)
            graphs.insert(0, base)  # Base first — subdomain data wins on conflict

    # Merge
    merged, report = merge_graphs(graphs)

    # Print report
    print("", file=sys.stderr)
    for line in report:
        print(line, file=sys.stderr)

    # Write output
    output_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")

    size_kb = output_path.stat().st_size / 1024
    print(f"\nWritten to {output_path} ({size_kb:.0f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()

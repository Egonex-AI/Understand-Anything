#!/usr/bin/env python3
"""
merge_domain_results.py — Combine per-domain flow extraction results into final domain-analysis.json.

Input: intermediate/domain-discovery.json + intermediate/flows-*.json
Output: intermediate/domain-analysis.json
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _get_git_commit_hash(project_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return ""


def build_project_with_provenance(
    project: dict[str, Any],
    project_root: Path,
    *,
    generation_mode: str = "full",
) -> dict[str, Any]:
    """Stamp project metadata with derive-stage provenance for artifact validation."""
    analyzed_at = datetime.now(timezone.utc).isoformat()
    git_hash = _get_git_commit_hash(project_root)

    stamped = dict(project)
    stamped.setdefault("analyzedAt", analyzed_at)
    stamped.setdefault("gitCommitHash", git_hash)
    stamped["provenance"] = {
        "generationMode": generation_mode,
        "completedStages": ["derive"],
        "degraded": False,
        "gitCommitHash": git_hash,
        "toolVersion": "1.0.0",
        "analyzedAt": analyzed_at,
    }
    return stamped


def merge_domain_results(
    discovery: dict[str, Any],
    flows_by_domain: dict[str, dict[str, Any]],
    project: dict[str, Any],
) -> dict[str, Any]:
    """Merge domain discovery + per-domain flows into final domain graph."""
    nodes: list[dict] = []
    edges: list[dict] = []

    for domain_info in discovery.get("domains", []):
        domain_id = domain_info["id"]
        nodes.append({
            "id": domain_id,
            "type": "domain",
            "name": domain_info.get("name", ""),
            "summary": domain_info.get("summary", ""),
            "tags": domain_info.get("tags", []),
            "complexity": "moderate",
            "domainMeta": {
                "entities": domain_info.get("entities", []),
                "businessRules": domain_info.get("businessRules", []),
                "crossDomainInteractions": domain_info.get("crossDomainInteractions", []),
            },
        })

        domain_flows = flows_by_domain.get(domain_id, {})
        for flow in domain_flows.get("flows", []):
            flow_id = flow["id"]
            nodes.append({
                "id": flow_id,
                "type": "flow",
                "name": flow.get("name", ""),
                "summary": flow.get("summary", ""),
                "tags": flow.get("tags", []),
                "complexity": flow.get("complexity", "moderate"),
                "domainMeta": flow.get("domainMeta", {}),
            })
            edges.append({
                "source": domain_id,
                "target": flow_id,
                "type": "contains_flow",
                "direction": "forward",
                "weight": 1.0,
            })

            steps = flow.get("steps", [])
            n_steps = len(steps)
            for i, step in enumerate(steps):
                nodes.append({
                    "id": step["id"],
                    "type": "step",
                    "name": step.get("name", ""),
                    "summary": step.get("summary", ""),
                    "tags": step.get("tags", []),
                    "complexity": step.get("complexity", "simple"),
                    "filePath": step.get("filePath", ""),
                    "lineRange": step.get("lineRange", [0, 0]),
                })
                weight = round((i + 1) / max(n_steps, 1), 1) if n_steps > 0 else 0.1
                weight = max(0.1, min(weight, 1.0))
                edges.append({
                    "source": flow_id,
                    "target": step["id"],
                    "type": "flow_step",
                    "direction": "forward",
                    "weight": weight,
                })

        for cd_edge in domain_flows.get("crossDomainEdges", []):
            edges.append({
                "source": cd_edge.get("source", domain_id),
                "target": cd_edge.get("target", ""),
                "type": "cross_domain",
                "direction": "forward",
                "description": cd_edge.get("description", ""),
                "weight": 0.6,
            })

    seen_cd: set[tuple] = set()
    deduped_edges: list[dict] = []
    for e in edges:
        if e["type"] == "cross_domain":
            key = (e["source"], e["target"])
            if key in seen_cd:
                continue
            seen_cd.add(key)
        deduped_edges.append(e)

    return {
        "version": "1.0.0",
        "project": project,
        "nodes": nodes,
        "edges": deduped_edges,
        "layers": [],
        "tour": [],
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python merge_domain_results.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    inter_dir = project_root / ".understand-anything" / "intermediate"

    discovery_path = inter_dir / "domain-discovery.json"
    if not discovery_path.exists():
        print(f"[merge-domain] Discovery not found: {discovery_path}", file=sys.stderr)
        return 1

    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))

    kg_path = project_root / ".understand-anything" / "knowledge-graph.json"
    project = {}
    if kg_path.exists():
        kg = json.loads(kg_path.read_text(encoding="utf-8"))
        project = kg.get("project", {})

    flows_by_domain: dict[str, dict] = {}
    for domain_info in discovery.get("domains", []):
        domain_id = domain_info["id"]
        safe_name = domain_id.replace("domain:", "")
        flows_path = inter_dir / f"flows-{safe_name}.json"
        if flows_path.exists():
            flows_by_domain[domain_id] = json.loads(flows_path.read_text(encoding="utf-8"))
        else:
            print(f"[merge-domain] WARNING: Missing flows for {domain_id}")

    project = build_project_with_provenance(project, project_root)
    result = merge_domain_results(discovery, flows_by_domain, project)

    out_path = inter_dir / "domain-analysis.json"
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    n_domains = sum(1 for n in result["nodes"] if n["type"] == "domain")
    n_flows = sum(1 for n in result["nodes"] if n["type"] == "flow")
    n_steps = sum(1 for n in result["nodes"] if n["type"] == "step")
    print(f"[merge-domain] Merged: {n_domains} domains, {n_flows} flows, {n_steps} steps")
    return 0


if __name__ == "__main__":
    sys.exit(main())

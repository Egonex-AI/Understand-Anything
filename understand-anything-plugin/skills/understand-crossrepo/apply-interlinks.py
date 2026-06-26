#!/usr/bin/env python3
"""
apply-interlinks.py — Task 5 of /understand-crossrepo.

Usage:
    python apply-interlinks.py <out>

Reads:
    <out>/.understand-anything/intermediate/combined-graph.json
    <out>/.understand-anything/intermediate/crossrepo-edges.json

Writes:
    <out>/.understand-anything/knowledge-graph.json
    <out>/.understand-anything/meta.json
    <out>/.understand-anything/tmp/ua-inline-validate.cjs  (validator)
    <out>/.understand-anything/intermediate/review.json    (validator output)

Steps:
  1. Backfill any module:<ns> anchor nodes missing summary/tags (combine-graphs doesn't emit them).
  2. Synthesize external infra nodes + layer for any external:<svc> edge targets.
  3. Apply crossrepo edges: assign x<i> ids, dedup, drop dangling, tag low-confidence.
  4. Assemble final knowledge-graph.json.
  5. Run bundled inline validator; assert issues == [].
  6. Write meta.json.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Inline validator (verbatim from skills/understand/SKILL.md Phase 6) ────────
_VALIDATOR_CJS = r"""#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);
  const assigned = new Map();
  if (!Array.isArray(graph.layers)) { if (graph.layers) warnings.push('graph.layers is not an array'); graph.layers = []; }
  if (!Array.isArray(graph.tour)) { if (graph.tour) warnings.push('graph.tour is not an array'); graph.tour = []; }
  graph.layers.forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) issues.push(`File node '${id}' not in any layer`);
  });
  graph.tour.forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
"""

_FILE_LEVEL_TYPES = {
    "file", "config", "document", "service", "pipeline",
    "table", "schema", "resource", "endpoint",
}


def _load(path: Path) -> dict | list:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def _backfill_node(node: dict) -> dict:
    """Normalize a node so it passes the dashboard's core/schema.ts GraphNodeSchema.

    The inline .cjs validator only checks summary/tags, but the dashboard's stricter
    schema also requires `complexity` and rejects a non-tuple `lineRange` (some
    per-repo graphs store lineRange as a string) — a rejected node is dropped, which
    cascades into dropped edges. Fix both here.
    """
    if not node.get("summary"):
        ntype = node.get("type", "unknown")
        nname = node.get("name", node["id"])
        node["summary"] = f"{ntype.capitalize()} node: {nname}"
    if not node.get("tags"):
        repo = node.get("repo", "")
        node["tags"] = [f"repo:{repo}"] if repo else ["untagged"]
    if node.get("complexity") not in ("simple", "moderate", "complex"):
        node["complexity"] = "moderate"
    # lineRange must be [int, int] or absent (it's optional) — drop anything else.
    lr = node.get("lineRange")
    if lr is not None and not (
        isinstance(lr, (list, tuple)) and len(lr) == 2
        and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in lr)
    ):
        node.pop("lineRange", None)
    return node


# The cross-repo linker emits semantic types (`authenticates_via`, `embeds`) that
# are NOT in the dashboard's core/schema.ts EdgeTypeSchema enum — such edges get
# dropped on load. Map the unsupported ones to the nearest allowed type and keep
# the original meaning in the edge label. All other linker types (calls, depends_on,
# reads_from, writes_to, publishes, subscribes) are already valid and pass through.
_EDGE_TYPE_MAP = {
    "authenticates_via": "depends_on",
    "embeds": "depends_on",
}


def _svc_name_from_external(target: str) -> str:
    """'external:keycloak' → 'keycloak'"""
    return target.split(":", 1)[1]


def _make_external_node(svc: str) -> dict:
    return {
        "id": f"service:external/{svc}",
        "type": "service",
        "name": svc,
        "summary": f"External shared infrastructure: {svc}",
        "tags": ["external", "shared-infra"],
        "repo": "external",
    }


def apply(out: Path) -> None:
    intermediate = out / ".understand-anything" / "intermediate"
    ua_dir = out / ".understand-anything"
    tmp_dir = ua_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # ── Load inputs ────────────────────────────────────────────────────────────
    combined = _load(intermediate / "combined-graph.json")
    crossrepo_raw: list[dict] = _load(intermediate / "crossrepo-edges.json")

    # ── 1. Backfill module anchors (combine-graphs omits summary) ─────────────
    nodes: list[dict] = [_backfill_node(n) for n in combined.get("nodes", [])]
    node_ids: set[str] = {n["id"] for n in nodes}

    intra_edges: list[dict] = list(combined.get("edges", []))
    layers: list[dict] = [
        # Ensure description field exists on every layer (validator layer structure)
        {**l, "description": l.get("description") or f"Layer for {l.get('name', l['id'])}"}
        for l in combined.get("layers", [])
    ]

    # ── 2. Synthesize external infra nodes ────────────────────────────────────
    external_svcs: list[str] = sorted({
        _svc_name_from_external(e["target"])
        for e in crossrepo_raw
        if e.get("target", "").startswith("external:")
    })
    external_nodes = [_backfill_node(_make_external_node(s)) for s in external_svcs]
    for en in external_nodes:
        if en["id"] not in node_ids:
            nodes.append(en)
            node_ids.add(en["id"])

    # External layer — all external service nodes
    external_layer_node_ids = sorted(en["id"] for en in external_nodes)
    if external_layer_node_ids:
        layers.append({
            "id": "layer:external-shared-infra",
            "name": "External / Shared Infra",
            "description": "Synthetic nodes for shared external services referenced across repos.",
            "nodeIds": external_layer_node_ids,
        })

    # ── 3. Apply crossrepo edges ───────────────────────────────────────────────
    # Remap external:<svc> → service:external/<svc>
    def _remap_target(target: str) -> str:
        if target.startswith("external:"):
            return f"service:external/{_svc_name_from_external(target)}"
        return target

    # Dedup by (source, target, type) — first wins (or higher weight)
    seen_keys: dict[tuple, dict] = {}
    cross_edges_raw: list[dict] = []
    for e in crossrepo_raw:
        src = e.get("source", "")
        tgt = _remap_target(e.get("target", ""))
        etype = e.get("type", "")
        key = (src, tgt, etype)
        if key in seen_keys:
            # Keep whichever has higher weight
            existing = seen_keys[key]
            if (e.get("weight") or 0) > (existing.get("weight") or 0):
                seen_keys[key] = {**e, "target": tgt}
        else:
            seen_keys[key] = {**e, "target": tgt}

    # Now filter: drop if endpoints not in final node set
    # module:<ns> and service:external/<svc> are always in node_ids by construction
    cross_edges_final: list[dict] = []
    xi = 0
    for key, e in sorted(seen_keys.items()):  # sort for determinism
        src, tgt, etype = e["source"], e["target"], e.get("type", "")
        # Drop if either endpoint is missing
        if src not in node_ids or tgt not in node_ids:
            continue
        weight = e.get("weight")
        if weight is None:
            weight = 0.5
        # Map linker types the dashboard schema doesn't know to an allowed type,
        # preserving the original semantic in the label.
        mapped_type = _EDGE_TYPE_MAP.get(etype, etype)
        label = e.get("label")
        if mapped_type != etype:
            label = f"{etype}: {label}" if label else etype
        edge = {
            "id": f"x{xi}",
            "source": src,
            "target": tgt,
            "type": mapped_type,
            "direction": "forward",
            "weight": float(weight),
        }
        if label:
            # `description` survives the dashboard schema (which strips unknown edge
            # fields like `label`); keep `label` too for the raw/intermediate file.
            edge["label"] = label
            edge["description"] = label
        if e.get("confidence") is not None:
            edge["confidence"] = e["confidence"]
        if e.get("confidence") is not None and e["confidence"] < 0.5:
            edge["lowConfidence"] = True
        # fineTarget: keep coarse edge always; annotate if fine node exists
        fine = e.get("fineTarget")
        if fine and fine in node_ids:
            edge["fineTarget"] = fine
        cross_edges_final.append(edge)
        xi += 1

    all_edges = intra_edges + cross_edges_final

    # ── 4. Build tour ──────────────────────────────────────────────────────────
    # Step 1: overview — all module anchors
    module_anchors = sorted(
        n["id"] for n in nodes if n.get("type") == "module" and not n["id"].startswith("module:external")
    )
    # Step per repo: module anchor + up to 2 file-level nodes
    repo_steps = []
    repo_names = [nid.split(":", 1)[1] for nid in module_anchors if ":" in nid]
    for ns in repo_names:
        anchor = f"module:{ns}"
        # pick up to 2 file-level nodes for this repo
        sample = sorted([
            n["id"] for n in nodes
            if n.get("repo") == ns and n["type"] in _FILE_LEVEL_TYPES
        ])[:2]
        step_nodes = [anchor] + [s for s in sample if s in node_ids]
        repo_steps.append({
            "order": len(repo_steps) + 2,
            "title": f"{ns} service",
            "description": f"Key nodes in the {ns} repo.",
            "nodeIds": step_nodes,
        })

    # Final step: cross-repo interlink endpoints
    interlink_endpoints = sorted({
        nid
        for e in cross_edges_final
        for nid in [e["source"], e["target"]]
        if nid in node_ids
    })[:6]

    tour = [
        {
            "order": 1,
            "title": "Platform Overview",
            "description": "High-level view of all repos and their module anchors.",
            "nodeIds": module_anchors,
        },
        *repo_steps,
        {
            "order": len(repo_steps) + 2,
            "title": "Cross-Repo Interlinks",
            "description": "Nodes at the boundaries of inter-service dependencies.",
            "nodeIds": interlink_endpoints,
        },
    ]

    # ── 5. Assemble final graph ────────────────────────────────────────────────
    # One timestamp + commit shared by project metadata and meta.json.
    analyzed_at = datetime.now(tz=timezone.utc).isoformat()
    git_commit_hash = "crossrepo"
    combined_project = combined.get("project") or {}
    project = {
        "name": f"{combined_project.get('name', 'combined')} — cross-repo",
        "languages": combined_project.get("languages", []),
        "frameworks": combined_project.get("frameworks", []),
        "description": combined_project.get(
            "description",
            "Cross-repo knowledge graph combining multiple service repos.",
        ),
        # Required by the dashboard's core/schema.ts ProjectMetaSchema — the inline
        # .cjs validator doesn't check these, but the dashboard rejects the graph
        # without them ("Missing or invalid project metadata").
        "analyzedAt": analyzed_at,
        "gitCommitHash": git_commit_hash,
    }

    # Sort nodes and layers for determinism
    final_nodes = sorted(nodes, key=lambda n: n["id"])
    final_edges = sorted(all_edges, key=lambda e: (e.get("source", ""), e.get("target", ""), e.get("type", "")))
    final_layers = sorted(layers, key=lambda l: l["id"])
    # Sort nodeIds within each layer for determinism
    for layer in final_layers:
        layer["nodeIds"] = sorted(layer["nodeIds"])

    graph = {
        "version": "1.0.0",
        "project": project,
        "nodes": final_nodes,
        "edges": final_edges,
        "layers": final_layers,
        "tour": tour,
    }

    # ── 6. Write knowledge-graph.json ─────────────────────────────────────────
    kg_path = ua_dir / "knowledge-graph.json"
    _dump(kg_path, graph)

    # ── 7. Run bundled inline validator ───────────────────────────────────────
    validator_path = tmp_dir / "ua-inline-validate.cjs"
    validator_path.write_text(_VALIDATOR_CJS, encoding="utf-8")

    review_path = intermediate / "review.json"
    result = subprocess.run(
        ["node", str(validator_path), str(kg_path), str(review_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Validator error: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    review = json.loads(review_path.read_text())
    if review.get("issues"):
        print(f"Validation issues: {json.dumps(review['issues'], indent=2)}", file=sys.stderr)
        sys.exit(1)

    print(
        f"Validation passed: {review['stats']['totalNodes']} nodes, "
        f"{review['stats']['totalEdges']} edges, "
        f"{review['stats']['totalLayers']} layers.",
        file=sys.stderr,
    )

    # ── 8. Write meta.json ────────────────────────────────────────────────────
    node_count = len(final_nodes)
    meta = {
        "lastAnalyzedAt": analyzed_at,
        "gitCommitHash": git_commit_hash,
        "version": "1.0.0",
        "analyzedFiles": node_count,
    }
    _dump(ua_dir / "meta.json", meta)

    print(
        f"apply-interlinks complete: {node_count} nodes, "
        f"{len(final_edges)} edges, {len(final_layers)} layers.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python apply-interlinks.py <out>", file=sys.stderr)
        sys.exit(1)
    apply(Path(sys.argv[1]))

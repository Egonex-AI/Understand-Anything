#!/usr/bin/env python3
"""
Merge script for Karpathy-pattern knowledge graphs.

Combines the deterministic scan-manifest.json with LLM analysis batches
(analysis-batch-*.json) into a final assembled knowledge graph.

Handles: entity deduplication, edge normalization, layer building from
index.md categories, tour generation from index.md section ordering.

Usage:
    python merge-knowledge-graph.py <wiki-directory>

Output:
    Writes assembled-graph.json to <wiki-directory>/.understand-anything/intermediate/
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Canonical type sets (must match core/src/types.ts)
# ---------------------------------------------------------------------------

VALID_NODE_TYPES = {
    "article", "entity", "topic", "claim", "source",
    # Codebase types (for cross-compatibility)
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource", "domain", "flow", "step",
}

VALID_EDGE_TYPES = {
    "cites", "contradicts", "builds_on", "exemplifies",
    "categorized_under", "authored_by", "related", "similar_to",
    # Codebase types
    "imports", "exports", "contains", "inherits", "implements",
    "calls", "subscribes", "publishes", "middleware",
    "reads_from", "writes_to", "transforms", "validates",
    "depends_on", "tested_by", "configures",
    "deploys", "serves", "provisions", "triggers",
    "migrates", "documents", "routes", "defines_schema",
    "contains_flow", "flow_step", "cross_domain",
}

NODE_TYPE_ALIASES = {
    "note": "article", "page": "article", "wiki_page": "article",
    "person": "entity", "actor": "entity", "organization": "entity",
    "tag": "topic", "category": "topic", "theme": "topic",
    "assertion": "claim", "decision": "claim", "thesis": "claim",
    "reference": "source", "raw": "source", "paper": "source",
}

EDGE_TYPE_ALIASES = {
    "references": "cites", "cites_source": "cites",
    "conflicts_with": "contradicts", "disagrees_with": "contradicts",
    "refines": "builds_on", "elaborates": "builds_on",
    "illustrates": "exemplifies", "instance_of": "exemplifies", "example_of": "exemplifies",
    "belongs_to": "categorized_under", "tagged_with": "categorized_under",
    "written_by": "authored_by", "created_by": "authored_by",
    "relates_to": "related", "related_to": "related",
}


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_node_type(t: str) -> str:
    t = t.lower().strip()
    return NODE_TYPE_ALIASES.get(t, t)


def normalize_edge_type(t: str) -> str:
    t = t.lower().strip()
    return EDGE_TYPE_ALIASES.get(t, t)


def normalize_entity_name(name: str) -> str:
    """Normalize entity names for deduplication."""
    return re.sub(r'\s+', ' ', name.strip().lower())


# ---------------------------------------------------------------------------
# Merge pipeline
# ---------------------------------------------------------------------------

def merge(root: Path) -> dict:
    intermediate = root / ".understand-anything" / "intermediate"
    manifest_path = intermediate / "scan-manifest.json"

    if not manifest_path.is_file():
        print(f"Error: {manifest_path} not found. Run parse-knowledge-base.py first.",
              file=sys.stderr)
        sys.exit(1)

    # Load scan manifest (deterministic base)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in manifest["nodes"]}
    edges = list(manifest["edges"])

    report = {"base_nodes": len(nodes), "base_edges": len(edges),
              "batches": 0, "new_entities": 0, "new_claims": 0,
              "new_edges": 0, "deduped_entities": 0, "dropped_edges": 0}

    # Load analysis batches
    batch_files = sorted(intermediate.glob("analysis-batch-*.json"))
    entity_name_map: dict[str, str] = {}  # normalized_name → entity_id
    dedup_remap: dict[str, str] = {}  # duplicate_id → canonical_id

    for bf in batch_files:
        report["batches"] += 1
        try:
            batch = json.loads(bf.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"[merge] Warning: Failed to load {bf.name}: {e}", file=sys.stderr)
            continue

        # Process new nodes from LLM analysis
        for node in batch.get("nodes", []):
            node_type = normalize_node_type(node.get("type", ""))
            if node_type not in VALID_NODE_TYPES:
                print(f"[merge] Warning: Unknown node type '{node.get('type')}' — skipping",
                      file=sys.stderr)
                continue

            node["type"] = node_type
            node_id = node.get("id", "")

            # Entity deduplication — track remapping for edge fixup
            if node_type == "entity":
                norm_name = normalize_entity_name(node.get("name", ""))
                if norm_name in entity_name_map:
                    # Map duplicate ID → canonical ID for edge remapping
                    dedup_remap[node_id] = entity_name_map[norm_name]
                    report["deduped_entities"] += 1
                    continue
                entity_name_map[norm_name] = node_id
                report["new_entities"] += 1
            elif node_type == "claim":
                report["new_claims"] += 1

            # Ensure required fields
            node.setdefault("summary", node.get("name", ""))
            node.setdefault("tags", [])
            node.setdefault("complexity", "simple")

            nodes[node_id] = node

        # Process new edges from LLM analysis
        for edge in batch.get("edges", []):
            edge_type = normalize_edge_type(edge.get("type", ""))
            if edge_type not in VALID_EDGE_TYPES:
                print(f"[merge] Warning: Unknown edge type '{edge.get('type')}' — "
                      f"mapped to 'related'", file=sys.stderr)
                edge_type = "related"

            edge["type"] = edge_type
            edge.setdefault("direction", "forward")
            edge.setdefault("weight", 0.5)

            # Remap deduped entity IDs, then validate source/target exist
            src = dedup_remap.get(edge.get("source", ""), edge.get("source", ""))
            tgt = dedup_remap.get(edge.get("target", ""), edge.get("target", ""))
            edge["source"] = src
            edge["target"] = tgt
            if src in nodes and tgt in nodes:
                edges.append(edge)
                report["new_edges"] += 1
            else:
                report["dropped_edges"] += 1

    # --- Deduplicate edges ---
    seen: set[tuple[str, str, str]] = set()
    final_edges = []
    for edge in edges:
        key = (edge["source"], edge["target"], edge["type"])
        if key not in seen:
            seen.add(key)
            final_edges.append(edge)

    # --- Build article→layer map from categories ---
    categories = manifest.get("categories", [])
    article_layer_map: dict[str, str] = {}  # article_id → layer_id
    layer_members: dict[str, list[str]] = {}  # layer_id → [node_ids]

    for cat in categories:
        cat_name = cat["name"]
        cat_slug = cat_name.lower().replace(" ", "-")
        layer_id = f"layer:{cat_slug}"
        topic_id = f"topic:{cat_slug}"
        members = [e["source"] for e in final_edges
                   if e["type"] == "categorized_under" and e["target"] == topic_id]
        if topic_id in nodes:
            members.append(topic_id)
        layer_members[layer_id] = members
        for mid in members:
            article_layer_map[mid] = layer_id

    # --- Assign entity/claim nodes to their parent article's layer ---
    # Step 1: Build entity/claim → article mapping from edges
    child_to_article: dict[str, str] = {}
    for edge in final_edges:
        src_type = nodes.get(edge["source"], {}).get("type", "")
        tgt_type = nodes.get(edge["target"], {}).get("type", "")
        # If an article connects to an entity/claim, map the child to the article
        if src_type == "article" and tgt_type in ("entity", "claim"):
            child_to_article.setdefault(edge["target"], edge["source"])
        elif tgt_type == "article" and src_type in ("entity", "claim"):
            child_to_article.setdefault(edge["source"], edge["target"])

    # Step 2: For orphan entities/claims, try to match by ID prefix
    # Build a reverse lookup: bare article name → full article ID
    # e.g., "concept-aaak-compression" → "article:concepts/concept-aaak-compression"
    bare_to_article: dict[str, str] = {}
    for nid in nodes:
        if nid.startswith("article:"):
            # Extract the bare filename from paths like "article:concepts/concept-foo"
            bare = nid.split("/")[-1] if "/" in nid else nid.replace("article:", "")
            bare_to_article[bare] = nid

    for nid, node in nodes.items():
        if node["type"] in ("entity", "claim") and nid not in child_to_article:
            # e.g., "claim:concept-aaak-compression:not-zero-loss" → stem "concept-aaak-compression"
            # e.g., "entity:brain" → stem "brain"
            raw = nid.split(":", 1)[1] if ":" in nid else nid  # "concept-aaak-compression:not-zero-loss"
            stem = raw.split(":")[0]  # "concept-aaak-compression"

            # Try exact bare name match first
            if stem in bare_to_article:
                child_to_article[nid] = bare_to_article[stem]
            else:
                # Try suffix/substring match against bare names
                # e.g., entity:brain → segment-brain, entity:mempalace → tool-mempalace
                matched = False
                for bare, aid in bare_to_article.items():
                    if stem in bare or bare in stem:
                        child_to_article[nid] = aid
                        matched = True
                        break
                    # Also try: bare ends with -stem (e.g., "segment-brain" ends with "-brain")
                    if bare.endswith(f"-{stem}") or bare.endswith(f"/{stem}"):
                        child_to_article[nid] = aid
                        matched = True
                        break
                # Last resort: check if the node's name appears in any article's
                # name OR content (knowledgeMeta.content)
                if not matched and node.get("name"):
                    node_name_lower = node["name"].lower()
                    for aid, anode in nodes.items():
                        if not aid.startswith("article:"):
                            continue
                        # Match against article name
                        if node_name_lower in anode.get("name", "").lower():
                            child_to_article[nid] = aid
                            matched = True
                            break
                        # Match against article content (wikilinks or text)
                        meta = anode.get("knowledgeMeta", {})
                        content = (meta.get("content") or "").lower()
                        if len(node_name_lower) >= 3 and node_name_lower in content:
                            child_to_article[nid] = aid
                            matched = True
                            break

    # Step 3: Place children into their parent article's layer
    for child_id, article_id in child_to_article.items():
        layer_id = article_layer_map.get(article_id)
        if layer_id and layer_id in layer_members:
            layer_members[layer_id].append(child_id)
            article_layer_map[child_id] = layer_id

    # --- Build layers ---
    layers = []
    for cat in categories:
        cat_name = cat["name"]
        cat_slug = cat_name.lower().replace(" ", "-")
        layer_id = f"layer:{cat_slug}"
        members = list(dict.fromkeys(layer_members.get(layer_id, [])))  # Deduplicate preserving order
        layers.append({
            "id": layer_id,
            "name": cat_name,
            "description": f"{cat_name} ({len(members)} nodes)",
            "nodeIds": members,
        })

    # Assign uncategorized nodes to an "Other" layer
    categorized_ids = set()
    for layer in layers:
        categorized_ids.update(layer["nodeIds"])
    uncategorized = [nid for nid in nodes if nid not in categorized_ids]
    if uncategorized:
        layers.append({
            "id": "layer:other",
            "name": "Other",
            "description": f"Uncategorized nodes ({len(uncategorized)})",
            "nodeIds": uncategorized,
        })

    # --- Build tour from index.md category ordering ---
    tour = []
    for i, cat in enumerate(categories):
        cat_slug = cat["name"].lower().replace(" ", "-")
        topic_id = f"topic:{cat_slug}"
        # Pick representative articles (up to 3 per category)
        members = [e["source"] for e in final_edges
                   if e["type"] == "categorized_under" and e["target"] == topic_id][:3]
        if not members and topic_id in nodes:
            members = [topic_id]
        if members:
            tour.append({
                "order": i + 1,
                "title": cat["name"],
                "description": f"Explore the {cat['name']} section ({cat['count']} articles)",
                "nodeIds": members,
            })

    # --- Detect project name ---
    project_name = root.name
    # Try to find a better name from index.md H1
    index_path = root / "wiki" / "index.md"
    if not index_path.is_file():
        index_path = root / "index.md"
    if index_path.is_file():
        text = index_path.read_text(encoding="utf-8", errors="replace")
        h1_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        if h1_match:
            project_name = h1_match.group(1).strip()

    # --- Assemble final graph ---
    graph = {
        "version": "1.0.0",
        "kind": "knowledge",
        "project": {
            "name": project_name,
            "languages": ["markdown"],
            "frameworks": ["karpathy-wiki"],
            "description": f"Knowledge graph for {project_name}",
            "analyzedAt": datetime.now(timezone.utc).isoformat(),
            "gitCommitHash": "",
        },
        "nodes": list(nodes.values()),
        "edges": final_edges,
        "layers": layers,
        "tour": tour,
    }

    # Try to get git commit hash
    try:
        import subprocess
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=str(root), timeout=5
        )
        if result.returncode == 0:
            graph["project"]["gitCommitHash"] = result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass

    # Write output
    out_path = intermediate / "assembled-graph.json"
    out_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")

    # Report
    print(f"[merge] Input: {report['base_nodes']} scan nodes, "
          f"{report['base_edges']} scan edges, {report['batches']} analysis batches",
          file=sys.stderr)
    print(f"[merge] Added: {report['new_entities']} entities, "
          f"{report['new_claims']} claims, {report['new_edges']} edges "
          f"({report['deduped_entities']} deduped entities, "
          f"{report['dropped_edges']} dropped dangling edges)", file=sys.stderr)
    print(f"[merge] Output: {len(graph['nodes'])} nodes, {len(final_edges)} edges, "
          f"{len(layers)} layers, {len(tour)} tour steps", file=sys.stderr)
    print(f"[merge] Written: {out_path}", file=sys.stderr)

    return graph


def main():
    if len(sys.argv) < 2:
        print("Usage: merge-knowledge-graph.py <wiki-directory>", file=sys.stderr)
        sys.exit(1)

    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    merge(root)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
hybrid_runner.py — Gemma-powered extraction for understand-anything

Routes high-token extraction phases (project-scanner, file-analyzer batches)
to a local Gemma model via Ollama instead of Claude subagents, reducing
Claude API costs by ~4-5×.

Usage:
  python3 hybrid_runner.py scan  --project-root <path>
  python3 hybrid_runner.py analyze --project-root <path> --skill-dir <path>
                                   --batch-index <n> --batch-input <path>

The scan subcommand replaces the project-scanner Phase 2 LLM call (description
synthesis only — Phase 1 runs the Node.js discovery script unchanged).

The analyze subcommand replaces the file-analyzer Phase 2 LLM call (semantic
analysis, summaries, tags, nodes, edges). Phase 1 (extract-structure.mjs) must
have already been run and its output placed at the path indicated in the batch
input JSON.

Environment variables:
  OLLAMA_HOST   — Ollama base URL (default: http://localhost:11434)
  OLLAMA_MODEL  — model name (default: gemma4:26b-a4b)
  HYBRID_TIMEOUT — request timeout in seconds (default: 600)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:26b-a4b")
HYBRID_TIMEOUT = int(os.environ.get("HYBRID_TIMEOUT", "600"))

# Edge type → correct weight mapping per file-analyzer spec
EDGE_WEIGHTS: dict[str, float] = {
    "contains": 1.0,
    "imports": 0.7,
    "calls": 0.8,
    "inherits": 0.9,
    "implements": 0.9,
    "exports": 0.8,
    "depends_on": 0.6,
    "tested_by": 0.5,
    "configures": 0.6,
    "documents": 0.5,
    "deploys": 0.7,
    "migrates": 0.7,
    "triggers": 0.6,
    "defines_schema": 0.8,
    "serves": 0.7,
    "provisions": 0.7,
    "routes": 0.6,
    "related": 0.5,
}

VALID_NODE_TYPES = {
    "file", "function", "class", "config", "document",
    "service", "table", "endpoint", "pipeline", "schema", "resource",
}

VALID_EDGE_TYPES = set(EDGE_WEIGHTS.keys())

# ─────────────────────────────────────────────────────────────────────────────
# Ollama client
# ─────────────────────────────────────────────────────────────────────────────
def call_ollama(prompt: str, timeout: int = HYBRID_TIMEOUT) -> str:
    """
    Call Ollama generate endpoint using Gemma4 raw chat format.
    Uses <start_of_turn> tokens for proper system/user/model turns.
    Falls back gracefully on timeout or server error.
    """
    url = f"{OLLAMA_HOST}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "raw": True,  # bypass Ollama template re-application — we handle it ourselves
        "options": {
            "temperature": 0.1,
            "num_predict": 8192,
        },
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read())
        return result.get("response", "")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        raise RuntimeError(f"Ollama HTTP {e.code}: {body}") from e
    except TimeoutError:
        raise RuntimeError(f"Ollama request timed out after {timeout}s") from None


def build_gemma_prompt(system: str, user: str) -> str:
    """Build a Gemma4 chat-format prompt string."""
    return (
        f"<start_of_turn>system\n{system}<end_of_turn>\n"
        f"<start_of_turn>user\n{user}<end_of_turn>\n"
        f"<start_of_turn>model\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Response cleanup
# ─────────────────────────────────────────────────────────────────────────────
def extract_json(raw: str) -> dict[str, Any]:
    """
    Extract a JSON object from Gemma's response.
    Handles: markdown fences, trailing garbage, prompt echo.
    """
    text = raw.strip()

    # Strip ```json ... ``` or ``` ... ``` wrappers
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()

    # Strip prompt echo: if response starts with our prompt prefix, find the first {
    if text.startswith("<start_of_turn>") or text.startswith("system\n"):
        idx = text.find("{")
        if idx != -1:
            text = text[idx:]

    # Strip trailing garbage after last closing brace
    last_brace = text.rfind("}")
    if last_brace != -1:
        text = text[: last_brace + 1]

    return json.loads(text)


# ─────────────────────────────────────────────────────────────────────────────
# Post-processing fixes for analyze output
# ─────────────────────────────────────────────────────────────────────────────
def fix_nodes(nodes: list[dict]) -> list[dict]:
    """
    Normalize node list:
    - Deduplicate by ID (keep last)
    - Fix type for config nodes with 'file:' prefix (common Gemma mistake)
    - Ensure all required fields present
    - Fix invalid node types to 'file' as fallback
    """
    seen: dict[str, dict] = {}
    for node in nodes:
        nid = node.get("id", "")
        if not nid:
            continue  # drop nodes without ID

        # Fix: config files that got 'file:' prefix instead of 'config:'
        # If node has fileCategory config but uses file: prefix, normalise
        # (We can infer from tags or name — if tags include 'config' or 'configuration')
        n_type = node.get("type", "file")
        if n_type not in VALID_NODE_TYPES:
            node["type"] = "file"  # fallback

        # Fix invalid complexity
        complexity = node.get("complexity", "moderate")
        if complexity not in {"simple", "moderate", "complex"}:
            node["complexity"] = "moderate"

        # Ensure required fields
        if not node.get("summary"):
            node["summary"] = "No summary available."
        if not node.get("tags"):
            node["tags"] = ["untagged"]
        if not node.get("name"):
            # Derive from ID
            parts = nid.split(":")
            node["name"] = parts[-1] if parts else nid

        seen[nid] = node

    return list(seen.values())


def fix_edges_and_inject_imports(
    edges: list[dict],
    batch_import_data: dict[str, list[str]],
    node_ids: set[str],
) -> list[dict]:
    """
    Fix edge list:
    1. Strip ALL Gemma-emitted 'imports' edges (Gemma over-generates these)
    2. Reinject exact imports from batch_import_data (authoritative, pre-resolved)
    3. Fix edge weights to spec values
    4. Drop self-referencing edges
    5. Drop edges with invalid types
    6. Drop dangling edges referencing unknown nodes (unless the node is in
       another batch — cross-batch file: references are allowed for imports)
    """
    result: list[dict] = []

    # Step 1: Process non-import edges
    for edge in edges:
        et = edge.get("type", "")
        if et == "imports":
            continue  # will be replaced below
        if et not in VALID_EDGE_TYPES:
            continue  # drop unknown edge types
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        if not src or not tgt:
            continue
        if src == tgt:
            continue  # no self-refs
        # Fix weight
        edge["weight"] = EDGE_WEIGHTS.get(et, edge.get("weight", 0.5))
        edge["direction"] = "forward"
        result.append(edge)

    # Step 2: Reinject imports from authoritative batchImportData
    for file_path, imports in batch_import_data.items():
        src_id = f"file:{file_path}"
        for target_path in imports:
            tgt_id = f"file:{target_path}"
            result.append(
                {
                    "source": src_id,
                    "target": tgt_id,
                    "type": "imports",
                    "direction": "forward",
                    "weight": 0.7,
                }
            )

    # Deduplicate edges by (source, target, type) — keep highest weight
    edge_map: dict[tuple[str, str, str], dict] = {}
    for edge in result:
        key = (edge["source"], edge["target"], edge["type"])
        existing = edge_map.get(key)
        if not existing or edge.get("weight", 0) > existing.get("weight", 0):
            edge_map[key] = edge

    return list(edge_map.values())


# ─────────────────────────────────────────────────────────────────────────────
# Subcommand: scan
# ─────────────────────────────────────────────────────────────────────────────
SCAN_SYSTEM = """You are a technical writer. Given raw project metadata (a description from package.json or README), write a clean 1-2 sentence project description. Be concise. No marketing language."""

SCAN_USER_TEMPLATE = """Project name: {name}
Raw description from package.json: {raw_description}
First lines of README:
{readme_head}

Write a clean 1-2 sentence description of this project. Reply with only the description text, no JSON, no quotes."""


def run_scan(project_root: str) -> None:
    """
    Phase 2 of project-scanner: synthesize description field from scan results.
    Phase 1 (Node.js discovery script) must have already been run.
    """
    scan_tmp = os.path.join(project_root, ".understand-anything", "tmp", "ua-scan-results.json")
    scan_out = os.path.join(project_root, ".understand-anything", "intermediate", "scan-result.json")

    if not os.path.exists(scan_tmp):
        print(f"[hybrid:scan] ERROR: scan results not found at {scan_tmp}", file=sys.stderr)
        print("[hybrid:scan] Run the project-scanner Phase 1 script first.", file=sys.stderr)
        sys.exit(1)

    with open(scan_tmp) as f:
        data = json.load(f)

    raw_desc = data.get("rawDescription", "").strip()
    readme_head = data.get("readmeHead", "").strip()
    name = data.get("name", os.path.basename(project_root))
    total_files = data.get("totalFiles", 0)

    # Build description without LLM if we have enough raw data
    # Only call Ollama when both rawDescription AND readmeHead are empty
    if raw_desc:
        # Clean up raw description
        desc = re.sub(r"\s+", " ", raw_desc).strip()
        # Trim to 2 sentences max
        sentences = re.split(r"(?<=[.!?])\s+", desc)
        desc = " ".join(sentences[:2])
    elif readme_head:
        # Use Gemma for synthesis only when necessary
        print("[hybrid:scan] Synthesizing description from README via Gemma...", file=sys.stderr)
        prompt = build_gemma_prompt(
            SCAN_SYSTEM,
            SCAN_USER_TEMPLATE.format(
                name=name,
                raw_description="(none)",
                readme_head=readme_head[:800],
            ),
        )
        try:
            raw = call_ollama(prompt, timeout=120)
            desc = raw.strip().split("\n")[0]  # first line only
        except RuntimeError as e:
            print(f"[hybrid:scan] Gemma call failed: {e}. Using README head.", file=sys.stderr)
            desc = readme_head.split("\n")[0][:200]
    else:
        desc = "No description available."

    if total_files > 100:
        desc += " Note: this project has over 100 source files; consider scoping analysis to a subdirectory for faster results."

    # Build final output — strip Phase 1 intermediate fields
    output = {
        "name": name,
        "description": desc,
        "languages": data.get("languages", []),
        "frameworks": data.get("frameworks", []),
        "files": data.get("files", []),
        "totalFiles": total_files,
        "filteredByIgnore": data.get("filteredByIgnore", 0),
        "estimatedComplexity": data.get("estimatedComplexity", "unknown"),
        "importMap": data.get("importMap", {}),
    }

    os.makedirs(os.path.dirname(scan_out), exist_ok=True)
    with open(scan_out, "w") as f:
        json.dump(output, f, indent=2)

    print(f"[hybrid:scan] {name} | {total_files} files | {output['estimatedComplexity']}")
    print(f"[hybrid:scan] Languages: {', '.join(output['languages'])}")
    print(f"[hybrid:scan] Description: {desc[:100]}...")
    print(f"[hybrid:scan] Written to: {scan_out}")


# ─────────────────────────────────────────────────────────────────────────────
# Subcommand: analyze
# ─────────────────────────────────────────────────────────────────────────────
ANALYZE_SYSTEM = """You are an expert code analyst. Your job is to read source file extraction results and produce precise knowledge graph nodes and edges.

Output ONLY a single valid JSON object with "nodes" and "edges" arrays. No markdown fences, no explanation, no text before { or after }."""

ANALYZE_USER_TEMPLATE = """Analyze these source files and produce GraphNode and GraphEdge objects.

Project: {project_name}
Languages: {languages}
Batch index: {batch_index}

## Structural Extraction Results (from tree-sitter analysis)
```json
{extract_results}
```

## Pre-resolved import data (MANDATORY — use this and ONLY this for import edge creation)
Important: Do NOT create any imports edges yourself. Import edges will be added automatically from this data.
Use this data only to understand relationships for summary writing.
```json
{batch_import_data}
```

## Files to analyze (create one node per file):
{file_list}

## Node ID conventions (use EXACT prefixes — no project name prefix):
| Type | Format | Example |
|------|--------|---------|
| File (code/script/markup) | `file:<path>` | `file:src/index.ts` |
| Config file | `config:<path>` | `config:tsconfig.json` |
| Document | `document:<path>` | `document:README.md` |
| Service/Infra | `service:<path>` | `service:Dockerfile` |
| Function | `function:<path>:<name>` | `function:src/utils.ts:formatDate` |
| Class | `class:<path>:<name>` | `class:src/models/User.ts:User` |

## Required fields for every node:
- id: string (exact prefix format above)
- type: one of: file, function, class, config, document, service, table, endpoint, pipeline, schema, resource
- name: string (filename for file/config/document nodes; function/class name for sub-nodes)
- summary: 1-2 sentences describing purpose and role (never empty)
- tags: 3-5 lowercase hyphenated tags (never empty)
- complexity: simple | moderate | complex

## Significance filter for function/class nodes:
Only create function: and class: nodes for:
- Functions with 10+ lines
- Classes with 2+ methods or 20+ lines
- Any exported function/class

## Required fields for every edge:
- source: node id
- target: node id
- type: one of: contains, calls, inherits, implements, exports, depends_on, tested_by, configures, documents, deploys, migrates, triggers, defines_schema, serves, provisions, routes, related
  (DO NOT create 'imports' edges — those are injected automatically)
- direction: "forward"
- weight: see values below

## Edge weights:
contains=1.0, calls=0.8, inherits=0.9, implements=0.9, exports=0.8,
depends_on=0.6, tested_by=0.5, configures=0.6, documents=0.5,
deploys=0.7, migrates=0.7, triggers=0.6, defines_schema=0.8,
serves=0.7, provisions=0.7, routes=0.6, related=0.5

Output ONLY the JSON. Start with {{ and end with }}."""


def run_analyze(
    project_root: str,
    skill_dir: str,
    batch_index: int,
    batch_input_path: str,
) -> None:
    """
    Phase 2 of file-analyzer: semantic analysis for a single batch.
    Phase 1 (extract-structure.mjs) must have already been run.
    """
    # Read batch input
    with open(batch_input_path) as f:
        batch_input = json.load(f)

    project_name = batch_input.get("projectName", os.path.basename(project_root))
    languages = batch_input.get("languages", [])
    batch_files: list[dict] = batch_input.get("batchFiles", [])
    batch_import_data: dict[str, list[str]] = batch_input.get("batchImportData", {})

    # Phase 1: Run extract-structure.mjs (deterministic tree-sitter extraction)
    extract_input_path = os.path.join(
        project_root, ".understand-anything", "tmp",
        f"ua-file-analyzer-input-{batch_index}.json"
    )
    extract_output_path = os.path.join(
        project_root, ".understand-anything", "tmp",
        f"ua-file-extract-results-{batch_index}.json"
    )

    # Write the extract-structure.mjs input format
    extract_input = {
        "projectRoot": project_root,
        "batchFiles": batch_files,
        "batchImportData": batch_import_data,
    }
    os.makedirs(os.path.dirname(extract_input_path), exist_ok=True)
    with open(extract_input_path, "w") as f:
        json.dump(extract_input, f)

    extract_script = os.path.join(skill_dir, "extract-structure.mjs")
    print(f"[hybrid:analyze:{batch_index}] Running extract-structure.mjs...", file=sys.stderr)
    t0 = time.time()
    result = subprocess.run(
        ["node", extract_script, extract_input_path, extract_output_path],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        print(f"[hybrid:analyze:{batch_index}] extract-structure.mjs failed:", file=sys.stderr)
        print(result.stderr[:500], file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(extract_output_path) or os.path.getsize(extract_output_path) == 0:
        print(f"[hybrid:analyze:{batch_index}] extract-structure.mjs produced no output", file=sys.stderr)
        sys.exit(1)

    with open(extract_output_path) as f:
        extract_results = json.load(f)

    print(f"[hybrid:analyze:{batch_index}] Extraction done in {time.time()-t0:.1f}s | {extract_results.get('filesAnalyzed',0)} files analyzed", file=sys.stderr)

    # Phase 2: Build Gemma prompt
    file_list_lines = []
    for i, bf in enumerate(batch_files, 1):
        file_list_lines.append(
            f"{i}. `{bf['path']}` ({bf['sizeLines']} lines, language: `{bf['language']}`, fileCategory: `{bf['fileCategory']}`)"
        )
    file_list = "\n".join(file_list_lines)

    # Trim extract results to stay within context — keep only results, not the full input
    extract_trimmed = {
        "filesAnalyzed": extract_results.get("filesAnalyzed", 0),
        "results": extract_results.get("results", []),
    }

    user_prompt = ANALYZE_USER_TEMPLATE.format(
        project_name=project_name,
        languages=", ".join(languages) if languages else "unknown",
        batch_index=batch_index,
        extract_results=json.dumps(extract_trimmed, indent=2),
        batch_import_data=json.dumps(batch_import_data, indent=2),
        file_list=file_list,
    )

    prompt = build_gemma_prompt(ANALYZE_SYSTEM, user_prompt)

    print(f"[hybrid:analyze:{batch_index}] Sending {len(batch_files)} files to Gemma ({OLLAMA_MODEL})...", file=sys.stderr)
    t0 = time.time()
    try:
        raw = call_ollama(prompt, timeout=HYBRID_TIMEOUT)
    except RuntimeError as e:
        print(f"[hybrid:analyze:{batch_index}] Gemma call failed: {e}", file=sys.stderr)
        # Write an empty batch — pipeline continues, assemble-reviewer will note the gap
        empty_batch = {"nodes": [], "edges": []}
        batch_out = os.path.join(
            project_root, ".understand-anything", "intermediate",
            f"batch-{batch_index}.json"
        )
        os.makedirs(os.path.dirname(batch_out), exist_ok=True)
        with open(batch_out, "w") as f:
            json.dump(empty_batch, f)
        print(f"[hybrid:analyze:{batch_index}] Wrote empty batch (Gemma failure)", file=sys.stderr)
        sys.exit(0)

    elapsed = time.time() - t0
    print(f"[hybrid:analyze:{batch_index}] Gemma response in {elapsed:.1f}s", file=sys.stderr)

    # Parse and validate
    try:
        parsed = extract_json(raw)
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[hybrid:analyze:{batch_index}] JSON parse failed: {e}", file=sys.stderr)
        print(f"[hybrid:analyze:{batch_index}] Raw (first 300 chars): {raw[:300]}", file=sys.stderr)
        # Write empty batch
        batch_out = os.path.join(
            project_root, ".understand-anything", "intermediate",
            f"batch-{batch_index}.json"
        )
        os.makedirs(os.path.dirname(batch_out), exist_ok=True)
        with open(batch_out, "w") as f:
            json.dump({"nodes": [], "edges": []}, f)
        sys.exit(0)

    nodes_raw = parsed.get("nodes", [])
    edges_raw = parsed.get("edges", [])

    # Post-process: fix nodes and reinject import edges
    nodes = fix_nodes(nodes_raw)
    node_ids = {n["id"] for n in nodes}
    edges = fix_edges_and_inject_imports(edges_raw, batch_import_data, node_ids)

    batch_out = os.path.join(
        project_root, ".understand-anything", "intermediate",
        f"batch-{batch_index}.json"
    )
    os.makedirs(os.path.dirname(batch_out), exist_ok=True)
    output = {"nodes": nodes, "edges": edges}
    with open(batch_out, "w") as f:
        json.dump(output, f, indent=2)

    # Count nodes by type
    type_counts: dict[str, int] = {}
    for n in nodes:
        t = n.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1

    print(
        f"[hybrid:analyze:{batch_index}] ✓ {len(nodes)} nodes "
        f"({', '.join(f'{v} {k}' for k, v in sorted(type_counts.items()))}), "
        f"{len(edges)} edges | Written to: {batch_out}"
    )

    # Report import edge injection
    import_count = sum(len(v) for v in batch_import_data.values())
    injected = sum(1 for e in edges if e["type"] == "imports")
    print(f"[hybrid:analyze:{batch_index}]   Import edges: {injected} injected (expected {import_count} from batchImportData)")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Hybrid LLM runner — routes extraction phases to local Gemma"
    )
    sub = parser.add_subparsers(dest="command")

    # scan subcommand
    scan_p = sub.add_parser("scan", help="Synthesize project description (project-scanner Phase 2)")
    scan_p.add_argument("--project-root", required=True)

    # analyze subcommand
    analyze_p = sub.add_parser("analyze", help="Semantic analysis for a file batch (file-analyzer Phase 2)")
    analyze_p.add_argument("--project-root", required=True)
    analyze_p.add_argument("--skill-dir", required=True)
    analyze_p.add_argument("--batch-index", type=int, required=True)
    analyze_p.add_argument("--batch-input", required=True, help="Path to batch input JSON")

    args = parser.parse_args()

    if args.command == "scan":
        run_scan(args.project_root)
    elif args.command == "analyze":
        run_analyze(
            project_root=args.project_root,
            skill_dir=args.skill_dir,
            batch_index=args.batch_index,
            batch_input_path=args.batch_input,
        )
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

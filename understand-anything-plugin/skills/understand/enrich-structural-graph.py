#!/usr/bin/env python3
"""Enrich a structural-only knowledge graph with per-node complexity, tags,
and summary so it passes GraphNodeSchema validation without LLM phases.

Heuristics (no model calls — deterministic and fast):
  - complexity: derived from sizeLines (simple <= 80, moderate <= 300, else complex)
  - tags: fileCategory + language + top-level directory + special markers
  - summary: templated from name/path/category/language

Usage:
  python3 enrich-structural-graph.py <knowledge-graph.json> [--write]
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

COMPLEXITY_SIMPLE_MAX = 80
COMPLEXITY_MODERATE_MAX = 300

MARKERS = [
    (r"(^|[/._-])test[s]?([/._-]|$)", "test"),
    (r"(^|[/._-])test_|_test\.|\.test\.", "test"),
    (r"(^|[/._-])__tests__([/._-]|$)", "test"),
    (r"(^|[/._-])specs?([/._-]|$)", "test"),
    (r"\.(lock|lockb|sum)$", "lockfile"),
    (r"(^|[/._-])node_modules([/._-]|$)", "third-party"),
    (r"(^|[/._-])vendor([/._-]|$)", "third-party"),
    (r"(^|[/._-])dist([/._-]|$)", "generated"),
    (r"(^|[/._-])build([/._-]|$)", "generated"),
    (r"(^|[/._-])\.next([/._-]|$)", "generated"),
    (r"(^|[/._-])generated([/._-]|$)", "generated"),
    (r"(^|[/._-])migrations?([/._-]|$)", "migration"),
    (r"(^|[/._-])fixtures?([/._-]|$)", "fixture"),
    (r"(^|[/._-])benchmarks?([/._-]|$)", "benchmark"),
    (r"(^|[/._-])\.github([/._-]|$)", "ci"),
    (r"(^|[/._-])\.gitlab([/._-]|$)", "ci"),
    (r"(^|[/._-])\.circleci([/._-]|$)", "ci"),
    (r"(^|[/._-])\.husky([/._-]|$)", "tooling"),
    (r"(^|[/._-])\.vscode([/._-]|$)", "tooling"),
    (r"(^|[/._-])\.idea([/._-]|$)", "tooling"),
]

MARKDOWN_LANGUAGE_LABELS = {
    "markdown": "documentation",
    "txt": "text",
    "rst": "documentation",
    "adoc": "documentation",
}


def complexity_for(size_lines: int) -> str:
    if size_lines is None:
        return "moderate"
    if size_lines <= COMPLEXITY_SIMPLE_MAX:
        return "simple"
    if size_lines <= COMPLEXITY_MODERATE_MAX:
        return "moderate"
    return "complex"


def tags_for(node: dict) -> list[str]:
    path = node.get("filePath") or node.get("id") or node.get("name") or ""
    tags: list[str] = []

    category = node.get("fileCategory")
    if category:
        tags.append(category)

    language = node.get("language")
    if language and language != "unknown":
        tags.append(language)
        if language in MARKDOWN_LANGUAGE_LABELS:
            tags.append(MARKDOWN_LANGUAGE_LABELS[language])

    top_dir = path.split("/", 1)[0] if "/" in path else path
    if top_dir and top_dir not in (".", ""):
        tags.append("dir:" + top_dir)

    lower = path.lower()
    for pattern, marker in MARKERS:
        if re.search(pattern, lower):
            tags.append(marker)
            break

    node_type = node.get("type")
    if node_type and node_type != "file":
        tags.append(node_type)

    seen: set[str] = set()
    deduped: list[str] = []
    for tag in tags:
        if tag not in seen:
            seen.add(tag)
            deduped.append(tag)
    return deduped


def summary_for(node: dict) -> str:
    name = node.get("name") or ""
    path = node.get("filePath") or node.get("id") or ""
    category = node.get("fileCategory") or "file"
    language = node.get("language") or "unknown"
    size = node.get("sizeLines")

    prefix = {
        "code": "Source code",
        "markup": "Markup",
        "docs": "Documentation",
        "config": "Configuration",
        "infra": "Infrastructure definition",
        "data": "Data",
        "script": "Script",
    }.get(category, "File")

    location = path.rsplit("/", 1)[0] if "/" in path else "project root"
    if size is not None:
        return f"{prefix} `{name}` ({language}, {size} lines) in {location}."
    return f"{prefix} `{name}` ({language}) in {location}."


def enrich(graph: dict) -> Counter:
    stats: Counter = Counter()
    for node in graph.get("nodes", []):
        if not isinstance(node, dict):
            continue
        if not node.get("complexity"):
            node["complexity"] = complexity_for(node.get("sizeLines"))
            stats["complexity"] += 1
        if not isinstance(node.get("tags"), list) or not node["tags"]:
            node["tags"] = tags_for(node)
            stats["tags"] += 1
        if not node.get("summary"):
            node["summary"] = summary_for(node)
            stats["summary"] += 1
    return stats


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    path = Path(sys.argv[1])
    graph = json.loads(path.read_text(encoding="utf-8"))
    stats = enrich(graph)

    if "--write" in sys.argv:
        path.write_text(json.dumps(graph, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {path}")
    print(f"Enriched nodes: {len(graph.get('nodes', []))}")
    print("Fields added:", dict(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

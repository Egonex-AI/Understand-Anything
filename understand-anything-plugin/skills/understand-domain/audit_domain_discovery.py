#!/usr/bin/env python3
"""
audit_domain_discovery.py — Check domain-discovery.json for potential over-merging.

Input: intermediate/domain-discovery.json + intermediate/kg-summary.json
Output: intermediate/domain-audit.json
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

MIN_ENTITY_NOUNS_FOR_SPLIT = 4
TAG_OVERLAP_SPLIT_THRESHOLD = 0.3

_VERB_PREFIXES = frozenset({
    "get", "create", "update", "delete", "find", "list", "save",
    "load", "remove", "add", "set", "check", "validate", "build",
    "handle", "process", "fetch", "send", "receive", "basic", "v2",
})


def extract_subdomains(terms_md: str) -> set[str]:
    """Extract second-level domain names from a terms markdown by scanning `### ` headings.

    Only the heading layer is parsed — table contents are never touched (table
    parsing is brittle; see spec §2 '分工'). The subdomain set is the program
    validation anchor for matchedSubDomains (spec §6.2).
    """
    subdomains: set[str] = set()
    for line in terms_md.splitlines():
        stripped = line.strip()
        if stripped.startswith("### "):
            name = stripped[4:].strip()
            if name:
                subdomains.add(name)
    return subdomains


def _extract_entity_nouns(names: list[str]) -> set[str]:
    """Extract core entity nouns from node names by stripping common verb prefixes."""
    nouns: set[str] = set()
    for name in names:
        # Split on separators and CamelCase boundaries
        parts = re.split(r"[_\-/]|(?<=[a-z])(?=[A-Z])", name)
        for part in parts:
            if part.lower() not in _VERB_PREFIXES and len(part) > 2:
                nouns.add(part)
    return nouns


def _tag_overlap(tags_a: set[str], tags_b: set[str]) -> float:
    """Compute Jaccard similarity between two tag sets."""
    if not tags_a or not tags_b:
        return 0.0
    return len(tags_a & tags_b) / len(tags_a | tags_b)


def audit_domain_discovery(
    discovery: dict[str, Any],
    summary: dict[str, Any],
) -> dict[str, Any]:
    """Audit domain discovery for potential over-merging."""
    warnings: list[dict] = []
    domains = discovery.get("domains", [])
    modules = summary.get("modules", [])
    key_nodes = summary.get("keyNodes", [])

    # Build module -> keyNodes mapping
    mod_keynodes: dict[str, list[dict]] = defaultdict(list)
    for kn in key_nodes:
        mod_keynodes[kn["module"]].append(kn)

    # Check each domain for entity noun diversity
    for domain in domains:
        domain_id = domain["id"]
        domain_modules = domain.get("modules", [])

        all_nouns: set[str] = set()
        noun_to_modules: dict[str, set[str]] = defaultdict(set)

        for mod_path in domain_modules:
            for kn in mod_keynodes.get(mod_path, []):
                nouns = _extract_entity_nouns([kn["name"]])
                all_nouns.update(nouns)
                for noun in nouns:
                    noun_to_modules[noun].add(mod_path)

        if len(all_nouns) >= MIN_ENTITY_NOUNS_FOR_SPLIT:
            warnings.append({
                "type": "entity_diversity",
                "domain": domain_id,
                "message": (
                    f"Domain '{domain_id}' contains {len(all_nouns)} distinct "
                    f"entity nouns: {sorted(all_nouns)}. Consider splitting."
                ),
                "entityNouns": sorted(all_nouns),
                "modulesByEntity": {n: sorted(m) for n, m in noun_to_modules.items()},
            })

    # Check pairwise tag overlap between modules in the same domain
    for domain in domains:
        domain_id = domain["id"]
        domain_modules = domain.get("modules", [])
        mod_tags: dict[str, set[str]] = {}

        for mod_path in domain_modules:
            mod_data = next((m for m in modules if m["path"] == mod_path), None)
            if mod_data:
                mod_tags[mod_path] = set(mod_data.get("tags", []))

        paths = list(mod_tags.keys())
        for i in range(len(paths)):
            for j in range(i + 1, len(paths)):
                overlap = _tag_overlap(mod_tags[paths[i]], mod_tags[paths[j]])
                if 0 < overlap < TAG_OVERLAP_SPLIT_THRESHOLD:
                    warnings.append({
                        "type": "tag_divergence",
                        "domain": domain_id,
                        "message": (
                            f"Modules '{paths[i]}' and '{paths[j]}' in "
                            f"'{domain_id}' have low tag overlap ({overlap:.0%}). "
                            f"May be separate domains."
                        ),
                        "moduleA": paths[i],
                        "moduleB": paths[j],
                        "overlap": round(overlap, 3),
                    })

    should_refine = any(
        w["type"] in ("entity_diversity", "tag_divergence") for w in warnings
    )

    return {
        "warnings": warnings,
        "shouldRefine": should_refine,
        "summary": (
            f"Found {len(warnings)} warning(s). "
            f"Refinement {'recommended' if should_refine else 'not needed'}."
        ),
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python audit_domain_discovery.py <project-root>", file=sys.stderr)
        return 1

    project_root = Path(sys.argv[1])
    inter_dir = project_root / ".understand-anything" / "intermediate"

    discovery_path = inter_dir / "domain-discovery.json"
    summary_path = inter_dir / "kg-summary.json"

    if not discovery_path.exists():
        print(f"[audit-domain] Discovery not found: {discovery_path}", file=sys.stderr)
        return 1
    if not summary_path.exists():
        print(f"[audit-domain] Summary not found: {summary_path}", file=sys.stderr)
        return 1

    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
    summary = json.loads(summary_path.read_text(encoding="utf-8"))

    result = audit_domain_discovery(discovery, summary)

    out_path = inter_dir / "domain-audit.json"
    out_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(f"[audit-domain] {result['summary']}", file=sys.stderr)
    for w in result["warnings"]:
        print(f"[audit-domain]   ⚠ {w['type']}: {w['message']}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Tests for merge_domain_results.py provenance stamping."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from merge_domain_results import build_project_with_provenance, merge_domain_results


def test_merge_includes_derive_provenance() -> None:
    discovery = {
        "domains": [{
            "id": "domain:order",
            "name": "Order Management",
            "summary": "Handles orders",
            "tags": ["order"],
            "entities": [],
            "businessRules": [],
            "crossDomainInteractions": [],
        }]
    }
    flows_by_domain = {
        "domain:order": {
            "flows": [{
                "id": "flow:create-order",
                "name": "Create Order",
                "summary": "Creates an order",
                "tags": ["order"],
                "complexity": "moderate",
                "domainMeta": {},
                "steps": [{
                    "id": "step:create-order:validate",
                    "name": "Validate",
                    "summary": "Validates input",
                    "tags": ["validation"],
                    "complexity": "simple",
                    "filePath": "src/order.ts",
                    "lineRange": [1, 10],
                }],
            }],
            "crossDomainEdges": [],
        }
    }
    project = build_project_with_provenance({}, Path("/tmp/test-project"))

    result = merge_domain_results(discovery, flows_by_domain, project)

    provenance = result["project"]["provenance"]
    assert "derive" in provenance["completedStages"], (
        f"Expected 'derive' in completedStages, got {provenance['completedStages']}"
    )
    assert provenance.get("gitCommitHash") is not None
    assert provenance.get("analyzedAt")


if __name__ == "__main__":
    test_merge_includes_derive_provenance()
    print("  ✓ test_merge_includes_derive_provenance")
    print("\nAll tests passed.")

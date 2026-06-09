#!/usr/bin/env python3
"""Tests for split_kg_by_domain.py module overlap warnings."""
from __future__ import annotations

import io
import sys
from contextlib import redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from split_kg_by_domain import split_kg_by_domain


def test_overlap_warning_emitted(capsys=None) -> None:
    kg = {
        "nodes": [
            {"id": "file:src/shared/util.ts", "type": "file", "filePath": "src/shared/util.ts"},
        ],
        "edges": [],
    }
    discovery = {
        "domains": [
            {"id": "domain:a", "name": "A", "modules": ["src/shared"]},
            {"id": "domain:b", "name": "B", "modules": ["src/shared"]},
        ]
    }

    stderr = io.StringIO()
    with redirect_stderr(stderr):
        split_kg_by_domain(kg, discovery, warn_on_overlap=True)

    output = stderr.getvalue()
    assert "WARNING" in output, f"Expected overlap warning in stderr, got: {output!r}"
    assert "src/shared/util.ts" in output
    assert "domain:a" in output
    assert "domain:b" in output


if __name__ == "__main__":
    test_overlap_warning_emitted()
    print("  ✓ test_overlap_warning_emitted")
    print("\nAll tests passed.")

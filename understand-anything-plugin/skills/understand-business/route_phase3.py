#!/usr/bin/env python3
"""Route Phase 3/4 assembly based on Phase 2 output format.

Determines whether to run the domain-centric pipeline (Phase 3 + Phase 4)
or the feature-centric pipeline (Phase 4b + Phase 4c + cross_reference).

Usage:
    python3 route_phase3.py <project-root>

Returns JSON:
    {"route": "feature_centric" | "domain_centric", "reason": "..."}
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def route_assembly(project_root_str: str) -> dict:
    """Decide which post-Phase-2 assembly pipeline to execute."""
    project_root = Path(project_root_str)
    assoc_path = project_root / '.understand-anything' / 'intermediate' / 'phase2-associations.json'

    if not assoc_path.exists():
        return {
            'route': 'domain_centric',
            'reason': 'phase2-associations.json not found; defaulting to domain-centric pipeline',
        }

    try:
        data = json.loads(assoc_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        return {
            'route': 'domain_centric',
            'reason': f'Failed to parse phase2-associations.json ({exc}); defaulting to domain-centric pipeline',
        }

    if not isinstance(data, dict):
        return {
            'route': 'domain_centric',
            'reason': 'phase2-associations.json is not a JSON object; defaulting to domain-centric pipeline',
        }

    # association_discovery output includes featureCount and/or phase3_compatible
    if 'featureCount' in data or 'phase3_compatible' in data:
        return {
            'route': 'feature_centric',
            'reason': 'Phase 2 produced association_discovery output (featureCount/phase3_compatible present)',
        }

    return {
        'route': 'domain_centric',
        'reason': 'Phase 2 produced legacy pairwise/batch association output',
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 route_phase3.py <project-root>', file=sys.stderr)
        sys.exit(1)

    result = route_assembly(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)

#!/usr/bin/env python3
"""Phase 0 extension: Detect project scenario to route Phase 2 strategy.

Scenarios:
  - server_only: Only server/backend facets present → use pairwise matching
  - client_server: One server + one client facet → use association_discovery
  - multi_client: One server + multiple client facets → use association_discovery

Usage:
    python3 scenario_detector.py <project-root>
"""
import json
import sys
from pathlib import Path

CLIENT_FACET_TYPES = {'mobile', 'frontend', 'web', 'desktop'}
SERVER_FACET_TYPES = {'server', 'backend'}

_STRATEGY_MAP = {
    'server_only': 'pairwise',
    'client_server': 'association_discovery',
    'multi_client': 'association_discovery',
    'client_only': 'skip',
    'unknown': 'pairwise',
}


def detect_scenario(project_root_str: str) -> dict:
    project_root = Path(project_root_str)
    system_path = project_root / '.understand-anything' / 'system.json'

    if not system_path.exists():
        return {
            'scenario': 'unknown',
            'server_facet': None,
            'client_facets': [],
            'phase2_strategy': 'pairwise',
        }

    try:
        system_config = json.loads(system_path.read_text())
    except (json.JSONDecodeError, IOError):
        return {
            'scenario': 'unknown',
            'server_facet': None,
            'client_facets': [],
            'phase2_strategy': 'pairwise',
        }

    facets = system_config.get('facets', [])
    if not isinstance(facets, list):
        facets = []

    server_facet = None
    client_facets = []

    for facet in facets:
        facet_type = facet.get('type', '')
        if facet_type in SERVER_FACET_TYPES:
            if server_facet is None:
                server_facet = facet
        elif facet_type in CLIENT_FACET_TYPES:
            client_facets.append(facet)

    if not server_facet and not client_facets:
        scenario = 'unknown'
    elif not server_facet:
        scenario = 'client_only'
    elif not client_facets:
        scenario = 'server_only'
    elif len(client_facets) == 1:
        scenario = 'client_server'
    else:
        scenario = 'multi_client'

    phase2_strategy = _STRATEGY_MAP.get(scenario, 'pairwise')

    return {
        'scenario': scenario,
        'server_facet': server_facet,
        'client_facets': client_facets,
        'phase2_strategy': phase2_strategy,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 scenario_detector.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = detect_scenario(sys.argv[1])
    print(f"Scenario: {result['scenario']}, Phase 2 strategy: {result['phase2_strategy']}")

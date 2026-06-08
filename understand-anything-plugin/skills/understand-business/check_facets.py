#!/usr/bin/env python3
"""Phase 0: Check facet availability from system.json.

Reads system.json, checks for each facet whether its aggregation graph
(system-graph.json for backend, client-graph.json for mobile) and wiki exist.

Usage:
    python3 check_facets.py <project-root>

Output:
    <project-root>/.understand-anything/intermediate/facet-status.json
"""
import json
import sys
from pathlib import Path


GRAPH_FILE_MAP = {
    'backend': 'system-graph.json',
    'mobile': 'client-graph.json',
    'frontend': None,
    'test': None,
}


def check_facets(project_root_str):
    project_root = Path(project_root_str)
    system_path = project_root / '.understand-anything' / 'system.json'

    if not system_path.exists():
        result = {'facets': []}
        _write_output(project_root, result)
        return result

    with open(system_path) as f:
        system_config = json.load(f)

    facets_result = []
    for facet in system_config.get('facets', []):
        facet_id = facet.get('id', '')
        facet_path = facet.get('path', '')
        facet_type = facet.get('type', '')

        facet_dir = project_root / facet_path
        ua_dir = facet_dir / '.understand-anything'
        graph_file = GRAPH_FILE_MAP.get(facet_type)

        has_graph = False
        graph_path = ''
        if graph_file:
            gp = ua_dir / graph_file
            has_graph = gp.exists()
            graph_path = str(gp.relative_to(project_root)) if has_graph else ''

        wiki_meta = ua_dir / 'wiki' / 'meta.json'
        has_wiki = wiki_meta.exists()

        if has_graph and has_wiki:
            status = 'available'
        elif has_wiki and not has_graph:
            status = 'degraded'
        else:
            status = 'missing'

        facets_result.append({
            'id': facet_id,
            'type': facet_type,
            'path': facet_path,
            'status': status,
            'graphPath': graph_path,
            'hasWiki': has_wiki,
            'hasGraph': has_graph,
        })

    result = {'facets': facets_result}
    _write_output(project_root, result)
    return result


def _write_output(project_root, result):
    output_dir = project_root / '.understand-anything' / 'intermediate'
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / 'facet-status.json'
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 check_facets.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = check_facets(sys.argv[1])
    for f in result['facets']:
        print(f"  [{f['status'].upper():>9}] {f['id']} ({f['type']}) at {f['path']}")

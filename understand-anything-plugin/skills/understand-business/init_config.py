#!/usr/bin/env python3
"""Generate default system.json and config.json for a project.

Usage: python3 init_config.py [project-root]
       Defaults to current directory if project-root is omitted.
"""

import json
import sys
from pathlib import Path

from detect_platforms import build_mobile_services, detect_platform_type


def detect_facets(project_root: Path) -> list[dict]:
    """Scan project root for recognizable facet patterns."""
    facets = []
    for d in sorted(project_root.iterdir()):
        if not d.is_dir() or d.name.startswith('.'):
            continue
        ua_dir = d / '.understand-anything'
        if not ua_dir.exists():
            continue
        kg = ua_dir / 'knowledge-graph.json'
        if not kg.exists():
            continue
        facet_type = _guess_type(d)
        facet = {'id': d.name, 'path': f'{d.name}/', 'type': facet_type}
        sub_paths = _detect_sub_paths(d, facet_type)
        if sub_paths:
            facet['subPaths'] = sub_paths
            if facet_type == 'mobile':
                services, platform_mapping = build_mobile_services(
                    project_root, facet['path'], sub_paths
                )
                facet['services'] = services
                if platform_mapping:
                    facet['platformMapping'] = platform_mapping
        facets.append(facet)
    return facets


def _guess_type(d: Path) -> str:
    """Guess facet type from directory contents."""
    names = {f.name.lower() for f in d.iterdir() if f.is_file()}
    if any(n in names for n in ('build.gradle', 'build.gradle.kts', 'androidmanifest.xml')):
        return 'mobile'
    if any(n in names for n in ('package.json', 'tsconfig.json', 'vite.config.ts')):
        return 'frontend'
    if any(n in names for n in ('pom.xml', 'go.mod', 'requirements.txt', 'cargo.toml')):
        return 'backend'
    return 'backend'


def _detect_sub_paths(d: Path, facet_type: str) -> list[str]:
    """Detect sub-platform directories for facets with multiple clients."""
    known = {'android', 'ios', 'flutter', 'react-native'}
    found = []
    for sub in sorted(d.iterdir()):
        if not sub.is_dir() or sub.name.startswith('.'):
            continue
        if facet_type == 'mobile':
            if sub.name.lower() in known or detect_platform_type(str(sub))["platform"] != "unknown":
                found.append(sub.name)
        elif sub.name.lower() in known:
            found.append(f'{sub.name}/')
    return found


def main():
    project_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    ua_dir = project_root / '.understand-anything'
    ua_dir.mkdir(parents=True, exist_ok=True)

    system_path = ua_dir / 'system.json'
    config_path = ua_dir / 'config.json'

    if system_path.exists():
        print(f'system.json already exists at {system_path}, skipping.')
    else:
        facets = detect_facets(project_root)
        system = {
            'name': project_root.name,
            'description': '',
            'discovery': {'mode': 'manual'},
            'facets': facets,
        }
        system_path.write_text(json.dumps(system, indent=2, ensure_ascii=False) + '\n')
        print(f'Created {system_path} with {len(facets)} facet(s) detected.')

    if config_path.exists():
        print(f'config.json already exists at {config_path}, skipping.')
    else:
        config = {
            'outputLanguage': 'zh-CN',
            'autoUpdate': False,
            'excludeServices': [],
            'rpcAnnotations': [],
            'apiBaseUrl': '',
            'protocolType': 'rest',
        }
        config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n')
        print(f'Created {config_path}')


if __name__ == '__main__':
    main()

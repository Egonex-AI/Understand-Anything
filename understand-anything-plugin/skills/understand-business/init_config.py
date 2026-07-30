#!/usr/bin/env python3
"""Generate default system.json and config.json for a project.

Usage: python3 init_config.py [project-root]
       Defaults to current directory if project-root is omitted.
"""

import json
import sys
from pathlib import Path

from detect_platforms import build_mobile_services, build_server_services, detect_platform_type


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
            elif facet_type in ('backend', 'server'):
                services = build_server_services(
                    project_root, facet['path'], sub_paths
                )
                facet['services'] = services
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
    """Detect sub-service directories within a facet.

    For mobile facets: detect known platforms (android/ios/flutter/etc.).
    For backend/server facets: detect sub-dirs with KG or build files (pom.xml, go.mod, etc.).
    """
    known_mobile = {'android', 'ios', 'flutter', 'react-native'}
    backend_build_files = {'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod',
                           'Cargo.toml', 'requirements.txt', 'pyproject.toml',
                           'package.json', 'settings.gradle', 'settings.gradle.kts'}
    skip_dirs = {'node_modules', 'dist', 'build', 'target', '__pycache__'}
    found = []
    for sub in sorted(d.iterdir()):
        if not sub.is_dir() or sub.name.startswith('.') or sub.name in skip_dirs:
            continue
        if facet_type == 'mobile':
            if sub.name.lower() in known_mobile or detect_platform_type(str(sub))["platform"] != "unknown":
                found.append(sub.name)
        else:
            has_kg = (sub / '.understand-anything' / 'knowledge-graph.json').is_file()
            has_build = any((sub / f).is_file() for f in backend_build_files)
            if has_kg or has_build:
                found.append(sub.name)
    return found


def _update_existing_system(system_path: Path, project_root: Path) -> None:
    """Merge newly discovered sub-services into an existing system.json."""
    with open(system_path, encoding='utf-8') as f:
        system = json.load(f)

    changed = False
    for facet in system.get('facets', []):
        facet_type = facet.get('type', '')
        facet_path = facet.get('path', '').rstrip('/')
        facet_dir = project_root / facet_path
        if not facet_dir.is_dir():
            continue

        detected = _detect_sub_paths(facet_dir, facet_type)
        existing = set(facet.get('subPaths', []))
        new_subs = [s for s in detected if s not in existing]
        if not new_subs:
            continue

        facet.setdefault('subPaths', []).extend(new_subs)
        facet['subPaths'] = sorted(set(facet['subPaths']))

        if facet_type == 'mobile':
            services, platform_mapping = build_mobile_services(
                project_root, facet.get('path', ''), new_subs
            )
            facet.setdefault('services', []).extend(services)
            if platform_mapping:
                facet.setdefault('platformMapping', {}).update(platform_mapping)
        elif facet_type in ('backend', 'server'):
            services = build_server_services(
                project_root, facet.get('path', ''), new_subs
            )
            facet.setdefault('services', []).extend(services)

        changed = True
        print(f'  Updated facet "{facet_path}": added {len(new_subs)} sub-service(s): {new_subs}')

    if changed:
        system_path.write_text(json.dumps(system, indent=2, ensure_ascii=False) + '\n')
        print(f'Updated {system_path}')
    else:
        print(f'system.json is up to date, no new sub-services found.')


def main():
    update_mode = '--update' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    project_root = Path(args[0]) if args else Path.cwd()
    ua_dir = project_root / '.understand-anything'
    ua_dir.mkdir(parents=True, exist_ok=True)

    system_path = ua_dir / 'system.json'
    config_path = ua_dir / 'config.json'

    if system_path.exists():
        if update_mode:
            _update_existing_system(system_path, project_root)
        else:
            print(f'system.json already exists at {system_path}, skipping. Use --update to merge new sub-services.')
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

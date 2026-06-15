#!/usr/bin/env python3
"""Build client-graph.json from platform wiki data.

Reads wiki/domains/*.json from each platform directory (android, ios, flutter, etc.)
and produces a unified client-graph.json with cross-platform feature mapping.

Usage:
    python3 build-client-graph.py <project-root>

Output:
    <project-root>/<client-facet-path>/.understand-anything/client-graph.json
"""
import json
import sys
import hashlib
from pathlib import Path


def _load_system_config(project_root: Path):
    system_path = project_root / '.understand-anything' / 'system.json'
    if not system_path.exists():
        return None
    with open(system_path) as f:
        return json.load(f)


def _find_client_facet(system_config):
    for facet in system_config.get('facets', []):
        if facet.get('type') == 'mobile':
            return facet
    return None


def _load_platform_domains(platform_path: Path):
    wiki_domains_dir = platform_path / '.understand-anything' / 'wiki' / 'domains'
    if not wiki_domains_dir.exists():
        return {}
    domains = {}
    for f in wiki_domains_dir.glob('*.json'):
        try:
            with open(f) as fh:
                data = json.load(fh)
                domain_id = data.get('id', f.stem)
                domains[domain_id] = data
        except (json.JSONDecodeError, IOError):
            continue
    return domains


def _detect_platform_frameworks(platform_domains_map):
    """Determine the framework type for each platform based on its name and wiki metadata.

    Returns:
        frameworks: sorted list of cross-platform framework names found
        platform_framework_map: dict mapping platform name -> framework type
    """
    CROSS_PLATFORM_INDICATORS = {
        'flutter': ['flutter'],
        'react-native': ['react_native', 'react-native', 'reactnative'],
        'kmm': ['kmm', 'kotlin_multiplatform'],
    }

    frameworks = set()
    platform_framework_map = {}

    for platform in platform_domains_map:
        platform_lower = platform.lower().replace('-', '_')
        detected = None
        for fw, indicators in CROSS_PLATFORM_INDICATORS.items():
            if any(ind in platform_lower for ind in indicators):
                detected = fw
                break

        if detected:
            frameworks.add(detected)
            platform_framework_map[platform] = detected
        else:
            platform_framework_map[platform] = 'native'

    return sorted(frameworks), platform_framework_map


def _normalize_domain_name(name):
    return name.lower().replace('-', '_').replace(' ', '_')


def _classify_impl_type(domain_name, platform_domains_map, platform_framework_map):
    """Classify domain implementation type based on which platform it belongs to."""
    normalized = _normalize_domain_name(domain_name)
    has_cross_platform_ref = False
    has_native_ref = False
    implementations = {}

    for platform, domains in platform_domains_map.items():
        for did, domain in domains.items():
            d_name = _normalize_domain_name(domain.get('name', did))
            if d_name != normalized:
                continue
            wiki_ref = domain.get('_wiki_ref', '')
            fw = platform_framework_map.get(platform, 'native')
            if fw != 'native':
                has_cross_platform_ref = True
            else:
                has_native_ref = True
            implementations[platform] = {'framework': fw, 'ref': wiki_ref}

    if has_cross_platform_ref and not has_native_ref:
        return 'cross-platform', implementations
    elif has_native_ref and not has_cross_platform_ref:
        return 'platform-specific', implementations
    elif has_cross_platform_ref and has_native_ref:
        return 'mixed', implementations
    else:
        return 'platform-specific', implementations


def _build_domain_links(platform_domains_map, platform_framework_map):
    """Build cross-platform domain links by matching domain names across platforms.

    Uses exact normalized name matching + common mobile semantic families.
    """
    SEMANTIC_FAMILIES = {
        'messaging': ['instant_messaging', 'im_chat', 'group_chat', 'chat'],
        'live_room': ['live_streaming', 'live_voice_room', 'audio_chatroom', 'audio_room_pk'],
        'gift': ['gift', 'gift_payment'],
        'call': ['phone_call', 'av_call_media'],
        'profile': ['profile_settings', 'account_profile'],
        'social': ['social_moment', 'feed_social'],
        'login': ['login_auth'],
    }

    # Collect all domains per platform with both slug-based and display-name-based keys
    platform_domain_map = {}  # { platform: { normalized_slug: domain_id } }
    platform_display_names = {}  # { platform: { domain_id: display_name } }
    for platform, domains in platform_domains_map.items():
        platform_domain_map[platform] = {}
        platform_display_names[platform] = {}
        for did, domain in domains.items():
            slug = did.removeprefix('domain:').replace('-', '_').lower()
            platform_domain_map[platform][slug] = did
            platform_display_names[platform][did] = domain.get('name', did)

    # Find semantic family matches
    domain_links = []
    used_domains = set()  # track (platform, domain_id) pairs already linked

    for family_name, family_members in SEMANTIC_FAMILIES.items():
        mappings = {}
        canonical = None
        for platform, domains in platform_domain_map.items():
            for slug, did in domains.items():
                if slug in family_members and (platform, did) not in used_domains:
                    mappings[platform] = did
                    if canonical is None:
                        canonical = platform_display_names.get(platform, {}).get(did, slug)
                    used_domains.add((platform, did))

        if len(mappings) >= 2:
            domain_links.append({
                'canonicalFeature': canonical or family_name,
                'mappings': mappings,
            })

    # Also match exact slug names across platforms
    all_slugs = {}  # { slug: [(platform, domain_id)] }
    for platform, domains in platform_domain_map.items():
        for slug, did in domains.items():
            if (platform, did) not in used_domains:
                all_slugs.setdefault(slug, []).append((platform, did))

    for slug, entries in all_slugs.items():
        if len(entries) >= 2:
            mappings = {platform: did for platform, did in entries}
            p0, d0 = entries[0]
            canonical = platform_display_names.get(p0, {}).get(d0, slug)
            domain_links.append({
                'canonicalFeature': canonical or slug,
                'mappings': mappings,
            })

    return domain_links


def build_client_graph(project_root_str: str) -> None:
    project_root = Path(project_root_str)
    system_config = _load_system_config(project_root)
    if not system_config:
        raise FileNotFoundError('[build-client-graph] system.json not found')

    client_facet = _find_client_facet(system_config)
    if not client_facet:
        raise ValueError('[build-client-graph] No mobile facet found in system.json')

    facet_path = project_root / client_facet['path']
    sub_paths = client_facet.get('subPaths', [])
    if not sub_paths:
        sub_paths = [d.name + '/' for d in facet_path.iterdir() if d.is_dir() and (d / '.understand-anything' / 'wiki' / 'meta.json').exists()]

    platforms = []
    platform_domains_map = {}
    for sp in sub_paths:
        platform_path = facet_path / sp.rstrip('/')
        if not platform_path.exists():
            continue
        platform_name = sp.rstrip('/')
        platforms.append(platform_name)
        domains = _load_platform_domains(platform_path)
        for did, domain in domains.items():
            domain['_wiki_ref'] = f"{client_facet['path']}{sp}.understand-anything/wiki/domains/{Path(did).stem}.json"
        platform_domains_map[platform_name] = domains

    if not platforms:
        raise FileNotFoundError('[build-client-graph] No integrated platforms found')

    cross_platform_frameworks, platform_framework_map = _detect_platform_frameworks(platform_domains_map)

    all_domain_names = set()
    for domains in platform_domains_map.values():
        for domain in domains.values():
            all_domain_names.add(domain.get('name', ''))

    feature_map = []
    for domain_name in sorted(all_domain_names):
        if not domain_name:
            continue
        impl_type, implementations = _classify_impl_type(
            domain_name, platform_domains_map, platform_framework_map
        )
        for impl in implementations.values():
            impl.pop('_wiki_ref', None)
        entry = {
            'domain': domain_name,
            'implType': impl_type,
            'implementations': implementations,
        }
        feature_map.append(entry)

    domain_links = _build_domain_links(platform_domains_map, platform_framework_map)

    client_graph = {
        'platforms': platforms,
        'crossPlatformFrameworks': cross_platform_frameworks,
        'featureMap': feature_map,
        'domainLinks': domain_links,
    }

    # Hash is of canonical content (without contentHash), so integrity can be
    # verified by stripping the field, re-hashing, and comparing.
    content = json.dumps(client_graph, indent=2, ensure_ascii=False)
    content_hash = hashlib.sha256(content.encode()).hexdigest()
    client_graph['contentHash'] = content_hash
    content = json.dumps(client_graph, indent=2, ensure_ascii=False)

    output_path = facet_path / '.understand-anything' / 'client-graph.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = str(output_path) + '.tmp'
    with open(tmp_path, 'w') as f:
        f.write(content)
    Path(tmp_path).rename(output_path)

    print(f'[build-client-graph] Generated client-graph.json: {len(platforms)} platforms, {len(feature_map)} features, hash={content_hash[:12]}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 build-client-graph.py <project-root>', file=sys.stderr)
        sys.exit(1)
    try:
        build_client_graph(sys.argv[1])
    except (FileNotFoundError, ValueError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

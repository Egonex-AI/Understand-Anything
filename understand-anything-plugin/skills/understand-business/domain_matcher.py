#!/usr/bin/env python3
"""Phase 1: Deterministic domain matching across facets.

Three-layer matching (all deterministic, no LLM):
  Layer 1a: API endpoint exact match (client API call path == server endpoint path)
  Layer 1b: Domain name exact match (case-insensitive, normalized punctuation)
  Layer 1c: Manual mapping from domain-mapping.json

Unmatched pairs → candidates[] for Phase 2 LLM verification.

Usage:
    python3 domain_matcher.py <project-root>

Output:
    <project-root>/.understand-anything/intermediate/phase1-matches.json
"""
import json
import sys
from pathlib import Path


def _normalize_name(name):
    return name.lower().replace('-', '_').replace(' ', '_')


def _load_domains_from_wiki_dir(wiki_dir, domains, service=''):
    if not wiki_dir.exists():
        return
    for f in wiki_dir.glob('*.json'):
        try:
            data = json.loads(f.read_text())
            name = data.get('name', f.stem)
            endpoints = []
            ip = data.get('integrationPoints', {})
            if isinstance(ip, list):
                for entry in ip:
                    ep = entry.get('endpoint', '') or entry.get('target', '')
                    if ep:
                        endpoints.append(ep)
            elif isinstance(ip, dict):
                for entry in ip.get('inbound', []):
                    ep = entry.get('endpoint', '')
                    if ep:
                        endpoints.append(ep)
            if name not in domains:
                domains[name] = {
                    'data': data,
                    'endpoints': endpoints,
                    'file': str(f),
                    'service': service,
                }
        except (json.JSONDecodeError, IOError):
            continue


def _load_server_domains(project_root, server_path, sub_paths=None):
    facet_dir = (Path(project_root) / server_path).resolve()
    if not facet_dir.is_relative_to(Path(project_root).resolve()):
        raise ValueError(f"Path escapes project root: {server_path}")
    domains = {}
    parent_wiki = facet_dir / '.understand-anything' / 'wiki' / 'domains'
    _load_domains_from_wiki_dir(parent_wiki, domains, service='cross-service')
    for sp in sub_paths or []:
        service = sp.rstrip('/')
        wiki_dir = facet_dir / service / '.understand-anything' / 'wiki' / 'domains'
        _load_domains_from_wiki_dir(wiki_dir, domains, service=service)
    return domains


def _load_client_domains(project_root, client_path, sub_paths):
    domains = {}
    facet_dir = (Path(project_root) / client_path).resolve()
    if not facet_dir.is_relative_to(Path(project_root).resolve()):
        raise ValueError(f"Path escapes project root: {client_path}")
    root = facet_dir
    parent_wiki = root / '.understand-anything' / 'wiki' / 'domains'
    for f in (parent_wiki.glob('*.json') if parent_wiki.exists() else []):
        try:
            data = json.loads(f.read_text())
            name = data.get('name', f.stem)
            if name not in domains:
                domains[name] = {'data': data, 'api_calls': [], 'platform': 'cross-platform', 'file': str(f)}
        except (json.JSONDecodeError, IOError):
            continue
    for sp in sub_paths:
        platform = sp.rstrip('/')
        wiki_dir = root / platform / '.understand-anything' / 'wiki' / 'domains'
        kg_path = root / platform / '.understand-anything' / 'knowledge-graph.json'

        api_calls_by_domain = {}
        if kg_path.exists():
            try:
                kg = json.loads(kg_path.read_text())
                for edge in kg.get('edges', []):
                    if edge.get('type') == 'consumes_api':
                        target = edge.get('target', '')
                        if ':' in target:
                            path_part = target.split(':', 2)[-1] if target.count(':') >= 2 else target
                            api_calls_by_domain.setdefault('_all', []).append(path_part)
            except (json.JSONDecodeError, IOError):
                pass

        if not wiki_dir.exists():
            continue
        for f in wiki_dir.glob('*.json'):
            try:
                data = json.loads(f.read_text())
                name = data.get('name', f.stem)
                if name not in domains:
                    domains[name] = {'data': data, 'api_calls': list(api_calls_by_domain.get('_all', [])), 'platform': platform, 'file': str(f)}
            except (json.JSONDecodeError, IOError):
                continue
    return domains


def _match_by_api(server_domains, client_domains):
    endpoint_to_server = {}
    for s_name, s_info in server_domains.items():
        for ep in s_info.get('endpoints', []):
            path = ep.split(' ', 1)[-1] if ' ' in ep else ep
            endpoint_to_server[path] = s_name

    matches = []
    matched_pairs = set()
    for c_name, c_info in client_domains.items():
        for api_call in c_info.get('api_calls', []):
            path = api_call.split(' ', 1)[-1] if ' ' in api_call else api_call
            if path in endpoint_to_server:
                s_name = endpoint_to_server[path]
                pair_key = (s_name, c_name)
                if pair_key not in matched_pairs:
                    matched_pairs.add(pair_key)
                    matches.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'auto-api',
                        'confidence': 1.0,
                    })
    return matches


def _match_by_name(server_domains, client_domains, already_matched_server, already_matched_client):
    matches = []
    server_norm = {_normalize_name(k): k for k in server_domains if k not in already_matched_server}
    for c_name in client_domains:
        if c_name in already_matched_client:
            continue
        c_norm = _normalize_name(c_name)
        if c_norm in server_norm:
            s_name = server_norm[c_norm]
            matches.append({
                'canonical': s_name,
                'server': [s_name],
                'client': [c_name],
                'matchType': 'auto-name',
                'confidence': 1.0,
            })
    return matches


def _strip_suffix(name):
    """Remove common suffixes like （端到端）to get core domain name."""
    import re
    return re.sub(r'[（(].+?[)）]', '', name).strip()


def _char_bigrams(text):
    """Generate character bigrams for Chinese text matching."""
    return {text[i:i+2] for i in range(len(text) - 1)} if len(text) >= 2 else {text}


def _match_by_fuzzy(server_domains, client_domains, already_matched_server, already_matched_client):
    """Fuzzy name matching: substring, shared bigrams, or common prefix for CJK text."""
    matches = []
    matched_pairs = set()

    for s_name in server_domains:
        if s_name in already_matched_server:
            continue
        s_clean = _strip_suffix(s_name)

        for c_name in client_domains:
            if c_name in already_matched_client:
                continue
            c_clean = _strip_suffix(c_name)

            pair = (s_name, c_name)
            if pair in matched_pairs:
                continue

            # Substring match (either direction)
            if len(s_clean) >= 2 and len(c_clean) >= 2:
                if s_clean in c_clean or c_clean in s_clean:
                    matched_pairs.add(pair)
                    matches.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'auto-fuzzy',
                        'confidence': 0.9,
                    })
                    continue

            # Common prefix (>= 2 chars)
            prefix_len = 0
            for a, b in zip(s_clean, c_clean):
                if a == b:
                    prefix_len += 1
                else:
                    break
            min_len = min(len(s_clean), len(c_clean))
            if prefix_len >= 2 and min_len > 0 and prefix_len / min_len >= 0.5:
                matched_pairs.add(pair)
                matches.append({
                    'canonical': s_name,
                    'server': [s_name],
                    'client': [c_name],
                    'matchType': 'auto-fuzzy',
                    'confidence': 0.8,
                })
                continue

            # Bigram overlap (Jaccard >= 0.4)
            s_bigrams = _char_bigrams(s_clean)
            c_bigrams = _char_bigrams(c_clean)
            if s_bigrams and c_bigrams:
                jaccard = len(s_bigrams & c_bigrams) / len(s_bigrams | c_bigrams)
                if jaccard >= 0.4:
                    matched_pairs.add(pair)
                    matches.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'auto-fuzzy',
                        'confidence': round(0.6 + jaccard * 0.3, 2),
                    })

    return matches


def _load_manual_mappings(project_root):
    mapping_path = Path(project_root) / '.understand-anything' / 'domain-mapping.json'
    if not mapping_path.exists():
        return []
    try:
        data = json.loads(mapping_path.read_text())
        return data.get('mappings', [])
    except (json.JSONDecodeError, IOError):
        return []


# Infrastructure domain detection keywords
_INFRASTRUCTURE_KEYWORDS = {'网络层', 'UI基础', 'UI 基础', '混合容器', '数据埋点', '数据与配置', '应用启动', '平台基础'}


def _consolidate_mobile_domains(project_root: str, facet_path: str, sub_paths: list) -> dict:
    """Consolidate multi-platform client domains into logical business domains.

    For mobile facets, multiple platforms (iOS/Android/Flutter) may implement the same
    business feature. This function merges them using domainLinks/featureParity data.

    Flutter modules are not independent apps — they're embedded in native apps via bridges.
    """
    root = Path(project_root)
    facet_dir = root / facet_path

    # Load merge metadata
    cg_path = facet_dir / '.understand-anything' / 'client-graph.json'
    arch_path = facet_dir / '.understand-anything' / 'wiki' / 'architecture.json'

    domain_links = []
    native_bridges = []
    feature_parity = []

    if cg_path.exists():
        try:
            cg = json.loads(cg_path.read_text())
            domain_links = cg.get('domainLinks', [])
        except (json.JSONDecodeError, IOError):
            pass

    if arch_path.exists():
        try:
            arch = json.loads(arch_path.read_text())
            native_bridges = arch.get('nativeBridge', [])
            feature_parity = arch.get('featureParity', [])
            if not domain_links:
                domain_links = arch.get('domainMapping', [])
        except (json.JSONDecodeError, IOError):
            pass

    # Determine Flutter bridge accessibility
    # flutter_service -> [native services that can access it]
    flutter_services = set()
    bridge_targets = {}
    for bridge in native_bridges:
        from_svc = bridge.get('from', '')
        to_svc = bridge.get('to', '')
        # Identify which is Flutter
        if 'flutter' in from_svc.lower():
            flutter_services.add(from_svc)
            bridge_targets.setdefault(from_svc, []).append(to_svc)
        elif 'flutter' in to_svc.lower():
            flutter_services.add(to_svc)
            bridge_targets.setdefault(to_svc, []).append(from_svc)

    # Build merge map: (platform, domain_id) -> canonicalFeature
    merge_map = {}
    for link in domain_links:
        canonical = link.get('canonicalFeature', '')
        for platform, ref in link.get('mappings', {}).items():
            domain_id = ref.removeprefix('domain:') if isinstance(ref, str) else ''
            if canonical and domain_id:
                merge_map[(platform, domain_id)] = canonical

    # Also use featureParity for domains not in domainLinks
    for fp in feature_parity:
        canonical = fp.get('feature', '')
        for plat_key, plat_info in fp.get('platforms', {}).items():
            platform_name = plat_info.get('service', '')
            domain_id = plat_info.get('domain', '')
            if canonical and platform_name and domain_id:
                if (platform_name, domain_id) not in merge_map:
                    merge_map[(platform_name, domain_id)] = canonical

    # Load all raw platform domains
    raw_domains = []
    for sp in sub_paths:
        platform = sp.rstrip('/')
        wiki_dir = facet_dir / platform / '.understand-anything' / 'wiki' / 'domains'
        if not wiki_dir.exists():
            continue
        for f in wiki_dir.glob('*.json'):
            try:
                data = json.loads(f.read_text())
                name = data.get('name', f.stem)
                domain_id = data.get('id', f.stem).removeprefix('domain:')
                summary = data.get('summary', '')
                raw_domains.append({
                    'name': name,
                    'platform': platform,
                    'domainId': domain_id,
                    'summary': summary,
                    'file': str(f),
                    'data': data,
                })
            except (json.JSONDecodeError, IOError):
                continue

    # Classify and merge
    consolidated = {}  # canonicalName -> LogicalDomain
    standalone = []
    infrastructure = []

    for d in raw_domains:
        # Check infrastructure
        is_infra = any(kw in d['name'] for kw in _INFRASTRUCTURE_KEYWORDS)
        if is_infra:
            infrastructure.append({
                'name': d['name'],
                'platform': d['platform'],
                'domainId': d['domainId'],
                'implType': 'infrastructure',
                'deliveryPlatforms': [d['platform']],
            })
            continue

        # Check if this domain should be merged
        canonical = merge_map.get((d['platform'], d['domainId']))
        if canonical:
            if canonical not in consolidated:
                consolidated[canonical] = {
                    'name': canonical,
                    'implType': 'cross-platform',
                    'platforms': [],
                    'deliveryPlatforms': [],
                    'implementations': [],
                    'mergedSummary': '',
                }
            entry = consolidated[canonical]
            entry['platforms'].append(d['platform'])
            entry['implementations'].append({
                'platform': d['platform'],
                'domainName': d['name'],
                'domainId': d['domainId'],
                'summary': d['summary'],
            })
            entry['mergedSummary'] += f" [{d['platform']}] {d['summary']}"
        else:
            # Standalone (platform-specific) domain
            delivery = [d['platform']]
            impl_type = 'native-specific'

            # Flutter-only domains are accessible from native via bridge
            if d['platform'] in flutter_services:
                impl_type = 'flutter-only'
                accessible_natives = bridge_targets.get(d['platform'], [])
                delivery = list(set([d['platform']] + accessible_natives))

            standalone.append({
                'name': d['name'],
                'platform': d['platform'],
                'domainId': d['domainId'],
                'implType': impl_type,
                'deliveryPlatforms': delivery,
            })

    # Post-process consolidated domains
    for entry in consolidated.values():
        platforms_set = set(entry['platforms'])
        # If ALL implementations are Flutter, it's flutter-only
        if platforms_set <= flutter_services:
            entry['implType'] = 'flutter-only'
            # Add bridge-accessible platforms to deliveryPlatforms
            all_accessible = set()
            for fp in platforms_set:
                all_accessible.update(bridge_targets.get(fp, []))
            entry['deliveryPlatforms'] = sorted(set(entry['platforms']) | all_accessible)
        else:
            entry['deliveryPlatforms'] = sorted(entry['platforms'])

        entry['mergedSummary'] = entry['mergedSummary'].strip()

    return {
        'consolidated': list(consolidated.values()),
        'standalone': standalone,
        'infrastructure': infrastructure,
    }


def match_domains(project_root_str: str, system_config: dict | None = None) -> dict:
    project_root = Path(project_root_str)

    if system_config is None:
        system_path = project_root / '.understand-anything' / 'system.json'
        if not system_path.exists():
            return {'matched': [], 'candidates': []}
        system_config = json.loads(system_path.read_text())

    server_facet = None
    client_facet = None
    for facet in system_config.get('facets', []):
        facet_type = facet.get('type', '')
        if facet_type in ('backend', 'server'):
            server_facet = facet
        elif facet_type == 'mobile':
            client_facet = facet

    if not server_facet or not client_facet:
        return {'matched': [], 'candidates': []}

    server_domains = _load_server_domains(
        project_root_str,
        server_facet['path'],
        server_facet.get('subPaths', []),
    )
    client_domains = _load_client_domains(
        project_root_str,
        client_facet['path'],
        client_facet.get('subPaths', [])
    )

    # Domain consolidation for mobile facets
    consolidation = _consolidate_mobile_domains(
        project_root_str, client_facet['path'], client_facet.get('subPaths', [])
    )

    # Replace raw client_domains with consolidated logical domains for matching
    if consolidation['consolidated'] or consolidation['standalone']:
        consolidated_client_domains = {}
        for d in consolidation['consolidated']:
            consolidated_client_domains[d['name']] = {
                'data': {'name': d['name'], 'summary': d['mergedSummary']},
                'api_calls': [],
                'platform': 'consolidated',
                'file': '',
                'implType': d['implType'],
                'deliveryPlatforms': d['deliveryPlatforms'],
            }
        for d in consolidation['standalone']:
            consolidated_client_domains[d['name']] = {
                'data': {'name': d['name']},
                'api_calls': [],
                'platform': d['platform'],
                'file': '',
                'implType': d['implType'],
                'deliveryPlatforms': d['deliveryPlatforms'],
            }
        # Infrastructure domains are excluded from matching
        client_domains = consolidated_client_domains

    all_matched = []
    matched_server = set()
    matched_client = set()

    manual_mappings = _load_manual_mappings(project_root_str)
    for m in manual_mappings:
        canonical = m.get('canonical', '')
        server_aliases = m.get('aliases', {}).get('server', [])
        client_aliases = m.get('aliases', {}).get('client', [])
        all_matched.append({
            'canonical': canonical,
            'server': server_aliases,
            'client': client_aliases,
            'matchType': 'manual',
            'confidence': 1.0,
        })
        matched_server.update(server_aliases)
        matched_client.update(client_aliases)

    api_matches = _match_by_api(server_domains, client_domains)
    for m in api_matches:
        for s in m['server']:
            matched_server.add(s)
        for c in m['client']:
            matched_client.add(c)
        all_matched.append(m)

    name_matches = _match_by_name(server_domains, client_domains, matched_server, matched_client)
    for m in name_matches:
        for s in m['server']:
            matched_server.add(s)
        for c in m['client']:
            matched_client.add(c)
        all_matched.append(m)

    fuzzy_matches = _match_by_fuzzy(server_domains, client_domains, matched_server, matched_client)
    for m in fuzzy_matches:
        for s in m['server']:
            matched_server.add(s)
        for c in m['client']:
            matched_client.add(c)
        all_matched.append(m)

    candidates = []
    for s_name in server_domains:
        if s_name in matched_server:
            continue
        for c_name in client_domains:
            if c_name in matched_client:
                continue
            candidates.append({
                'server': s_name,
                'client': c_name,
                'reason': 'name mismatch, no shared API endpoints',
            })

    result = {'matched': all_matched, 'candidates': candidates}

    output_dir = project_root / '.understand-anything' / 'intermediate'
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'phase1-matches.json').write_text(json.dumps(result, indent=2, ensure_ascii=False))

    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 domain_matcher.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = match_domains(sys.argv[1])
    print(f"Matched: {len(result['matched'])}, Candidates for LLM: {len(result['candidates'])}")

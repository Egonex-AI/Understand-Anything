#!/usr/bin/env python3
"""Phase 3: Merge domain matches and generate domains.json + cross-facet-links.json.

Reads Phase 1 deterministic matches and Phase 2 LLM verification results,
produces the business-landscape index files.

Usage:
    python3 assemble_landscape.py <project-root>

Output:
    intermediate/domains.json
    intermediate/cross-facet-links.json
    .understand-anything/domain-mapping.json (updated)
"""
import json
import sys
from pathlib import Path


def _deduplicate_domains(domains: list[dict]) -> list[dict]:
    """Merge domains with identical names, combining their facets and interactions."""
    seen: dict[str, dict] = {}
    for domain in domains:
        key = domain.get('name', '').strip().lower()
        if not key:
            continue
        if key in seen:
            existing = seen[key]
            existing.setdefault('facets', []).extend(domain.get('facets', []))
            existing.setdefault('interactions', []).extend(domain.get('interactions', []))
            existing.setdefault('businessRules', []).extend(domain.get('businessRules', []))
            existing['facets'] = list({json.dumps(f, sort_keys=True, ensure_ascii=False): f for f in existing['facets']}.values())
            existing['interactions'] = list({json.dumps(i, sort_keys=True, ensure_ascii=False): i for i in existing['interactions']}.values())
            existing['businessRules'] = list({json.dumps(r, sort_keys=True, ensure_ascii=False): r for r in existing['businessRules']}.values())
        else:
            seen[key] = domain
    return list(seen.values())


def assemble_landscape(project_root_str: str) -> dict | None:
    project_root = Path(project_root_str)
    intermediate = project_root / '.understand-anything' / 'intermediate'

    phase1_path = intermediate / 'phase1-matches.json'
    if not phase1_path.exists():
        print('[assemble-landscape] ERROR: phase1-matches.json not found', file=sys.stderr)
        return None

    phase1 = json.loads(phase1_path.read_text())
    all_matched = list(phase1.get('matched', []))

    for candidate in phase1.get('candidates', []):
        s_name = candidate['server']
        c_name = candidate['client']
        match_file = intermediate / f'match-{s_name}-{c_name}.json'
        if match_file.exists():
            try:
                llm_result = json.loads(match_file.read_text())
                checkpoint = llm_result.get('_checkpoint', {})
                if checkpoint.get('status') != 'complete':
                    continue
                if llm_result.get('match') and llm_result.get('confidence', 0) >= 0.7:
                    all_matched.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'auto-llm',
                        'confidence': llm_result.get('confidence', 0.7),
                    })
            except (json.JSONDecodeError, IOError):
                continue

    # Phase 2 Strategy B: Association discovery results
    assoc_path = intermediate / 'phase2-associations.json'
    if assoc_path.exists():
        try:
            assoc_data = json.loads(assoc_path.read_text())
            for assoc in assoc_data.get('associations', []):
                s_name = assoc.get('server_domain', '')
                c_name = assoc.get('client_domain', '')
                confidence = assoc.get('confidence', 0)
                if s_name and c_name and confidence >= 0.6:
                    all_matched.append({
                        'canonical': s_name,
                        'server': [s_name],
                        'client': [c_name],
                        'matchType': 'llm-association',
                        'confidence': confidence,
                        'relationship': assoc.get('relationship', 'unknown'),
                    })
        except (json.JSONDecodeError, IOError):
            pass

    matched_server = set()
    matched_client = set()
    for m in all_matched:
        matched_server.update(m.get('server', []))
        matched_client.update(m.get('client', []))

    domains_list = []
    for m in all_matched:
        domain_entry = {
            'id': f"domain:{m['canonical']}",
            'name': m['canonical'],
            'summary': '',
            'facets': ['server', 'client'],
            'matchType': m.get('matchType', 'unknown'),
            'matchConfidence': m.get('confidence', 1.0),
            'detailRef': f"business-landscape/domains/{m['canonical']}.json",
        }
        domains_list.append(domain_entry)

    domains_list = _deduplicate_domains(domains_list)

    unmapped = []
    for candidate in phase1.get('candidates', []):
        s_name = candidate['server']
        c_name = candidate['client']
        if s_name not in matched_server:
            unmapped.append({'facet': 'server', 'domain': s_name, 'reason': candidate.get('reason', 'no match')})
        if c_name not in matched_client:
            unmapped.append({'facet': 'client', 'domain': c_name, 'reason': candidate.get('reason', 'no match')})

    seen_unmapped = set()
    deduped_unmapped = []
    for u in unmapped:
        key = (u['facet'], u['domain'])
        if key not in seen_unmapped:
            seen_unmapped.add(key)
            deduped_unmapped.append(u)

    total = len(domains_list) + len(deduped_unmapped)
    domains_json = {
        'domains': domains_list,
        'unmapped': deduped_unmapped,
        'stats': {
            'totalDomains': total,
            'mappedDomains': len(domains_list),
            'unmappedDomains': len(deduped_unmapped),
            'coverageRate': round(len(domains_list) / total, 2) if total > 0 else 0,
        }
    }
    (intermediate / 'domains.json').write_text(json.dumps(domains_json, indent=2, ensure_ascii=False))

    links = []
    for m in all_matched:
        links.append({
            'domain': f"domain:{m['canonical']}",
            'serverEndpoints': [],
            'clientApiCalls': [],
            'matchDetails': [{
                'matchLayer': 1 if m['matchType'] in ('auto-api', 'auto-name', 'manual') else 2,
                'matchType': m['matchType'],
            }],
        })
    cross_facet_links = {'links': links, 'unmatchedEndpoints': {'server': [], 'client': []}}
    (intermediate / 'cross-facet-links.json').write_text(json.dumps(cross_facet_links, indent=2, ensure_ascii=False))

    mapping = {'mappings': [], 'unmapped': deduped_unmapped}
    for m in all_matched:
        mapping['mappings'].append({
            'canonical': m['canonical'],
            'aliases': {
                'server': m.get('server', []),
                'client': m.get('client', []),
            },
            'matchType': m.get('matchType', 'unknown'),
        })
    mapping_path = project_root / '.understand-anything' / 'domain-mapping.json'
    mapping_path.write_text(json.dumps(mapping, indent=2, ensure_ascii=False))

    return domains_json


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 assemble_landscape.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = assemble_landscape(sys.argv[1])
    if result:
        stats = result['stats']
        print(f"Assembled: {stats['mappedDomains']} mapped, {stats['unmappedDomains']} unmapped ({stats['coverageRate']*100:.0f}% coverage)")

#!/usr/bin/env python3
"""Phase 4 alternative: Assemble feature-centric business documents.

Produces business_features.json with feature-centric structure where each
feature has a clientLayer (platforms, implementations) and serverLayer
(primary + supporting server domains).

Usage:
    python3 assemble_business_features.py <project-root>

Reads:
    intermediate/phase2-associations.json
    (consolidation data from domain_matcher)

Output:
    business-landscape/business-features.json
"""
import json
import sys
from pathlib import Path


def _build_feature_document(feature_data: dict, association: dict) -> dict:
    """Build a single feature document combining client and server layers."""
    name = feature_data.get('name', 'unknown')

    # Build client layer from consolidation data
    platforms_dict = {}
    for impl in feature_data.get('implementations', []):
        platforms_dict[impl.get('platform', '')] = {
            k: v for k, v in impl.items() if k != 'platform'
        }
    # For standalone features with no implementations list
    if not platforms_dict:
        for p in feature_data.get('platforms', []):
            platforms_dict[p] = {}

    client_layer = {
        'implType': feature_data.get('implType', 'unknown'),
        'platforms': platforms_dict,
        'deliveryPlatforms': feature_data.get('deliveryPlatforms', []),
        'summary': feature_data.get('mergedSummary', ''),
    }

    # Build server layer from association (skip if errored)
    primary = association.get('primaryServer') if not association.get('error') else None
    supporting = association.get('supportingServers') or []

    primary_domain = None
    if primary and isinstance(primary, dict) and primary.get('domain'):
        primary_domain = {
            'name': primary.get('domain', ''),
            'service': primary.get('service', ''),
            'confidence': primary.get('confidence', 0),
        }

    server_layer = {
        'primaryDomain': primary_domain,
        'supportingDomains': [
            {
                'name': s.get('domain', ''),
                'service': s.get('service', ''),
                'relationship': s.get('relationship', 'unknown'),
                'confidence': s.get('confidence', 0),
            }
            for s in supporting
            if isinstance(s, dict)
        ],
    }

    return {
        'id': f'feature:{name}',
        'name': name,
        'clientLayer': client_layer,
        'serverLayer': server_layer,
    }


def _merge_server_associations(associations: list) -> dict:
    """Build reverse index: server domain → list of features that depend on it."""
    index = {}

    for assoc in associations:
        if assoc.get('error'):
            continue
        feature_name = assoc.get('featureName', '')

        primary = assoc.get('primaryServer')
        if primary and isinstance(primary, dict):
            domain = primary.get('domain', '')
            if domain:
                if domain not in index:
                    index[domain] = {'features': [], 'refCount': 0, 'service': primary.get('service', '')}
                index[domain]['features'].append(feature_name)
                index[domain]['refCount'] += 1

        for s in (assoc.get('supportingServers') or []):
            domain = s.get('domain', '')
            if domain:
                if domain not in index:
                    index[domain] = {'features': [], 'refCount': 0, 'service': s.get('service', '')}
                if feature_name not in index[domain]['features']:
                    index[domain]['features'].append(feature_name)
                    index[domain]['refCount'] += 1

    return index


def assemble_features(associations: list, consolidation: dict) -> dict:
    """Assemble feature-centric documents from associations and consolidation data."""
    # Build name→feature_data lookup
    feature_lookup = {}
    for f in consolidation.get('consolidated', []):
        feature_lookup[f['name']] = f
    for f in consolidation.get('standalone', []):
        feature_lookup[f['name']] = {
            'name': f['name'],
            'implType': f.get('implType', 'native-specific'),
            'platforms': [f.get('platform', '')],
            'deliveryPlatforms': f.get('deliveryPlatforms', []),
            'implementations': [],
            'mergedSummary': '',
        }

    # Build feature documents
    features = []
    with_association = 0
    for assoc in associations:
        feature_name = assoc.get('featureName', '')
        feature_data = feature_lookup.get(feature_name, {
            'name': feature_name,
            'implType': 'unknown',
            'platforms': [],
            'deliveryPlatforms': [],
            'implementations': [],
            'mergedSummary': '',
        })
        doc = _build_feature_document(feature_data, assoc)
        features.append(doc)
        if doc['serverLayer']['primaryDomain'] is not None:
            with_association += 1

    server_index = _merge_server_associations(associations)

    return {
        'features': features,
        'serverIndex': server_index,
        'stats': {
            'totalFeatures': len(features),
            'withServerAssociation': with_association,
            'serverDomainsReferenced': len(server_index),
        },
    }


def run_assemble_features(project_root_str: str) -> dict:
    """Full pipeline: read Phase 2 results, assemble, write output."""
    project_root = Path(project_root_str)
    intermediate_dir = project_root / '.understand-anything' / 'intermediate'

    assoc_path = intermediate_dir / 'phase2-associations.json'
    if not assoc_path.exists():
        return {'error': 'phase2-associations.json not found. Run Phase 2 first.'}

    try:
        assoc_data = json.loads(assoc_path.read_text())
    except (json.JSONDecodeError, IOError) as e:
        return {'error': f'Failed to parse phase2-associations.json: {e}'}

    associations = assoc_data.get('associations', [])

    # Re-derive consolidation from domain_matcher
    from domain_matcher import _consolidate_mobile_domains

    system_path = project_root / '.understand-anything' / 'system.json'
    if not system_path.exists():
        return {'error': 'system.json not found'}

    try:
        system_config = json.loads(system_path.read_text())
    except (json.JSONDecodeError, IOError) as e:
        return {'error': f'Failed to parse system.json: {e}'}

    consolidation = {'consolidated': [], 'standalone': [], 'infrastructure': []}
    for facet in system_config.get('facets', []):
        if facet.get('type') == 'mobile':
            facet_path = facet.get('path', '')
            if not facet_path:
                continue
            c = _consolidate_mobile_domains(
                project_root_str, facet_path, facet.get('subPaths', [])
            )
            consolidation['consolidated'].extend(c['consolidated'])
            consolidation['standalone'].extend(c['standalone'])
            consolidation['infrastructure'].extend(c['infrastructure'])

    result = assemble_features(associations, consolidation)

    # Write output
    output_dir = project_root / '.understand-anything' / 'business-landscape'
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'business-features.json').write_text(
        json.dumps(result, indent=2, ensure_ascii=False)
    )

    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 assemble_business_features.py <project-root>', file=sys.stderr)
        sys.exit(1)
    result = run_assemble_features(sys.argv[1])
    if 'error' in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    stats = result['stats']
    print(f"Features: {stats['totalFeatures']}, with server: {stats['withServerAssociation']}, server domains: {stats['serverDomainsReferenced']}")

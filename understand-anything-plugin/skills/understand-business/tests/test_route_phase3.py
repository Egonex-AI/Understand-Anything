import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from route_phase3 import route_assembly


@pytest.fixture
def project_root(tmp_path):
    intermediate = tmp_path / '.understand-anything' / 'intermediate'
    intermediate.mkdir(parents=True)
    return tmp_path


def test_association_discovery_routes_to_feature_centric(project_root):
    """association_discovery output with featureCount routes to feature_centric."""
    assoc_data = {
        'associations': [
            {
                'featureName': '用户资料',
                'primaryServer': {'domain': '用户资料', 'service': 'ultron-user', 'confidence': 0.9},
                'supportingServers': [],
            }
        ],
        'featureCount': 1,
        'serverDomainCount': 5,
        'llmCalls': 1,
        'phase3_compatible': [
            {'server_domain': '用户资料', 'client_domain': '用户资料', 'confidence': 0.9},
        ],
    }
    assoc_path = project_root / '.understand-anything' / 'intermediate' / 'phase2-associations.json'
    assoc_path.write_text(json.dumps(assoc_data, ensure_ascii=False))

    result = route_assembly(str(project_root))

    assert result['route'] == 'feature_centric'
    assert 'association_discovery' in result['reason']


def test_feature_count_only_routes_to_feature_centric(project_root):
    """featureCount alone is sufficient to route to feature_centric."""
    assoc_data = {
        'associations': [],
        'featureCount': 0,
        'serverDomainCount': 3,
        'llmCalls': 0,
    }
    assoc_path = project_root / '.understand-anything' / 'intermediate' / 'phase2-associations.json'
    assoc_path.write_text(json.dumps(assoc_data))

    result = route_assembly(str(project_root))

    assert result['route'] == 'feature_centric'


def test_legacy_pairwise_routes_to_domain_centric(project_root):
    """Legacy pairwise/batch output routes to domain_centric."""
    assoc_data = {
        'associations': [
            {
                'server_domain': '用户资料',
                'client_domain': 'Profile',
                'confidence': 0.85,
                'relationship': 'calls',
            }
        ],
    }
    assoc_path = project_root / '.understand-anything' / 'intermediate' / 'phase2-associations.json'
    assoc_path.write_text(json.dumps(assoc_data, ensure_ascii=False))

    result = route_assembly(str(project_root))

    assert result['route'] == 'domain_centric'
    assert 'legacy' in result['reason']


def test_missing_file_routes_to_domain_centric(project_root):
    """Missing phase2-associations.json falls back to domain_centric."""

    result = route_assembly(str(project_root))

    assert result['route'] == 'domain_centric'
    assert 'not found' in result['reason']


def test_invalid_json_routes_to_domain_centric(project_root):
    """Invalid JSON falls back to domain_centric."""
    assoc_path = project_root / '.understand-anything' / 'intermediate' / 'phase2-associations.json'
    assoc_path.write_text('{not valid json')

    result = route_assembly(str(project_root))

    assert result['route'] == 'domain_centric'
    assert 'Failed to parse' in result['reason']

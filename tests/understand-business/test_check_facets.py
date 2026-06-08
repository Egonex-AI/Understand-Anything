#!/usr/bin/env python3
import json
import os
import tempfile
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from check_facets import check_facets


@pytest.fixture
def tmp_project(tmp_path):
    ua = tmp_path / '.understand-anything'
    ua.mkdir()
    return tmp_path


class TestCheckFacets:
    def test_returns_empty_when_no_system_json(self, tmp_project):
        result = check_facets(str(tmp_project))
        assert result['facets'] == []

    def test_detects_available_backend_facet(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        server_ua = tmp_project / 'server' / '.understand-anything'
        server_ua.mkdir(parents=True)
        (server_ua / 'system-graph.json').write_text('{}')
        wiki_dir = server_ua / 'wiki'
        wiki_dir.mkdir()
        (wiki_dir / 'meta.json').write_text('{}')
        result = check_facets(str(tmp_project))
        assert len(result['facets']) == 1
        assert result['facets'][0]['status'] == 'available'

    def test_detects_missing_mobile_facet(self, tmp_project):
        system = {'facets': [{'id': 'client', 'path': 'client/', 'type': 'mobile'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        (tmp_project / 'client').mkdir()
        result = check_facets(str(tmp_project))
        assert len(result['facets']) == 1
        assert result['facets'][0]['status'] == 'missing'

    def test_detects_degraded_facet_wiki_only(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        server_ua = tmp_project / 'server' / '.understand-anything'
        wiki_dir = server_ua / 'wiki'
        wiki_dir.mkdir(parents=True)
        (wiki_dir / 'meta.json').write_text('{}')
        result = check_facets(str(tmp_project))
        assert result['facets'][0]['status'] == 'degraded'

    def test_writes_facet_status_json(self, tmp_project):
        system = {'facets': [{'id': 'server', 'path': 'server/', 'type': 'backend'}]}
        (tmp_project / '.understand-anything' / 'system.json').write_text(json.dumps(system))
        (tmp_project / 'server').mkdir()
        result = check_facets(str(tmp_project))
        output_path = tmp_project / '.understand-anything' / 'intermediate' / 'facet-status.json'
        assert output_path.exists()
        saved = json.loads(output_path.read_text())
        assert saved == result

"""Tests for scenario_detector.py — confirm frontend facets are routed correctly."""
import json
from pathlib import Path

import pytest
from scenario_detector import detect_scenario


@pytest.fixture
def tmp_project(tmp_path):
    ua = tmp_path / ".understand-anything"
    ua.mkdir()
    return tmp_path


def _write_system(tmp_project, facets):
    (tmp_project / ".understand-anything" / "system.json").write_text(json.dumps({"facets": facets}))


class TestScenarioDetector:
    def test_server_plus_frontend_is_client_server(self, tmp_project):
        _write_system(tmp_project, [
            {"id": "backend", "path": "server/", "type": "server"},
            {"id": "web", "path": "frontend/", "type": "frontend"},
        ])
        result = detect_scenario(str(tmp_project))
        assert result["scenario"] == "client_server"
        assert result["phase2_strategy"] == "association_discovery"

    def test_server_plus_mobile_plus_frontend_is_multi_client(self, tmp_project):
        _write_system(tmp_project, [
            {"id": "backend", "path": "server/", "type": "server"},
            {"id": "mobile", "path": "mobile/", "type": "mobile"},
            {"id": "web", "path": "frontend/", "type": "frontend"},
        ])
        result = detect_scenario(str(tmp_project))
        assert result["scenario"] == "multi_client"
        assert len(result["client_facets"]) == 2

    def test_frontend_only_is_client_only(self, tmp_project):
        _write_system(tmp_project, [
            {"id": "web", "path": "frontend/", "type": "frontend"},
        ])
        result = detect_scenario(str(tmp_project))
        assert result["scenario"] == "client_only"
        assert result["phase2_strategy"] == "skip"

    def test_frontend_facet_is_in_client_facets(self, tmp_project):
        _write_system(tmp_project, [
            {"id": "backend", "path": "server/", "type": "backend"},
            {"id": "web", "path": "frontend/", "type": "frontend"},
        ])
        result = detect_scenario(str(tmp_project))
        types = [f["type"] for f in result["client_facets"]]
        assert "frontend" in types

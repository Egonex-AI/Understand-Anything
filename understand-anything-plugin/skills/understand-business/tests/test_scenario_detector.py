import pytest
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from scenario_detector import detect_scenario


@pytest.fixture
def server_only_project(tmp_path):
    """Project with only server facets."""
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    system = {
        "name": "backend-only",
        "facets": [
            {"type": "server", "name": "后端微服务", "path": "backend", "subPaths": ["svc-a", "svc-b"]}
        ]
    }
    (ua_dir / "system.json").write_text(json.dumps(system, ensure_ascii=False))
    return tmp_path


@pytest.fixture
def client_server_project(tmp_path):
    """Project with both server and mobile facets."""
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    system = {
        "name": "full-stack",
        "facets": [
            {"type": "server", "name": "后端", "path": "backend", "subPaths": ["ultron-user"]},
            {"type": "mobile", "name": "客户端", "path": "mobile", "subPaths": ["Amar", "ddoversea"]}
        ]
    }
    (ua_dir / "system.json").write_text(json.dumps(system, ensure_ascii=False))
    return tmp_path


@pytest.fixture
def multi_client_project(tmp_path):
    """Project with multiple client facets (mobile + frontend)."""
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    system = {
        "name": "multi-client",
        "facets": [
            {"type": "server", "name": "后端", "path": "backend", "subPaths": []},
            {"type": "mobile", "name": "移动端", "path": "mobile", "subPaths": ["ios", "android"]},
            {"type": "frontend", "name": "Web端", "path": "web", "subPaths": []}
        ]
    }
    (ua_dir / "system.json").write_text(json.dumps(system, ensure_ascii=False))
    return tmp_path


@pytest.fixture
def no_system_project(tmp_path):
    """Project without system.json."""
    return tmp_path


def test_server_only_scenario(server_only_project):
    """Only server facets → server_only"""
    result = detect_scenario(str(server_only_project))
    assert result["scenario"] == "server_only"
    assert result["server_facet"] is not None
    assert result["client_facets"] == []


def test_client_server_scenario(client_server_project):
    """Server + mobile → client_server"""
    result = detect_scenario(str(client_server_project))
    assert result["scenario"] == "client_server"
    assert result["server_facet"]["type"] == "server"
    assert len(result["client_facets"]) == 1
    assert result["client_facets"][0]["type"] == "mobile"


def test_multi_client_scenario(multi_client_project):
    """Server + multiple client facets → multi_client"""
    result = detect_scenario(str(multi_client_project))
    assert result["scenario"] == "multi_client"
    assert len(result["client_facets"]) == 2


def test_no_system_json_returns_unknown(no_system_project):
    """Missing system.json → unknown scenario"""
    result = detect_scenario(str(no_system_project))
    assert result["scenario"] == "unknown"


def test_result_includes_phase2_strategy(client_server_project):
    """client_server should recommend association_discovery strategy"""
    result = detect_scenario(str(client_server_project))
    assert result["phase2_strategy"] == "association_discovery"


def test_server_only_uses_pairwise_strategy(server_only_project):
    """server_only should recommend pairwise strategy"""
    result = detect_scenario(str(server_only_project))
    assert result["phase2_strategy"] == "pairwise"


@pytest.fixture
def client_only_project(tmp_path):
    """Project with only client facets, no server."""
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    system = {
        "name": "client-only",
        "facets": [
            {"type": "mobile", "name": "移动端", "path": "mobile", "subPaths": ["ios"]}
        ]
    }
    (ua_dir / "system.json").write_text(json.dumps(system, ensure_ascii=False))
    return tmp_path


@pytest.fixture
def malformed_system_project(tmp_path):
    """Project with invalid system.json."""
    ua_dir = tmp_path / ".understand-anything"
    ua_dir.mkdir()
    (ua_dir / "system.json").write_text("{invalid json!!!")
    return tmp_path


def test_client_only_scenario(client_only_project):
    """Client facets only → client_only with skip strategy"""
    result = detect_scenario(str(client_only_project))
    assert result["scenario"] == "client_only"
    assert result["phase2_strategy"] == "skip"


def test_malformed_system_json_returns_unknown(malformed_system_project):
    """Malformed system.json → unknown with pairwise fallback"""
    result = detect_scenario(str(malformed_system_project))
    assert result["scenario"] == "unknown"
    assert result["phase2_strategy"] == "pairwise"


def test_unknown_scenario_uses_pairwise(no_system_project):
    """unknown scenario should default to pairwise (safe fallback)"""
    result = detect_scenario(str(no_system_project))
    assert result["phase2_strategy"] == "pairwise"

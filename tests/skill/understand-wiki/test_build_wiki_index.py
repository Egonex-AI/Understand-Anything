"""Tests for build-wiki-index.py — deterministic wiki index with endpoints."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-wiki"
    / "build-wiki-index.py"
)


def _load_module():
    spec = importlib.util.spec_from_file_location("build_wiki_index", _MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_wiki_index"] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()
build_service_index = mod.build_service_index
build_parent_index = mod.build_parent_index


class TestBuildWikiIndexEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.wiki_dir = os.path.join(self.tmp, "wiki")
        os.makedirs(self.wiki_dir, exist_ok=True)
        os.makedirs(os.path.join(self.wiki_dir, "domains"), exist_ok=True)

        with open(os.path.join(self.wiki_dir, "service.json"), "w") as f:
            json.dump({"name": "order-service", "description": "Order service"}, f)
        with open(os.path.join(self.wiki_dir, "domains", "orders.json"), "w") as f:
            json.dump({
                "name": "Orders",
                "summary": "Order domain",
                "flows": [{
                    "id": "flow:create",
                    "name": "Create Order",
                    "summary": "Creates an order",
                    "steps": [],
                }],
            }, f)

    def test_service_index_includes_endpoint_entry(self) -> None:
        endpoints_dir = os.path.join(self.wiki_dir, "endpoints")
        os.makedirs(endpoints_dir, exist_ok=True)
        with open(os.path.join(endpoints_dir, "order-service.json"), "w") as f:
            json.dump({
                "service": "order-service",
                "description": "RPC/MQ endpoints for order-service",
                "providers": [
                    {"identifier": "OrderService", "protocol": "dubbo"},
                    {"identifier": "OrderApi", "protocol": "moa"},
                ],
                "consumers": [],
            }, f)

        index = build_service_index(self.wiki_dir, "order-service")
        endpoint_entries = [e for e in index["entries"] if e["type"] == "endpoint"]
        self.assertEqual(len(endpoint_entries), 1)

        entry = endpoint_entries[0]
        self.assertEqual(entry["id"], "wiki:endpoints:order-service")
        self.assertEqual(entry["name"], "order-service Endpoints")
        self.assertEqual(entry["type"], "endpoint")
        self.assertEqual(entry["summary"], "RPC/MQ endpoints for order-service")
        self.assertEqual(entry["service"], "order-service")
        self.assertEqual(sorted(entry["tags"]), ["dubbo", "moa"])

    def test_service_index_without_endpoints(self) -> None:
        index = build_service_index(self.wiki_dir, "order-service")
        endpoint_entries = [e for e in index["entries"] if e["type"] == "endpoint"]
        self.assertEqual(endpoint_entries, [])

    def test_parent_index_includes_endpoint_index(self) -> None:
        endpoints_dir = os.path.join(self.wiki_dir, "endpoints")
        os.makedirs(endpoints_dir, exist_ok=True)
        with open(os.path.join(endpoints_dir, "index.json"), "w") as f:
            json.dump({
                "totalProviders": 5,
                "totalConsumers": 3,
                "byService": [],
                "byProtocol": {},
                "byTopic": {},
            }, f)

        index = build_parent_index(self.wiki_dir)
        endpoint_entries = [e for e in index["entries"] if e["type"] == "endpoint"]
        self.assertEqual(len(endpoint_entries), 1)

        entry = endpoint_entries[0]
        self.assertEqual(entry["id"], "wiki:endpoints:index")
        self.assertEqual(entry["name"], "Endpoint Index")
        self.assertEqual(entry["type"], "endpoint")
        self.assertEqual(
            entry["summary"],
            "Cross-service endpoint navigation (5 providers, 3 consumers)",
        )


if __name__ == "__main__":
    unittest.main()

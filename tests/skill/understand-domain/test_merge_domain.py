# tests/skill/understand-domain/test_merge_domain.py
import json
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


class TestMergeDomainResults(unittest.TestCase):
    def test_merge_creates_domain_nodes(self):
        from merge_domain_results import merge_domain_results

        discovery = {
            "domains": [
                {"id": "domain:order", "name": "Order Management", "summary": "Orders", "tags": ["order"],
                 "entities": ["Order"], "businessRules": [], "crossDomainInteractions": [], "modules": ["src/order"]},
            ]
        }
        flows = {
            "domain:order": {
                "domainId": "domain:order",
                "flows": [{
                    "id": "flow:create-order", "name": "Create Order", "summary": "Creates an order",
                    "tags": ["order"], "complexity": "moderate",
                    "domainMeta": {"entryPoint": "POST /orders", "entryType": "http"},
                    "steps": [{
                        "id": "step:create-order:validate", "name": "Validate", "summary": "Validates input",
                        "tags": ["validation"], "complexity": "simple", "filePath": "src/order/OrderService.java",
                        "lineRange": [0, 0],
                    }],
                }],
                "crossDomainEdges": [],
            }
        }

        result = merge_domain_results(discovery, flows, project={
            "name": "test", "languages": ["java"], "frameworks": ["spring"],
            "description": "Test", "analyzedAt": "2026-01-01T00:00:00Z", "gitCommitHash": "abc",
        })

        domain_nodes = [n for n in result["nodes"] if n["type"] == "domain"]
        flow_nodes = [n for n in result["nodes"] if n["type"] == "flow"]
        step_nodes = [n for n in result["nodes"] if n["type"] == "step"]
        self.assertEqual(len(domain_nodes), 1)
        self.assertEqual(len(flow_nodes), 1)
        self.assertEqual(len(step_nodes), 1)

    def test_merge_creates_edges(self):
        from merge_domain_results import merge_domain_results

        discovery = {
            "domains": [
                {"id": "domain:order", "name": "Order", "summary": "Orders", "tags": [],
                 "entities": [], "businessRules": [], "crossDomainInteractions": [], "modules": []},
            ]
        }
        flows = {
            "domain:order": {
                "domainId": "domain:order",
                "flows": [{
                    "id": "flow:create-order", "name": "Create Order", "summary": "Creates",
                    "tags": [], "complexity": "moderate",
                    "domainMeta": {"entryPoint": "POST /orders", "entryType": "http"},
                    "steps": [{
                        "id": "step:create-order:s1", "name": "S1", "summary": "Step 1",
                        "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0],
                    }],
                }],
                "crossDomainEdges": [],
            }
        }

        result = merge_domain_results(discovery, flows, project={
            "name": "t", "languages": [], "frameworks": [],
            "description": "", "analyzedAt": "", "gitCommitHash": "",
        })

        edge_types = {e["type"] for e in result["edges"]}
        self.assertIn("contains_flow", edge_types)
        self.assertIn("flow_step", edge_types)

    def test_flow_step_weights_are_ordered(self):
        from merge_domain_results import merge_domain_results

        discovery = {"domains": [{"id": "domain:a", "name": "A", "summary": "", "tags": [],
                                   "entities": [], "businessRules": [], "crossDomainInteractions": [], "modules": []}]}
        flows = {
            "domain:a": {
                "domainId": "domain:a",
                "flows": [{
                    "id": "flow:f1", "name": "F1", "summary": "", "tags": [], "complexity": "simple",
                    "domainMeta": {"entryPoint": "", "entryType": "manual"},
                    "steps": [
                        {"id": "step:f1:s1", "name": "S1", "summary": "", "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0]},
                        {"id": "step:f1:s2", "name": "S2", "summary": "", "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0]},
                        {"id": "step:f1:s3", "name": "S3", "summary": "", "tags": [], "complexity": "simple", "filePath": "", "lineRange": [0, 0]},
                    ],
                }],
                "crossDomainEdges": [],
            }
        }

        result = merge_domain_results(discovery, flows, project={
            "name": "t", "languages": [], "frameworks": [],
            "description": "", "analyzedAt": "", "gitCommitHash": "",
        })

        step_edges = [e for e in result["edges"] if e["type"] == "flow_step"]
        weights = [e["weight"] for e in step_edges]
        self.assertEqual(weights, sorted(weights))
        self.assertTrue(all(0 < w <= 1.0 for w in weights))


if __name__ == "__main__":
    unittest.main()

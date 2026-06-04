# tests/skill/understand-domain/test_condense_kg.py
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


def _make_kg(nodes, edges, project=None):
    """Build a minimal KG fixture."""
    return {
        "version": "1.0.0",
        "project": project or {
            "name": "test-project",
            "languages": ["java"],
            "frameworks": ["spring-boot"],
            "description": "Test project",
            "analyzedAt": "2026-01-01T00:00:00Z",
            "gitCommitHash": "abc123",
        },
        "nodes": nodes,
        "edges": edges,
        "layers": [{"id": "layer:api", "name": "API Layer", "nodeIds": []}],
        "tour": [],
    }


def _make_node(node_id, node_type, name, summary, tags, file_path=None):
    return {
        "id": node_id,
        "type": node_type,
        "name": name,
        "summary": summary,
        "tags": tags,
        "complexity": "moderate",
        "filePath": file_path or "",
        "lineRange": [0, 0],
    }


class TestCondenseKg(unittest.TestCase):
    def test_module_grouping(self):
        from condense_kg_for_domain import condense_kg

        nodes = [
            _make_node("file:src/order/OrderService.java", "file", "OrderService", "Manages orders", ["order"], "src/order/OrderService.java"),
            _make_node("file:src/order/OrderController.java", "file", "OrderController", "REST API for orders", ["order", "api"], "src/order/OrderController.java"),
            _make_node("file:src/payment/PaymentService.java", "file", "PaymentService", "Handles payments", ["payment"], "src/payment/PaymentService.java"),
        ]
        kg = _make_kg(nodes, [])

        result = condense_kg(kg)

        self.assertIn("modules", result)
        module_paths = [m["path"] for m in result["modules"]]
        self.assertIn("src/order", module_paths)
        self.assertIn("src/payment", module_paths)

        order_mod = next(m for m in result["modules"] if m["path"] == "src/order")
        self.assertEqual(order_mod["nodeCount"], 2)

    def test_endpoint_extraction(self):
        from condense_kg_for_domain import condense_kg

        nodes = [
            _make_node("endpoint:POST /orders", "endpoint", "POST /orders", "Create order", ["order"], "src/order/OrderController.java"),
            _make_node("file:src/order/OrderService.java", "file", "OrderService", "Service logic", ["order"], "src/order/OrderService.java"),
        ]
        kg = _make_kg(nodes, [])

        result = condense_kg(kg)

        self.assertIn("keyNodes", result)
        endpoint_ids = [n["id"] for n in result["keyNodes"]]
        self.assertIn("endpoint:POST /orders", endpoint_ids)

    def test_cross_module_edges(self):
        from condense_kg_for_domain import condense_kg

        nodes = [
            _make_node("file:src/order/OrderService.java", "file", "OrderService", "Orders", ["order"], "src/order/OrderService.java"),
            _make_node("file:src/payment/PaymentService.java", "file", "PaymentService", "Payments", ["payment"], "src/payment/PaymentService.java"),
        ]
        edges = [
            {"source": "file:src/order/OrderService.java", "target": "file:src/payment/PaymentService.java", "type": "calls", "direction": "forward", "weight": 0.8, "description": "OrderService calls PaymentService.charge()"},
        ]
        kg = _make_kg(nodes, edges)

        result = condense_kg(kg)

        self.assertIn("crossModuleEdges", result)
        self.assertEqual(len(result["crossModuleEdges"]), 1)
        self.assertEqual(result["crossModuleEdges"][0]["sourceModule"], "src/order")
        self.assertEqual(result["crossModuleEdges"][0]["targetModule"], "src/payment")

    def test_output_has_project_and_stats(self):
        from condense_kg_for_domain import condense_kg

        kg = _make_kg(
            [_make_node("file:src/a.java", "file", "A", "File A", ["a"], "src/a.java")],
            [],
        )
        result = condense_kg(kg)

        self.assertIn("project", result)
        self.assertEqual(result["project"]["name"], "test-project")
        self.assertIn("stats", result)
        self.assertEqual(result["stats"]["totalNodes"], 1)


if __name__ == "__main__":
    unittest.main()

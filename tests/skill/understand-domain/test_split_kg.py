# tests/skill/understand-domain/test_split_kg.py
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


def _make_node(node_id, file_path):
    return {
        "id": node_id, "type": "file", "name": node_id,
        "summary": f"Summary of {node_id}", "tags": ["test"],
        "complexity": "simple", "filePath": file_path, "lineRange": [0, 0],
    }


def _make_edge(source, target, edge_type="calls"):
    return {"source": source, "target": target, "type": edge_type, "direction": "forward", "weight": 0.8}


class TestSplitKgByDomain(unittest.TestCase):
    def test_split_assigns_nodes_to_domains(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/Order.java", "src/order/Order.java"),
                _make_node("file:src/payment/Pay.java", "src/payment/Pay.java"),
            ],
            "edges": [],
        }
        discovery = {
            "domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
                {"id": "domain:payment", "name": "Payment", "modules": ["src/payment"]},
            ]
        }

        result = split_kg_by_domain(kg, discovery)

        self.assertIn("domain:order", result)
        self.assertIn("domain:payment", result)
        self.assertEqual(len(result["domain:order"]["nodes"]), 1)
        self.assertEqual(result["domain:order"]["nodes"][0]["id"], "file:src/order/Order.java")

    def test_intra_domain_edges_included(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/A.java", "src/order/A.java"),
                _make_node("file:src/order/B.java", "src/order/B.java"),
            ],
            "edges": [_make_edge("file:src/order/A.java", "file:src/order/B.java")],
        }
        discovery = {"domains": [{"id": "domain:order", "modules": ["src/order"], "name": "Order"}]}

        result = split_kg_by_domain(kg, discovery)
        self.assertEqual(len(result["domain:order"]["edges"]), 1)

    def test_cross_domain_edges_included_in_both(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/A.java", "src/order/A.java"),
                _make_node("file:src/payment/B.java", "src/payment/B.java"),
            ],
            "edges": [_make_edge("file:src/order/A.java", "file:src/payment/B.java")],
        }
        discovery = {
            "domains": [
                {"id": "domain:order", "modules": ["src/order"], "name": "Order"},
                {"id": "domain:payment", "modules": ["src/payment"], "name": "Payment"},
            ]
        }

        result = split_kg_by_domain(kg, discovery)
        order_edges = result["domain:order"]["edges"]
        self.assertTrue(any(e["target"] == "file:src/payment/B.java" for e in order_edges))

    def test_unassigned_nodes_skipped(self):
        from split_kg_by_domain import split_kg_by_domain

        kg = {
            "nodes": [
                _make_node("file:src/order/A.java", "src/order/A.java"),
                _make_node("file:src/util/Helper.java", "src/util/Helper.java"),
            ],
            "edges": [],
        }
        discovery = {"domains": [{"id": "domain:order", "modules": ["src/order"], "name": "Order"}]}

        result = split_kg_by_domain(kg, discovery)
        self.assertEqual(len(result["domain:order"]["nodes"]), 1)


if __name__ == "__main__":
    unittest.main()

"""Tests for wiki_quality_gate.py — Quality Gate Layer 1 validation."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "understand-anything-plugin", "skills", "understand-wiki"))

from wiki_quality_gate import run_quality_gate, run_parent_quality_gate


class TestWikiQualityGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.wiki_dir = os.path.join(self.tmp, "wiki")
        self.domains_dir = os.path.join(self.wiki_dir, "domains")
        os.makedirs(self.domains_dir)
        self.service_root = self.tmp

    def _write_json(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)

    def _write_valid_wiki(self):
        self._write_json(os.path.join(self.wiki_dir, "meta.json"), {
            "gitCommitHash": "abc123",
            "generatedAt": "2026-06-03T00:00:00Z",
            "version": "1.0.0",
            "outputLanguage": "zh",
        })
        self._write_json(os.path.join(self.wiki_dir, "index.json"), {
            "entries": [
                {
                    "id": "wiki:svc:order",
                    "name": "Order",
                    "type": "domain",
                    "summary": "Order domain",
                    "service": "order-service",
                }
            ]
        })
        self._write_json(os.path.join(self.wiki_dir, "service.json"), {
            "name": "order-service",
            "description": "Manages order lifecycle and fulfillment",
            "techStack": ["Java", "Spring"],
            "modules": ["controller", "service"],
            "entryPoints": ["OrderController"],
        })
        self._write_json(os.path.join(self.domains_dir, "order-mgmt.json"), {
            "id": "domain:order-mgmt",
            "name": "Order Management",
            "summary": "Handles the complete order lifecycle",
            "entities": ["Order", "OrderItem"],
            "flows": [{
                "id": "flow:create-order",
                "name": "Create Order",
                "summary": "Creates a new order in the system",
                "steps": [{
                    "order": 1,
                    "name": "Validate",
                    "description": "Validates order request parameters and business rules",
                    "sourceRef": {"file": "src/OrderService.java", "lineRange": [10, 20]},
                }]
            }]
        })
        # Create the referenced source file
        os.makedirs(os.path.join(self.service_root, "src"), exist_ok=True)
        with open(os.path.join(self.service_root, "src", "OrderService.java"), "w") as f:
            f.write("// dummy")

    def _write_domain_graph(self, domains=None):
        if domains is None:
            domains = ["order-mgmt"]
        dg_path = os.path.join(self.tmp, "domain-graph.json")
        nodes = [{"id": f"domain:{d}", "type": "domain", "name": d} for d in domains]
        self._write_json(dg_path, {"nodes": nodes, "edges": []})
        return dg_path

    def test_valid_wiki_passes(self):
        self._write_valid_wiki()
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertTrue(result["passed"])
        self.assertEqual(len(result["issues"]), 0)
        self.assertEqual(result["stats"]["coveragePercent"], 100)

    def test_missing_meta_fields(self):
        self._write_valid_wiki()
        self._write_json(os.path.join(self.wiki_dir, "meta.json"), {})
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertFalse(result["passed"])
        meta_issues = [i for i in result["issues"] if "meta.json" in i]
        self.assertGreaterEqual(len(meta_issues), 4)

    def test_empty_index_entries(self):
        self._write_valid_wiki()
        self._write_json(os.path.join(self.wiki_dir, "index.json"), {"entries": []})
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertFalse(result["passed"])
        self.assertTrue(any("entries" in i for i in result["issues"]))

    def test_missing_service_description(self):
        self._write_valid_wiki()
        self._write_json(os.path.join(self.wiki_dir, "service.json"), {
            "name": "svc",
            "description": "short",
        })
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertFalse(result["passed"])
        self.assertTrue(any("too short" in i for i in result["issues"]))

    def test_coverage_gap_detected(self):
        self._write_valid_wiki()
        dg_path = self._write_domain_graph(["order-mgmt", "shipping"])
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertFalse(result["passed"])
        self.assertTrue(any("shipping" in i for i in result["issues"]))
        self.assertEqual(result["stats"]["coveragePercent"], 50)

    def test_domain_page_no_flows(self):
        self._write_valid_wiki()
        self._write_json(os.path.join(self.domains_dir, "order-mgmt.json"), {
            "id": "domain:order-mgmt",
            "name": "Order Management",
            "summary": "Handles the complete order lifecycle",
            "entities": [],
            "flows": [],
        })
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertFalse(result["passed"])
        self.assertTrue(any("no flows" in i for i in result["issues"]))

    def test_source_ref_missing_file_is_warning(self):
        self._write_valid_wiki()
        # Remove the source file
        os.remove(os.path.join(self.service_root, "src", "OrderService.java"))
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        # Should still pass (source ref is warning, not error)
        self.assertTrue(result["passed"])
        self.assertGreater(len(result["warnings"]), 0)
        self.assertTrue(any("OrderService.java" in w for w in result["warnings"]))

    def test_step_with_short_description_is_warning(self):
        self._write_valid_wiki()
        self._write_json(os.path.join(self.domains_dir, "order-mgmt.json"), {
            "id": "domain:order-mgmt",
            "name": "Order Management",
            "summary": "Handles the complete order lifecycle",
            "entities": [],
            "flows": [{
                "id": "flow:create",
                "name": "Create",
                "summary": "Creates order",
                "steps": [{"order": 1, "name": "x", "description": "hi"}]
            }]
        })
        dg_path = self._write_domain_graph()
        result = run_quality_gate(self.wiki_dir, dg_path, self.service_root)
        self.assertTrue(result["passed"])
        self.assertGreater(len(result["warnings"]), 0)

    def test_output_written_to_file(self):
        self._write_valid_wiki()
        dg_path = self._write_domain_graph()
        out_path = os.path.join(self.tmp, "result.json")
        run_quality_gate(self.wiki_dir, dg_path, self.service_root, output_path=out_path)
        self.assertTrue(os.path.exists(out_path))
        with open(out_path) as f:
            data = json.load(f)
        self.assertTrue(data["passed"])


class TestParentArchitectureEventFlows(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.wiki_dir = os.path.join(self.tmp, "wiki")
        os.makedirs(os.path.join(self.wiki_dir, "domains"), exist_ok=True)

    def _write_json(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)

    def _write_valid_parent_wiki(self, arch_overrides=None):
        self._write_json(os.path.join(self.wiki_dir, "meta.json"), {
            "gitCommitHash": "abc", "generatedAt": "t", "version": "1", "outputLanguage": "en",
            "serviceCount": 2,
        })
        self._write_json(os.path.join(self.wiki_dir, "index.json"), {
            "entries": [{"id": "x", "name": "overview", "type": "overview", "summary": "s"}],
        })
        self._write_json(os.path.join(self.wiki_dir, "overview.json"), {
            "name": "System", "description": "A multi-service system",
            "services": [{"name": "svc-a", "description": "Service A", "domains": ["d1"]}],
        })
        arch = {
            "crossServiceCalls": [
                {"caller": {"service": "a"}, "callee": {"service": "b"}, "type": "moa_rpc", "evidence": "script-matched"},
            ],
            "sharedResources": [],
            "eventFlows": [
                {"topic": "order.created", "publisher": "a", "subscribers": ["b"]},
            ],
        }
        if arch_overrides:
            arch.update(arch_overrides)
        self._write_json(os.path.join(self.wiki_dir, "architecture.json"), arch)

    def test_valid_eventflows_passes(self):
        self._write_valid_parent_wiki()
        result = run_parent_quality_gate(self.wiki_dir)
        arch_issues = [i for i in result["issues"] if "eventFlows" in i]
        self.assertEqual(len(arch_issues), 0)

    def test_eventflows_missing_topic_is_error(self):
        self._write_valid_parent_wiki({"eventFlows": [{"publisher": "a", "subscribers": ["b"]}]})
        result = run_parent_quality_gate(self.wiki_dir)
        self.assertTrue(any("missing topic" in i for i in result["issues"]))

    def test_eventflows_missing_publisher_is_error(self):
        self._write_valid_parent_wiki({"eventFlows": [{"topic": "t", "subscribers": ["b"]}]})
        result = run_parent_quality_gate(self.wiki_dir)
        self.assertTrue(any("missing publisher" in i for i in result["issues"]))

    def test_eventflows_missing_subscribers_is_error(self):
        self._write_valid_parent_wiki({"eventFlows": [{"topic": "t", "publisher": "a"}]})
        result = run_parent_quality_gate(self.wiki_dir)
        self.assertTrue(any("subscribers" in i for i in result["issues"]))

    def test_eventflows_with_caller_callee_is_error(self):
        self._write_valid_parent_wiki({"eventFlows": [
            {"caller": {"service": "a"}, "callee": {"service": "b"}, "type": "kafka"},
        ]})
        result = run_parent_quality_gate(self.wiki_dir)
        self.assertTrue(any("caller/callee" in i for i in result["issues"]))

    def test_empty_eventflows_is_ok(self):
        self._write_valid_parent_wiki({"eventFlows": []})
        result = run_parent_quality_gate(self.wiki_dir)
        arch_issues = [i for i in result["issues"] if "eventFlows" in i]
        self.assertEqual(len(arch_issues), 0)


if __name__ == "__main__":
    unittest.main()

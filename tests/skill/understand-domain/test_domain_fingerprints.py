# tests/skill/understand-domain/test_domain_fingerprints.py
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent.parent.parent.parent / "understand-anything-plugin" / "skills" / "understand-domain"
sys.path.insert(0, str(SCRIPT_DIR))


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _make_domain_subset(domain_id: str, nodes_count: int = 2) -> dict:
    return {
        "domain": {"id": domain_id, "name": domain_id.replace("domain:", ""), "summary": f"Summary of {domain_id}"},
        "nodes": [{"id": f"file:src/{i}.java", "type": "file"} for i in range(nodes_count)],
        "edges": [],
        "stats": {"nodes": nodes_count, "edges": 0},
    }


class TestComputeFingerprints(unittest.TestCase):
    """Test fingerprint computation from domain-*.json files."""

    def test_computes_sha256_for_each_domain_file(self):
        from compute_domain_fingerprints import compute_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            data_order = _make_domain_subset("domain:order")
            data_payment = _make_domain_subset("domain:payment")
            _write_json(inter_dir / "domain-order.json", data_order)
            _write_json(inter_dir / "domain-payment.json", data_payment)

            result = compute_fingerprints(inter_dir)

        self.assertIn("order", result)
        self.assertIn("payment", result)
        self.assertEqual(len(result), 2)
        # Fingerprints should be hex sha256 strings
        for fp in result.values():
            self.assertEqual(len(fp), 64)
            int(fp, 16)  # should not raise

    def test_fingerprint_is_deterministic(self):
        from compute_domain_fingerprints import compute_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))

            result1 = compute_fingerprints(inter_dir)
            result2 = compute_fingerprints(inter_dir)

        self.assertEqual(result1, result2)

    def test_fingerprint_changes_when_content_changes(self):
        from compute_domain_fingerprints import compute_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order", 2))
            fp1 = compute_fingerprints(inter_dir)["order"]

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order", 5))
            fp2 = compute_fingerprints(inter_dir)["order"]

        self.assertNotEqual(fp1, fp2)

    def test_ignores_non_domain_files(self):
        from compute_domain_fingerprints import compute_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "flows-order.json", {"flows": []})
            _write_json(inter_dir / "kg-summary.json", {"modules": []})
            _write_json(inter_dir / "domain-discovery.json", {"domains": []})
            _write_json(inter_dir / "domain-discovery-checkpoint.json", {"_checkpoint": {}})

            result = compute_fingerprints(inter_dir)

        self.assertEqual(list(result.keys()), ["order"])

    def test_empty_directory_returns_empty_dict(self):
        from compute_domain_fingerprints import compute_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            result = compute_fingerprints(Path(tmpdir))

        self.assertEqual(result, {})


class TestCompareFingerprints(unittest.TestCase):
    """Test comparison between old and new fingerprint sets."""

    def test_all_unchanged(self):
        from compute_domain_fingerprints import compare_fingerprints

        old = {"order": "aaa", "payment": "bbb"}
        new = {"order": "aaa", "payment": "bbb"}
        result = compare_fingerprints(old, new)

        self.assertEqual(sorted(result["unchanged"]), ["order", "payment"])
        self.assertEqual(result["changed"], [])
        self.assertEqual(result["new"], [])
        self.assertEqual(result["removed"], [])

    def test_detects_changed_domains(self):
        from compute_domain_fingerprints import compare_fingerprints

        old = {"order": "aaa", "payment": "bbb"}
        new = {"order": "aaa", "payment": "ccc"}
        result = compare_fingerprints(old, new)

        self.assertEqual(result["unchanged"], ["order"])
        self.assertEqual(result["changed"], ["payment"])

    def test_detects_new_domains(self):
        from compute_domain_fingerprints import compare_fingerprints

        old = {"order": "aaa"}
        new = {"order": "aaa", "payment": "bbb"}
        result = compare_fingerprints(old, new)

        self.assertEqual(result["unchanged"], ["order"])
        self.assertEqual(result["new"], ["payment"])

    def test_detects_removed_domains(self):
        from compute_domain_fingerprints import compare_fingerprints

        old = {"order": "aaa", "payment": "bbb"}
        new = {"order": "aaa"}
        result = compare_fingerprints(old, new)

        self.assertEqual(result["unchanged"], ["order"])
        self.assertEqual(result["removed"], ["payment"])

    def test_empty_old_all_new(self):
        from compute_domain_fingerprints import compare_fingerprints

        result = compare_fingerprints({}, {"order": "aaa", "payment": "bbb"})

        self.assertEqual(result["unchanged"], [])
        self.assertEqual(result["changed"], [])
        self.assertEqual(sorted(result["new"]), ["order", "payment"])

    def test_empty_new_all_removed(self):
        from compute_domain_fingerprints import compare_fingerprints

        result = compare_fingerprints({"order": "aaa"}, {})

        self.assertEqual(result["removed"], ["order"])
        self.assertEqual(result["unchanged"], [])

    def test_mixed_changes(self):
        from compute_domain_fingerprints import compare_fingerprints

        old = {"order": "aaa", "payment": "bbb", "legacy": "ccc"}
        new = {"order": "aaa", "payment": "xxx", "shipping": "ddd"}
        result = compare_fingerprints(old, new)

        self.assertEqual(result["unchanged"], ["order"])
        self.assertEqual(result["changed"], ["payment"])
        self.assertEqual(result["new"], ["shipping"])
        self.assertEqual(result["removed"], ["legacy"])


class TestLoadSaveFingerprints(unittest.TestCase):
    """Test persistence of fingerprints to/from disk."""

    def test_save_and_load_roundtrip(self):
        from compute_domain_fingerprints import load_fingerprints, save_fingerprints

        fingerprints = {"order": "abc123", "payment": "def456"}

        with tempfile.TemporaryDirectory() as tmpdir:
            fp_path = Path(tmpdir) / "domain-fingerprints.json"
            save_fingerprints(fingerprints, fp_path)

            self.assertTrue(fp_path.exists())
            loaded = load_fingerprints(fp_path)

        self.assertEqual(loaded, fingerprints)

    def test_load_missing_file_returns_empty(self):
        from compute_domain_fingerprints import load_fingerprints

        result = load_fingerprints(Path("/nonexistent/domain-fingerprints.json"))
        self.assertEqual(result, {})

    def test_load_invalid_json_returns_empty(self):
        from compute_domain_fingerprints import load_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            fp_path = Path(tmpdir) / "domain-fingerprints.json"
            fp_path.write_text("not valid json{{{", encoding="utf-8")
            result = load_fingerprints(fp_path)

        self.assertEqual(result, {})

    def test_load_non_dict_json_returns_empty(self):
        from compute_domain_fingerprints import load_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            fp_path = Path(tmpdir) / "domain-fingerprints.json"
            fp_path.write_text('["not", "a", "dict"]', encoding="utf-8")
            result = load_fingerprints(fp_path)

        self.assertEqual(result, {})

    def test_load_dict_with_non_string_values_returns_empty(self):
        from compute_domain_fingerprints import load_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            fp_path = Path(tmpdir) / "domain-fingerprints.json"
            fp_path.write_text('{"order": {"hash": "abc"}}', encoding="utf-8")
            result = load_fingerprints(fp_path)

        self.assertEqual(result, {})


class TestGetDomainsToExtract(unittest.TestCase):
    """Test the high-level function that combines fingerprint + flows file checks."""

    def test_skips_unchanged_domains_with_valid_flows(self):
        from compute_domain_fingerprints import get_domains_to_extract

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            domain_data = _make_domain_subset("domain:order")
            _write_json(inter_dir / "domain-order.json", domain_data)
            _write_json(inter_dir / "flows-order.json", {"flows": [{"id": "flow:1"}]})

            # Save fingerprints matching current content
            from compute_domain_fingerprints import compute_fingerprints, save_fingerprints
            fps = compute_fingerprints(inter_dir)
            save_fingerprints(fps, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertEqual(result["to_extract"], [])
        self.assertEqual(result["skipped"], ["order"])

    def test_extracts_changed_domains(self):
        from compute_domain_fingerprints import get_domains_to_extract, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order", 2))
            _write_json(inter_dir / "flows-order.json", {"flows": [{"id": "flow:1"}]})

            # Save old fingerprints (different from current content)
            save_fingerprints({"order": "old_fingerprint_that_wont_match"}, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertEqual(result["to_extract"], ["order"])
        self.assertEqual(result["skipped"], [])

    def test_extracts_domains_without_flows_file(self):
        from compute_domain_fingerprints import get_domains_to_extract, compute_fingerprints, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))

            # Save matching fingerprints but no flows file
            fps = compute_fingerprints(inter_dir)
            save_fingerprints(fps, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertEqual(result["to_extract"], ["order"])

    def test_extracts_domains_with_empty_flows(self):
        from compute_domain_fingerprints import get_domains_to_extract, compute_fingerprints, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "flows-order.json", {"flows": []})  # empty flows array

            fps = compute_fingerprints(inter_dir)
            save_fingerprints(fps, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertEqual(result["to_extract"], ["order"])

    def test_extracts_domains_with_invalid_flows_json(self):
        from compute_domain_fingerprints import get_domains_to_extract, compute_fingerprints, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            (inter_dir / "flows-order.json").write_text("truncated{{{", encoding="utf-8")

            fps = compute_fingerprints(inter_dir)
            save_fingerprints(fps, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertEqual(result["to_extract"], ["order"])

    def test_full_flag_forces_all_extraction(self):
        from compute_domain_fingerprints import get_domains_to_extract, compute_fingerprints, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "flows-order.json", {"flows": [{"id": "flow:1"}]})

            fps = compute_fingerprints(inter_dir)
            save_fingerprints(fps, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=True)

        self.assertEqual(result["to_extract"], ["order"])
        self.assertEqual(result["skipped"], [])

    def test_new_domains_always_extracted(self):
        from compute_domain_fingerprints import get_domains_to_extract, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-payment.json", _make_domain_subset("domain:payment"))

            # Only order has old fingerprints
            save_fingerprints({"order": "old_fp"}, inter_dir / "domain-fingerprints.json")

            discovery = {"domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
                {"id": "domain:payment", "name": "Payment", "modules": ["src/payment"]},
            ]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertIn("order", result["to_extract"])
        self.assertIn("payment", result["to_extract"])

    def test_skips_doc_only_domains(self):
        from compute_domain_fingerprints import get_domains_to_extract

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-documentation.json", _make_domain_subset("domain:documentation"))

            discovery = {"domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
                {"id": "domain:documentation", "name": "Docs", "modules": ["docs/", "doc/"]},
            ]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertIn("order", result["to_extract"])
        self.assertNotIn("documentation", result["to_extract"])
        self.assertIn("documentation", result["doc_only_skipped"])

    def test_no_previous_fingerprints_extracts_all(self):
        from compute_domain_fingerprints import get_domains_to_extract

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-payment.json", _make_domain_subset("domain:payment"))

            discovery = {"domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
                {"id": "domain:payment", "name": "Payment", "modules": ["src/payment"]},
            ]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

        self.assertEqual(sorted(result["to_extract"]), ["order", "payment"])


class TestMainCLI(unittest.TestCase):
    """Test the CLI entry point."""

    def test_main_writes_fingerprints_and_reports(self):
        from compute_domain_fingerprints import main

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            inter_dir = project_root / ".understand-anything" / "intermediate"
            inter_dir.mkdir(parents=True)

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-payment.json", _make_domain_subset("domain:payment"))
            _write_json(inter_dir / "domain-discovery.json", {"domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
                {"id": "domain:payment", "name": "Payment", "modules": ["src/payment"]},
            ]})

            exit_code = main([str(project_root)])

            self.assertEqual(exit_code, 0)
            fp_path = inter_dir / "domain-fingerprints.json"
            self.assertTrue(fp_path.exists())
            fps = json.loads(fp_path.read_text(encoding="utf-8"))
            self.assertIn("order", fps)
            self.assertIn("payment", fps)

    def test_main_save_only_specified_domains(self):
        from compute_domain_fingerprints import main, compute_fingerprints, load_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            inter_dir = project_root / ".understand-anything" / "intermediate"
            inter_dir.mkdir(parents=True)

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-payment.json", _make_domain_subset("domain:payment"))
            _write_json(inter_dir / "domain-shipping.json", _make_domain_subset("domain:shipping"))

            exit_code = main([str(project_root), "--save", "--domains", "order,payment"])

            self.assertEqual(exit_code, 0)
            fps = load_fingerprints(inter_dir / "domain-fingerprints.json")
            self.assertIn("order", fps)
            self.assertIn("payment", fps)
            self.assertNotIn("shipping", fps)

    def test_main_save_merges_with_existing(self):
        """--save with --domains should preserve fingerprints for domains not in the list."""
        from compute_domain_fingerprints import main, load_fingerprints, save_fingerprints

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            inter_dir = project_root / ".understand-anything" / "intermediate"
            inter_dir.mkdir(parents=True)

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-payment.json", _make_domain_subset("domain:payment"))

            save_fingerprints({"order": "existing_fp"}, inter_dir / "domain-fingerprints.json")

            exit_code = main([str(project_root), "--save", "--domains", "payment"])

            self.assertEqual(exit_code, 0)
            fps = load_fingerprints(inter_dir / "domain-fingerprints.json")
            self.assertEqual(fps["order"], "existing_fp")
            self.assertIn("payment", fps)
            self.assertNotEqual(fps["payment"], "existing_fp")

    def test_failed_extraction_does_not_poison_next_run(self):
        """If extraction fails for a changed domain but old valid flows exist,
        next run should still re-extract that domain."""
        from compute_domain_fingerprints import (
            get_domains_to_extract, compute_fingerprints, save_fingerprints, load_fingerprints
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            inter_dir = Path(tmpdir)

            # Run A: initial extraction succeeds
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order", 2))
            _write_json(inter_dir / "flows-order.json", {"flows": [{"id": "flow:1"}]})
            fps_v1 = compute_fingerprints(inter_dir)
            save_fingerprints(fps_v1, inter_dir / "domain-fingerprints.json")

            # Run B: domain content changes, extraction fails
            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order", 5))
            # flows-order.json still has old valid flows from Run A

            # Simulate selective save: only save fingerprints for skipped domains, NOT failed ones
            fps_v2 = compute_fingerprints(inter_dir)
            # Don't save "order" fingerprint because extraction failed
            # (workflow passes --domains with only successfully extracted + skipped domains)

            # Run C: should still detect order as needing extraction
            discovery = {"domains": [{"id": "domain:order", "name": "Order", "modules": ["src/order"]}]}
            result = get_domains_to_extract(inter_dir, discovery, full=False)

            self.assertIn("order", result["to_extract"])

    def test_main_missing_args(self):
        from compute_domain_fingerprints import main
        exit_code = main([])
        self.assertEqual(exit_code, 1)

    def test_main_check_outputs_json(self):
        from compute_domain_fingerprints import main

        import io
        from contextlib import redirect_stdout

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            inter_dir = project_root / ".understand-anything" / "intermediate"
            inter_dir.mkdir(parents=True)

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "domain-discovery.json", {"domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
            ]})

            buf = io.StringIO()
            with redirect_stdout(buf):
                exit_code = main([str(project_root), "--check"])

            self.assertEqual(exit_code, 0)
            result = json.loads(buf.getvalue())
            self.assertIn("to_extract", result)
            self.assertIn("order", result["to_extract"])

    def test_main_check_full_forces_all(self):
        from compute_domain_fingerprints import main, compute_fingerprints, save_fingerprints

        import io
        from contextlib import redirect_stdout

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            inter_dir = project_root / ".understand-anything" / "intermediate"
            inter_dir.mkdir(parents=True)

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))
            _write_json(inter_dir / "flows-order.json", {"flows": [{"id": "flow:1"}]})
            _write_json(inter_dir / "domain-discovery.json", {"domains": [
                {"id": "domain:order", "name": "Order", "modules": ["src/order"]},
            ]})

            fps = compute_fingerprints(inter_dir)
            save_fingerprints(fps, inter_dir / "domain-fingerprints.json")

            buf = io.StringIO()
            with redirect_stdout(buf):
                exit_code = main([str(project_root), "--check", "--full"])

            self.assertEqual(exit_code, 0)
            result = json.loads(buf.getvalue())
            self.assertIn("order", result["to_extract"])

    def test_main_save_writes_fingerprints(self):
        from compute_domain_fingerprints import main

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            inter_dir = project_root / ".understand-anything" / "intermediate"
            inter_dir.mkdir(parents=True)

            _write_json(inter_dir / "domain-order.json", _make_domain_subset("domain:order"))

            exit_code = main([str(project_root), "--save"])

            self.assertEqual(exit_code, 0)
            fp_path = inter_dir / "domain-fingerprints.json"
            self.assertTrue(fp_path.exists())
            fps = json.loads(fp_path.read_text(encoding="utf-8"))
            self.assertIn("order", fps)


if __name__ == "__main__":
    unittest.main()

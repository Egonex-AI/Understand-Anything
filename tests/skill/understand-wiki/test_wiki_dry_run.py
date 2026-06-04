"""Tests for wiki_dry_run.py — dry-run planning without LLM generation."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "understand-anything-plugin",
        "skills",
        "understand-wiki",
    ),
)

from wiki_dry_run import (  # noqa: E402
    analyze_parent,
    discover_services,
    format_dry_run_report,
    resolve_current_commit,
)


def _make_domain_graph(domain_ids: list[str], commit: str = "abc123") -> dict:
    nodes = [
        {
            "id": did,
            "name": did,
            "type": "domain",
            "tags": [],
            "summary": "",
            "complexity": "simple",
        }
        for did in domain_ids
    ]
    return {
        "version": "1.0",
        "project": {
            "name": "test",
            "languages": [],
            "frameworks": [],
            "description": "",
            "analyzedAt": "",
            "gitCommitHash": commit,
        },
        "nodes": nodes,
        "edges": [],
        "layers": [],
        "tour": [],
    }


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


class TestDiscoverServices(unittest.TestCase):
    def test_skips_non_service_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "order-service").mkdir()
            _write_json(
                root / "order-service" / ".understand-anything" / "domain-graph.json",
                _make_domain_graph(["d1"]),
            )
            services = discover_services(root)
            self.assertEqual(services, ["order-service"])

    def test_empty_directory_returns_no_services(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "README.md").write_text("hi", encoding="utf-8")
            services = discover_services(root)
            self.assertEqual(services, [])


class TestServiceClassification(unittest.TestCase):
    def _setup_service(
        self,
        root: Path,
        name: str,
        *,
        wiki_commit: str | None = None,
        snapshot_domains: list[str] | None = None,
        current_domains: list[str] | None = None,
        current_commit: str = "current001",
    ) -> Path:
        svc = root / name
        ua = svc / ".understand-anything"
        ua.mkdir(parents=True)
        domains = current_domains or ["domain:a", "domain:b"]
        _write_json(ua / "domain-graph.json", _make_domain_graph(domains, current_commit))
        _write_json(ua / "knowledge-graph.json", {"nodes": [], "edges": []})

        if wiki_commit is not None:
            wiki = ua / "wiki"
            wiki.mkdir(parents=True)
            _write_json(
                wiki / "meta.json",
                {
                    "gitCommitHash": wiki_commit,
                    "generatedAt": "2026-06-03T12:00:00Z",
                    "version": "1.0.0",
                    "outputLanguage": "en",
                },
            )
            if snapshot_domains is not None:
                _write_json(
                    wiki / "domain-graph.snapshot.json",
                    _make_domain_graph(snapshot_domains, wiki_commit),
                )
        return svc

    def test_identifies_new_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._setup_service(root, "order-service", wiki_commit=None)
            plans = analyze_parent(root, commit_overrides={"order-service": "current001"})
            plan = plans[0]
            self.assertEqual(plan.name, "order-service")
            self.assertEqual(plan.mode, "FULL")
            self.assertIn("new", plan.reason.lower())

    def test_identifies_stale_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._setup_service(
                root,
                "payment-service",
                wiki_commit="old00001",
                snapshot_domains=["domain:a", "domain:b"],
                current_domains=["domain:a", "domain:b", "domain:c"],
                current_commit="new00001",
            )
            plans = analyze_parent(
                root,
                commit_overrides={"payment-service": "new00001"},
            )
            plan = plans[0]
            self.assertNotEqual(plan.mode, "SKIP")
            self.assertIn("new00001", plan.detail)
            self.assertIn("old00001", plan.detail)

    def test_identifies_up_to_date_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            commit = "samecommit99"
            self._setup_service(
                root,
                "inventory-service",
                wiki_commit=commit,
                snapshot_domains=["domain:a"],
                current_domains=["domain:a"],
                current_commit=commit,
            )
            plans = analyze_parent(
                root,
                commit_overrides={"inventory-service": commit},
            )
            plan = plans[0]
            self.assertEqual(plan.mode, "SKIP")
            self.assertIn("up-to-date", plan.reason.lower())

    def test_identifies_incremental_when_domains_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._setup_service(
                root,
                "order-service",
                wiki_commit="old001",
                snapshot_domains=["domain:a"],
                current_domains=[
                    "domain:a",
                    "domain:b",
                ],
                current_commit="new001",
            )
            plans = analyze_parent(
                root,
                commit_overrides={"order-service": "new001"},
            )
            plan = plans[0]
            self.assertEqual(plan.mode, "INCREMENTAL")
            self.assertGreater(plan.domains_to_generate, 0)


class TestDryRunOutput(unittest.TestCase):
    def test_formats_output_correctly(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ua = root / "order-service" / ".understand-anything"
            ua.mkdir(parents=True)
            _write_json(ua / "domain-graph.json", _make_domain_graph(["d1", "d2", "d3"]))
            _write_json(ua / "knowledge-graph.json", {"nodes": [], "edges": []})

            plans = analyze_parent(root, commit_overrides={"order-service": "c1"})
            report = format_dry_run_report(plans, root)

            self.assertIn("[understand-wiki] Dry run", report)
            self.assertIn("no files will be generated", report.lower())
            self.assertIn("order-service", report)
            self.assertIn("FULL", report)
            self.assertIn("Phase 3", report)
            self.assertIn("Total estimated cost", report)
            self.assertIn("Run without --dry-run", report)

    def test_empty_directory_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plans = analyze_parent(root)
            report = format_dry_run_report(plans, root)
            self.assertIn("[understand-wiki] Dry run", report)
            self.assertIn("Services to process:", report)
            self.assertIn("0 services", report.lower())


class TestDryRunMain(unittest.TestCase):
    def test_main_exits_zero(self):
        from wiki_dry_run import main

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ua = root / "svc" / ".understand-anything"
            ua.mkdir(parents=True)
            _write_json(ua / "domain-graph.json", _make_domain_graph(["d1"]))
            _write_json(ua / "knowledge-graph.json", {"nodes": [], "edges": []})

            old_argv = sys.argv
            old_stdout = sys.stdout
            try:
                sys.argv = ["wiki_dry_run.py", str(root)]
                sys.stdout = StringIO()
                with self.assertRaises(SystemExit) as ctx:
                    main()
                self.assertEqual(ctx.exception.code, 0)
                output = sys.stdout.getvalue()
                self.assertIn("Dry run", output)
            finally:
                sys.argv = old_argv
                sys.stdout = old_stdout


class TestResolveCurrentCommit(unittest.TestCase):
    def test_uses_domain_graph_when_git_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            svc = Path(tmp)
            ua = svc / ".understand-anything"
            ua.mkdir(parents=True)
            _write_json(
                ua / "domain-graph.json",
                _make_domain_graph(["d1"], commit="from-dg-hash"),
            )
            commit = resolve_current_commit(svc)
            self.assertEqual(commit, "from-dg-hash")


if __name__ == "__main__":
    unittest.main()

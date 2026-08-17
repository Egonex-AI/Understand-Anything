#!/usr/bin/env python3
"""
test_graph_query.py — Tests for the optional graph query backend.

Run from the repo root:
    python -m unittest tests.skill.diff.test_graph_query -v

Every test is skipped unless a FalkorDB backend is importable, so this is a
no-op on a checkout without the optional dependency installed. Install it with
`pip install falkordblite` (needs Python >= 3.12), or point UA_FALKORDB_URL at a
running instance.

The graphs here are synthetic and small so the expected traversal results can be
worked out by hand rather than pinned to a snapshot of some real repo.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent.parent
_SCRIPT = (
    _REPO_ROOT
    / "understand-anything-plugin"
    / "skills"
    / "understand-diff"
    / "graph-query.py"
)


def _backend_available() -> bool:
    if os.environ.get("UA_FALKORDB_URL"):
        return True
    try:
        import redislite.falkordb_client  # noqa: F401
    except Exception:
        return False
    return True


# ── Fixtures ──────────────────────────────────────────────────────────────
# A deliberate dependency chain, so blast radius is countable by hand:
#
#   types.ts  <-imports-  a.ts
#             <-imports-  b.ts  <-imports-  c.ts  <-imports-  d.ts
#
# a.ts contains runA, which calls runB in b.ts, which calls runC in c.ts.


def _node(node_id: str, node_type: str, name: str, file_path: str) -> dict:
    return {
        "id": node_id,
        "type": node_type,
        "name": name,
        "filePath": file_path,
        "summary": f"{name} defined in {file_path}",
        "tags": [],
        "complexity": "simple",
    }


def _edge(source: str, target: str, edge_type: str) -> dict:
    return {
        "source": source,
        "target": target,
        "type": edge_type,
        "direction": "forward",
        "weight": 1.0,
    }


def _chain_graph() -> dict:
    files = ["types.ts", "a.ts", "b.ts", "c.ts", "d.ts"]
    nodes = [_node(f"file:src/{f}", "file", f, f"src/{f}") for f in files]
    nodes += [
        _node("function:src/a.ts:runA", "function", "runA", "src/a.ts"),
        _node("function:src/b.ts:runB", "function", "runB", "src/b.ts"),
        _node("function:src/c.ts:runC", "function", "runC", "src/c.ts"),
    ]
    edges = [
        _edge("file:src/a.ts", "file:src/types.ts", "imports"),
        _edge("file:src/b.ts", "file:src/types.ts", "imports"),
        _edge("file:src/c.ts", "file:src/b.ts", "imports"),
        _edge("file:src/d.ts", "file:src/c.ts", "imports"),
        _edge("file:src/a.ts", "function:src/a.ts:runA", "contains"),
        _edge("file:src/b.ts", "function:src/b.ts:runB", "contains"),
        _edge("file:src/c.ts", "function:src/c.ts:runC", "contains"),
        _edge("function:src/a.ts:runA", "function:src/b.ts:runB", "calls"),
        _edge("function:src/b.ts:runB", "function:src/c.ts:runC", "calls"),
    ]
    return {"version": "1.0.0", "project": {"name": "chain"},
            "nodes": nodes, "edges": edges}


def _member_graph(name: str) -> dict:
    return {
        "version": "1.0.0",
        "project": {"name": name},
        "nodes": [
            _node(f"file:src/{name}.ts", "file", f"{name}.ts", f"src/{name}.ts"),
            _node(f"function:src/{name}.ts:go", "function", "go", f"src/{name}.ts"),
        ],
        "edges": [_edge(f"file:src/{name}.ts", f"function:src/{name}.ts:go", "contains")],
    }


# ── Harness ───────────────────────────────────────────────────────────────

@unittest.skipUnless(_backend_available(), "no FalkorDB backend installed")
class GraphQueryTestCase(unittest.TestCase):
    """Shared plumbing: a temp project holding a knowledge graph."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def write_graph(self, graph: dict, root: Path | None = None) -> Path:
        root = root or self.root
        (root / ".ua").mkdir(parents=True, exist_ok=True)
        path = root / ".ua" / "knowledge-graph.json"
        path.write_text(json.dumps(graph, indent=2))
        return path

    def run_cli(self, *args: str, expect_success: bool = True,
                stdin: str | None = None, env: dict | None = None,
                root: Path | None = None) -> subprocess.CompletedProcess:
        environ = dict(os.environ)
        environ.pop("UA_EMBED_URL", None)  # semantic search is tested separately
        environ.update(env or {})
        proc = subprocess.run(
            [sys.executable, str(_SCRIPT), *args, "--root", str(root or self.root)],
            capture_output=True, text=True, input=stdin, env=environ,
        )
        if expect_success:
            self.assertEqual(proc.returncode, 0, f"{args} failed:\n{proc.stderr[-800:]}")
        return proc

    def cli_json(self, *args: str, **kwargs):
        return json.loads(self.run_cli(*args, **kwargs).stdout)


# ── Traversal correctness ─────────────────────────────────────────────────

class TraversalTests(GraphQueryTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.write_graph(_chain_graph())

    def test_blast_radius_follows_the_import_chain(self) -> None:
        """a and b import types directly; c and d reach it in 2 and 3 hops."""
        self.assertEqual(
            self.cli_json("blast-radius", "--name", "types.ts", "--hops", "3"),
            ["file:src/a.ts", "file:src/b.ts", "file:src/c.ts", "file:src/d.ts"],
        )

    def test_blast_radius_respects_the_hop_limit(self) -> None:
        self.assertEqual(
            self.cli_json("blast-radius", "--name", "types.ts", "--hops", "1"),
            ["file:src/a.ts", "file:src/b.ts"],
        )

    def test_nodes_for_file_returns_the_file_and_its_members(self) -> None:
        ids = [n["id"] for n in self.cli_json("nodes-for-file", "--q", "src/a.ts")]
        self.assertEqual(ids, ["file:src/a.ts", "function:src/a.ts:runA"])

    def test_nodes_for_file_matches_a_longer_caller_path(self) -> None:
        """Callers may pass a path prefixed by the repo directory."""
        ids = [n["id"] for n in
               self.cli_json("nodes-for-file", "--q", "some/prefix/src/a.ts")]
        self.assertIn("file:src/a.ts", ids)

    def test_calls_from_and_calls_to_are_inverses(self) -> None:
        self.assertEqual(
            self.cli_json("calls-from", "--name", "runA", "--hops", "2"),
            ["function:src/b.ts:runB", "function:src/c.ts:runC"],
        )
        self.assertEqual(
            self.cli_json("calls-to", "--name", "runC", "--hops", "2"),
            ["function:src/a.ts:runA", "function:src/b.ts:runB"],
        )

    def test_search_matches_name_and_path(self) -> None:
        self.assertTrue(self.cli_json("search", "--q", "runA"))
        self.assertTrue(self.cli_json("search", "--q", "src/d.ts"))

    def test_batch_answers_several_questions_in_order(self) -> None:
        out = self.cli_json("batch", "--q", json.dumps([
            {"op": "blast-radius", "name": "types.ts", "hops": 1},
            {"op": "calls-from", "name": "runA", "hops": 1},
        ]))
        self.assertEqual(out[0], ["file:src/a.ts", "file:src/b.ts"])
        self.assertEqual(out[1], ["function:src/b.ts:runB"])

    def test_batch_accepts_stdin(self) -> None:
        out = self.cli_json(
            "batch", stdin=json.dumps([{"op": "blast-radius", "name": "types.ts",
                                        "hops": 1}]))
        self.assertEqual(out[0], ["file:src/a.ts", "file:src/b.ts"])

    def test_ids_are_not_namespaced_for_a_single_repo(self) -> None:
        """Single-repo ids must stay byte-identical to the JSON's own ids."""
        for node_id in self.cli_json("blast-radius", "--name", "types.ts"):
            self.assertNotIn("::", node_id)


# ── Incremental sync ──────────────────────────────────────────────────────

class SyncTests(GraphQueryTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.graph = _chain_graph()
        self.path = self.write_graph(self.graph)
        self.baseline = self.cli_json("stats")

    def test_first_sync_is_full(self) -> None:
        self.assertEqual(self.baseline["sync"]["mode"], "full")
        self.assertEqual(self.baseline["nodes"], 8)
        self.assertEqual(self.baseline["edges"], 9)

    def test_unchanged_graph_is_not_resynced(self) -> None:
        again = self.cli_json("stats")
        self.assertEqual(again["sync"]["mode"], "cached")
        self.assertEqual(again["sync"]["files"], 0)
        self.assertEqual(again["nodes"], self.baseline["nodes"])
        self.assertEqual(again["edges"], self.baseline["edges"])

    def test_editing_one_file_resyncs_only_that_file(self) -> None:
        for node in self.graph["nodes"]:
            if node["filePath"] == "src/b.ts":
                node["summary"] += " [edited]"
        self.write_graph(self.graph)

        after = self.cli_json("stats")
        self.assertEqual(after["sync"]["mode"], "incremental")
        self.assertEqual(after["sync"]["files"], 1)

    def test_incremental_sync_preserves_incoming_edges(self) -> None:
        """DETACH DELETE drops edges from untouched files; they must come back."""
        for node in self.graph["nodes"]:
            if node["filePath"] == "src/b.ts":
                node["summary"] += " [edited]"
        self.write_graph(self.graph)
        after = self.cli_json("stats")

        self.assertEqual(after["nodes"], self.baseline["nodes"])
        self.assertEqual(after["edges"], self.baseline["edges"])
        # c.ts -> b.ts is an edge owned by an untouched file.
        self.assertIn("file:src/c.ts",
                      self.cli_json("blast-radius", "--name", "b.ts", "--hops", "1"))

    def test_removing_a_file_removes_its_nodes(self) -> None:
        dropped = {n["id"] for n in self.graph["nodes"] if n["filePath"] == "src/d.ts"}
        self.graph["nodes"] = [n for n in self.graph["nodes"]
                               if n["filePath"] != "src/d.ts"]
        self.graph["edges"] = [e for e in self.graph["edges"]
                               if e["source"] not in dropped
                               and e["target"] not in dropped]
        self.write_graph(self.graph)

        after = self.cli_json("stats")
        self.assertEqual(after["nodes"], self.baseline["nodes"] - len(dropped))
        self.assertEqual(self.cli_json("nodes-for-file", "--q", "src/d.ts"), [])

    def test_node_without_a_file_path_still_loads(self) -> None:
        self.graph["nodes"].append({
            "id": "concept:orphan", "type": "concept", "name": "Orphan",
            "summary": "no filePath", "tags": [], "complexity": "simple",
        })
        self.write_graph(self.graph)

        self.assertEqual(self.cli_json("stats")["nodes"], self.baseline["nodes"] + 1)
        self.assertTrue(self.cli_json("search", "--q", "Orphan"))


# ── Workspaces ────────────────────────────────────────────────────────────

class WorkspaceTests(GraphQueryTestCase):
    def setUp(self) -> None:
        super().setUp()
        for name, pkg, deps in (
            ("api", "@acme/api", {"@acme/shared": "^1.0.0"}),
            ("shared", "@acme/shared", {}),
        ):
            member = self.root / name
            member.mkdir()
            (member / "package.json").write_text(json.dumps(
                {"name": pkg, "version": "1.0.0", "dependencies": deps}))
            self.write_graph(_member_graph(name), root=member)

        self.manifest = self.root / "workspace.json"
        self.manifest.write_text(json.dumps({"repos": ["api", "shared"]}))

    def cli_ws(self, *args: str):
        return self.cli_json(*args, "--workspace", str(self.manifest))

    def test_both_members_are_loaded(self) -> None:
        stats = self.cli_ws("stats")
        self.assertEqual(stats["repos"], ["api", "shared"])
        # two real nodes per member, plus one stand-in node per repo
        self.assertEqual(stats["nodes"], 6)

    def test_ids_are_namespaced_per_repo(self) -> None:
        rows = self.cli_ws("cypher", "--q",
                           "MATCH (n:Node) WHERE n.id STARTS WITH 'api::' "
                           "RETURN count(n)")
        self.assertEqual(rows[0][0], 3)

    def test_package_manifests_link_the_repos(self) -> None:
        rows = self.cli_ws("cypher", "--q",
                           "MATCH (a:Node)-[r]->(b:Node) WHERE a.repo <> b.repo "
                           "RETURN a.repo, type(r), b.repo")
        self.assertEqual(rows, [["api", "DEPENDS_ON", "shared"]])

    def test_a_traversal_crosses_the_repo_boundary(self) -> None:
        rows = self.cli_ws("cypher", "--q",
                           "MATCH (a:Node {repo:'api'})-[*1..3]->(x:Node) "
                           "WHERE x.repo = 'shared' RETURN count(x)")
        self.assertGreater(rows[0][0], 0)


# ── Graceful failure ──────────────────────────────────────────────────────

class FailureModeTests(GraphQueryTestCase):
    def test_missing_graph_explains_itself(self) -> None:
        proc = self.run_cli("stats", expect_success=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("/understand", proc.stdout + proc.stderr)

    def test_semantic_search_requires_an_endpoint(self) -> None:
        self.write_graph(_chain_graph())
        proc = self.run_cli("semantic", "--q", "anything", expect_success=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("UA_EMBED_URL", proc.stdout + proc.stderr)

    def test_an_unreachable_embedder_does_not_break_plain_queries(self) -> None:
        """A misconfigured endpoint must warn, not take the whole command down."""
        self.write_graph(_chain_graph())
        proc = self.run_cli("blast-radius", "--name", "types.ts",
                            env={"UA_EMBED_URL": "http://127.0.0.1:9/embed"})
        self.assertIn("warning", proc.stderr.lower())
        self.assertEqual(json.loads(proc.stdout),
                         ["file:src/a.ts", "file:src/b.ts", "file:src/c.ts",
                          "file:src/d.ts"])

    def test_unknown_batch_op_is_rejected(self) -> None:
        self.write_graph(_chain_graph())
        proc = self.run_cli("batch", "--q", json.dumps([{"op": "nope"}]),
                            expect_success=False)
        self.assertNotEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

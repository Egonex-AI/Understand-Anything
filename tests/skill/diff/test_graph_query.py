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
    # A second file with the same basename, imported by e.ts only. Seeding by
    # name picks up both; seeding by path must not.
    nodes.append(_node("file:src/nested/types.ts", "file", "types.ts",
                       "src/nested/types.ts"))
    nodes.append(_node("file:src/e.ts", "file", "e.ts", "src/e.ts"))
    nodes += [
        _node("function:src/a.ts:runA", "function", "runA", "src/a.ts"),
        _node("function:src/b.ts:runB", "function", "runB", "src/b.ts"),
        _node("function:src/c.ts:runC", "function", "runC", "src/c.ts"),
    ]
    edges = [
        _edge("file:src/e.ts", "file:src/nested/types.ts", "imports"),
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
            self.cli_json("blast-radius", "--path", "src/types.ts", "--hops", "3"),
            ["file:src/a.ts", "file:src/b.ts", "file:src/c.ts", "file:src/d.ts"],
        )

    def test_blast_radius_by_path_is_scoped_to_one_file(self) -> None:
        """Basenames are not unique, so a path must not seed from namesakes.

        Two different files are named types.ts here; seeding by name unions both
        and overstates the impact.
        """
        by_path = self.cli_json("blast-radius", "--path", "src/types.ts", "--hops", "3")
        self.assertEqual(by_path, ["file:src/a.ts", "file:src/b.ts",
                                   "file:src/c.ts", "file:src/d.ts"])

        by_name = self.cli_json("blast-radius", "--name", "types.ts", "--hops", "1")
        self.assertIn("file:src/e.ts", by_name)      # only the namesake reaches this
        self.assertNotIn("file:src/e.ts",
                         self.cli_json("blast-radius", "--path", "src/types.ts",
                                       "--hops", "1"))

    def test_blast_radius_needs_a_path_or_a_name(self) -> None:
        proc = self.run_cli("blast-radius", expect_success=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("path", proc.stdout + proc.stderr)

    def test_blast_radius_respects_the_hop_limit(self) -> None:
        self.assertEqual(
            self.cli_json("blast-radius", "--path", "src/types.ts", "--hops", "1"),
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
            {"op": "blast-radius", "path": "src/types.ts", "hops": 1},
            {"op": "calls-from", "name": "runA", "hops": 1},
        ]))
        self.assertEqual(out[0], ["file:src/a.ts", "file:src/b.ts"])
        self.assertEqual(out[1], ["function:src/b.ts:runB"])

    def test_batch_accepts_stdin(self) -> None:
        out = self.cli_json(
            "batch", stdin=json.dumps([{"op": "blast-radius", "path": "src/types.ts",
                                        "hops": 1}]))
        self.assertEqual(out[0], ["file:src/a.ts", "file:src/b.ts"])

    def test_search_honours_an_explicit_limit(self) -> None:
        """A limit passed in a batch spec must reach the query.

        It used to be dropped, so a caller asking for 2 results silently got 25 --
        the opposite of what a context-conscious skill wants.
        """
        out = self.cli_json("batch", "--q", json.dumps([
            {"op": "search", "q": "src", "limit": 2},
            {"op": "search", "q": "src"},
        ]))
        self.assertEqual(len(out[0]), 2)
        self.assertGreater(len(out[1]), 2)

    def test_ids_are_not_namespaced_for_a_single_repo(self) -> None:
        """Single-repo ids must stay byte-identical to the JSON's own ids."""
        for node_id in self.cli_json("blast-radius", "--path", "src/types.ts"):
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
        self.assertEqual(self.baseline["nodes"], 10)
        self.assertEqual(self.baseline["edges"], 10)

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
                      self.cli_json("blast-radius", "--path", "src/b.ts", "--hops", "1"))

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

    def test_adding_only_an_edge_is_synced(self) -> None:
        """A commit that adds an import and changes nothing else must be seen.

        Digests cover each file's incident edges for exactly this reason. When
        they covered only node fields, this was invisible: every digest matched,
        sync reported "cached", and the new edge never reached the graph.
        """
        self.graph["edges"].append(
            _edge("file:src/d.ts", "file:src/types.ts", "imports"))
        self.write_graph(self.graph)

        after = self.cli_json("stats")
        self.assertEqual(after["sync"]["mode"], "incremental")
        self.assertEqual(after["edges"], self.baseline["edges"] + 1)
        # d.ts now depends on types.ts directly rather than only through c.ts
        self.assertIn("file:src/d.ts",
                      self.cli_json("blast-radius", "--path", "src/types.ts",
                                    "--hops", "1"))

    def test_removing_only_an_edge_is_synced(self) -> None:
        self.graph["edges"] = [e for e in self.graph["edges"]
                               if not (e["source"] == "file:src/a.ts"
                                       and e["target"] == "file:src/types.ts")]
        self.write_graph(self.graph)

        after = self.cli_json("stats")
        self.assertEqual(after["edges"], self.baseline["edges"] - 1)
        self.assertNotIn("file:src/a.ts",
                         self.cli_json("blast-radius", "--path", "src/types.ts"))

    def test_changing_an_edge_property_is_synced(self) -> None:
        for edge in self.graph["edges"]:
            if edge["type"] == "imports":
                edge["weight"] = 0.25
                break
        self.write_graph(self.graph)
        self.assertEqual(self.cli_json("stats")["sync"]["mode"], "incremental")

    def test_a_stamp_without_nodes_is_pruned(self) -> None:
        """A stamp whose nodes are gone must not mask the file on the next sync.

        Simulates a sync interrupted after stamping: the stamp says the file is
        present while its nodes are not, which would otherwise be reported as
        'cached' forever.
        """
        self.cli_json("cypher", "--q",
                      "MATCH (n:Node) WHERE n.__key = 'src/b.ts' DELETE n")
        after = self.cli_json("stats")
        self.assertEqual(after["sync"]["mode"], "incremental")
        self.assertEqual(after["nodes"], self.baseline["nodes"])
        self.assertEqual(after["edges"], self.baseline["edges"])

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
    """Repos stay in separate graphs; only their topology is duplicated.

    The chain is web -> api -> shared, so `shared` has one direct dependent and
    one that is only reachable transitively.
    """

    def setUp(self) -> None:
        super().setUp()
        for name, pkg, deps in (
            ("web", "@acme/web", {"@acme/api": "^1.0.0"}),
            ("api", "@acme/api", {"@acme/shared": "^1.0.0"}),
            ("shared", "@acme/shared", {}),
        ):
            member = self.root / name
            member.mkdir()
            (member / "package.json").write_text(json.dumps(
                {"name": pkg, "version": "1.0.0", "dependencies": deps}))
            self.write_graph(_member_graph(name), root=member)

        self.manifest = self.root / "workspace.json"
        self.manifest.write_text(json.dumps({"repos": ["web", "api", "shared"]}))

    def cli_ws(self, *args: str):
        return self.cli_json(*args, "--workspace", str(self.manifest))

    def test_each_repo_keeps_its_own_graph(self) -> None:
        stats = self.cli_ws("stats")
        self.assertEqual(sorted(stats["isolatedGraphs"]), ["api", "shared", "web"])
        for name in ("web", "api", "shared"):
            self.assertEqual(stats["repos"][name]["nodes"], 2)
            self.assertEqual(stats["repos"][name]["edges"], 1)

    def test_ids_are_never_namespaced(self) -> None:
        """A repo's ids must read the same inside a workspace as outside one."""
        per_repo = self.cli_ws("nodes-for-file", "--q", "src/api.ts")
        self.assertEqual([n["id"] for n in per_repo["api"]],
                         ["file:src/api.ts", "function:src/api.ts:go"])

    def test_repos_are_isolated_from_each_other(self) -> None:
        """Asking api for a file that lives in shared must return nothing."""
        per_repo = self.cli_ws("nodes-for-file", "--q", "src/shared.ts")
        self.assertEqual(per_repo["api"], [])
        self.assertTrue(per_repo["shared"])

    def test_index_finds_direct_and_transitive_dependents(self) -> None:
        self.assertEqual(self.cli_ws("affected-repos", "--repo", "shared"),
                         ["api", "web"])
        self.assertEqual(self.cli_ws("affected-repos", "--repo", "api"), ["web"])
        self.assertEqual(self.cli_ws("affected-repos", "--repo", "web"), [])

    def test_index_respects_the_hop_limit(self) -> None:
        """One hop from shared reaches api but not web."""
        self.assertEqual(
            self.cli_ws("affected-repos", "--repo", "shared", "--hops", "1"),
            ["api"])

    def test_cross_repo_blast_radius_reports_both_scopes(self) -> None:
        out = self.cli_ws("blast-radius", "--name", "shared.ts")
        self.assertEqual(out["definedIn"], ["shared"])
        self.assertEqual(out["downstreamRepos"], ["api", "web"])
        self.assertIn("shared", out["sameRepo"])

    def test_index_is_reused_when_manifests_are_unchanged(self) -> None:
        """The index is derived from package.json, so it should not be rebuilt
        on every command — a rebuild also briefly empties it for other readers."""
        first = self.cli_ws("stats")
        second = self.cli_ws("stats")
        self.assertEqual(first["indexEdges"], second["indexEdges"])
        self.assertEqual(self.cli_ws("affected-repos", "--repo", "shared"),
                         ["api", "web"])

    def test_index_is_rebuilt_when_a_dependency_changes(self) -> None:
        self.cli_ws("stats")
        pkg = self.root / "web" / "package.json"
        data = json.loads(pkg.read_text())
        data["dependencies"] = {}          # web no longer depends on api
        pkg.write_text(json.dumps(data))

        self.assertEqual(self.cli_ws("affected-repos", "--repo", "shared"), ["api"])

    def test_workspace_second_run_is_cached(self) -> None:
        first = self.cli_ws("stats")
        second = self.cli_ws("stats")
        for name in ("web", "api", "shared"):
            self.assertEqual(first["repos"][name]["sync"]["mode"], "full")
            self.assertEqual(second["repos"][name]["sync"]["mode"], "cached")


# ── Semantic search ───────────────────────────────────────────────────────

def _embedder_reachable() -> bool:
    url = os.environ.get("UA_EMBED_URL")
    if not url:
        return False
    import urllib.request
    try:
        req = urllib.request.Request(
            url, data=json.dumps({"inputs": ["probe"], "truncate": True}).encode(),
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception:
        return False


@unittest.skipUnless(_embedder_reachable(), "UA_EMBED_URL not set or unreachable")
class SemanticTests(GraphQueryTestCase):
    """Only runs when an embedding endpoint is configured."""

    def setUp(self) -> None:
        super().setUp()
        self.write_graph(_chain_graph())
        self.embed_env = {"UA_EMBED_URL": os.environ["UA_EMBED_URL"]}

    def test_vectors_are_built_during_sync(self) -> None:
        stats = self.cli_json("stats", env=self.embed_env)
        self.assertTrue(stats["semantic"])
        self.assertGreater(stats["embedDimension"], 0)

    def test_semantic_search_returns_ranked_nodes(self) -> None:
        self.cli_json("stats", env=self.embed_env)
        hits = self.cli_json("semantic", "--q", "run a function",
                             "--k", "3", env=self.embed_env)
        self.assertTrue(hits)
        self.assertIn("id", hits[0])

    def test_a_stale_vector_index_is_rebuilt(self) -> None:
        """Switching embedding models must not leave a wrong-dimension index.

        Writing 384-dimension vectors into a 4-dimension index used to succeed
        silently and fail only at query time, with an error naming neither the
        cause nor the fix.
        """
        self.cli_json("stats", env=self.embed_env)

        # Plant the wrong index from processes with no embedder configured, so
        # they do not repair it on the way in.
        self.cli_json("cypher", "--q", "DROP VECTOR INDEX FOR (n:Node) ON (n.emb)")
        self.cli_json("cypher", "--q",
                      "CREATE VECTOR INDEX FOR (n:Node) ON (n.emb) "
                      "OPTIONS {dimension: 4, similarityFunction: 'cosine'}")

        rebuilt = self.cli_json("stats", env=self.embed_env)
        self.assertEqual(rebuilt["sync"]["vectorIndexRebuilt"]["from"], 4)
        self.assertEqual(rebuilt["sync"]["vectorIndexRebuilt"]["to"],
                         rebuilt["embedDimension"])
        # and the query works rather than raising a dimension mismatch
        self.assertTrue(self.cli_json("semantic", "--q", "types", env=self.embed_env))

    def test_an_embedder_configured_later_backfills(self) -> None:
        """Enabling the embedder after a plain sync must still index the graph.

        The vector index used to be created only on a first sync, so this path
        left existing nodes without vectors and raised a raw driver error.
        """
        first = self.cli_json("stats")                      # no embedder
        self.assertFalse(first["semantic"])

        second = self.cli_json("stats", env=self.embed_env)  # embedder appears
        self.assertTrue(second["semantic"])
        self.assertEqual(second["sync"]["mode"], "cached")
        self.assertEqual(second["sync"]["vectorsBackfilled"], first["nodes"])

        # and semantic search now works rather than erroring
        self.assertTrue(self.cli_json("semantic", "--q", "types", env=self.embed_env))


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
        proc = self.run_cli("blast-radius", "--path", "src/types.ts",
                            env={"UA_EMBED_URL": "http://127.0.0.1:9/embed"})
        self.assertIn("warning", proc.stderr.lower())
        self.assertEqual(json.loads(proc.stdout),
                         ["file:src/a.ts", "file:src/b.ts", "file:src/c.ts",
                          "file:src/d.ts"])

    def test_an_unsafe_node_type_is_refused(self) -> None:
        """Types become labels, which cannot be parameterised.

        knowledge-graph.json is committed and shared, so a type that is not a
        plain identifier is rejected rather than interpolated into Cypher.
        """
        graph = _chain_graph()
        graph["nodes"].append({
            "id": "evil", "type": "file) MATCH (n) DETACH DELETE n //",
            "name": "evil", "filePath": "evil.ts", "summary": "",
            "tags": [], "complexity": "simple",
        })
        self.write_graph(graph)

        proc = self.run_cli("stats", expect_success=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("unsafe node type", proc.stdout + proc.stderr)

    def test_an_unsafe_edge_type_is_refused(self) -> None:
        graph = _chain_graph()
        graph["edges"].append(
            _edge("file:src/a.ts", "file:src/b.ts", "imports] () //"))
        self.write_graph(graph)

        proc = self.run_cli("stats", expect_success=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("unsafe edge type", proc.stdout + proc.stderr)

    def test_unknown_batch_op_is_rejected(self) -> None:
        self.write_graph(_chain_graph())
        proc = self.run_cli("batch", "--q", json.dumps([{"op": "nope"}]),
                            expect_success=False)
        self.assertNotEqual(proc.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

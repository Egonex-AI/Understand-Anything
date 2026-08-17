#!/usr/bin/env python3
"""FalkorDB query adapter for Understand-Anything knowledge graphs.

Read-only consumer of `.ua/knowledge-graph.json`. The JSON stays the source of
truth; this mirrors it into a graph so the skills can ask multi-hop questions
with a query instead of a chain of greps.

Backends, picked automatically:
  embedded  FalkorDBLite, in-process, no server, no config (needs Python >= 3.12)
  server    any FalkorDB instance, via UA_FALKORDB_URL (e.g. redis://localhost:6379)

The graph is rebuilt only when the JSON's content hash changes, so repeated
queries pay the load cost once.

CLI
  python graph-query.py search         --q auth
  python graph-query.py nodes-for-file --q src/types.ts
  python graph-query.py neighbors --id "file:src/a.ts"
  python graph-query.py blast-radius --name types.ts --hops 3
  python graph-query.py calls-from --name registerAllParsers
  python graph-query.py calls-to --name validateGraph
  python graph-query.py path --from "file:a.ts" --to "file:b.ts"
  python graph-query.py cypher --q "MATCH (n:File) RETURN count(n)"

Every command prints JSON on stdout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

UA_DIRS = (".ua", ".understand-anything")
GRAPH_FILE = "knowledge-graph.json"
STAMP_KEY = "__ua_source_hash__"

# UA edge types that mean "A depends on B", used by the blast-radius query.
DEPENDENCY_EDGES = ("IMPORTS", "DEPENDS_ON")


def find_graph_json(project_root: Path) -> Path:
    """Locate the graph, honouring the legacy .understand-anything/ directory."""
    for d in UA_DIRS:
        candidate = project_root / d / GRAPH_FILE
        if candidate.exists():
            return candidate
    raise SystemExit(
        f"No {GRAPH_FILE} under {'/ or '.join(UA_DIRS)}/ in {project_root}. "
        "Run /understand first."
    )


def label_for(node_type: str) -> str:
    return "".join(part.capitalize() for part in node_type.split("_"))


class UAGraph:
    """A UA knowledge graph, queryable over FalkorDB."""

    def __init__(self, graph_json: Path, graph_name: str | None = None):
        self.graph_json = graph_json
        self.raw = json.loads(graph_json.read_text())
        self.source_hash = hashlib.sha256(graph_json.read_bytes()).hexdigest()[:16]
        self.name = graph_name or self.raw.get("project", {}).get("name", "ua")
        self.backend, self.graph = self._connect()
        if self._stamp() != self.source_hash:
            self._rebuild()

    # ---- backend selection -------------------------------------------------

    def _connect(self):
        url = os.environ.get("UA_FALKORDB_URL")
        if url:
            from falkordb import FalkorDB
            from urllib.parse import urlparse

            parsed = urlparse(url)
            db = FalkorDB(host=parsed.hostname or "localhost", port=parsed.port or 6379)
            return "server", db.select_graph(self.name)

        try:
            from redislite.falkordb_client import FalkorDB as EmbeddedFalkorDB
        except ImportError:
            raise SystemExit(
                "No backend available. Either `pip install falkordblite` "
                "(embedded, needs Python >= 3.12) or set UA_FALKORDB_URL to a "
                "running FalkorDB instance."
            )

        db_path = self.graph_json.parent / "falkordb.db"
        db = EmbeddedFalkorDB(str(db_path))
        return "embedded", db.select_graph(self.name)

    # ---- build -------------------------------------------------------------

    def _stamp(self) -> str | None:
        """Hash of the JSON this graph was last built from, if any."""
        try:
            res = self.graph.query(
                f"MATCH (s:{STAMP_KEY}) RETURN s.hash LIMIT 1"
            ).result_set
            return res[0][0] if res else None
        except Exception:
            return None  # graph does not exist yet

    def _rebuild(self) -> None:
        try:
            self.graph.delete()
        except Exception:
            pass  # nothing to delete on a first run

        self.graph.query("CREATE INDEX FOR (n:Node) ON (n.id)")

        for n in self.raw.get("nodes", []):
            line_range = n.get("lineRange") or []
            self.graph.query(
                f"CREATE (x:Node:{label_for(n['type'])} {{"
                "id: $id, type: $type, name: $name, filePath: $filePath, "
                "summary: $summary, tags: $tags, complexity: $complexity, "
                "lineStart: $lineStart, lineEnd: $lineEnd})",
                {
                    "id": n["id"],
                    "type": n["type"],
                    "name": n.get("name", ""),
                    "filePath": n.get("filePath", ""),
                    "summary": n.get("summary", ""),
                    "tags": n.get("tags", []),
                    "complexity": n.get("complexity", ""),
                    "lineStart": line_range[0] if len(line_range) == 2 else -1,
                    "lineEnd": line_range[1] if len(line_range) == 2 else -1,
                },
            )

        for e in self.raw.get("edges", []):
            self.graph.query(
                "MATCH (a:Node {id: $src}), (b:Node {id: $dst}) "
                f"CREATE (a)-[:{e['type'].upper()} {{type: $type, "
                "direction: $direction, weight: $weight}]->(b)",
                {
                    "src": e["source"],
                    "dst": e["target"],
                    "type": e["type"],
                    "direction": e.get("direction", "forward"),
                    "weight": e.get("weight", 0.0),
                },
            )

        self.graph.query(
            f"CREATE (:{STAMP_KEY} {{hash: $h}})", {"h": self.source_hash}
        )

    # ---- queries -----------------------------------------------------------

    def _rows(self, cypher: str, params: dict | None = None) -> list:
        return self.graph.query(cypher, params or {}).result_set

    def search(self, term: str, limit: int = 25) -> list[dict]:
        rows = self._rows(
            "MATCH (n:Node) WHERE toLower(n.name) CONTAINS toLower($t) "
            "OR toLower(n.summary) CONTAINS toLower($t) "
            "OR toLower(n.filePath) CONTAINS toLower($t) "
            "RETURN n.id, n.type, n.name, n.filePath, n.summary "
            "ORDER BY n.id LIMIT $lim",
            {"t": term, "lim": limit},
        )
        return [
            dict(zip(("id", "type", "name", "filePath", "summary"), r)) for r in rows
        ]

    def nodes_for_file(self, path: str) -> list[dict]:
        """Every node defined in a file: the file node plus its functions/classes.

        This is what `understand-diff` needs for a changed path. Paths in the graph
        are relative to the project root, so a suffix match keeps it working when the
        caller passes an absolute or repo-prefixed path.
        """
        rows = self._rows(
            "MATCH (n:Node) WHERE n.filePath = $p OR n.filePath ENDS WITH $suffix "
            "RETURN n.id, n.type, n.name, n.filePath ORDER BY n.id",
            {"p": path, "suffix": "/" + path.lstrip("/")},
        )
        return [dict(zip(("id", "type", "name", "filePath"), r)) for r in rows]

    def neighbors(self, node_id: str) -> list[dict]:
        rows = self._rows(
            "MATCH (n:Node {id: $id})-[r]-(m:Node) "
            "RETURN type(r), m.id, m.type, m.name ORDER BY m.id",
            {"id": node_id},
        )
        return [dict(zip(("edge", "id", "type", "name"), r)) for r in rows]

    def blast_radius(self, name: str, hops: int = 3) -> list[str]:
        """Everything that transitively depends on the named node.

        This is what `understand-diff` needs: given a changed file, what else
        could be affected.
        """
        rels = "|".join(DEPENDENCY_EDGES)
        rows = self._rows(
            f"MATCH (t:Node)<-[:{rels}*1..{hops}]-(d:Node) "
            "WHERE t.name = $n RETURN DISTINCT d.id ORDER BY d.id",
            {"n": name},
        )
        return [r[0] for r in rows]

    def calls_from(self, name: str, hops: int = 3) -> list[str]:
        rows = self._rows(
            f"MATCH (s:Node)-[:CALLS*1..{hops}]->(x:Node) "
            "WHERE s.name = $n RETURN DISTINCT x.id ORDER BY x.id",
            {"n": name},
        )
        return [r[0] for r in rows]

    def calls_to(self, name: str, hops: int = 2) -> list[str]:
        rows = self._rows(
            f"MATCH (t:Node)<-[:CALLS*1..{hops}]-(c:Node) "
            "WHERE t.name = $n RETURN DISTINCT c.id ORDER BY c.id",
            {"n": name},
        )
        return [r[0] for r in rows]

    def path(self, src: str, dst: str, max_hops: int = 6) -> list[str]:
        # FalkorDB wants shortestPath in WITH/RETURN and a directed pattern.
        rows = self._rows(
            "MATCH (a:Node {id: $a}), (b:Node {id: $b}) "
            f"RETURN [n IN nodes(shortestPath((a)-[*..{max_hops}]->(b))) | n.id]",
            {"a": src, "b": dst},
        )
        return rows[0][0] if rows and rows[0][0] else []

    def stats(self) -> dict:
        return {
            "project": self.raw.get("project", {}).get("name"),
            "backend": self.backend,
            "graph": self.name,
            "nodes": self._rows("MATCH (n:Node) RETURN count(n)")[0][0],
            "edges": self._rows("MATCH ()-[r]->() RETURN count(r)")[0][0],
            "source": str(self.graph_json),
            "sourceHash": self.source_hash,
        }


def run_one(ua: "UAGraph", spec: dict):
    """Dispatch a single {op, ...} request against an open graph."""
    op = spec.get("op")
    if op == "stats":
        return ua.stats()
    if op == "search":
        return ua.search(spec["q"], spec.get("limit", 25))
    if op == "nodes-for-file":
        return ua.nodes_for_file(spec["path"])
    if op == "neighbors":
        return ua.neighbors(spec["id"])
    if op == "blast-radius":
        return ua.blast_radius(spec["name"], spec.get("hops", 3))
    if op == "calls-from":
        return ua.calls_from(spec["name"], spec.get("hops", 3))
    if op == "calls-to":
        return ua.calls_to(spec["name"], spec.get("hops", 2))
    if op == "path":
        return ua.path(spec["from"], spec["to"], spec.get("hops", 6))
    if op == "cypher":
        return ua._rows(spec["q"])
    raise SystemExit(f"unknown op: {op}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("command", choices=[
        "stats", "search", "neighbors", "blast-radius",
        "calls-from", "calls-to", "path", "cypher", "batch", "nodes-for-file",
    ])
    p.add_argument("--root", default=".", help="project root (default: cwd)")
    p.add_argument("--q", help="search term or raw Cypher")
    p.add_argument("--id", help="node id")
    p.add_argument("--name", help="node name")
    p.add_argument("--hops", type=int, default=3)
    p.add_argument("--from", dest="src")
    p.add_argument("--to", dest="dst")
    args = p.parse_args()

    ua = UAGraph(find_graph_json(Path(args.root).resolve()))

    def need(value, flag):
        if not value:
            sys.exit(f"{args.command} requires {flag}")
        return value

    if args.command == "batch":
        # Many questions, one process. The embedded server's boot and shutdown
        # dominate a single-shot invocation, so a skill answering a multi-part
        # question should send its whole plan at once.
        specs = json.loads(args.q) if args.q else json.load(sys.stdin)
        out = [run_one(ua, s) for s in specs]
    elif args.command == "stats":
        out = ua.stats()
    elif args.command == "search":
        out = ua.search(need(args.q, "--q"))
    elif args.command == "nodes-for-file":
        out = ua.nodes_for_file(need(args.q, "--q"))
    elif args.command == "neighbors":
        out = ua.neighbors(need(args.id, "--id"))
    elif args.command == "blast-radius":
        out = ua.blast_radius(need(args.name, "--name"), args.hops)
    elif args.command == "calls-from":
        out = ua.calls_from(need(args.name, "--name"), args.hops)
    elif args.command == "calls-to":
        out = ua.calls_to(need(args.name, "--name"), args.hops)
    elif args.command == "path":
        out = ua.path(need(args.src, "--from"), need(args.dst, "--to"), args.hops)
    else:
        out = ua._rows(need(args.q, "--q"))

    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()

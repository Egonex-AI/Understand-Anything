#!/usr/bin/env python3
"""FalkorDB query adapter for Understand-Anything knowledge graphs.

Read-only consumer of `.ua/knowledge-graph.json`. The JSON stays the source of
truth; this mirrors it into a graph so the skills can ask multi-hop questions
with a query instead of a chain of greps. Nothing is ever written back.

Backends, picked automatically:
  embedded  FalkorDBLite, in-process, no server, no config (needs Python >= 3.12)
  server    any FalkorDB instance, via UA_FALKORDB_URL (e.g. redis://localhost:6379)

Sync is incremental. A digest is stored per source file, so re-syncing after an
edit replaces only the nodes of files that actually changed rather than
rebuilding the whole graph.

Semantic search is optional. Set UA_EMBED_URL to a text-embedding endpoint that
accepts {"inputs": [...]} and returns a list of vectors (e.g. a local
text-embeddings-inference server) and node vectors are built during sync.
Without it, everything except the `semantic*` commands works unchanged.

Workspaces let several repos share one graph so traversals cross repo
boundaries. Point --workspace at a JSON file: {"repos": ["../api", "../web"]}.

CLI
  python graph-query.py stats
  python graph-query.py search             --q auth
  python graph-query.py nodes-for-file     --q src/types.ts
  python graph-query.py neighbors          --id "file:src/a.ts"
  python graph-query.py blast-radius       --name types.ts --hops 3
  python graph-query.py calls-from         --name registerAllParsers
  python graph-query.py calls-to           --name validateGraph
  python graph-query.py path               --from "file:a.ts" --to "file:b.ts"
  python graph-query.py semantic           --q "how are imports resolved"
  python graph-query.py semantic-traverse  --q "graph persistence" --hops 2
  python graph-query.py cypher             --q "MATCH (n:File) RETURN count(n)"
  python graph-query.py batch              --q '[{"op":"blast-radius","name":"a.ts"}]'

Every command prints JSON on stdout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

UA_DIRS = (".ua", ".understand-anything")
GRAPH_FILE = "knowledge-graph.json"
FILE_STAMP = "__ua_file__"

# UA edge types that mean "A depends on B", used by the blast-radius query.
DEPENDENCY_EDGES = ("IMPORTS", "DEPENDS_ON")

EMBED_BATCH = 8          # the local TEI server rejects much larger payloads
EMBED_TEXT_CHARS = 150   # summaries are long; the head of one is enough to rank on


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


def digest(payload) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# embeddings (optional)
# --------------------------------------------------------------------------- #

class Embedder:
    """Thin client for an {"inputs": [...]} -> [[float]] embedding endpoint."""

    def __init__(self, url: str):
        self.url = url
        self.dimension = len(self.encode(["dimension probe"])[0])

    def encode(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), EMBED_BATCH):
            chunk = texts[i:i + EMBED_BATCH]
            req = urllib.request.Request(
                self.url,
                data=json.dumps({"inputs": chunk, "truncate": True}).encode(),
                headers={"Content-Type": "application/json"},
            )
            out.extend(json.loads(urllib.request.urlopen(req, timeout=120).read()))
        return out

    @staticmethod
    def text_for(node: dict) -> str:
        return " ".join([
            node.get("name", ""),
            (node.get("summary") or "")[:EMBED_TEXT_CHARS],
            " ".join(node.get("tags") or []),
        ]).strip()


# --------------------------------------------------------------------------- #
# graph
# --------------------------------------------------------------------------- #

class UAGraph:
    """One or more UA knowledge graphs, queryable over FalkorDB."""

    def __init__(self, sources: list[tuple[str | None, Path]], graph_name: str | None = None):
        """sources is [(repo_or_None, path_to_knowledge_graph_json)].

        repo is None for the single-repo case, which keeps node ids exactly as
        they appear in the JSON so existing callers are unaffected.
        """
        self.sources = sources
        self.repos = [r for r, _ in sources if r]
        first = json.loads(sources[0][1].read_text())
        self.name = graph_name or (
            "workspace" if self.repos else first.get("project", {}).get("name", "ua")
        )
        self.embedder = self._make_embedder()
        self.backend, self.graph = self._connect(sources[0][1])
        self.synced = self._sync()

    # ---- optional dependencies --------------------------------------------

    @staticmethod
    def _make_embedder() -> Embedder | None:
        url = os.environ.get("UA_EMBED_URL")
        if not url:
            return None
        try:
            return Embedder(url)
        except Exception as exc:  # unreachable endpoint must not break plain queries
            print(f"warning: UA_EMBED_URL unreachable ({exc}); "
                  "semantic commands disabled", file=sys.stderr)
            return None

    def _connect(self, anchor: Path):
        url = os.environ.get("UA_FALKORDB_URL")
        if url:
            from urllib.parse import urlparse
            from falkordb import FalkorDB

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

        db = EmbeddedFalkorDB(str(anchor.parent / "falkordb.db"))
        return "embedded", db.select_graph(self.name)

    # ---- incremental sync --------------------------------------------------

    def _stored_digests(self) -> dict[str, str]:
        try:
            rows = self.graph.query(
                f"MATCH (s:{FILE_STAMP}) RETURN s.key, s.digest"
            ).result_set
            return {k: d for k, d in rows}
        except Exception:
            return {}  # graph does not exist yet

    def _load_sources(self):
        """Flatten every source into id-namespaced nodes and edges."""
        nodes, edges = [], []
        for repo, path in self.sources:
            raw = json.loads(path.read_text())
            prefix = f"{repo}::" if repo else ""
            if repo:
                # A stand-in for the repo itself, so workspace-level dependency
                # edges have something to connect.
                nodes.append({
                    "id": f"{repo}::__repo__", "type": "module", "name": repo,
                    "filePath": "", "summary": f"Repository {repo}",
                    "tags": ["repo"], "complexity": "simple", "repo": repo,
                })
            for n in raw.get("nodes", []):
                n = dict(n)
                n["id"] = prefix + n["id"]
                n["repo"] = repo or ""
                nodes.append(n)
            for e in raw.get("edges", []):
                e = dict(e)
                e["source"] = prefix + e["source"]
                e["target"] = prefix + e["target"]
                edges.append(e)
        edges.extend(self._cross_repo_edges())
        return nodes, edges

    def _cross_repo_edges(self) -> list[dict]:
        """Link repos that declare each other in package.json.

        UA's graph records only resolved intra-repo imports, so file-level
        cross-repo edges would need the scan phase's import map. Package
        manifests give the repo-level dependency reliably, which is enough to
        make a workspace traversal meaningful.
        """
        if len(self.sources) < 2:
            return []

        owner: dict[str, str] = {}   # package name -> repo
        manifests: dict[str, dict] = {}
        for repo, path in self.sources:
            pkg = path.parent.parent / "package.json"
            if not pkg.exists():
                continue
            try:
                data = json.loads(pkg.read_text())
            except json.JSONDecodeError:
                continue
            manifests[repo] = data
            if data.get("name"):
                owner[data["name"]] = repo

        edges = []
        for repo, data in manifests.items():
            declared = {
                **data.get("dependencies", {}),
                **data.get("devDependencies", {}),
                **data.get("peerDependencies", {}),
            }
            for spec in declared:
                target_repo = owner.get(spec)
                if target_repo and target_repo != repo:
                    edges.append({
                        "source": f"{repo}::__repo__",
                        "target": f"{target_repo}::__repo__",
                        "type": "depends_on",
                        "direction": "forward",
                        "weight": 1.0,
                    })
        return edges

    def _sync(self) -> dict:
        """Replace only the files whose content changed since the last sync."""
        nodes, edges = self._load_sources()

        # Group by the file a node belongs to; that is the unit of replacement.
        by_key: dict[str, list[dict]] = {}
        for n in nodes:
            key = f"{n.get('repo','')}::{n.get('filePath') or n['id']}"
            by_key.setdefault(key, []).append(n)

        current = {
            k: digest([
                {kk: n.get(kk) for kk in
                 ("id", "type", "name", "summary", "tags", "complexity")}
                for n in sorted(v, key=lambda x: x["id"])
            ])
            for k, v in by_key.items()
        }

        stored = self._stored_digests()
        changed = {k for k, d in current.items() if stored.get(k) != d}
        removed = set(stored) - set(current)

        if not changed and not removed:
            return {"mode": "cached", "files": 0, "nodes": 0}

        first_run = not stored
        if first_run:
            self.graph.query("CREATE INDEX FOR (n:Node) ON (n.id)")
            if self.embedder:
                self.graph.query(
                    "CREATE VECTOR INDEX FOR (n:Node) ON (n.emb) "
                    "OPTIONS {dimension: $d, similarityFunction: 'cosine'}",
                    {"d": self.embedder.dimension},
                )

        # Drop the nodes of changed/removed files. DETACH also drops edges that
        # arrive from untouched files, so those are re-created below.
        for key in changed | removed:
            self.graph.query(
                f"MATCH (n:Node) WHERE n.__key = $k DETACH DELETE n", {"k": key}
            )
            self.graph.query(
                f"MATCH (s:{FILE_STAMP} {{key: $k}}) DELETE s", {"k": key}
            )

        # Re-insert the changed nodes, with vectors when an embedder is present.
        fresh = [n for k in changed for n in by_key[k]]
        vectors = {}
        if self.embedder and fresh:
            texts = [Embedder.text_for(n) for n in fresh]
            vectors = dict(zip((n["id"] for n in fresh), self.embedder.encode(texts)))

        for key in changed:
            for n in by_key[key]:
                line_range = n.get("lineRange") or []
                params = {
                    "id": n["id"], "type": n["type"], "name": n.get("name", ""),
                    "filePath": n.get("filePath", ""), "summary": n.get("summary", ""),
                    "tags": n.get("tags", []), "complexity": n.get("complexity", ""),
                    "lineStart": line_range[0] if len(line_range) == 2 else -1,
                    "lineEnd": line_range[1] if len(line_range) == 2 else -1,
                    "repo": n.get("repo", ""), "key": key,
                }
                props = ("id: $id, type: $type, name: $name, filePath: $filePath, "
                         "summary: $summary, tags: $tags, complexity: $complexity, "
                         "lineStart: $lineStart, lineEnd: $lineEnd, repo: $repo, "
                         "__key: $key")
                if n["id"] in vectors:
                    params["emb"] = vectors[n["id"]]
                    props += ", emb: vecf32($emb)"
                self.graph.query(
                    f"CREATE (x:Node:{label_for(n['type'])} {{{props}}})", params
                )
            self.graph.query(
                f"CREATE (:{FILE_STAMP} {{key: $k, digest: $d}})",
                {"k": key, "d": current[key]},
            )

        # Any edge touching a rebuilt node has to be re-created.
        touched = {n["id"] for k in changed for n in by_key[k]}
        for e in edges:
            if e["source"] in touched or e["target"] in touched:
                self.graph.query(
                    "MATCH (a:Node {id: $src}), (b:Node {id: $dst}) "
                    f"MERGE (a)-[:{e['type'].upper()} {{type: $type, "
                    "direction: $direction, weight: $weight}]->(b)",
                    {
                        "src": e["source"], "dst": e["target"], "type": e["type"],
                        "direction": e.get("direction", "forward"),
                        "weight": e.get("weight", 0.0),
                    },
                )

        return {
            "mode": "full" if first_run else "incremental",
            "files": len(changed) + len(removed),
            "nodes": len(fresh),
        }

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
        return [dict(zip(("id", "type", "name", "filePath", "summary"), r)) for r in rows]

    def nodes_for_file(self, path: str) -> list[dict]:
        """The file node plus every function and class defined in it.

        Paths are matched from the right in both directions, because the caller's
        path and the graph's may be rooted differently. `git diff` reports paths
        relative to the repository, while graph paths are relative to whatever
        directory `/understand` was pointed at — which is a subdirectory in a
        scoped monorepo run. So the caller's path may be either longer or shorter
        than the stored one.
        """
        clean = path.lstrip("/")
        rows = self._rows(
            "MATCH (n:Node) WHERE n.filePath <> '' AND ("
            "  n.filePath = $p"
            "  OR n.filePath ENDS WITH $suffix"          # caller gave a shorter path
            "  OR $p ENDS WITH ('/' + n.filePath)"       # caller gave a longer path
            ") RETURN n.id, n.type, n.name, n.filePath ORDER BY n.id",
            {"p": clean, "suffix": "/" + clean},
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
        """Everything that transitively depends on the named node."""
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

    def _require_embedder(self) -> Embedder:
        if not self.embedder:
            raise SystemExit(
                "Semantic search needs an embedding endpoint. "
                "Set UA_EMBED_URL (e.g. http://localhost:8080/embed)."
            )
        return self.embedder

    def semantic(self, query: str, k: int = 10) -> list[dict]:
        vec = self._require_embedder().encode([query])[0]
        rows = self._rows(
            "CALL db.idx.vector.queryNodes('Node','emb',$k,vecf32($q)) YIELD node "
            "RETURN node.id, node.type, node.name, node.filePath",
            {"k": k, "q": vec},
        )
        return [dict(zip(("id", "type", "name", "filePath"), r)) for r in rows]

    def semantic_traverse(self, query: str, k: int = 5, hops: int = 2) -> list[str]:
        """Find nodes that mean the query, then traverse out from them.

        The point of putting vectors in the graph rather than beside it: seeding
        and traversal happen in one statement.
        """
        vec = self._require_embedder().encode([query])[0]
        rows = self._rows(
            "CALL db.idx.vector.queryNodes('Node','emb',$k,vecf32($q)) YIELD node AS seed "
            f"MATCH (seed)-[:IMPORTS|CALLS|CONTAINS*1..{hops}]->(reached:Node) "
            "RETURN DISTINCT reached.id ORDER BY reached.id",
            {"k": k, "q": vec},
        )
        return [r[0] for r in rows]

    def stats(self) -> dict:
        return {
            "graph": self.name,
            "backend": self.backend,
            "repos": self.repos or ["<single>"],
            "nodes": self._rows("MATCH (n:Node) RETURN count(n)")[0][0],
            "edges": self._rows("MATCH ()-[r]->() RETURN count(r)")[0][0],
            "sync": self.synced,
            "semantic": bool(self.embedder),
            "embedDimension": self.embedder.dimension if self.embedder else None,
        }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def resolve_sources(root: Path, workspace: str | None) -> list[tuple[str | None, Path]]:
    if not workspace:
        return [(None, find_graph_json(root))]

    manifest_path = Path(workspace).resolve()
    manifest = json.loads(manifest_path.read_text())
    sources = []
    for entry in manifest.get("repos", []):
        repo_root = (manifest_path.parent / entry).resolve()
        sources.append((repo_root.name, find_graph_json(repo_root)))
    if not sources:
        raise SystemExit(f"{manifest_path} lists no repos")
    return sources


def run_one(ua: UAGraph, spec: dict):
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
    if op == "semantic":
        return ua.semantic(spec["q"], spec.get("k", 10))
    if op == "semantic-traverse":
        return ua.semantic_traverse(spec["q"], spec.get("k", 5), spec.get("hops", 2))
    if op == "cypher":
        return ua._rows(spec["q"])
    raise SystemExit(f"unknown op: {op}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("command", choices=[
        "stats", "search", "nodes-for-file", "neighbors", "blast-radius",
        "calls-from", "calls-to", "path", "semantic", "semantic-traverse",
        "cypher", "batch",
    ])
    p.add_argument("--root", default=".", help="project root (default: cwd)")
    p.add_argument("--workspace", help="workspace manifest listing several repos")
    p.add_argument("--q", help="search term, query text, raw Cypher, or batch JSON")
    p.add_argument("--id", help="node id")
    p.add_argument("--name", help="node name")
    p.add_argument("--hops", type=int, default=3)
    p.add_argument("--k", type=int, default=10)
    p.add_argument("--from", dest="src")
    p.add_argument("--to", dest="dst")
    args = p.parse_args()

    sources = resolve_sources(Path(args.root).resolve(), args.workspace)
    ua = UAGraph(sources)

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
    elif args.command == "semantic":
        out = ua.semantic(need(args.q, "--q"), args.k)
    elif args.command == "semantic-traverse":
        out = ua.semantic_traverse(need(args.q, "--q"), args.k, args.hops)
    else:
        out = ua._rows(need(args.q, "--q"))

    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()

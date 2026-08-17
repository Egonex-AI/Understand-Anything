#!/usr/bin/env python3
"""FalkorDB query adapter for Understand-Anything knowledge graphs.

Read-only consumer of `.ua/knowledge-graph.json`. The JSON stays the source of
truth; this mirrors it into a graph so the skills can ask multi-hop questions
with a query instead of a chain of greps. Nothing is ever written back.

Backends, picked automatically:
  embedded  FalkorDBLite, in-process, no server, no config (needs Python >= 3.12)
  server    any FalkorDB instance, via UA_FALKORDB_URL (e.g. redis://localhost:6379)

Sync is incremental. A digest is stored per source file, so re-syncing after an
edit replaces only the nodes of files that actually changed.

Semantic search is optional. Set UA_EMBED_URL to a text-embedding endpoint that
accepts {"inputs": [...]} and returns a list of vectors (e.g. a local
text-embeddings-inference server) and node vectors are built during sync.
Without it, everything except the `semantic*` commands works unchanged.

Workspaces keep one graph per repo rather than merging them. Every repo stays
isolated, with ids exactly as they appear in its own JSON, and a small index
graph holds just the repos and the dependencies between them. A cross-repo
question is answered in two cheap stages: traverse the index to find which repos
are affected, then query only those repos' graphs. Point --workspace at a
manifest: {"repos": ["../api", "../web"]}.

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

  # workspace-only
  python graph-query.py affected-repos     --repo shared --workspace ws.json
  python graph-query.py blast-radius       --name auth.ts --workspace ws.json

Every command prints JSON on stdout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

UA_DIRS = (".ua", ".understand-anything")
GRAPH_FILE = "knowledge-graph.json"
FILE_STAMP = "__ua_file__"
INDEX_GRAPH = "__ua_workspace__"

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


_SAFE_TYPE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def safe_type(raw: str, kind: str) -> str:
    """Validate a type before it is interpolated into Cypher.

    Node and edge types become labels and relationship types, which cannot be
    parameterised. `knowledge-graph.json` is committed to repositories and shared
    between teammates, so it is not automatically trusted input. Anything that is
    not a plain identifier is rejected rather than escaped.
    """
    if not isinstance(raw, str) or not _SAFE_TYPE.match(raw):
        raise SystemExit(f"refusing to build graph: unsafe {kind} type {raw!r}")
    return raw


def label_for(node_type: str) -> str:
    return "".join(part.capitalize() for part in safe_type(node_type, "node").split("_"))


def rel_for(edge_type: str) -> str:
    return safe_type(edge_type, "edge").upper()


def digest(payload) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


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
            req = urllib.request.Request(
                self.url,
                data=json.dumps(
                    {"inputs": texts[i:i + EMBED_BATCH], "truncate": True}
                ).encode(),
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


def make_embedder() -> Embedder | None:
    url = os.environ.get("UA_EMBED_URL")
    if not url:
        return None
    try:
        return Embedder(url)
    except Exception as exc:  # an unreachable endpoint must not break plain queries
        print(f"warning: UA_EMBED_URL unreachable ({exc}); semantic commands disabled",
              file=sys.stderr)
        return None


# --------------------------------------------------------------------------- #
# backend
# --------------------------------------------------------------------------- #

class Backend:
    """One FalkorDB connection handing out graph handles by key.

    A single instance holds many graphs, which is what keeps repos isolated
    without paying for a separate server per repo.
    """

    def __init__(self, anchor_dir: Path):
        url = os.environ.get("UA_FALKORDB_URL")
        if url:
            from urllib.parse import urlparse
            from falkordb import FalkorDB

            parsed = urlparse(url)
            self._db = FalkorDB(host=parsed.hostname or "localhost",
                                port=parsed.port or 6379)
            self.kind = "server"
            return

        try:
            from redislite.falkordb_client import FalkorDB as EmbeddedFalkorDB
        except ImportError:
            raise SystemExit(
                "No backend available. Either `pip install falkordblite` "
                "(embedded, needs Python >= 3.12) or set UA_FALKORDB_URL to a "
                "running FalkorDB instance."
            )

        anchor_dir.mkdir(parents=True, exist_ok=True)
        self._db = EmbeddedFalkorDB(str(anchor_dir / "falkordb.db"))
        self.kind = "embedded"

    def graph(self, key: str):
        return self._db.select_graph(key)


# --------------------------------------------------------------------------- #
# one repo, one graph
# --------------------------------------------------------------------------- #

class RepoGraph:
    """A single UA knowledge graph. Node ids are exactly the JSON's own ids."""

    def __init__(self, backend: Backend, key: str, graph_json: Path,
                 embedder: Embedder | None):
        self.key = key
        self.graph_json = graph_json
        self.embedder = embedder
        self.backend_kind = backend.kind
        self.graph = backend.graph(key)
        self.raw = json.loads(graph_json.read_text())
        self.synced = self._sync()

    # ---- incremental sync --------------------------------------------------

    def _stored_digests(self) -> dict[str, str]:
        try:
            rows = self.graph.query(
                f"MATCH (s:{FILE_STAMP}) RETURN s.key, s.digest"
            ).result_set
            return {k: d for k, d in rows}
        except Exception:
            return {}  # graph does not exist yet

    def _vector_index_dimension(self) -> int | None:
        """Dimension of the existing vector index on :Node(emb), if there is one."""
        try:
            rows = self.graph.query("CALL db.indexes()").result_set
        except Exception:
            return None
        for label, _props, types, options, *_rest in rows:
            if label != "Node" or not isinstance(types, dict):
                continue
            if "VECTOR" in (types.get("emb") or []):
                return (options or {}).get("emb", {}).get("dimension")
        return None

    def _ensure_indexes(self) -> dict:
        """Bring indexes in line with the current configuration.

        Checked on every sync rather than only the first, because the
        configuration can change under a graph that already exists. Two cases
        matter: an embedder added after a plain sync needs an index created, and
        an embedder swapped for a different model needs the index *rebuilt* --
        writing 384-dimension vectors into a 4-dimension index succeeds silently
        and only fails later, at query time, with an error that points nowhere.
        """
        try:
            self.graph.query("CREATE INDEX FOR (n:Node) ON (n.id)")
        except Exception:
            pass  # already indexed

        if not self.embedder:
            return {}

        existing = self._vector_index_dimension()
        wanted = self.embedder.dimension

        if existing == wanted:
            return {}

        if existing is not None:
            # Stale vectors are unusable at the new dimension, so drop them and
            # let the backfill re-embed from scratch.
            self.graph.query("DROP VECTOR INDEX FOR (n:Node) ON (n.emb)")
            self.graph.query("MATCH (n:Node) WHERE n.emb IS NOT NULL SET n.emb = NULL")

        self.graph.query(
            "CREATE VECTOR INDEX FOR (n:Node) ON (n.emb) "
            "OPTIONS {dimension: $d, similarityFunction: 'cosine'}", {"d": wanted})

        if existing is None:
            return {}
        return {"vectorIndexRebuilt": {"from": existing, "to": wanted}}

    def _prune_orphan_stamps(self) -> int:
        """Drop stamps whose files have no nodes left.

        A stamp without nodes would make the next sync believe that file is
        already present and skip it.
        """
        live = {r[0] for r in self.rows("MATCH (n:Node) RETURN DISTINCT n.__key")}
        stamped = {r[0] for r in self.rows(f"MATCH (s:{FILE_STAMP}) RETURN s.key")}
        orphans = sorted(stamped - live)
        if orphans:
            self.graph.query(
                f"UNWIND $keys AS k MATCH (s:{FILE_STAMP} {{key: k}}) DELETE s",
                {"keys": orphans})
        return len(orphans)

    def _backfill_vectors(self, nodes_by_id: dict[str, dict]) -> int:
        """Embed any node that has no vector yet.

        Covers the case where the embedder is configured after a plain sync: the
        nodes are already there and unchanged, so nothing else would revisit them.
        """
        if not self.embedder:
            return 0
        missing = [r[0] for r in self.rows(
            "MATCH (n:Node) WHERE n.emb IS NULL RETURN n.id")]
        pending = [i for i in missing if i in nodes_by_id]
        if not pending:
            return 0
        vectors = self.embedder.encode(
            [Embedder.text_for(nodes_by_id[i]) for i in pending])
        self.graph.query(
            "UNWIND $rows AS r MATCH (n:Node {id: r.id}) SET n.emb = vecf32(r.emb)",
            {"rows": [{"id": i, "emb": v} for i, v in zip(pending, vectors)]})
        return len(pending)

    def _write_nodes(self, rows: list[dict], vectors: dict[str, list[float]]) -> None:
        """Insert nodes in one query per label, rather than one query per node."""
        grouped: dict[str, list[dict]] = defaultdict(list)
        for n in rows:
            grouped[label_for(n["type"])].append(n)

        props = ("id: r.id, type: r.type, name: r.name, filePath: r.filePath, "
                 "summary: r.summary, tags: r.tags, complexity: r.complexity, "
                 "lineStart: r.lineStart, lineEnd: r.lineEnd, __key: r.__key")
        for label, group in grouped.items():
            # Vectors cannot be applied conditionally inside one UNWIND, so the
            # group is split by whether a vector is present.
            plain = [r for r in group if r["id"] not in vectors]
            embedded = [dict(r, emb=vectors[r["id"]]) for r in group if r["id"] in vectors]
            if plain:
                self.graph.query(
                    f"UNWIND $rows AS r CREATE (x:Node:{label} {{{props}}})",
                    {"rows": plain})
            if embedded:
                self.graph.query(
                    f"UNWIND $rows AS r "
                    f"CREATE (x:Node:{label} {{{props}, emb: vecf32(r.emb)}})",
                    {"rows": embedded})

    def _write_edges(self, edges: list[dict]) -> None:
        """Insert edges in one query per relationship type."""
        grouped: dict[str, list[dict]] = defaultdict(list)
        for e in edges:
            grouped[rel_for(e["type"])].append({
                "src": e["source"], "dst": e["target"], "type": e["type"],
                "direction": e.get("direction", "forward"),
                "weight": e.get("weight", 0.0),
            })
        for rel, group in grouped.items():
            self.graph.query(
                "UNWIND $rows AS r MATCH (a:Node {id: r.src}), (b:Node {id: r.dst}) "
                f"CREATE (a)-[:{rel} {{type: r.type, direction: r.direction, "
                "weight: r.weight}]->(b)",
                {"rows": group})

    @staticmethod
    def _row_for(node: dict, key: str) -> dict:
        line_range = node.get("lineRange") or []
        return {
            "id": node["id"], "type": node["type"], "name": node.get("name", ""),
            "filePath": node.get("filePath", ""), "summary": node.get("summary", ""),
            "tags": node.get("tags", []), "complexity": node.get("complexity", ""),
            "lineStart": line_range[0] if len(line_range) == 2 else -1,
            "lineEnd": line_range[1] if len(line_range) == 2 else -1,
            "__key": key,
        }

    def _sync(self) -> dict:
        nodes = self.raw.get("nodes", [])
        edges = self.raw.get("edges", [])

        # The file a node belongs to is the unit of replacement.
        by_key: dict[str, list[dict]] = defaultdict(list)
        key_of: dict[str, str] = {}
        for n in nodes:
            key = n.get("filePath") or n["id"]
            by_key[key].append(n)
            key_of[n["id"]] = key

        # An edge is incident to the files at both of its ends, so adding an
        # import marks both files changed. Without this, an edge-only change --
        # the most common thing a commit does -- would leave every digest intact
        # and never be synced at all.
        edges_by_key: dict[str, list[dict]] = defaultdict(list)
        for e in edges:
            fingerprint = (e["source"], e["target"], e["type"],
                           e.get("direction", "forward"), e.get("weight", 0.0))
            for endpoint in (e["source"], e["target"]):
                key = key_of.get(endpoint)
                if key is not None:
                    edges_by_key[key].append(fingerprint)

        current = {
            k: digest({
                "nodes": [
                    {kk: n.get(kk) for kk in
                     ("id", "type", "name", "summary", "tags", "complexity",
                      "filePath", "lineRange")}
                    for n in sorted(v, key=lambda x: x["id"])
                ],
                "edges": sorted(edges_by_key.get(k, [])),
            })
            for k, v in by_key.items()
        }

        index_state = self._ensure_indexes()

        stored = self._stored_digests()
        if stored:
            self._prune_orphan_stamps()
            stored = self._stored_digests()
        changed = {k for k, d in current.items() if stored.get(k) != d}
        removed = set(stored) - set(current)
        first_run = not stored

        if not changed and not removed:
            backfilled = self._backfill_vectors({n["id"]: n for n in nodes})
            return {"mode": "cached", "files": 0, "nodes": 0, **index_state,
                    **({"vectorsBackfilled": backfilled} if backfilled else {})}

        # Drop the nodes of changed/removed files. DETACH also drops edges
        # arriving from untouched files, so those are re-created below. Stamps go
        # last, after edges: a crash mid-sync must leave the affected files
        # unstamped so the next run repairs them instead of reporting "cached".
        for key in changed | removed:
            self.graph.query(
                "MATCH (n:Node) WHERE n.__key = $k DETACH DELETE n", {"k": key})
            self.graph.query(
                f"MATCH (s:{FILE_STAMP} {{key: $k}}) DELETE s", {"k": key})

        fresh = [n for k in changed for n in by_key[k]]
        vectors: dict[str, list[float]] = {}
        if self.embedder and fresh:
            vectors = dict(zip(
                (n["id"] for n in fresh),
                self.embedder.encode([Embedder.text_for(n) for n in fresh]),
            ))

        self._write_nodes([self._row_for(n, key_of[n["id"]]) for n in fresh], vectors)

        touched = {n["id"] for n in fresh}
        self._write_edges([e for e in edges
                           if e["source"] in touched or e["target"] in touched])

        self.graph.query(
            f"UNWIND $rows AS r CREATE (:{FILE_STAMP} {{key: r.key, digest: r.digest}})",
            {"rows": [{"key": k, "digest": current[k]} for k in changed]})

        backfilled = self._backfill_vectors({n["id"]: n for n in nodes})
        return {
            "mode": "full" if first_run else "incremental",
            "files": len(changed) + len(removed),
            "nodes": len(fresh),
            **index_state,
            **({"vectorsBackfilled": backfilled} if backfilled else {}),
        }

    # ---- queries -----------------------------------------------------------

    def rows(self, cypher: str, params: dict | None = None) -> list:
        return self.graph.query(cypher, params or {}).result_set

    def search(self, term: str, limit: int = 25) -> list[dict]:
        rows = self.rows(
            "MATCH (n:Node) WHERE toLower(n.name) CONTAINS toLower($t) "
            "OR toLower(n.summary) CONTAINS toLower($t) "
            "OR toLower(n.filePath) CONTAINS toLower($t) "
            "RETURN n.id, n.type, n.name, n.filePath, n.summary "
            "ORDER BY n.id LIMIT $lim",
            {"t": term, "lim": limit})
        return [dict(zip(("id", "type", "name", "filePath", "summary"), r)) for r in rows]

    def nodes_for_file(self, path: str) -> list[dict]:
        """The file node plus every function and class defined in it.

        Paths are matched from the right in both directions, because the caller's
        path and the graph's may be rooted differently. `git diff` reports paths
        relative to the repository, while graph paths are relative to whatever
        directory `/understand` was pointed at — a subdirectory in a scoped
        monorepo run. So the caller's path may be longer or shorter than the
        stored one.
        """
        clean = path.lstrip("/")
        rows = self.rows(
            "MATCH (n:Node) WHERE n.filePath <> '' AND ("
            "  n.filePath = $p"
            "  OR n.filePath ENDS WITH $suffix"        # caller gave a shorter path
            "  OR $p ENDS WITH ('/' + n.filePath)"     # caller gave a longer path
            ") RETURN n.id, n.type, n.name, n.filePath ORDER BY n.id",
            {"p": clean, "suffix": "/" + clean})
        return [dict(zip(("id", "type", "name", "filePath"), r)) for r in rows]

    def neighbors(self, node_id: str) -> list[dict]:
        rows = self.rows(
            "MATCH (n:Node {id: $id})-[r]-(m:Node) "
            "RETURN type(r), m.id, m.type, m.name ORDER BY m.id", {"id": node_id})
        return [dict(zip(("edge", "id", "type", "name"), r)) for r in rows]

    def blast_radius(self, name: str, hops: int = 3) -> list[str]:
        """Everything in this repo that transitively depends on the named node."""
        rels = "|".join(DEPENDENCY_EDGES)
        rows = self.rows(
            f"MATCH (t:Node)<-[:{rels}*1..{hops}]-(d:Node) "
            "WHERE t.name = $n RETURN DISTINCT d.id ORDER BY d.id", {"n": name})
        return [r[0] for r in rows]

    def calls_from(self, name: str, hops: int = 3) -> list[str]:
        rows = self.rows(
            f"MATCH (s:Node)-[:CALLS*1..{hops}]->(x:Node) "
            "WHERE s.name = $n RETURN DISTINCT x.id ORDER BY x.id", {"n": name})
        return [r[0] for r in rows]

    def calls_to(self, name: str, hops: int = 2) -> list[str]:
        rows = self.rows(
            f"MATCH (t:Node)<-[:CALLS*1..{hops}]-(c:Node) "
            "WHERE t.name = $n RETURN DISTINCT c.id ORDER BY c.id", {"n": name})
        return [r[0] for r in rows]

    def path(self, src: str, dst: str, max_hops: int = 6) -> list[str]:
        # FalkorDB wants shortestPath in WITH/RETURN and a directed pattern.
        rows = self.rows(
            "MATCH (a:Node {id: $a}), (b:Node {id: $b}) "
            f"RETURN [n IN nodes(shortestPath((a)-[*..{max_hops}]->(b))) | n.id]",
            {"a": src, "b": dst})
        return rows[0][0] if rows and rows[0][0] else []

    def has_name(self, name: str) -> bool:
        return bool(self.rows(
            "MATCH (n:Node) WHERE n.name = $n RETURN 1 LIMIT 1", {"n": name}))

    def _require_embedder(self) -> Embedder:
        if not self.embedder:
            raise SystemExit(
                "Semantic search needs an embedding endpoint. "
                "Set UA_EMBED_URL (e.g. http://localhost:8080/embed).")
        return self.embedder

    def semantic(self, query: str, k: int = 10) -> list[dict]:
        vec = self._require_embedder().encode([query])[0]
        rows = self.rows(
            "CALL db.idx.vector.queryNodes('Node','emb',$k,vecf32($q)) YIELD node "
            "RETURN node.id, node.type, node.name, node.filePath", {"k": k, "q": vec})
        return [dict(zip(("id", "type", "name", "filePath"), r)) for r in rows]

    def semantic_traverse(self, query: str, k: int = 5, hops: int = 2) -> list[str]:
        """Find nodes that mean the query, then traverse out from them.

        The point of putting vectors in the graph rather than beside it: seeding
        and traversal happen in one statement.
        """
        vec = self._require_embedder().encode([query])[0]
        rows = self.rows(
            "CALL db.idx.vector.queryNodes('Node','emb',$k,vecf32($q)) YIELD node AS seed "
            f"MATCH (seed)-[:IMPORTS|CALLS|CONTAINS*1..{hops}]->(reached:Node) "
            "RETURN DISTINCT reached.id ORDER BY reached.id", {"k": k, "q": vec})
        return [r[0] for r in rows]

    def counts(self) -> dict:
        return {
            "nodes": self.rows("MATCH (n:Node) RETURN count(n)")[0][0],
            "edges": self.rows("MATCH ()-[r]->() RETURN count(r)")[0][0],
        }


# --------------------------------------------------------------------------- #
# many repos, one instance
# --------------------------------------------------------------------------- #

class Workspace:
    """Isolated per-repo graphs plus a tiny index of the dependencies between them.

    Nothing is merged. Each repo keeps its own graph and its own ids, so a
    single-repo query is identical whether or not a workspace exists. Only the
    repo-level topology is duplicated into the index graph, which is what makes
    a cross-repo question answerable by traversal rather than by scanning every
    repo.
    """

    def __init__(self, members: list[tuple[str, Path]], backend: Backend,
                 embedder: Embedder | None, index_key: str = INDEX_GRAPH):
        self.backend = backend
        self.repos = {
            name: RepoGraph(backend, name, path, embedder) for name, path in members
        }
        self.index = backend.graph(index_key)
        self.index_edges = self._build_index(members)

    def _build_index(self, members: list[tuple[str, Path]]) -> int:
        """Build the index from package manifests, skipping it when unchanged.

        The index is tiny, so it is rebuilt whole rather than diffed -- but only
        when the manifests it derives from have actually changed, so repeated
        commands do not pay for it and never observe it half-built.

        UA's graph records only resolved intra-repo imports, so file-level
        cross-repo edges would need the scan phase's import map. Package
        manifests give the repo-level dependency reliably.
        """
        owner: dict[str, str] = {}
        declared: dict[str, dict] = {}
        for name, path in members:
            manifest = path.parent.parent / "package.json"
            if not manifest.exists():
                declared[name] = {}
                continue
            try:
                data = json.loads(manifest.read_text())
            except json.JSONDecodeError:
                declared[name] = {}
                continue
            if data.get("name"):
                owner[data["name"]] = name
            declared[name] = {
                **data.get("dependencies", {}),
                **data.get("devDependencies", {}),
                **data.get("peerDependencies", {}),
            }

        # Rebuild only when the manifests differ from what the index was built from.
        stamp = digest({"repos": sorted(self.repos), "owner": owner,
                        "declared": {k: sorted(v) for k, v in declared.items()}})
        try:
            rows = self.index.query(
                f"MATCH (s:{FILE_STAMP}) RETURN s.digest LIMIT 1").result_set
            if rows and rows[0][0] == stamp:
                edges = self.index.query(
                    "MATCH ()-[r:DEPENDS_ON]->() RETURN count(r)").result_set
                return edges[0][0] if edges else 0
        except Exception:
            pass  # index graph does not exist yet

        try:
            self.index.delete()
        except Exception:
            pass

        for name in self.repos:
            self.index.query("CREATE (:Repo {name: $n})", {"n": name})

        created = 0
        for name, deps in declared.items():
            for spec in deps:
                target = owner.get(spec)
                if target and target != name:
                    self.index.query(
                        "MATCH (a:Repo {name: $a}), (b:Repo {name: $b}) "
                        "MERGE (a)-[:DEPENDS_ON {via: $via}]->(b)",
                        {"a": name, "b": target, "via": spec})
                    created += 1

        self.index.query(f"CREATE (:{FILE_STAMP} {{digest: $d}})", {"d": stamp})
        return created

    # ---- cross-repo ---------------------------------------------------------

    def affected_repos(self, repo: str, hops: int = 5) -> list[str]:
        """Repos that transitively depend on `repo` — one query on a tiny graph."""
        rows = self.index.query(
            f"MATCH (t:Repo {{name: $n}})<-[:DEPENDS_ON*1..{hops}]-(d:Repo) "
            "RETURN DISTINCT d.name ORDER BY d.name", {"n": repo}).result_set
        return [r[0] for r in rows]

    def repos_defining(self, name: str) -> list[str]:
        return [r for r, g in self.repos.items() if g.has_name(name)]

    def blast_radius(self, name: str, hops: int = 3) -> dict:
        """Two stages: local impact where the node lives, then dependent repos.

        Downstream repos are reported at repo granularity because there are no
        file-level cross-repo edges to follow — see _build_index.
        """
        origins = self.repos_defining(name)
        local = {r: self.repos[r].blast_radius(name, hops) for r in origins}
        downstream = sorted({
            d for r in origins for d in self.affected_repos(r) if d not in origins
        })
        return {
            "definedIn": origins,
            "sameRepo": local,
            "downstreamRepos": downstream,
            "note": "downstream is repo-level; file-level cross-repo edges need "
                    "the scan phase's import map",
        }

    def fan_out(self, method: str, *args) -> dict:
        """Run a per-repo query against every member, keyed by repo."""
        return {r: getattr(g, method)(*args) for r, g in self.repos.items()}

    def stats(self) -> dict:
        return {
            "mode": "workspace",
            "backend": self.backend.kind,
            "repos": {
                r: {**g.counts(), "sync": g.synced} for r, g in self.repos.items()
            },
            "isolatedGraphs": list(self.repos),
            "indexEdges": self.index_edges,
        }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

PER_REPO_OPS = {
    "search": ("search", ("q", "limit")),
    "nodes-for-file": ("nodes_for_file", ("path",)),
    "neighbors": ("neighbors", ("id",)),
    "blast-radius": ("blast_radius", ("name", "hops")),
    "calls-from": ("calls_from", ("name", "hops")),
    "calls-to": ("calls_to", ("name", "hops")),
    "path": ("path", ("from", "to", "hops")),
    "semantic": ("semantic", ("q", "k")),
    "semantic-traverse": ("semantic_traverse", ("q", "k", "hops")),
}
DEFAULTS = {"hops": 3, "k": 10, "limit": 25}


def run_one(target, spec: dict):
    """Dispatch a single {op, ...} request. `target` is a RepoGraph or Workspace."""
    op = spec.get("op")
    if op == "stats":
        return target.stats() if isinstance(target, Workspace) else single_stats(target)
    if op == "cypher":
        if isinstance(target, Workspace):
            return {r: g.rows(spec["q"]) for r, g in target.repos.items()}
        return target.rows(spec["q"])
    if op == "affected-repos":
        if not isinstance(target, Workspace):
            raise SystemExit("affected-repos needs --workspace")
        return target.affected_repos(spec["repo"], spec.get("hops", 5))

    if op not in PER_REPO_OPS:
        raise SystemExit(f"unknown op: {op}")
    method, params = PER_REPO_OPS[op]
    args = [spec.get(p, DEFAULTS.get(p)) for p in params]
    if any(a is None for a in args):
        missing = [p for p, a in zip(params, args) if a is None]
        raise SystemExit(f"{op} requires: {', '.join(missing)}")

    if isinstance(target, Workspace):
        # blast-radius has real cross-repo meaning; the rest simply fan out.
        if op == "blast-radius":
            return target.blast_radius(*args)
        return target.fan_out(method, *args)
    return getattr(target, method)(*args)


def single_stats(repo: RepoGraph) -> dict:
    return {
        "graph": repo.key,
        "backend": repo.backend_kind,
        "repos": ["<single>"],
        **repo.counts(),
        "sync": repo.synced,
        "semantic": bool(repo.embedder),
        "embedDimension": repo.embedder.dimension if repo.embedder else None,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("command", choices=[
        "stats", "search", "nodes-for-file", "neighbors", "blast-radius",
        "calls-from", "calls-to", "path", "semantic", "semantic-traverse",
        "affected-repos", "cypher", "batch",
    ])
    p.add_argument("--root", default=".", help="project root (default: cwd)")
    p.add_argument("--workspace", help="manifest listing several repos")
    p.add_argument("--q", help="search term, query text, raw Cypher, or batch JSON")
    p.add_argument("--id", help="node id")
    p.add_argument("--name", help="node name")
    p.add_argument("--repo", help="repo name (affected-repos)")
    p.add_argument("--hops", type=int, default=3)
    p.add_argument("--limit", type=int, default=25)
    p.add_argument("--k", type=int, default=10)
    p.add_argument("--from", dest="src")
    p.add_argument("--to", dest="dst")
    args = p.parse_args()

    embedder = make_embedder()

    if args.workspace:
        manifest_path = Path(args.workspace).resolve()
        manifest = json.loads(manifest_path.read_text())
        members = []
        for entry in manifest.get("repos", []):
            repo_root = (manifest_path.parent / entry).resolve()
            members.append((repo_root.name, find_graph_json(repo_root)))
        if not members:
            raise SystemExit(f"{manifest_path} lists no repos")
        # One embedded instance beside the manifest holds every repo's graph.
        backend = Backend(manifest_path.parent / ".ua")
        target = Workspace(members, backend, embedder)
    else:
        graph_json = find_graph_json(Path(args.root).resolve())
        backend = Backend(graph_json.parent)
        key = json.loads(graph_json.read_text()).get("project", {}).get("name", "ua")
        target = RepoGraph(backend, key, graph_json, embedder)

    spec_from_flags = {
        "q": args.q, "id": args.id, "name": args.name, "path": args.q,
        "repo": args.repo, "hops": args.hops, "k": args.k, "limit": args.limit,
        "from": args.src, "to": args.dst,
    }

    if args.command == "batch":
        # Many questions, one process. The embedded server's boot and shutdown
        # dominate a single-shot invocation, so a skill answering a multi-part
        # question should send its whole plan at once.
        specs = json.loads(args.q) if args.q else json.load(sys.stdin)
        out = [run_one(target, s) for s in specs]
    else:
        out = run_one(target, {"op": args.command, **spec_from_flags})

    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()

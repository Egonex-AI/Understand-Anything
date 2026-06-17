#!/usr/bin/env python3
"""Build frontend-graph.json from knowledge-graph.json, domain-graph.json, and source scanning.

Reads:
    <service-root>/.understand-anything/knowledge-graph.json
    <service-root>/.understand-anything/domain-graph.json

Writes:
    <service-root>/.understand-anything/frontend-graph.json

Usage:
    python3 build-frontend-graph.py <service-root>
"""
import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

VERSION = "1.0.0"

_PAGE_GLOBS = [
    "pages/**/*.tsx", "pages/**/*.jsx", "pages/**/*.vue", "pages/**/*.svelte",
    "src/pages/**/*.tsx", "src/pages/**/*.jsx", "src/pages/**/*.vue",
    "src/views/**/*.vue", "src/views/**/*.tsx",
    "app/**/page.tsx", "app/**/page.jsx", "app/**/page.js",
    "src/app/**/page.tsx", "src/app/**/page.jsx",
]

_COMPONENT_GLOBS = [
    "components/**/*.tsx", "components/**/*.vue", "components/**/*.svelte",
    "src/components/**/*.tsx", "src/components/**/*.vue",
    "features/**/*.tsx", "src/features/**/*.tsx",
]

_STORE_GLOBS = [
    "stores/**/*.ts", "src/stores/**/*.ts",
    "store/**/*.ts", "src/store/**/*.ts",
    "**/*Store.ts", "**/*store.ts", "**/*Slice.ts", "**/*slice.ts",
]

_SKIP_DIRS = frozenset(("node_modules", "dist", "build", ".git", ".understand-anything",
                        "__pycache__", ".next", ".nuxt", ".svelte-kit"))

_API_CALL_RE = re.compile(
    r"""(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*['"`]([^'"`\s]+)['"`]""",
    re.MULTILINE,
)


def _skip(path: Path) -> bool:
    return any(part in _SKIP_DIRS or part.startswith(".") for part in path.parts)


def _glob(root: Path, pattern: str) -> list[str]:
    return sorted(
        str(p.relative_to(root))
        for p in root.glob(pattern)
        if not _skip(p.relative_to(root))
    )


def _extract_pages(root: Path, kg: dict) -> list[str]:
    pages = [
        n["filePath"]
        for n in kg.get("nodes", [])
        if n.get("type") == "file" and any(t in n.get("tags", []) for t in ("page", "view", "screen"))
    ]
    if not pages:
        for pattern in _PAGE_GLOBS:
            pages.extend(_glob(root, pattern))
    return sorted(set(pages))


def _extract_components(root: Path, kg: dict) -> list[str]:
    components = [
        n["filePath"]
        for n in kg.get("nodes", [])
        if n.get("type") == "file" and "component" in n.get("tags", [])
    ]
    if not components:
        for pattern in _COMPONENT_GLOBS:
            components.extend(_glob(root, pattern))
    return sorted(set(components))


def _extract_state_stores(root: Path, kg: dict) -> list[str]:
    stores = [
        n["filePath"]
        for n in kg.get("nodes", [])
        if n.get("type") == "file" and any(t in n.get("tags", []) for t in ("store", "state", "slice"))
    ]
    if not stores:
        for pattern in _STORE_GLOBS:
            stores.extend(_glob(root, pattern))
    return sorted(set(stores))


def _fp_to_route(fp: str, strip_prefixes: list[str]) -> str | None:
    """Convert a file path to a URL route by stripping known prefixes and index/page stems."""
    parts = Path(fp).parts
    for prefix in strip_prefixes:
        prefix_parts = tuple(prefix.rstrip("/").split("/"))
        if parts[: len(prefix_parts)] == prefix_parts:
            parts = parts[len(prefix_parts) :]
            break
    if parts:
        stem = Path(parts[-1]).stem
        if stem in ("+layout", "layout", "_app", "_document"):
            return None  # layout wrappers are not navigable routes
        elif stem in ("index", "page", "+page"):
            parts = parts[:-1]
        elif stem.startswith("[") and stem.endswith("]"):
            parts = (*parts[:-1], ":" + stem[1:-1])
        else:
            parts = (*parts[:-1], stem)
    return "/" + "/".join(parts) if parts else "/"


def _extract_routes(root: Path, kg: dict) -> list[str]:
    routes: set[str] = set()
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    # From KG: edges of type 'routes' pointing to endpoint nodes
    for edge in kg.get("edges", []):
        if edge.get("type") == "routes":
            target = nodes_by_id.get(edge.get("target", ""), {})
            path = target.get("path", "") or target.get("name", "")
            if path and path.startswith("/"):
                routes.add(path)

    # From KG: standalone endpoint nodes that look like routes
    for node in kg.get("nodes", []):
        if node.get("type") == "endpoint":
            path = node.get("path", "") or node.get("name", "")
            if path and path.startswith("/") and "." not in Path(path).name:
                routes.add(path)

    # File-based: Next.js pages/ and app/
    for pattern in (
        "pages/**/*.tsx", "pages/**/*.jsx", "pages/**/*.js",
        "src/pages/**/*.tsx", "src/pages/**/*.jsx",
    ):
        for fp in _glob(root, pattern):
            route = _fp_to_route(fp, ["src/pages", "pages"])
            if route:
                routes.add(route)
    for pattern in ("app/**/page.tsx", "app/**/page.jsx", "src/app/**/page.tsx"):
        for fp in _glob(root, pattern):
            route = _fp_to_route(fp, ["src/app", "app"])
            if route:
                routes.add(route)

    # File-based: Nuxt pages/
    for pattern in ("pages/**/*.vue", "src/pages/**/*.vue"):
        for fp in _glob(root, pattern):
            route = _fp_to_route(fp, ["src/pages", "pages"])
            if route:
                routes.add(route)

    # File-based: SvelteKit src/routes/
    for pattern in ("src/routes/**/*.svelte", "src/routes/**/+page.svelte"):
        for fp in _glob(root, pattern):
            route = _fp_to_route(fp, ["src/routes", "routes"])
            if route:
                routes.add(route)

    return sorted(routes)


def _extract_api_calls(root: Path, kg: dict) -> list[dict]:
    calls: list[dict] = []
    seen: set[str] = set()
    nodes_by_id = {n["id"]: n for n in kg.get("nodes", [])}

    for edge in kg.get("edges", []):
        if edge.get("type") not in ("consumes_api", "calls"):
            continue
        target = nodes_by_id.get(edge.get("target", ""), {})
        if target.get("type") != "endpoint":
            continue
        method = target.get("method", "UNKNOWN")
        path = target.get("path", "") or target.get("name", "")
        if not path:
            continue
        key = f"{method}:{path}"
        if key in seen:
            continue
        seen.add(key)
        src_node = nodes_by_id.get(edge.get("source", ""), {})
        calls.append({
            "method": method,
            "path": path,
            "source": src_node.get("filePath", ""),
        })

    if not calls:
        found_enough = False
        for suffix in (".ts", ".tsx", ".js", ".jsx"):
            if found_enough:
                break
            for fp in root.rglob(f"*{suffix}"):
                if _skip(fp.relative_to(root)):
                    continue
                try:
                    text = fp.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                for m in _API_CALL_RE.finditer(text):
                    path = m.group(1)
                    if "/api/" in path or path.startswith("/api"):
                        key = f"UNKNOWN:{path}"
                        if key not in seen:
                            seen.add(key)
                            calls.append({
                                "method": "UNKNOWN",
                                "path": path,
                                "source": str(fp.relative_to(root)),
                            })
                if len(calls) >= 200:
                    found_enough = True
                    break

    return calls[:200]


def _slug_in(name: str, text: str) -> bool:
    """Return True if the domain name matches the given text.

    Matches either the full hyphenated slug (e.g. "order-management") or any
    significant individual word (length >= 4) from the name (e.g. "order",
    "management"), so that "Order Management" matches paths like "orders/".
    """
    lower_text = text.lower()
    slug = name.lower().replace(" ", "-").replace("_", "-")
    if slug in lower_text:
        return True
    # Also match on individual significant words (singularised via simple stem)
    words = re.split(r"[\s_\-]+", name.lower())
    for word in words:
        if len(word) < 4:
            continue
        # Try the word itself and a simple singular (strip trailing 's')
        candidates = {word}
        if word.endswith("s"):
            candidates.add(word[:-1])
        for candidate in candidates:
            if candidate in lower_text:
                return True
    return False


def _build_features(dg: dict, routes: list[str], pages: list[str],
                    components: list[str], stores: list[str],
                    api_calls: list[dict]) -> list[dict]:
    features = []
    for node in dg.get("nodes", []):
        if node.get("type") != "domain":
            continue
        domain_id = node["id"]
        name = node.get("name", "")
        if not name:
            continue
        feat_routes = [r for r in routes if _slug_in(name, r)]
        feat_pages = [p for p in pages if _slug_in(name, p)]
        feat_components = [c for c in components if _slug_in(name, c)]
        feat_stores = [s for s in stores if _slug_in(name, s)]
        feat_calls = [
            {"method": a["method"], "path": a["path"],
             "source": a["source"], "lineRange": []}
            for a in api_calls
            if _slug_in(name, a["path"])
        ]
        features.append({
            "id": domain_id.replace("domain:", "feature:", 1),
            "name": name,
            "sourceDomain": domain_id,
            "routes": feat_routes,
            "pages": feat_pages,
            "components": feat_components,
            "stateStores": feat_stores,
            "apiCalls": feat_calls,
            "uiRules": [],
            "interactionRules": [],
            "stateTransitions": [],
            "apiSequence": [],
        })
    return features


def _validate(graph: dict) -> tuple[bool, bool, list[str]]:
    """Returns (valid, degraded, warnings). valid=False means the run should abort."""
    warnings: list[str] = []

    if graph.get("facetType") != "frontend":
        return False, False, ['facetType must be "frontend"']
    if "provenance" not in graph.get("project", {}):
        return False, False, ["project.provenance missing"]

    features = graph.get("features", [])
    if not features:
        return False, False, ["features[] is empty — no domain evidence found in domain-graph.json"]

    with_evidence = [
        f for f in features
        if f.get("routes") or f.get("pages") or f.get("apiCalls")
           or f.get("stateStores") or f.get("components")
    ]
    if not with_evidence:
        return False, False, ["No feature has any route/page/API/store/component evidence"]

    without = len(features) - len(with_evidence)
    if without:
        warnings.append(
            f"{without} feature(s) have no evidence (routes/pages/apiCalls/stateStores/components) — degraded"
        )
    if "routes" in graph and "pages" in graph and not graph["routes"] and not graph["pages"]:
        warnings.append("routes[] and pages[] both empty — route extraction may have failed")

    return True, bool(warnings), warnings


def _frontend_subpaths(root: Path) -> list[str]:
    """Return subPaths declared for the frontend facet in a discoverable system.json.

    Checks root/.understand-anything/system.json then root.parent/... — the
    aggregate is invoked with the facet dir (e.g. web/), whose system.json lives
    at the project root (root.parent). A system.json with no frontend facet does
    not stop the search; the next base is still checked.
    """
    bases = [root]
    if root.parent != root:  # avoid re-checking the same dir at the filesystem root
        bases.append(root.parent)
    for base in bases:
        sys_path = base / ".understand-anything" / "system.json"
        if not sys_path.is_file():
            continue
        try:
            cfg = json.loads(sys_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        for facet in cfg.get("facets", []):
            if facet.get("type") == "frontend":
                return facet.get("subPaths", []) or []
        # system.json present but no frontend facet — keep looking at the next base
    return []


def _discover_repos(root: Path) -> list[tuple[str, Path]]:
    """Resolve the web repos this aggregate covers, as (name, root) pairs.

    1. Single-repo: root itself has a domain-graph.json -> [(root.name, root)].
    2. Explicit: a frontend facet in system.json lists subPaths -> use those in
       declared order, keeping only ones that actually have a domain-graph.json.
    3. Scan: otherwise, immediate subdirs that have a domain-graph.json, by name.

    Discovery keys on domain-graph.json, so arbitrary subdirs (docs/, scripts/)
    are simply not repos and are skipped without warning.
    """
    if (root / ".understand-anything" / "domain-graph.json").is_file():
        return [(root.name, root)]

    sub_paths = _frontend_subpaths(root)
    if sub_paths:
        repos: list[tuple[str, Path]] = []
        for sp in sub_paths:
            d = root / sp.rstrip("/")
            if (d / ".understand-anything" / "domain-graph.json").is_file():
                repos.append((d.name, d))
        if repos:
            return repos

    repos = []
    for d in sorted(root.iterdir(), key=lambda p: p.name):
        if d.is_dir() and (d / ".understand-anything" / "domain-graph.json").is_file():
            repos.append((d.name, d))
    return repos


def _normalize_feature_name(name: str) -> str:
    return name.lower().replace("-", "_").replace(" ", "_")


def _union(lists: list[list[str]]) -> list[str]:
    out: set[str] = set()
    for lst in lists:
        out.update(lst)
    return sorted(out)


def _union_api_calls(lists: list[list[dict]]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for lst in lists:
        for c in lst:
            key = (c.get("method", ""), c.get("path", ""))
            if key in seen:
                continue
            seen.add(key)
            out.append(c)
    out.sort(key=lambda c: (c.get("path", ""), c.get("method", "")))
    return out


def _aggregate_features(per_repo: list[dict]) -> tuple[list[dict], list[dict]]:
    """Group features across repos by normalized name.

    Returns (features, domainLinks). Unique features pass through with
    sourceRepos=[repo]; features sharing a normalized name merge into one entry
    (deduped-union list fields, sourceRepos = every repo). Each shared (>=2 repo)
    group yields one domainLink mapping repo -> that repo's feature id.
    """
    groups: dict[str, list[tuple[str, dict]]] = {}
    order: list[str] = []  # preserve first-seen order for deterministic grouping
    for repo in per_repo:
        for feat in repo["features"]:
            key = _normalize_feature_name(feat.get("name", ""))
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append((repo["name"], feat))

    features: list[dict] = []
    domain_links: list[dict] = []
    for key in order:
        members = groups[key]
        repos_in_group = sorted({name for name, _ in members})
        _, first_feat = members[0]
        features.append({
            "id": first_feat["id"],
            "name": first_feat["name"],
            "sourceDomain": first_feat.get("sourceDomain", ""),
            "sourceRepos": repos_in_group,
            "routes": _union([f.get("routes", []) for _, f in members]),
            "pages": _union([f.get("pages", []) for _, f in members]),
            "components": _union([f.get("components", []) for _, f in members]),
            "stateStores": _union([f.get("stateStores", []) for _, f in members]),
            "apiCalls": _union_api_calls([f.get("apiCalls", []) for _, f in members]),
            "uiRules": [],
            "interactionRules": [],
            "stateTransitions": [],
            "apiSequence": [],
        })
        if len(repos_in_group) >= 2:
            mappings: dict[str, str] = {}
            for name, f in members:
                mappings.setdefault(name, f["id"])  # first occurrence per repo
            domain_links.append({
                "canonicalFeature": first_feat["name"],
                "mappings": mappings,
            })

    features.sort(key=lambda f: f["id"])
    domain_links.sort(key=lambda d: d["canonicalFeature"])
    return features, domain_links


def _extract_repo(repo_name: str, repo_root: Path) -> dict | None:
    """Load one repo's KG+DG and run all extractors.

    Returns the raw per-repo pieces, or None (with a WARN) if either graph is
    missing, so the aggregate can skip the repo and continue.
    """
    ua_dir = repo_root / ".understand-anything"
    kg_path = ua_dir / "knowledge-graph.json"
    dg_path = ua_dir / "domain-graph.json"
    if not kg_path.is_file() or not dg_path.is_file():
        print(
            f"[build-frontend-graph] WARN: skipping {repo_name} — missing "
            f"knowledge-graph.json or domain-graph.json",
            file=sys.stderr,
        )
        return None

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    dg = json.loads(dg_path.read_text(encoding="utf-8"))

    routes = _extract_routes(repo_root, kg)
    pages = _extract_pages(repo_root, kg)
    components = _extract_components(repo_root, kg)
    stores = _extract_state_stores(repo_root, kg)
    api_calls = _extract_api_calls(repo_root, kg)
    features = _build_features(dg, routes, pages, components, stores, api_calls)

    return {
        "name": repo_name,
        "project": kg.get("project", {}),
        "routes": routes,
        "pages": pages,
        "components": components,
        "stores": stores,
        "apiCalls": api_calls,
        "features": features,
    }


def build_frontend_graph(service_root_str: str) -> dict:
    root = Path(service_root_str).resolve()
    repos = _discover_repos(root)

    per_repo: list[dict] = []
    for repo_name, repo_root in repos:
        extracted = _extract_repo(repo_name, repo_root)
        if extracted is not None:
            per_repo.append(extracted)

    if not per_repo:
        raise FileNotFoundError(
            f"No web repo with knowledge-graph.json + domain-graph.json found under {root}"
        )

    names = [r["name"] for r in per_repo]
    if len(names) != len(set(names)):
        dupes = sorted({n for n in names if names.count(n) > 1})
        raise ValueError(
            f"[build-frontend-graph] Duplicate repo name(s) after discovery: {dupes} — "
            f"web sub-repos must have distinct directory names"
        )

    # Union scalar inventories across repos (stay as sorted string lists).
    routes = _union([r["routes"] for r in per_repo])
    pages = _union([r["pages"] for r in per_repo])
    components = _union([r["components"] for r in per_repo])
    stores = _union([r["stores"] for r in per_repo])

    # Union top-level apiCalls with per-repo provenance, deduped per (repo, method, path).
    # This intentionally differs from feature-level _union_api_calls (which dedups per
    # (method, path) and carries no repo), because the top-level inventory keeps provenance.
    all_api_calls: list[dict] = []
    seen_api: set[tuple[str, str, str]] = set()
    for r in per_repo:
        for c in r["apiCalls"]:
            key = (r["name"], c["method"], c["path"])
            if key in seen_api:
                continue
            seen_api.add(key)
            all_api_calls.append({
                "method": c["method"], "path": c["path"],
                "source": c["source"], "repo": r["name"],
            })
    all_api_calls.sort(key=lambda c: (c["repo"], c["path"], c["method"]))

    features, domain_links = _aggregate_features(per_repo)

    # Project metadata: single repo keeps its KG name (backward compat); aggregate
    # uses the facet/root dir name. Frameworks/languages are unioned.
    project_name = (
        per_repo[0]["project"].get("name", root.name) if len(per_repo) == 1 else root.name
    )
    frameworks = _union([r["project"].get("frameworks", []) for r in per_repo])
    languages = _union([r["project"].get("languages", []) for r in per_repo])
    degraded_in = any(
        r["project"].get("provenance", {}).get("degraded", False) for r in per_repo
    )
    # No single commit hash covers a multi-repo aggregate; use the first repo's as representative.
    git_hash = per_repo[0]["project"].get("gitCommitHash", "")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    graph: dict = {
        "version": VERSION,
        "facetType": "frontend",
        "project": {
            "name": project_name,
            "frameworks": frameworks,
            "languages": languages,
            "provenance": {
                "generationMode": "wiki",
                "degraded": degraded_in,
                "generatedAt": now,
                "gitCommitHash": git_hash,
            },
        },
        "repos": [r["name"] for r in per_repo],
        "routes": routes,
        "pages": pages,
        "components": components,
        "stateStores": stores,
        "apiCalls": all_api_calls,
        "features": features,
        "domainLinks": domain_links,
    }

    valid, degraded, warnings = _validate(graph)
    if not valid:
        raise ValueError(f"[build-frontend-graph] Validation failed: {warnings}")

    graph["project"]["provenance"]["degraded"] = degraded_in or degraded
    for w in warnings:
        print(f"[build-frontend-graph] WARN: {w}", file=sys.stderr)

    # Hash after all fields including degraded are finalized; consumers verify by
    # removing contentHash, serialising with indent=2 ensure_ascii=False, re-hashing.
    raw = json.dumps(graph, indent=2, ensure_ascii=False)
    graph["contentHash"] = "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    content = json.dumps(graph, indent=2, ensure_ascii=False)
    ua_dir = root / ".understand-anything"
    ua_dir.mkdir(parents=True, exist_ok=True)
    output_path = ua_dir / "frontend-graph.json"
    tmp = output_path.with_suffix(".json.tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.rename(output_path)

    print(
        f"[build-frontend-graph] Generated frontend-graph.json: "
        f"{len(per_repo)} repo(s), {len(features)} features, {len(routes)} routes, "
        f"{len(all_api_calls)} API calls, {len(domain_links)} domain links"
        + (" [degraded]" if (degraded_in or degraded) else "")
    )
    return graph


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build frontend-graph.json")
    parser.add_argument("service_root", help="Frontend service root directory")
    args = parser.parse_args()
    try:
        build_frontend_graph(args.service_root)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

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
    at the project root (root.parent).
    """
    for base in (root, root.parent):
        sys_path = base / ".understand-anything" / "system.json"
        if not sys_path.exists():
            continue
        try:
            cfg = json.loads(sys_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        for facet in cfg.get("facets", []):
            if facet.get("type") == "frontend":
                return facet.get("subPaths", []) or []
        return []
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
    if (root / ".understand-anything" / "domain-graph.json").exists():
        return [(root.name, root)]

    sub_paths = _frontend_subpaths(root)
    if sub_paths:
        repos: list[tuple[str, Path]] = []
        for sp in sub_paths:
            d = root / sp.rstrip("/")
            if (d / ".understand-anything" / "domain-graph.json").exists():
                repos.append((d.name, d))
        if repos:
            return repos

    repos = []
    for d in sorted(root.iterdir(), key=lambda p: p.name):
        if d.is_dir() and (d / ".understand-anything" / "domain-graph.json").exists():
            repos.append((d.name, d))
    return repos


def build_frontend_graph(service_root_str: str) -> dict:
    service_root = Path(service_root_str).resolve()
    ua_dir = service_root / ".understand-anything"

    kg_path = ua_dir / "knowledge-graph.json"
    dg_path = ua_dir / "domain-graph.json"

    if not kg_path.exists():
        raise FileNotFoundError(f"knowledge-graph.json not found at {kg_path}")
    if not dg_path.exists():
        raise FileNotFoundError(f"domain-graph.json not found at {dg_path}")

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    dg = json.loads(dg_path.read_text(encoding="utf-8"))

    proj = kg.get("project", {})
    prov = proj.get("provenance", {})

    routes = _extract_routes(service_root, kg)
    pages = _extract_pages(service_root, kg)
    components = _extract_components(service_root, kg)
    stores = _extract_state_stores(service_root, kg)
    api_calls = _extract_api_calls(service_root, kg)
    features = _build_features(dg, routes, pages, components, stores, api_calls)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    graph: dict = {
        "version": VERSION,
        "facetType": "frontend",
        "project": {
            "name": proj.get("name", service_root.name),
            "frameworks": proj.get("frameworks", []),
            "languages": proj.get("languages", []),
            "provenance": {
                "generationMode": "wiki",
                "degraded": prov.get("degraded", False),
                "generatedAt": now,
                "gitCommitHash": proj.get("gitCommitHash", ""),
            },
        },
        "routes": routes,
        "pages": pages,
        "components": components,
        "stateStores": stores,
        "apiCalls": [{"method": a["method"], "path": a["path"], "source": a["source"]}
                     for a in api_calls],
        "features": features,
    }

    valid, degraded, warnings = _validate(graph)
    if not valid:
        raise ValueError(f"[build-frontend-graph] Validation failed: {warnings}")

    graph["project"]["provenance"]["degraded"] = degraded
    for w in warnings:
        print(f"[build-frontend-graph] WARN: {w}", file=sys.stderr)

    # Hash after all fields including degraded are finalized; consumers verify by
    # removing contentHash, serialising with indent=2 ensure_ascii=False, and re-hashing.
    raw = json.dumps(graph, indent=2, ensure_ascii=False)
    graph["contentHash"] = "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

    content = json.dumps(graph, indent=2, ensure_ascii=False)
    output_path = ua_dir / "frontend-graph.json"
    tmp = output_path.with_suffix(".json.tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.rename(output_path)

    print(
        f"[build-frontend-graph] Generated frontend-graph.json: "
        f"{len(features)} features, {len(routes)} routes, {len(api_calls)} API calls"
        + (" [degraded]" if degraded else "")
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

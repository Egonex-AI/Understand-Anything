#!/usr/bin/env python3
"""
merge-batch-graphs.py — Merge and normalize batch analysis results.

Combines batch-*.json files from the intermediate directory into a single
assembled graph with normalized IDs, complexity values, and cleaned edges.

Called at the end of Phase 2 of /understand. Phase 3 (ASSEMBLE REVIEW)
then reviews the output for semantic issues the script cannot catch.

Usage:
    python merge-batch-graphs.py <project-root>

Input/output live under the project's data dir (`.ua/`, or legacy
`.understand-anything/` when that directory already exists):
    Input:  <ua-dir>/intermediate/batch-*.json
    Output: <ua-dir>/intermediate/assembled-graph.json
"""

import json
import os
import posixpath
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def resolve_ua_dir(root: Path) -> Path:
    """Mirror core resolveUaDir: legacy .understand-anything/ wins if present."""
    legacy = root / ".understand-anything"
    return legacy if legacy.is_dir() else root / ".ua"


# ── Configuration ─────────────────────────────────────────────────────────

VALID_NODE_PREFIXES = {
    "file", "func", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource",
    "domain", "flow", "step",
    # Knowledge-base node types (schema.ts NodeType enum)
    "article", "entity", "topic", "claim", "source",
}

# Precompiled once at import time. The previous inline form rebuilt and
# re-escaped this 24-alternative pattern *string* on every node (the regex
# cache keys on the final string, so only the compile was cached — the
# join + re.escape work was not). Benchmarked ~15x faster on large graphs.
# The `:`-delimited group + anchoring makes alternation order (and hence the
# unordered-set iteration order) irrelevant to matching, so hoisting is
# byte-for-byte equivalent.
_PROJECT_PREFIX_RE = re.compile(
    r"^[^:]+:(" + "|".join(re.escape(p) for p in VALID_NODE_PREFIXES) + r"):(.+)$"
)

# node.type → canonical ID prefix
TYPE_TO_PREFIX: dict[str, str] = {
    "file": "file",
    "function": "function",
    "func": "function",
    "class": "class",
    "module": "module",
    "concept": "concept",
    "config": "config",
    "document": "document",
    "service": "service",
    "table": "table",
    "endpoint": "endpoint",
    "pipeline": "pipeline",
    "schema": "schema",
    "resource": "resource",
    "domain": "domain",
    "flow": "flow",
    "step": "step",
    # Knowledge-base node types
    "article": "article",
    "entity": "entity",
    "topic": "topic",
    "claim": "claim",
    "source": "source",
}

COMPLEXITY_MAP: dict[str, str] = {
    "low": "simple",
    "easy": "simple",
    "medium": "moderate",
    "intermediate": "moderate",
    "high": "complex",
    "hard": "complex",
    "difficult": "complex",
}

VALID_COMPLEXITY = {"simple", "moderate", "complex"}


# ── tested_by linker configuration ────────────────────────────────────────

# JS/TS family: a `.test.ts` file may be testing a `.ts`, `.tsx`, `.js`, etc.
# We try each candidate extension in priority order.
_JS_TS_EXTS: tuple[str, ...] = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue")
_JS_TS_TEST_EXTS: frozenset[str] = frozenset(_JS_TS_EXTS)

# Mirrored production roots — when a test sits under `tests/`, it might be
# mirroring `src/`, `app/`, `lib/`, or the project root.
_MIRROR_PRODUCTION_ROOTS: tuple[str, ...] = ("src", "app", "lib", "")

# Per-extension test-name patterns: ext → (prefix_patterns, suffix_patterns).
# A basename qualifies as a test if its stem starts with any prefix or ends
# with any suffix listed for its extension. JS/TS family is handled separately
# because its `.test`/`.spec` infix sits on the *stem* of a double-extension
# basename (e.g. `foo.test.ts` has ext `.ts`, stem `foo.test`).
_TEST_NAME_PATTERNS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    ".go": ((), ("_test",)),
    ".py": (("test_",), ("_test",)),
    ".java": ((), ("Test", "Tests", "IT")),
    ".kt": ((), ("Test", "Tests")),
    ".scala": ((), ("Spec", "Suite", "Test", "Tests")),
    ".cs": ((), ("Test", "Tests")),
    ".c": (("test_",), ("_test",)),
    ".cpp": (("test_",), ("_test",)),
    ".cc": (("test_",), ("_test",)),
}


# Mirrors packages/core/src/schema.ts so the dashboard validator has nothing
# left to auto-correct for the `direction` field on merged graphs.
_DIRECTION_ALIASES: dict[str, str] = {"both": "bidirectional", "mutual": "bidirectional"}
_VALID_DIRECTIONS: frozenset[str] = frozenset({"forward", "backward", "bidirectional"})


def normalize_direction(value: Any) -> str:
    """Canonicalize an edge `direction` value to one of the schema enum members."""
    candidate = value.lower() if isinstance(value, str) else ""
    candidate = _DIRECTION_ALIASES.get(candidate, candidate)
    if candidate not in _VALID_DIRECTIONS:
        return "forward"
    return candidate


def _num(v: Any) -> float:
    """Coerce a value to float for safe comparison (handles string weights)."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def parse_batch_filename(name: str) -> tuple[int, int | None] | None:
    """Return the logical batch index and optional part number for a batch file.

    Incremental updates write the pruned baseline graph as `batch-existing.json`;
    treat it as a real batch that sorts before freshly analyzed numeric batches.
    """
    if name == "batch-existing.json":
        return (-1, None)

    match = re.match(r"batch-(\d+)(?:-part-(\d+))?\.json", name)
    if match is None:
        return None
    return (int(match.group(1)), int(match.group(2)) if match.group(2) else None)


def batch_sort_key(path: Path) -> tuple[int, int, str]:
    parsed = parse_batch_filename(path.name)
    if parsed is None:
        return (sys.maxsize, sys.maxsize, path.name)

    batch_index, part_number = parsed
    return (batch_index, part_number or 0, path.name)


# ── Batch loading ─────────────────────────────────────────────────────────

def load_batch(path: Path) -> dict[str, Any] | None:
    """Load a batch JSON file, tolerating malformed files."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Warning: skipping {path.name}: {e}", file=sys.stderr)
        return None

    if not isinstance(data.get("nodes"), list):
        print(f"  Warning: skipping {path.name}: missing or invalid 'nodes' array", file=sys.stderr)
        return None
    if not isinstance(data.get("edges"), list):
        print(f"  Warning: skipping {path.name}: missing or invalid 'edges' array", file=sys.stderr)
        return None

    return data


# ── ID normalization ──────────────────────────────────────────────────────

def classify_id_fix(original: str, corrected: str) -> str:
    """Return a human-readable pattern label for an ID correction."""
    # Double prefix: "file:file:..." → "file:..."
    for prefix in VALID_NODE_PREFIXES:
        if original.startswith(f"{prefix}:{prefix}:"):
            return f"{prefix}:{prefix}: → {prefix}: (double prefix)"

    # Project-name prefix: "my-project:file:..." → "file:..."
    parts = original.split(":")
    if len(parts) >= 3 and parts[0] not in VALID_NODE_PREFIXES and parts[1] in VALID_NODE_PREFIXES:
        return f"<project>:{parts[1]}: → {parts[1]}: (project-name prefix)"

    # Legacy func: → function:
    if original.startswith("func:") and corrected.startswith("function:"):
        return "func: → function: (prefix canonicalization)"

    # Bare path → prefixed
    if not any(original.startswith(f"{p}:") for p in VALID_NODE_PREFIXES):
        prefix = corrected.split(":")[0]
        return f"bare path → {prefix}: (missing prefix)"

    return f"{original} → {corrected}"


def normalize_node_id(node_id: str, node: dict[str, Any]) -> str:
    """Normalize a node ID, returning the corrected version."""
    nid = node_id

    # Strip double prefix: "file:file:src/foo.ts" → "file:src/foo.ts"
    for prefix in VALID_NODE_PREFIXES:
        double = f"{prefix}:{prefix}:"
        if nid.startswith(double):
            nid = nid[len(prefix) + 1:]
            break

    # Strip project-name prefix: "my-project:file:src/foo.ts" → "file:src/foo.ts"
    # Pattern: <word>:<valid-prefix>:<path>
    match = _PROJECT_PREFIX_RE.match(nid)
    if match:
        # Only strip if the first segment is NOT a valid prefix itself
        first_seg = nid.split(":")[0]
        if first_seg not in VALID_NODE_PREFIXES:
            nid = f"{match.group(1)}:{match.group(2)}"

    # Canonicalize legacy prefix: func: → function:
    if nid.startswith("func:") and not nid.startswith("function:"):
        nid = "function:" + nid[5:]

    # Add missing prefix for bare file paths
    has_prefix = any(nid.startswith(f"{p}:") for p in VALID_NODE_PREFIXES)
    if not has_prefix:
        node_type = node.get("type", "file")
        prefix = TYPE_TO_PREFIX.get(node_type, "file")
        if node_type in ("function", "class"):
            file_path = node.get("filePath", "")
            name = node.get("name", nid)
            if file_path:
                nid = f"{prefix}:{file_path}:{name}"
            else:
                # Without filePath, function:<name> collides with every other
                # function of the same name across the project. Prefix with a
                # placeholder so the collision is at least detectable in the
                # report instead of silently merging unrelated nodes.
                nid = f"{prefix}:__nofilepath__:{name}"
        else:
            nid = f"{prefix}:{nid}"

    return nid


def normalize_complexity(value: Any) -> tuple[str, str]:
    """Normalize a complexity value. Returns (normalized, status).

    status is one of:
      "valid"    — already a valid value, no change needed
      "mapped"   — known alias, confidently mapped (goes to Fixed report)
      "unknown"  — unrecognized value, defaulted to moderate (goes to Could-not-fix report)
    """
    if isinstance(value, str):
        lower = value.strip().lower()
        if lower in VALID_COMPLEXITY:
            return lower, "valid"
        if lower in COMPLEXITY_MAP:
            return COMPLEXITY_MAP[lower], "mapped"
        # Unknown string — default but flag it
        return "moderate", "unknown"
    elif isinstance(value, (int, float)):
        n = int(value)
        if n <= 3:
            return "simple", "mapped"
        elif n <= 6:
            return "moderate", "mapped"
        else:
            return "complex", "mapped"
    # None or other type — default but flag it
    return "moderate", "unknown"


# ── Deterministic Python call linker ──────────────────────────────────────

def _normalized_project_path(path: str) -> str | None:
    """Return a relative POSIX project path, or None if it escapes the root."""
    posix_path = path.replace("\\", "/")
    if posix_path.startswith("/") or re.match(r"^[A-Za-z]:/", posix_path):
        return None
    normalized = posixpath.normpath(posix_path)
    if normalized in ("", ".", "..") or normalized.startswith("../"):
        return None
    return normalized


def python_module_candidates(source_file: str, module: str) -> tuple[str, ...]:
    """Map a Python import module to possible project-relative source files."""
    source_path = _normalized_project_path(source_file)
    if source_path is None or not isinstance(module, str):
        return ()

    match = re.fullmatch(r"(\.*)([^\s./]+(?:\.[^\s./]+)*)?", module)
    if match is None:
        return ()
    leading_dots, dotted_module = match.groups()
    module_parts = dotted_module.split(".") if dotted_module else []
    if any(not part.isidentifier() for part in module_parts):
        return ()

    if leading_dots:
        base_parts = [
            part for part in posixpath.dirname(source_path).split("/") if part
        ]
        parent_levels = len(leading_dots) - 1
        if parent_levels and parent_levels >= len(base_parts):
            return ()
        if parent_levels:
            base_parts = base_parts[:-parent_levels]
        path_parts = base_parts + module_parts
    else:
        if not module_parts:
            return ()
        path_parts = module_parts

    module_path = "/".join(path_parts)
    if not module_path:
        return ()
    if dotted_module:
        return (f"{module_path}.py", f"{module_path}/__init__.py")
    return (f"{module_path}/__init__.py",)


def _python_imported_submodule(source: str, imported_name: str) -> str | None:
    """Build the module path for `from source import imported_name` used as a package."""
    if not imported_name or not imported_name.isidentifier():
        return None
    if not source:
        return imported_name
    if source.startswith("."):
        # `from . import helper` → `.helper`; `from .pkg import helper` → `.pkg.helper`
        if source.replace(".", "") == "":
            return source + imported_name
        return f"{source}.{imported_name}"
    return f"{source}.{imported_name}"


def _matching_function_ids(
    functions_by_file_and_name: dict[tuple[str, str], list[str]],
    files: tuple[str, ...],
    name: str,
) -> list[str]:
    matches: list[str] = []
    for path in files:
        for node_id in functions_by_file_and_name.get((path, name), []):
            if node_id not in matches:
                matches.append(node_id)
    return matches


def _python_import_binds(import_record: dict[str, Any], callee: str) -> bool:
    """Return whether an import record binds the called local name."""
    local_name = callee.split(".", 1)[0]
    aliases = import_record.get("aliases")
    if isinstance(aliases, dict) and local_name in aliases:
        return True
    specifiers = import_record.get("specifiers")
    if not isinstance(specifiers, list):
        return False
    if local_name in specifiers:
        return True
    source = import_record.get("source")
    return (
        "." in callee
        and isinstance(source, str)
        and source in specifiers
        and source.split(".", 1)[0] == local_name
    )


def _active_python_import(
    imports: list[Any],
    callee: str,
    call_line: Any,
) -> tuple[dict[str, Any] | None, bool]:
    """Return the latest binding before a call and whether ordering is ambiguous."""
    matching = [
        (index, record)
        for index, record in enumerate(imports)
        if isinstance(record, dict) and _python_import_binds(record, callee)
    ]
    if not matching:
        return None, False
    if not isinstance(call_line, int) or isinstance(call_line, bool):
        return None, True

    applicable: list[tuple[int, int, dict[str, Any]]] = []
    for index, record in matching:
        import_line = record.get("lineNumber")
        if not isinstance(import_line, int) or isinstance(import_line, bool):
            return None, True
        if import_line == call_line:
            return None, True
        if import_line < call_line:
            applicable.append((import_line, index, record))
    if not applicable:
        return None, False
    return max(applicable, key=lambda item: (item[0], item[1]))[2], False


def _resolve_imported_python_targets(
    functions_by_file_and_name: dict[tuple[str, str], list[str]],
    source_file: str,
    callee: str,
    active_import: dict[str, Any],
) -> list[str]:
    """Resolve a callee through one active import binding to function node ids."""
    source = active_import.get("source")
    specifiers = active_import.get("specifiers")
    aliases = active_import.get("aliases")
    if not isinstance(source, str) or not isinstance(specifiers, list):
        return []

    aliases = aliases if isinstance(aliases, dict) else {}
    module_files = python_module_candidates(source_file, source)
    original = aliases.get(callee)
    if callee in specifiers and callee not in aliases:
        return _matching_function_ids(
            functions_by_file_and_name, module_files, callee
        )
    if (
        isinstance(original, str)
        and original != source
        and callee in specifiers
    ):
        return _matching_function_ids(
            functions_by_file_and_name, module_files, original
        )

    qualifier, dot, member = callee.rpartition(".")
    if not dot or not member.isidentifier():
        return []

    aliased_module = aliases.get(qualifier)
    is_module_binding = aliased_module == source and qualifier in specifiers
    is_unaliased_module = qualifier == source and source in specifiers
    if is_module_binding or is_unaliased_module:
        return _matching_function_ids(
            functions_by_file_and_name, module_files, member
        )

    # `from package import helper; helper.expand()` — helper is a submodule
    if qualifier not in specifiers:
        return []
    parent_symbol = aliases[qualifier] if qualifier in aliases else qualifier
    if not isinstance(parent_symbol, str) or parent_symbol == source:
        return []

    # If the imported name is itself a function in the parent module, this is
    # attribute access on a function — not a submodule call. Prefer skip.
    if _matching_function_ids(
        functions_by_file_and_name, module_files, parent_symbol
    ):
        return []

    submodule = _python_imported_submodule(source, parent_symbol)
    if submodule is None:
        return []
    return _matching_function_ids(
        functions_by_file_and_name,
        python_module_candidates(source_file, submodule),
        member,
    )


def link_python_calls(
    nodes_by_id: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    extraction_results: list[dict[str, Any]],
) -> tuple[int, int]:
    """Append calls edges only when Python caller and callee resolve uniquely."""
    functions_by_file_and_name: dict[tuple[str, str], list[str]] = {}
    for node_id, node in nodes_by_id.items():
        if node.get("type") not in ("function", "func"):
            continue
        path = node.get("filePath")
        name = node.get("name")
        if not isinstance(path, str) or not isinstance(name, str) or not name:
            continue
        normalized_path = _normalized_project_path(path)
        if normalized_path is None:
            continue
        functions_by_file_and_name.setdefault((normalized_path, name), []).append(node_id)

    existing = {
        (
            edge.get("source"),
            edge.get("target"),
            edge.get("type"),
            edge.get("direction", "forward"),
        )
        for edge in edges
    }
    added = 0
    skipped = 0

    for result in extraction_results:
        if not isinstance(result, dict) or result.get("language") != "python":
            continue
        path = result.get("path")
        calls = result.get("callGraph")
        imports = result.get("imports")
        if not isinstance(path, str) or not isinstance(calls, list):
            continue
        path = _normalized_project_path(path)
        if path is None:
            skipped += len(calls)
            continue
        imports = imports if isinstance(imports, list) else []

        for call in calls:
            if not isinstance(call, dict):
                skipped += 1
                continue
            caller = call.get("caller")
            callee = call.get("callee")
            if (
                not isinstance(caller, str)
                or not isinstance(callee, str)
                or not caller
                or not callee
            ):
                skipped += 1
                continue

            caller_ids = functions_by_file_and_name.get((path, caller), [])
            if len(caller_ids) != 1:
                skipped += 1
                continue

            same_file = functions_by_file_and_name.get((path, callee), [])
            if same_file:
                target_ids = same_file
            else:
                active_import, binding_ambiguous = _active_python_import(
                    imports, callee, call.get("lineNumber")
                )
                if binding_ambiguous:
                    skipped += 1
                    continue
                target_ids = (
                    _resolve_imported_python_targets(
                        functions_by_file_and_name, path, callee, active_import
                    )
                    if active_import is not None
                    else []
                )

            unique_targets = list(dict.fromkeys(target_ids))
            if len(unique_targets) != 1:
                skipped += 1
                continue

            key = (caller_ids[0], unique_targets[0], "calls", "forward")
            if key in existing:
                continue
            edges.append({
                "source": caller_ids[0],
                "target": unique_targets[0],
                "type": "calls",
                "direction": "forward",
                "weight": 0.8,
                "description": "Python call graph (deterministic)",
            })
            existing.add(key)
            added += 1

    return added, skipped


def load_python_extraction_results(
    ua_dir: Path,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Load file extraction records; malformed or missing artifacts are non-fatal."""
    artifact_paths = sorted(
        (ua_dir / "tmp").glob("ua-file-extract-results-*.json")
    )
    if not artifact_paths:
        return [], [
            "  Python extraction artifacts not found in "
            f"{ua_dir / 'tmp'}"
        ]

    results: list[dict[str, Any]] = []
    report: list[str] = []
    for artifact_path in artifact_paths:
        try:
            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            report.append(
                f"  {artifact_path.name}: could not parse extraction artifact: {error}"
            )
            continue
        artifact_results = artifact.get("results") if isinstance(artifact, dict) else None
        if not isinstance(artifact_results, list):
            report.append(
                f"  {artifact_path.name}: ignored extraction artifact with no results array"
            )
            continue
        results.extend(result for result in artifact_results if isinstance(result, dict))
    return results, report


# ── Deterministic tested_by linker ────────────────────────────────────────
#
# Two-pass linker. Both passes produce canonical `production → test` edges.
#
# Pass 1 — preserve LLM semantics, fix direction.
#   The LLM sees the relationship only when analyzing a *test* file
#   (production files don't import their tests), so its emitted direction
#   is systematically wrong: source = the file it was analyzing = a test.
#   We do NOT strip these edges — the *pairing* is real evidence (the LLM
#   saw an import / using / same-package call). We just flip direction
#   when source is test + target is production. Edges that are
#   semantically broken (test↔test, production↔production, orphan endpoints)
#   are dropped.
#
# Pass 2 — supplement with path-convention pairings.
#   For test files the LLM didn't link to anything, fall back to filename
#   conventions (sibling `_test.go`, JS/TS `__tests__/`, Maven `src/test/`,
#   etc.) to find a production counterpart. Pairs already covered by
#   Pass 1 are skipped.
#
# Why this beats strip-and-rederive: real projects often violate the
# linker's naming conventions (one Go `_test.go` covering several `.go`
# files in the same package, .NET `<svc>/tests/X.cs` against
# `<svc>/src/Y/X.cs`). Stripping LLM edges drops that real-world coverage
# signal entirely. Swapping preserves it.

def _path_segments(path: str) -> list[str]:
    """Split a relative POSIX-style path into segments (ignoring empties)."""
    return [seg for seg in path.split("/") if seg]


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1] if "/" in path else path


def is_test_path(path: str) -> bool:
    """Return True if `path` looks like a test file by basename convention.

    Files inside `tests/`, `__tests__/`, `test/`, or `spec/` directories that
    do NOT carry a recognized test extension are treated as helpers/fixtures
    and classified as non-test (so `__tests__/helpers.ts` is not a test).
    """
    stem, ext = os.path.splitext(_basename(path))

    # JS/TS family: the test marker is an infix on the stem (foo.test.ts has
    # stem "foo.test", ext ".ts"), not a prefix/suffix on the stem itself.
    if ext in _JS_TS_TEST_EXTS:
        return stem.endswith(".test") or stem.endswith(".spec")

    patterns = _TEST_NAME_PATTERNS.get(ext)
    if patterns is None:
        return False
    prefixes, suffixes = patterns
    return any(stem.startswith(p) for p in prefixes) or any(
        stem.endswith(s) for s in suffixes
    )


def _strip_test_infix(stem: str) -> str | None:
    """For a JS/TS-family stem like `foo.test` or `foo.spec`, strip the
    trailing `.test` / `.spec`. Returns None if no infix is present."""
    for infix in (".test", ".spec"):
        if stem.endswith(infix):
            return stem[: -len(infix)]
    return None


def _join(dir_path: str, name: str) -> str:
    """Join a (possibly empty) directory path to a basename with a single
    slash, dropping the slash entirely when there is no directory."""
    return f"{dir_path}/{name}" if dir_path else name


def _add_unique(out: list[str], path: str) -> None:
    """Append `path` to `out` unless it is empty or already present."""
    if path and path not in out:
        out.append(path)


def _js_ts_sibling_candidates(dir_path: str, base_stem: str) -> list[str]:
    """Build sibling candidates for a JS/TS family base stem.

    `dir_path` is the parent dir (no trailing slash, may be empty).
    `base_stem` is the stem with the test infix already stripped.
    """
    return [_join(dir_path, f"{base_stem}{e}") for e in _JS_TS_EXTS]


def production_candidates(test_path: str) -> list[str]:
    """For a test file path, return ordered candidate production paths.

    The returned list is in priority order (sibling first, then `__tests__`
    walk-out, then mirrored-tree variants). Duplicates are removed while
    preserving order. Caller should pick the first candidate that resolves
    to a known production node.
    """
    stem, ext = os.path.splitext(_basename(test_path))
    segs = _path_segments(test_path)
    dir_segs = segs[:-1]
    dir_path = "/".join(dir_segs)

    candidates: list[str] = []

    # ── JS/TS family ──────────────────────────────────────────────────
    if ext in _JS_TS_TEST_EXTS:
        base_stem = _strip_test_infix(stem)
        if base_stem is not None:
            # 1. Sibling de-infix: prefer the same extension as the test, then
            # the rest of the family.
            _add_unique(candidates, _join(dir_path, f"{base_stem}{ext}"))
            for c in _js_ts_sibling_candidates(dir_path, base_stem):
                _add_unique(candidates, c)

            # 2. Walk out of test-segregating subdir — drop the trailing
            # __tests__/test/spec/tests segment. Some JS/TS projects use
            # `<dir>/test/foo.spec.ts` or `<dir>/spec/foo.spec.ts` instead of
            # the more idiomatic `__tests__/`; treat them the same.
            if dir_segs and dir_segs[-1] in ("__tests__", "test", "spec", "tests"):
                parent_dir = "/".join(dir_segs[:-1])
                _add_unique(candidates, _join(parent_dir, f"{base_stem}{ext}"))
                for c in _js_ts_sibling_candidates(parent_dir, base_stem):
                    _add_unique(candidates, c)

            # 3. Mirrored tree: tests/foo/X.test.ts → src/foo/X.ts (and
            # variants for app/lib/<root>).
            if dir_segs and dir_segs[0] in ("tests", "test", "__tests__"):
                tail_path = "/".join(dir_segs[1:])
                for root in _MIRROR_PRODUCTION_ROOTS:
                    new_dir = "/".join(p for p in (root, tail_path) if p)
                    _add_unique(candidates, _join(new_dir, f"{base_stem}{ext}"))
                    for c in _js_ts_sibling_candidates(new_dir, base_stem):
                        _add_unique(candidates, c)

    # ── Go ────────────────────────────────────────────────────────────
    elif ext == ".go" and stem.endswith("_test"):
        base_stem = stem[: -len("_test")]
        _add_unique(candidates, _join(dir_path, f"{base_stem}.go"))

    # ── Python ────────────────────────────────────────────────────────
    elif ext == ".py" and (stem.startswith("test_") or stem.endswith("_test")):
        if stem.startswith("test_"):
            base_stem = stem[len("test_"):]
        else:
            base_stem = stem[: -len("_test")]

        # Sibling
        _add_unique(candidates, _join(dir_path, f"{base_stem}.py"))

        # Walk out of an in-package tests/ or test/ directory:
        # `mypkg/tests/test_bar.py` → `mypkg/bar.py`. Common in Django apps
        # and any project that colocates tests with the package they cover.
        if dir_segs and dir_segs[-1] in ("tests", "test"):
            parent_dir = "/".join(dir_segs[:-1])
            _add_unique(candidates, _join(parent_dir, f"{base_stem}.py"))

        # Mirrored: tests/foo/test_bar.py → src/foo/bar.py (and variants)
        if dir_segs and dir_segs[0] in ("tests", "test"):
            tail_path = "/".join(dir_segs[1:])
            for root in _MIRROR_PRODUCTION_ROOTS:
                new_dir = "/".join(p for p in (root, tail_path) if p)
                _add_unique(candidates, _join(new_dir, f"{base_stem}.py"))

    # ── Java ──────────────────────────────────────────────────────────
    elif ext == ".java":
        for suffix in ("Tests", "Test", "IT"):
            if stem.endswith(suffix):
                base_stem = stem[: -len(suffix)]
                # Maven/Gradle layout: swap src/test/java/... → src/main/java/...
                if (
                    len(dir_segs) >= 3
                    and dir_segs[0] == "src"
                    and dir_segs[1] == "test"
                    and dir_segs[2] == "java"
                ):
                    new_dir = "/".join(["src", "main", "java"] + list(dir_segs[3:]))
                    _add_unique(candidates, f"{new_dir}/{base_stem}.java")
                # Sibling fallback
                _add_unique(candidates, _join(dir_path, f"{base_stem}.java"))
                break

    # ── Kotlin ────────────────────────────────────────────────────────
    elif ext == ".kt":
        for suffix in ("Tests", "Test"):
            if stem.endswith(suffix):
                base_stem = stem[: -len(suffix)]
                if (
                    len(dir_segs) >= 3
                    and dir_segs[0] == "src"
                    and dir_segs[1] == "test"
                    and dir_segs[2] == "kotlin"
                ):
                    new_dir = "/".join(["src", "main", "kotlin"] + list(dir_segs[3:]))
                    _add_unique(candidates, f"{new_dir}/{base_stem}.kt")
                _add_unique(candidates, _join(dir_path, f"{base_stem}.kt"))
                break

    # ── Scala ─────────────────────────────────────────────────────────
    elif ext == ".scala":
        for suffix in ("Spec", "Suite", "Tests", "Test"):
            if stem.endswith(suffix):
                base_stem = stem[: -len(suffix)]
                # sbt layout: swap any .../src/test/scala/... segment while
                # preserving a module prefix such as modules/core/.
                for i in range(0, max(len(dir_segs) - 2, 0)):
                    if list(dir_segs[i : i + 3]) == ["src", "test", "scala"]:
                        new_dir = "/".join(
                            list(dir_segs[:i])
                            + ["src", "main", "scala"]
                            + list(dir_segs[i + 3 :])
                        )
                        _add_unique(candidates, f"{new_dir}/{base_stem}.scala")
                        break
                _add_unique(candidates, _join(dir_path, f"{base_stem}.scala"))
                break

    # ── C# ────────────────────────────────────────────────────────────
    elif ext == ".cs":
        for suffix in ("Tests", "Test"):
            if stem.endswith(suffix):
                base_stem = stem[: -len(suffix)]
                # Sibling fallback (e.g. `Foo.Tests/BarTests.cs` ↔ same dir
                # is rare but cheap to try).
                _add_unique(candidates, _join(dir_path, f"{base_stem}.cs"))

                # Walk out of an in-service `tests/` directory and search
                # the sibling `src/` subtree. Handles layouts like
                # `src/<svc>/tests/BarTests.cs` ↔ `src/<svc>/src/.../Bar.cs`
                # (microservices-demo cartservice) and bare
                # `<proj>/tests/BarTests.cs` ↔ `<proj>/src/Bar.cs`.
                tests_idx = None
                for i in range(len(dir_segs) - 1, -1, -1):
                    if dir_segs[i].lower() in ("tests", "test"):
                        tests_idx = i
                        break
                if tests_idx is not None:
                    parent_segs = dir_segs[:tests_idx]
                    tail_segs = dir_segs[tests_idx + 1 :]
                    parent_dir = "/".join(parent_segs)
                    # `<parent>/<base_stem>.cs` (drop `tests/` entirely).
                    _add_unique(
                        candidates,
                        _join(parent_dir, f"{base_stem}.cs"),
                    )
                    # `<parent>/src/<tail>/<base_stem>.cs` (mirror through src/).
                    src_dir = "/".join([*parent_segs, "src", *tail_segs])
                    _add_unique(candidates, _join(src_dir, f"{base_stem}.cs"))

                # `.NET`-style sibling-project mirror: `My.App.Tests/...` ↔
                # `My.App/...`. The test project's top dir typically ends in
                # `.Tests`. Strip it and try the same tail under the sibling.
                if dir_segs:
                    top = dir_segs[0]
                    if top.endswith(".Tests") or top.endswith(".Test"):
                        sibling = top[: -len(".Tests")] if top.endswith(".Tests") else top[: -len(".Test")]
                        if sibling:
                            mirror_dir = "/".join([sibling, *dir_segs[1:]])
                            _add_unique(
                                candidates,
                                _join(mirror_dir, f"{base_stem}.cs"),
                            )
                break

    # ── C/C++ ─────────────────────────────────────────────────────────
    elif ext in {".c", ".cpp", ".cc"}:
        if stem.startswith("test_"):
            base_stem = stem[len("test_"):]
        elif stem.endswith("_test"):
            base_stem = stem[: -len("_test")]
        else:
            base_stem = None
        if base_stem is not None:
            _add_unique(candidates, _join(dir_path, f"{base_stem}{ext}"))

    return candidates


def _file_node_path(node: dict[str, Any]) -> str | None:
    """Return the relative project path for a `file:`-prefixed node, else None."""
    nid = node.get("id", "")
    if not isinstance(nid, str) or not nid.startswith("file:"):
        return None
    fp = node.get("filePath")
    if isinstance(fp, str) and fp:
        return fp
    return nid[len("file:"):]


def _swap_tested_by_in_place(
    edge: dict[str, Any], original_src: str, original_tgt: str
) -> None:
    """Flip an inverted `tested_by` edge so source becomes production and
    target becomes the test file. Mutates `edge` in place; appends a
    `[direction corrected]` audit marker to `description`.
    """
    edge["source"] = original_tgt
    edge["target"] = original_src
    edge["direction"] = "forward"
    prev = edge.get("description")
    edge["description"] = (
        "Direction corrected (was test → production)"
        if not prev
        else f"{prev} [direction corrected]"
    )


def _ensure_tested_tag(node: dict[str, Any]) -> bool:
    """Append "tested" to `node["tags"]`, coercing malformed `tags` to a
    fresh list. Returns True if the tag was newly added.

    `tags` from raw LLM batch JSON may be missing, None, a string, or
    another non-list value — the TypeScript autoFixGraph normalizer that
    handles this runs downstream of this script, so we defend here.
    """
    tags = node.get("tags")
    if not isinstance(tags, list):
        tags = []
        node["tags"] = tags
    if "tested" in tags:
        return False
    tags.append("tested")
    return True


def link_tests(
    nodes_by_id: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> tuple[int, int, int, int]:
    """Canonicalize `tested_by` edges and link unmatched test files.

    Two passes (see module-level "Deterministic tested_by linker" comment
    for the rationale):

      1. Walk every existing `tested_by` edge. Keep canonical
         (production → test) edges as-is. Flip inverted (test → production)
         edges so the swap preserves the LLM's pairing evidence with the
         right direction. Drop edges that don't classify cleanly as
         file ↔ file or where one endpoint is missing — they have no
         recoverable meaning.
      2. For every test file not yet paired by Pass 1, walk path-convention
         candidates and emit a fresh `production → test` edge for the first
         match.

    Tagging happens once per production node that ends up on the source
    side of any `tested_by` edge (canonical, swapped, or supplemented).

    Mutates `nodes_by_id` (adds "tested" tag) and `edges` (rewrites
    in place: drops semantically broken edges, swaps inverted ones, appends
    supplements).

    Returns (added, dropped, tagged, swapped):
      added:   path-convention supplemental edges appended in Pass 2
      dropped: pre-existing `tested_by` edges removed (unsalvageable)
      tagged:  production nodes newly tagged "tested"
      swapped: pre-existing `tested_by` edges flipped (test → production
               became production → test)
    """
    # ── Index file nodes by relative path; classify each as test/production.
    # `is_prod` here means "is a known file node AND is not a test by
    # path convention" — used both to validate edge endpoints and to drive
    # path-convention candidate matching.
    file_paths_to_nodes: dict[str, dict[str, Any]] = {}
    node_id_to_classification: dict[str, str] = {}  # id → "test" | "prod"
    test_nodes: list[tuple[str, dict[str, Any]]] = []
    for node in nodes_by_id.values():
        path = _file_node_path(node)
        if path is None:
            continue
        file_paths_to_nodes[path] = node
        if is_test_path(path):
            node_id_to_classification[node["id"]] = "test"
            test_nodes.append((path, node))
        else:
            node_id_to_classification[node["id"]] = "prod"

    # ── Pass 1: walk existing tested_by edges, canonicalize or drop.
    # `covered` tracks (production_id, test_id) pairs that have a kept edge
    # after this pass — used both to deduplicate within Pass 1 and to
    # suppress duplicate supplements in Pass 2.
    # `pair_to_idx` maps each kept pair to its slot in the compacted edges
    # list, so a duplicate that arrives later with a higher weight can
    # replace the earlier slot in place (mirrors Step 6's
    # `weight > existing.weight` rule — without this, a 0.3-weight edge
    # from batch 1 would silently outrank a 0.9-weight edge from batch 2
    # because Step 6 only ever sees one of them).
    # `swapped_pairs` records which surviving pairs came from a flipped
    # edge, so the `swapped` counter reflects the FINAL output and
    # doesn't double-count work done on edges that were later replaced.
    covered: set[tuple[str, str]] = set()
    pair_to_idx: dict[tuple[str, str], int] = {}
    swapped_pairs: set[tuple[str, str]] = set()
    dropped = 0
    write_idx = 0
    for edge in edges:
        if edge.get("type") != "tested_by":
            edges[write_idx] = edge
            write_idx += 1
            continue

        src = edge.get("source", "")
        tgt = edge.get("target", "")
        src_class = node_id_to_classification.get(src)
        tgt_class = node_id_to_classification.get(tgt)

        # Both endpoints must be known file nodes; one test, one production.
        # Anything else (orphan, test↔test, prod↔prod, non-file endpoint)
        # has no recoverable meaning — drop it.
        if (src_class, tgt_class) == ("prod", "test"):
            pair = (src, tgt)
            needs_swap = False
        elif (src_class, tgt_class) == ("test", "prod"):
            pair = (tgt, src)
            needs_swap = True
        else:
            dropped += 1
            continue

        if pair in covered:
            # Duplicate pair: keep the heavier-weight edge (mirrors the
            # weight-aware dedup in Step 6, which can't help here because
            # only one of the duplicates would reach it).
            existing_idx = pair_to_idx[pair]
            existing = edges[existing_idx]
            if _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
                # Heavier — replace existing slot. Apply the swap (or not)
                # only on the survivor, so we never spend cycles canonicalizing
                # an edge we're about to drop.
                if needs_swap:
                    _swap_tested_by_in_place(edge, src, tgt)
                    swapped_pairs.add(pair)
                else:
                    # Replacement is canonical — if the previous winner came
                    # from a swap, the surviving slot is no longer a swap.
                    swapped_pairs.discard(pair)
                edges[existing_idx] = edge
            # else: existing is heavier or equal — keep it, drop the new edge.
            dropped += 1
            continue

        if needs_swap:
            _swap_tested_by_in_place(edge, src, tgt)
            swapped_pairs.add(pair)
        covered.add(pair)
        pair_to_idx[pair] = write_idx
        edges[write_idx] = edge
        write_idx += 1
    del edges[write_idx:]
    swapped = len(swapped_pairs)

    # ── Pass 2: path-convention supplement for tests not yet paired.
    paired_test_ids = {test_id for (_prod_id, test_id) in covered}
    added = 0
    for test_path, test_node in test_nodes:
        if test_node["id"] in paired_test_ids:
            continue
        for cand_path in production_candidates(test_path):
            prod_node = file_paths_to_nodes.get(cand_path)
            if prod_node is None:
                continue
            if is_test_path(cand_path):
                # Don't link a test to another test even if naming aligns.
                continue
            pair = (prod_node["id"], test_node["id"])
            if pair in covered:
                continue
            edges.append({
                "source": prod_node["id"],
                "target": test_node["id"],
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
                "description": "Path-based pairing (deterministic)",
            })
            covered.add(pair)
            added += 1
            break

    # ── Tag every production node that ended up sourcing a tested_by edge
    # (covers Pass 1 canonical + swapped + Pass 2 supplements in one place).
    tagged = 0
    for prod_id, _test_id in covered:
        prod_node = nodes_by_id.get(prod_id)
        if prod_node is None:
            continue
        if _ensure_tested_tag(prod_node):
            tagged += 1

    return added, dropped, tagged, swapped


# ── Main merge + normalize ────────────────────────────────────────────────

def merge_and_normalize(
    batches: list[dict[str, Any]],
    extraction_results: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Merge batch results and normalize. Returns (assembled_graph, report_lines)."""

    # ── Pattern counters for "Fixed" report ──────────────────────────
    id_fix_patterns: Counter[str] = Counter()
    complexity_fix_patterns: Counter[str] = Counter()

    # ── Detail lists for "Could not fix" report ──────────────────────
    unfixable: list[str] = []

    # ── Step 1: Combine all nodes and edges ──────────────────────────
    all_nodes: list[dict] = []
    all_edges: list[dict] = []
    for batch in batches:
        all_nodes.extend(batch.get("nodes", []))
        all_edges.extend(batch.get("edges", []))

    total_input_nodes = len(all_nodes)
    total_input_edges = len(all_edges)

    # ── Step 2: Normalize node IDs and build ID mapping ──────────────
    id_mapping: dict[str, str] = {}  # original → corrected
    nodes_with_ids: list[dict] = []
    unknown_node_types: Counter[str] = Counter()

    for i, node in enumerate(all_nodes):
        original_id = node.get("id")
        if not original_id:
            unfixable.append(f"Node[{i}] has no 'id' field (name={node.get('name', '?')}, type={node.get('type', '?')})")
            continue

        # Flag unknown node types
        node_type = node.get("type", "")
        if node_type and node_type not in TYPE_TO_PREFIX:
            unknown_node_types[node_type] += 1

        nodes_with_ids.append(node)
        corrected_id = normalize_node_id(original_id, node)
        if corrected_id != original_id:
            pattern = classify_id_fix(original_id, corrected_id)
            id_fix_patterns[pattern] += 1
            id_mapping[original_id] = corrected_id
            node["id"] = corrected_id

    # ── Step 3: Normalize complexity ─────────────────────────────────
    complexity_unknown_patterns: Counter[str] = Counter()

    for node in nodes_with_ids:
        original = node.get("complexity")
        normalized, status = normalize_complexity(original)

        if status == "mapped":
            orig_repr = repr(original) if not isinstance(original, str) else f'"{original}"'
            complexity_fix_patterns[f"{orig_repr} → \"{normalized}\""] += 1
        elif status == "unknown":
            orig_repr = repr(original) if not isinstance(original, str) else f'"{original}"'
            complexity_unknown_patterns[f"complexity {orig_repr} → defaulted to \"moderate\""] += 1

        node["complexity"] = normalized

    # ── Step 4: Rewrite edge references ──────────────────────────────
    edges_rewritten = 0
    for edge in all_edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        new_src = id_mapping.get(src, src)
        new_tgt = id_mapping.get(tgt, tgt)
        if new_src != src or new_tgt != tgt:
            edges_rewritten += 1
            edge["source"] = new_src
            edge["target"] = new_tgt

    # ── Step 5: Deduplicate nodes by ID (keep last) ─────────────────
    duplicate_count = 0
    nodes_by_id: dict[str, dict] = {}
    for node in nodes_with_ids:
        nid = node.get("id", "")
        if nid in nodes_by_id:
            duplicate_count += 1
        nodes_by_id[nid] = node

    # ── Step 5b: Deterministic Python call linker ────────────────────
    python_calls_added, python_calls_skipped = link_python_calls(
        nodes_by_id, all_edges, extraction_results or []
    )

    # ── Step 5c: Deterministic tested_by linker ──────────────────────
    # See module-level "Deterministic tested_by linker" section above.
    tested_by_added, tested_by_dropped, tested_by_tagged, tested_by_swapped = link_tests(
        nodes_by_id, all_edges
    )

    # ── Step 6: Deduplicate edges, drop dangling ─────────────────────
    node_ids = set(nodes_by_id.keys())
    # Direction is part of the dedup key so a `forward` edge does not silently
    # overwrite a `bidirectional` one (or vice versa); they're different
    # semantic relationships that the dashboard renders distinctly.
    edges_by_key: dict[tuple[str, str, str, str], dict] = {}
    for edge in all_edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        etype = edge.get("type", "")
        direction = normalize_direction(edge.get("direction"))
        edge["direction"] = direction

        if src not in node_ids or tgt not in node_ids:
            missing = []
            if src not in node_ids:
                missing.append(f"source '{src}'")
            if tgt not in node_ids:
                missing.append(f"target '{tgt}'")
            unfixable.append(f"Edge {src} → {tgt} ({etype}): dropped, missing {', '.join(missing)}")
            continue

        key = (src, tgt, etype, direction)
        existing = edges_by_key.get(key)
        if existing is None or _num(edge.get("weight", 0)) > _num(existing.get("weight", 0)):
            edges_by_key[key] = edge

    # ── Build report ─────────────────────────────────────────────────
    report: list[str] = []
    report.append(f"Input: {total_input_nodes} nodes, {total_input_edges} edges")

    # Fixed section — grouped by pattern
    fixed_lines: list[str] = []
    if id_fix_patterns:
        for pattern, count in id_fix_patterns.most_common():
            fixed_lines.append(f"  {count:>4} × {pattern}")
    if complexity_fix_patterns:
        for pattern, count in complexity_fix_patterns.most_common():
            fixed_lines.append(f"  {count:>4} × complexity {pattern}")
    if edges_rewritten:
        fixed_lines.append(f"  {edges_rewritten:>4} × edge references rewritten after ID normalization")
    if duplicate_count:
        fixed_lines.append(f"  {duplicate_count:>4} × duplicate node IDs removed (kept last)")
    if tested_by_swapped:
        fixed_lines.append(f"  {tested_by_swapped:>4} × tested_by edges flipped (test → production became production → test)")
    if tested_by_dropped:
        fixed_lines.append(f"  {tested_by_dropped:>4} × tested_by edges dropped (orphan endpoint or test↔test / prod↔prod pair)")

    if fixed_lines:
        report.append("")
        total_fixes = (
            sum(id_fix_patterns.values())
            + sum(complexity_fix_patterns.values())
            + edges_rewritten
            + duplicate_count
            + tested_by_swapped
            + tested_by_dropped
        )
        report.append(f"Fixed ({total_fixes} corrections):")
        report.extend(fixed_lines)

    # Tested-by linker section — separate from Fixed since these are net-new
    # additions, not corrections.
    if tested_by_added or tested_by_tagged:
        report.append("")
        report.append("Tested-by linker:")
        report.append(f"  {tested_by_added:>4} × tested_by edges produced (path-convention supplement, production → test)")
        report.append(f"  {tested_by_tagged:>4} × production nodes tagged \"tested\"")

    report.append("")
    report.append("Python call linker:")
    report.append(f"  {python_calls_added:>4} × calls edges produced")
    report.append(
        f"  {python_calls_skipped:>4} × unresolved or ambiguous calls skipped"
    )

    # Could not fix section — unknown patterns (grouped) + individual details
    unfixable_total = (
        len(unfixable)
        + sum(complexity_unknown_patterns.values())
        + sum(unknown_node_types.values())
    )
    if unfixable_total:
        report.append("")
        report.append(f"Could not fix ({unfixable_total} issues — needs agent review):")
        # Unknown node types (grouped by count)
        for ntype, count in unknown_node_types.most_common():
            report.append(f"  {count:>4} × unknown node type \"{ntype}\" (not in schema, kept as-is)")
        # Unknown complexity patterns (grouped by count)
        for pattern, count in complexity_unknown_patterns.most_common():
            report.append(f"  {count:>4} × {pattern}")
        # Individual unfixable items
        for detail in unfixable:
            report.append(f"  - {detail}")

    # Output stats
    report.append("")
    report.append(f"Output: {len(nodes_by_id)} nodes, {len(edges_by_key)} edges")

    assembled = {
        "nodes": list(nodes_by_id.values()),
        "edges": list(edges_by_key.values()),
    }

    return assembled, report


# ── Imports-edge recovery from importMap ──────────────────────────────────

def recover_imports_from_scan(
    assembled: dict[str, Any],
    scan_result_path: Path,
) -> tuple[int, list[str]]:
    """Re-emit any `imports` edges that exist in `scan-result.json#importMap`
    but never made it into a batch's output. The project-scanner's importMap
    is the deterministic source of truth for resolved internal imports;
    file-analyzer agents are expected to transcribe those into edges 1:1
    but in practice drop ~25% of them on real projects (orchestrator-side
    batch construction loses entries, agent-side enumeration drops more).

    Returns (recovered_count, report_lines).
    """
    if not scan_result_path.is_file():
        return 0, [f"  importMap recovery skipped — {scan_result_path.name} not found"]

    try:
        scan = json.loads(scan_result_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return 0, [f"  importMap recovery skipped — could not parse {scan_result_path.name}: {e}"]

    import_map = scan.get("importMap")
    if not isinstance(import_map, dict):
        return 0, [f"  importMap recovery skipped — no importMap field in {scan_result_path.name}"]

    # Build the set of file: node ids actually present in the assembled graph.
    file_node_ids: set[str] = set()
    for node in assembled["nodes"]:
        if node.get("type") == "file":
            file_node_ids.add(node.get("id", ""))

    # Build the set of (source, target) imports edges already present.
    existing: set[tuple[str, str]] = set()
    for edge in assembled["edges"]:
        if edge.get("type") == "imports":
            existing.add((edge.get("source", ""), edge.get("target", "")))

    recovered = 0
    skipped_no_src_node = 0
    skipped_no_tgt_node = 0
    for src_path, targets in import_map.items():
        if not isinstance(targets, list):
            continue
        src_id = f"file:{src_path}"
        if src_id not in file_node_ids:
            if targets:
                skipped_no_src_node += 1
            continue
        for tgt_path in targets:
            if not isinstance(tgt_path, str) or not tgt_path:
                continue
            tgt_id = f"file:{tgt_path}"
            if tgt_id not in file_node_ids:
                skipped_no_tgt_node += 1
                continue
            if src_id == tgt_id:
                continue
            if (src_id, tgt_id) in existing:
                continue
            assembled["edges"].append({
                "source": src_id,
                "target": tgt_id,
                "type": "imports",
                "direction": "forward",
                "weight": 0.7,
                "recoveredFromImportMap": True,
            })
            existing.add((src_id, tgt_id))
            recovered += 1

    lines: list[str] = []
    lines.append(
        f"  Recovered {recovered} `imports` edges from importMap "
        f"({len(import_map)} entries scanned)"
    )
    if skipped_no_src_node:
        lines.append(
            f"  Skipped {skipped_no_src_node} importMap source files "
            f"with no `file:` node in graph"
        )
    if skipped_no_tgt_node:
        lines.append(
            f"  Skipped {skipped_no_tgt_node} importMap target paths "
            f"with no `file:` node in graph"
        )
    return recovered, lines


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python merge-batch-graphs.py <project-root>", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    intermediate_dir = resolve_ua_dir(project_root) / "intermediate"

    if not intermediate_dir.is_dir():
        print(f"Error: {intermediate_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    # Discover batch files, sorted by numeric index (not lexicographic).
    # `batch-existing.json` is the documented incremental baseline and must
    # sort before fresh batches so fresh duplicate nodes/edges win later.
    batch_files = sorted(
        intermediate_dir.glob("batch-*.json"),
        key=batch_sort_key,
    )
    if not batch_files:
        print("Error: no batch-*.json files found in intermediate/", file=sys.stderr)
        sys.exit(1)

    # Group by logical batch index so the report distinguishes single-batch
    # files from multi-part file-analyzer outputs. Files that don't match the
    # `batch-existing.json` / `batch-<N>.json` / `batch-<N>-part-<K>.json`
    # pattern (e.g. fused `batch-fused-8-13.json`, range `batch-8-13.json`)
    # would otherwise be silently dropped during load — flag them loudly
    # instead so the user can fix the file-analyzer agent.
    from collections import defaultdict as _dd
    by_batch = _dd(list)
    unrecognized_batch_files: list[str] = []
    for f in batch_files:
        parsed = parse_batch_filename(f.name)
        if parsed is None:
            unrecognized_batch_files.append(f.name)
        else:
            batch_index, part_number = parsed
            by_batch[batch_index].append((f.name, part_number))

    if unrecognized_batch_files:
        preview = ", ".join(unrecognized_batch_files[:5])
        suffix = (
            f" (+{len(unrecognized_batch_files) - 5} more)"
            if len(unrecognized_batch_files) > 5
            else ""
        )
        print(
            f"Warning: merge-batch-graphs: {len(unrecognized_batch_files)} "
            f"batch file(s) with unrecognized filenames will be DROPPED — "
            f"files: {preview}{suffix} — fix the file-analyzer agent to use "
            f"only batch-<N>.json or batch-<N>-part-<K>.json patterns",
            file=sys.stderr,
        )

    logical_count = len(by_batch)
    multi_part = sum(1 for entries in by_batch.values() if len(entries) > 1)
    print(
        f"Found {len(batch_files)} batch files "
        f"({logical_count} logical batches, {multi_part} multi-part):",
        file=sys.stderr,
    )

    # Missing-part detection: for any logical batch with parts (len > 1), the
    # set of part numbers MUST be contiguous starting at 1. Gaps suggest a
    # truncated write — emit a visible warning so the user can investigate.
    # Collect into `missing_part_warnings` so they also surface in the final
    # phase report; stderr alone gets buried under the per-batch load lines.
    missing_part_warnings: list[str] = []
    for idx, entries in by_batch.items():
        part_nums = [p for (_n, p) in entries if p is not None]
        if not part_nums:
            continue
        present = set(part_nums)
        expected = set(range(1, max(part_nums) + 1))
        missing = sorted(expected - present)
        if missing:
            msg = (
                f"batch {idx} has parts {sorted(present)} but "
                f"missing part {missing} — possible truncated write — "
                f"affected nodes/edges may be lost"
            )
            print(f"Warning: merge: {msg}", file=sys.stderr)
            missing_part_warnings.append(msg)

    # Load batches — skip unrecognized filenames so they don't pollute the
    # merged graph with content the agent labeled incorrectly.
    unrecognized_set = set(unrecognized_batch_files)
    batches: list[dict[str, Any]] = []
    empty_batch_warnings: list[str] = []
    for f in batch_files:
        if f.name in unrecognized_set:
            continue
        batch = load_batch(f)
        if batch is not None:
            batches.append(batch)
            n = len(batch.get("nodes", []))
            e = len(batch.get("edges", []))
            print(f"  {f.name}: {n} nodes, {e} edges", file=sys.stderr)
            # A file that parses but contributes nothing is how a silent
            # partial merge looks from the outside (see #484) — flag it
            # loudly instead of relying on a downstream reviewer to notice.
            if n == 0 and e == 0:
                msg = (
                    f"{f.name} loaded but contributed 0 nodes and 0 edges — "
                    f"either the analyzer wrote an empty batch or the file "
                    f"was read mid-write; inspect it directly"
                )
                print(f"  Warning: {msg}", file=sys.stderr)
                empty_batch_warnings.append(msg)

    if not batches:
        print("Error: no valid batch files loaded", file=sys.stderr)
        sys.exit(1)

    # Merge and normalize
    ua_dir = resolve_ua_dir(project_root)
    extraction_results, extraction_report = load_python_extraction_results(ua_dir)
    assembled, report = merge_and_normalize(batches, extraction_results)
    if extraction_report:
        report.extend(extraction_report)

    # Surface missing multi-part files to the phase report (parallel to
    # unrecognized-filename handling below). Stderr lines emitted during
    # batch discovery get buried under per-batch load output — re-emitting
    # via the report list ensures the Phase 4 review and final summary see
    # the data-loss signal.
    if missing_part_warnings:
        report.append("")
        report.append(
            f"Warning: {len(missing_part_warnings)} batch(es) with missing parts "
            f"— some nodes/edges silently dropped:"
        )
        for w in missing_part_warnings:
            report.append(f"  - {w}")

    # Surface empty-contribution batches to the phase report (same rationale
    # as missing_part_warnings above — stderr alone gets buried).
    if empty_batch_warnings:
        report.append("")
        report.append(
            f"Warning: {len(empty_batch_warnings)} batch file(s) loaded but "
            f"contributed no nodes or edges:"
        )
        for w in empty_batch_warnings:
            report.append(f"  - {w}")

    # Surface unrecognized-filename drops to the phase report so the
    # downstream review step sees them, not just stderr.
    if unrecognized_batch_files:
        preview = ", ".join(unrecognized_batch_files[:5])
        suffix = (
            f" (+{len(unrecognized_batch_files) - 5} more)"
            if len(unrecognized_batch_files) > 5
            else ""
        )
        report.append("")
        report.append(
            f"Warning: dropped {len(unrecognized_batch_files)} batch file(s) "
            f"with unrecognized filenames — files: {preview}{suffix} — "
            f"fix the file-analyzer agent to use only batch-<N>.json or "
            f"batch-<N>-part-<K>.json patterns (every node/edge in these "
            f"files was excluded from the final graph)"
        )

    # Recover any imports edges file-analyzer batches dropped despite
    # `batchImportData` containing them. The project-scanner's importMap
    # is the deterministic source of truth.
    scan_result_path = intermediate_dir / "scan-result.json"
    recovered, recovery_report = recover_imports_from_scan(assembled, scan_result_path)
    if recovery_report:
        report.append("")
        report.append("Imports edge recovery:")
        report.extend(recovery_report)

    # Print report
    print("", file=sys.stderr)
    for line in report:
        print(line, file=sys.stderr)

    # Write output
    output_path = intermediate_dir / "assembled-graph.json"
    output_path.write_text(json.dumps(assembled, indent=2, ensure_ascii=False), encoding="utf-8")

    size_kb = output_path.stat().st_size / 1024
    print(f"\nWritten to {output_path} ({size_kb:.0f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
extract-domain-context.py — Lightweight codebase scanner for domain knowledge extraction.

Scans a project directory and produces a structured JSON context file that the
domain-analyzer agent uses to identify business domains, flows, and steps.

Usage:
    python extract-domain-context.py <project-root>

Output:
    <project-root>/.understand-anything/intermediate/domain-context.json
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# ── Configuration ──────────────────────────────────────────────────────────

MAX_FILE_TREE_DEPTH = 6
MAX_FILES_PER_DIR = 50
MAX_FILES_TOTAL = 5000
MAX_SAMPLED_FILES = 40
MAX_LINES_PER_FILE = 80
MAX_ENTRY_POINTS = 200
MAX_OUTPUT_BYTES = 512 * 1024  # 512 KB — keeps output within agent context limits

# File extensions we care about for domain analysis
SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".pyi",
    ".go",
    ".rs",
    ".java", ".kt", ".scala",
    ".rb",
    ".cs",
    ".php",
    ".swift",
    ".c", ".cpp", ".h", ".hpp",
    ".ex", ".exs",
    ".hs",
    ".lua",
    ".r", ".R",
}

# Directories to always skip
SKIP_DIRS = {
    "node_modules", ".git", ".svn", ".hg", "__pycache__", ".tox",
    "venv", ".venv", "env", ".env", "dist", "build", "out", ".next",
    ".nuxt", "target", "vendor", ".idea", ".vscode", "coverage",
    ".understand-anything", ".pytest_cache", ".mypy_cache",
    "Pods", "DerivedData", ".gradle", "bin", "obj",
}

# Files that reveal project metadata
METADATA_FILES = [
    "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
    "setup.py", "setup.cfg", "pom.xml", "build.gradle",
    "Gemfile", "composer.json", "mix.exs", "Makefile",
    "docker-compose.yml", "docker-compose.yaml",
    "README.md", "README.rst", "README.txt", "README",
]

# ── Entry point detection patterns ─────────────────────────────────────────

ENTRY_POINT_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    # HTTP routes
    ("http", "Express/Koa route", re.compile(
        r"""(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete|all|use)\s*\(\s*['"](/[^'"]*?)['"]""",
        re.IGNORECASE,
    )),
    ("http", "Decorator route (Flask/FastAPI/NestJS)", re.compile(
        r"""@(?:app\.)?(?:route|get|post|put|patch|delete|api_view|RequestMapping|GetMapping|PostMapping)\s*\(\s*['"](/[^'"]*?)['"]""",
        re.IGNORECASE,
    )),
    ("http", "Next.js/Remix route handler", re.compile(
        r"""export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b""",
    )),
    # CLI
    ("cli", "CLI command", re.compile(
        r"""\.command\s*\(\s*['"]([\w\-:]+)['"]""",
    )),
    ("cli", "argparse subparser", re.compile(
        r"""add_parser\s*\(\s*['"]([\w\-]+)['"]""",
    )),
    # Event handlers
    ("event", "Event listener", re.compile(
        r"""\.on\s*\(\s*['"]([\w\-:.]+)['"]""",
    )),
    ("event", "Event subscriber decorator", re.compile(
        r"""@(?:EventHandler|Subscribe|Listener|on_event)\s*\(\s*['"]([\w\-:.]+)['"]""",
    )),
    # Cron / scheduled
    ("cron", "Cron schedule", re.compile(
        r"""@?(?:Cron|Schedule|Scheduled|crontab)\s*\(\s*['"]([^'"]+)['"]""",
        re.IGNORECASE,
    )),
    # GraphQL
    ("http", "GraphQL resolver", re.compile(
        r"""@(?:Query|Mutation|Subscription|Resolver)\s*\(""",
    )),
    # gRPC (only in .proto files — handled by file extension check below)
    ("http", "gRPC service", re.compile(
        r"""^service\s+(\w+)\s*\{""", re.MULTILINE,
    )),
    # Exported handlers (generic)
    ("manual", "Exported handler", re.compile(
        r"""export\s+(?:async\s+)?function\s+(handle\w+|process\w+|on\w+)\b""",
    )),
]


# ── Gitignore support ──────────────────────────────────────────────────────

def parse_gitignore(project_root: Path) -> list[re.Pattern[str]]:
    """Parse .gitignore into a list of compiled regex patterns."""
    gitignore = project_root / ".gitignore"
    patterns: list[re.Pattern[str]] = []
    if not gitignore.exists():
        return patterns

    for line in gitignore.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Convert glob to regex (simplified)
        regex = line.replace(".", r"\.").replace("**/", "(.*/)?").replace("*", "[^/]*").replace("?", "[^/]")
        if line.endswith("/"):
            regex = regex.rstrip("/") + "(/|$)"
        try:
            patterns.append(re.compile(regex))
        except re.error as e:
            print(f"Warning: skipping invalid gitignore pattern '{line}': {e}", file=sys.stderr)
    return patterns


def is_ignored(rel_path: str, gitignore_patterns: list[re.Pattern[str]]) -> bool:
    """Check if a relative path matches any gitignore pattern."""
    for pattern in gitignore_patterns:
        if pattern.search(rel_path):
            return True
    return False


# ── File tree scanner ──────────────────────────────────────────────────────

def scan_file_tree(
    root: Path,
    gitignore_patterns: list[re.Pattern[str]],
    max_depth: int = MAX_FILE_TREE_DEPTH,
) -> list[str]:
    """Return a flat list of relative file paths (source files only)."""
    result: list[str] = []

    def _walk(dir_path: Path, depth: int) -> None:
        if depth > max_depth or len(result) >= MAX_FILES_TOTAL:
            return
        try:
            entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        file_count = 0
        for entry in entries:
            if len(result) >= MAX_FILES_TOTAL:
                break
            # Skip symlinks to avoid infinite loops
            if entry.is_symlink():
                continue
            rel = str(entry.relative_to(root))
            if entry.is_dir():
                if entry.name in SKIP_DIRS:
                    continue
                if is_ignored(rel + "/", gitignore_patterns):
                    continue
                _walk(entry, depth + 1)
            elif entry.is_file():
                if file_count >= MAX_FILES_PER_DIR:
                    break
                if entry.suffix not in SOURCE_EXTENSIONS:
                    continue
                if is_ignored(rel, gitignore_patterns):
                    continue
                result.append(rel)
                file_count += 1

    _walk(root, 0)
    return result


# ── Entry point detection ──────────────────────────────────────────────────

def detect_entry_points(root: Path, file_paths: list[str]) -> list[dict[str, Any]]:
    """Scan source files for entry point patterns."""
    entry_points: list[dict[str, Any]] = []

    # Skip test files and the extraction script itself
    test_patterns = re.compile(r"(?:\.test\.|\.spec\.|__tests__|_test\.py|test_\w+\.py|extract-domain-context\.py)")

    for rel_path in file_paths:
        if len(entry_points) >= MAX_ENTRY_POINTS:
            break
        if test_patterns.search(rel_path):
            continue
        full_path = root / rel_path
        try:
            content = full_path.read_text(errors="replace")
        except (OSError, UnicodeDecodeError):
            continue

        lines = content.splitlines()
        for entry_type, description, pattern in ENTRY_POINT_PATTERNS:
            for match in pattern.finditer(content):
                # Find line number
                line_no = content[:match.start()].count("\n") + 1
                # Extract a snippet (signature + a few lines)
                start = max(0, line_no - 1)
                end = min(len(lines), start + 5)
                snippet = "\n".join(lines[start:end])

                entry_points.append({
                    "file": rel_path,
                    "line": line_no,
                    "type": entry_type,
                    "description": description,
                    "match": match.group(0)[:120],
                    "snippet": snippet[:300],
                })

                if len(entry_points) >= MAX_ENTRY_POINTS:
                    break
            if len(entry_points) >= MAX_ENTRY_POINTS:
                break

    return entry_points


# ── File signatures ────────────────────────────────────────────────────────

def extract_file_signatures(root: Path, file_paths: list[str]) -> list[dict[str, Any]]:
    """Extract exports and imports from each file (lightweight)."""
    signatures: list[dict[str, Any]] = []

    # Prioritize files likely to contain business logic
    priority_keywords = [
        "controller", "service", "handler", "router", "route", "api",
        "model", "entity", "repository", "usecase", "use_case",
        "command", "query", "event", "subscriber", "listener",
        "middleware", "guard", "interceptor", "resolver",
        "workflow", "flow", "process", "pipeline", "job", "task",
    ]

    def priority_score(path: str) -> int:
        lower = path.lower()
        score = 0
        for kw in priority_keywords:
            if kw in lower:
                score += 1
        return score

    sorted_paths = sorted(file_paths, key=priority_score, reverse=True)

    for rel_path in sorted_paths[:MAX_SAMPLED_FILES]:
        full_path = root / rel_path
        try:
            content = full_path.read_text(errors="replace")
        except (OSError, UnicodeDecodeError):
            continue

        lines = content.splitlines()[:MAX_LINES_PER_FILE]
        truncated = "\n".join(lines)

        # Extract exports (JS/TS)
        exports = re.findall(
            r"export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)",
            truncated,
        )
        # Extract exports (Python)
        if not exports:
            exports = re.findall(r"^(?:def|class)\s+(\w+)", truncated, re.MULTILINE)

        # Extract imports (first 20)
        imports = re.findall(
            r"""(?:import\s+.*?from\s+['"]([^'"]+)['"]|from\s+([\w.]+)\s+import)""",
            truncated,
        )
        import_list = [m[0] or m[1] for m in imports][:20]

        signatures.append({
            "file": rel_path,
            "exports": exports[:20],
            "imports": import_list,
            "lines": len(content.splitlines()),
            "preview": truncated[:500],
        })

    return signatures


# ── Metadata extraction ────────────────────────────────────────────────────

def extract_metadata(root: Path) -> dict[str, Any]:
    """Read project metadata files."""
    metadata: dict[str, Any] = {}

    for filename in METADATA_FILES:
        filepath = root / filename
        if not filepath.exists():
            continue
        try:
            content = filepath.read_text(errors="replace")
        except (OSError, UnicodeDecodeError):
            continue

        if filename == "package.json":
            try:
                pkg = json.loads(content)
                metadata["package.json"] = {
                    "name": pkg.get("name"),
                    "description": pkg.get("description"),
                    "scripts": list((pkg.get("scripts") or {}).keys()),
                    "dependencies": list((pkg.get("dependencies") or {}).keys()),
                    "devDependencies": list((pkg.get("devDependencies") or {}).keys()),
                }
            except json.JSONDecodeError:
                metadata["package.json"] = content[:500]
        elif filename.endswith((".md", ".rst", ".txt")) or filename == "README":
            metadata[filename] = content[:2000]
        elif filename.endswith((".toml", ".cfg", ".mod")):
            metadata[filename] = content[:1000]
        elif filename.endswith((".json", ".yml", ".yaml", ".xml", ".gradle")):
            metadata[filename] = content[:1000]

    return metadata


# ── Main ───────────────────────────────────────────────────────────────────

def _truncate_to_fit(context: dict[str, Any]) -> dict[str, Any]:
    """Progressively trim context sections to stay under MAX_OUTPUT_BYTES."""
    output = json.dumps(context, indent=2)
    if len(output.encode()) <= MAX_OUTPUT_BYTES:
        return context

    # 1. Trim file tree to just a count
    context["fileTree"] = context["fileTree"][:200]
    output = json.dumps(context, indent=2)
    if len(output.encode()) <= MAX_OUTPUT_BYTES:
        return context

    # 2. Trim previews in signatures
    for sig in context.get("fileSignatures", []):
        sig["preview"] = sig["preview"][:200]
    output = json.dumps(context, indent=2)
    if len(output.encode()) <= MAX_OUTPUT_BYTES:
        return context

    # 3. Trim snippets in entry points
    for ep in context.get("entryPoints", []):
        ep["snippet"] = ep["snippet"][:100]
    output = json.dumps(context, indent=2)
    if len(output.encode()) <= MAX_OUTPUT_BYTES:
        return context

    # 4. Reduce number of signatures and entry points
    context["fileSignatures"] = context["fileSignatures"][:20]
    context["entryPoints"] = context["entryPoints"][:100]

    return context


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python extract-domain-context.py <project-root>", file=sys.stderr)
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    if not project_root.is_dir():
        print(f"Error: {project_root} is not a directory", file=sys.stderr)
        sys.exit(1)

    try:
        # Ensure output directory exists
        output_dir = project_root / ".understand-anything" / "intermediate"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "domain-context.json"

        print(f"Scanning {project_root} ...", file=sys.stderr)

        gitignore_patterns = parse_gitignore(project_root)
        file_tree = scan_file_tree(project_root, gitignore_patterns)
        print(f"  Found {len(file_tree)} source files", file=sys.stderr)

        entry_points = detect_entry_points(project_root, file_tree)
        print(f"  Detected {len(entry_points)} entry points", file=sys.stderr)

        signatures = extract_file_signatures(project_root, file_tree)
        print(f"  Extracted {len(signatures)} file signatures", file=sys.stderr)

        metadata = extract_metadata(project_root)
        print(f"  Read {len(metadata)} metadata files", file=sys.stderr)

        context = {
            "projectRoot": str(project_root),
            "fileCount": len(file_tree),
            "fileTree": file_tree,
            "entryPoints": entry_points,
            "fileSignatures": signatures,
            "metadata": metadata,
        }

        context = _truncate_to_fit(context)
        output = json.dumps(context, indent=2)
        output_path.write_text(output)
        size_kb = len(output.encode()) / 1024
        print(f"  Wrote {output_path} ({size_kb:.0f} KB)", file=sys.stderr)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

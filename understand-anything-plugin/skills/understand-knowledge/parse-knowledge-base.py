#!/usr/bin/env python3
"""
Deterministic parser for Karpathy-pattern LLM wikis.

Detects the three-layer pattern (raw sources + wiki markdown + schema),
extracts structure from markdown files, resolves wikilinks, and derives
categories from index.md section headings.

Usage:
    python parse-knowledge-base.py <wiki-directory>

Output:
    Writes scan-manifest.json to <wiki-directory>/.understand-anything/intermediate/
"""

import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
# CommonMark inline link: [label](target).
#   - `(?<!\!)` skips image links `![alt](src)`.
#   - The label `[label]` may not contain `]`.
#   - The target `(...)` may not contain whitespace or `)` — covers the
#     overwhelming majority of links found in wiki markdown. Title text
#     (e.g. `[a](b "t")`) is not extracted here; we only use the target.
MD_LINK_RE = re.compile(r"(?<!\!)\[([^\]]+)\]\(([^)\s]+)\)")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
CODE_BLOCK_RE = re.compile(r"```(\w*)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
INDEX_SECTION_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)
# Schemes / fragments that mark a markdown-link target as non-page:
# external URLs (http, mailto…), anchors (#section), and explicit non-md
# resource refs are filtered by the `is_internal_md_target` helper.
_URL_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+\-.]*:")

# Files that are part of wiki infrastructure, not content articles
INFRA_FILES = {"index.md", "log.md", "claude.md", "agents.md", "soul.md"}

# ---------------------------------------------------------------------------
# Detection: is this a Karpathy-pattern wiki?
# ---------------------------------------------------------------------------

def detect_format(root: Path) -> dict:
    """Detect if directory follows the Karpathy LLM wiki three-layer pattern."""
    signals = {
        "has_index": (root / "index.md").is_file() or (root / "wiki" / "index.md").is_file(),
        "has_log": (root / "log.md").is_file() or (root / "wiki" / "log.md").is_file(),
        "has_raw": (root / "raw").is_dir(),
        "has_schema": any(
            (root / f).is_file() or (root / "wiki" / f).is_file()
            for f in ["CLAUDE.md", "AGENTS.md"]
        ),
    }

    # Find the wiki root — could be the directory itself or a wiki/ subdirectory
    if (root / "wiki").is_dir():
        wiki_root = root / "wiki"
    else:
        wiki_root = root

    # Count markdown files in the wiki root
    md_files = list(wiki_root.rglob("*.md"))
    signals["md_count"] = len(md_files)
    signals["wiki_root"] = str(wiki_root)

    # Primary signal: has index.md + meaningful number of markdown files
    if signals["has_index"] and signals["md_count"] >= 3:
        signals["detected"] = True
        signals["format"] = "karpathy"
    else:
        signals["detected"] = False
        signals["format"] = "unknown"

    return signals


# ---------------------------------------------------------------------------
# Markdown extraction helpers
# ---------------------------------------------------------------------------

def extract_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter as a simple key-value dict."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip().strip('"').strip("'")
    return fm


def extract_wikilinks(text: str) -> list[dict]:
    """Extract all [[target]] and [[target|display]] wikilinks."""
    links = []
    for m in WIKILINK_RE.finditer(text):
        links.append({
            "target": m.group(1).strip(),
            "display": m.group(2).strip() if m.group(2) else None,
        })
    return links


def is_internal_md_target(target: str) -> bool:
    """Return True if a markdown-link target points at an internal .md page.

    Filters out external URLs (http://, mailto:, etc.), bare anchors
    (`#section`), and explicit non-markdown asset paths. Targets without a
    `.md` extension are rejected — this parser only links between pages.
    """
    if not target:
        return False
    t = target.strip()
    if not t:
        return False
    # Pure anchor inside the current document — not a page link.
    if t.startswith("#"):
        return False
    # External / scheme-prefixed URLs (http://, https://, mailto:, ftp:, …).
    if _URL_SCHEME_RE.match(t):
        return False
    # Strip query / fragment for extension check.
    path_part = t.split("#", 1)[0].split("?", 1)[0]
    if not path_part:
        return False
    # Only resolve targets that point at a markdown file.
    return path_part.lower().endswith(".md")


def extract_md_links(text: str) -> list[dict]:
    """Extract CommonMark `[label](page.md)` links pointing at internal .md
    pages.

    Skips image links (`![]()`), external URLs, anchors, and non-markdown
    assets. Returned targets are raw (path-relative as written) — call
    `resolve_md_link` to map them to article IDs.

    Fenced code blocks are stripped before scanning so that a syntax-coloured
    example link inside ```` ```md ```` does not get treated as a real edge.
    """
    if not text:
        return []
    # Strip fenced code blocks before scanning. We can't reliably tell which
    # links inside a code fence are intentional, so we exclude them all —
    # mirrors how renderers display them as inert text.
    stripped = re.sub(r"```[\s\S]*?```", "", text)
    links = []
    for m in MD_LINK_RE.finditer(stripped):
        target = m.group(2).strip()
        if not is_internal_md_target(target):
            continue
        links.append({
            "target": target,
            "display": m.group(1).strip() or None,
        })
    return links


def extract_headings(text: str) -> list[dict]:
    """Extract all markdown headings with level and text."""
    return [
        {"level": len(m.group(1)), "text": m.group(2).strip()}
        for m in HEADING_RE.finditer(text)
    ]


def extract_code_blocks(text: str) -> list[str]:
    """Extract languages from fenced code blocks."""
    return [m.group(1) for m in CODE_BLOCK_RE.finditer(text) if m.group(1)]


def extract_first_paragraph(text: str) -> str:
    """Extract the first non-empty paragraph after frontmatter and H1."""
    # Strip frontmatter
    stripped = FRONTMATTER_RE.sub("", text).strip()
    if not stripped:
        return ""
    lines = stripped.split("\n")

    def _collect_paragraph(start_lines: list[str]) -> str:
        """Collect the first paragraph from the given lines."""
        para: list[str] = []
        for s_raw in start_lines:
            s = s_raw.strip()
            if not s and not para:
                continue  # Skip leading blank lines
            if not s and para:
                break  # End of paragraph
            if s.startswith(">"):
                continue  # Skip blockquotes
            if re.match(r"^[-*_]{3,}\s*$", s):
                continue  # Skip horizontal rules
            if s.startswith("#"):
                if para:
                    break  # End paragraph at next heading
                continue  # Skip headings before paragraph
            para.append(s)
        return " ".join(para)

    # Try: find first paragraph after H1
    for i, line in enumerate(lines):
        if line.strip().startswith("# "):
            result = _collect_paragraph(lines[i + 1:])
            if result:
                if len(result) > 200:
                    return result[:197] + "..."
                return result

    # Fallback: no H1 found, take first paragraph from start
    result = _collect_paragraph(lines)
    if len(result) > 200:
        result = result[:197] + "..."
    return result or ""


def extract_h1(text: str) -> str:
    """Extract the first H1 heading."""
    for m in HEADING_RE.finditer(text):
        if len(m.group(1)) == 1:
            # Strip trailing wiki-style decorations like " — subtitle"
            return m.group(2).strip()
    return ""


# ---------------------------------------------------------------------------
# Index.md parsing — categories come from section headings
# ---------------------------------------------------------------------------

def parse_index(index_path: Path) -> list[dict]:
    """Parse index.md to extract categories from ## headings and their links.

    Recognises both `[[wikilink]]` and CommonMark `[label](page.md)` styles
    under each `## Section` heading. Returns categories with two parallel
    target lists:

      - `articles`  — raw wikilink targets (stems or filenames), kept as
        strings for backward compatibility with existing call sites.
      - `md_links`  — raw CommonMark link targets (relative paths) that need
        path-based resolution.

    The two lists are populated independently so a wiki that uses only one
    syntax (or both) keeps working.
    """
    if not index_path.is_file():
        return []
    text = index_path.read_text(encoding="utf-8", errors="replace")
    categories = []
    current_category = None

    for line in text.split("\n"):
        # Detect ## section heading
        sec_match = re.match(r"^##\s+(.+)$", line)
        if sec_match:
            current_category = {
                "name": sec_match.group(1).strip(),
                "articles": [],
                "md_links": [],
            }
            categories.append(current_category)
            continue

        # Collect wikilinks under current section
        if current_category:
            for wl in WIKILINK_RE.finditer(line):
                current_category["articles"].append(wl.group(1).strip())
            # Also collect CommonMark `[label](page.md)` links so a Karpathy
            # wiki rendered on GitHub/GitLab (which doesn't render `[[ ]]`)
            # still produces deterministic category membership. Each link is
            # filtered through `is_internal_md_target` so external URLs and
            # image links are ignored.
            for ml in MD_LINK_RE.finditer(line):
                target = ml.group(2).strip()
                if is_internal_md_target(target):
                    current_category["md_links"].append(target)

    return categories


# ---------------------------------------------------------------------------
# Log.md parsing — extract operation timeline
# ---------------------------------------------------------------------------

def parse_log(log_path: Path) -> list[dict]:
    """Parse log.md to extract chronological entries."""
    if not log_path.is_file():
        return []
    text = log_path.read_text(encoding="utf-8", errors="replace")
    entries = []
    log_entry_re = re.compile(
        r"^##\s+\[(\d{4}-\d{2}-\d{2})\]\s+(\w+)\s*\|\s*(.+)$", re.MULTILINE
    )
    for m in log_entry_re.finditer(text):
        entries.append({
            "date": m.group(1),
            "operation": m.group(2),
            "title": m.group(3).strip(),
        })
    return entries


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def build_name_to_stem_map(wiki_root: Path) -> dict[str, str]:
    """Build a case-insensitive map from filename stem to relative stem path.

    Full relative paths always map uniquely. Bare basenames map only when
    unambiguous — duplicate basenames are removed so they don't silently
    resolve to the wrong page.
    """
    name_map: dict[str, str] = {}
    # Track which bare basenames appear more than once
    basename_counts: dict[str, int] = {}
    for md_file in wiki_root.rglob("*.md"):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()  # e.g., "decisions/decision-foo"
        basename = md_file.stem            # e.g., "decision-foo"
        # Full relative path always maps uniquely
        name_map[stem.lower()] = stem
        # Track basename for ambiguity detection
        key = basename.lower()
        basename_counts[key] = basename_counts.get(key, 0) + 1
        name_map[key] = stem

    # Remove ambiguous basename entries (appear more than once)
    for key, count in basename_counts.items():
        if count > 1 and key in name_map:
            del name_map[key]

    return name_map


def resolve_wikilink(target: str, name_map: dict[str, str], node_ids: set[str] | None = None) -> str | None:
    """Resolve a wikilink target to an article node ID.

    If node_ids is provided, only resolve to IDs that exist in the set.
    """
    key = target.lower().strip()
    # Skip targets that are clearly not page names (shell flags, etc.)
    if key.startswith("-"):
        return None
    stem = name_map.get(key)
    if stem:
        candidate = f"article:{stem}"
        # If we have a node set, verify the target exists
        if node_ids is not None and candidate not in node_ids:
            return None
        return candidate
    # Try without directory prefix
    for stored_key, stored_stem in name_map.items():
        if stored_key.endswith("/" + key) or stored_key == key:
            candidate = f"article:{stored_stem}"
            if node_ids is not None and candidate not in node_ids:
                return None
            return candidate
    return None


def build_path_to_stem_map(wiki_root: Path) -> dict[str, str]:
    """Build a case-insensitive map from `posix-style-relative-path.md` to
    article stem (relative to wiki_root, no extension).

    Used by `resolve_md_link` so CommonMark `[label](page.md)` targets resolve
    by relative path even when the basename collides with another file (where
    `name_map` deliberately drops the ambiguous bare-basename entry).
    """
    path_map: dict[str, str] = {}
    for md_file in wiki_root.rglob("*.md"):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()
        path_map[rel.as_posix().lower()] = stem
    return path_map


def _normalise_md_target(target: str, base_dir: Path, wiki_root: Path) -> str | None:
    """Normalise a CommonMark link `target` to a posix path relative to
    `wiki_root`.

    `target` is the raw href as written in the markdown source. `base_dir` is
    the directory of the file containing the link (relative to `wiki_root` —
    use `Path('.')` for files at the wiki root). Behaviour:

    - strips a trailing `#anchor` and `?query`;
    - resolves `./`, `../`, and bare relative paths against `base_dir`;
    - treats absolute paths (`/pages/x.md`) as relative to `wiki_root`;
    - rejects paths that escape `wiki_root` (returns None).

    Returns the lower-cased posix relative path (e.g. `"pages/alpha.md"`) or
    None if the target is unresolvable.
    """
    if not target:
        return None
    # Strip query/fragment.
    href = target.split("#", 1)[0].split("?", 1)[0].strip()
    if not href:
        return None
    # Absolute paths in the wiki are treated as relative to the wiki root —
    # mirrors how GitHub renders `/pages/x.md` in repo-rooted markdown.
    if href.startswith("/"):
        candidate = Path(href.lstrip("/"))
    else:
        candidate = base_dir / href
    # Manual normalisation of `.` and `..` segments without touching the
    # filesystem (Path.resolve would follow symlinks and require existence).
    parts: list[str] = []
    for part in candidate.as_posix().split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                # Escapes wiki_root — unresolvable.
                return None
            parts.pop()
        else:
            parts.append(part)
    if not parts:
        return None
    return "/".join(parts).lower()


def resolve_md_link(
    target: str,
    base_dir: Path,
    wiki_root: Path,
    path_map: dict[str, str],
    node_ids: set[str] | None = None,
) -> str | None:
    """Resolve a CommonMark `[label](path.md)` target to an article node ID.

    Resolution is by normalised relative path (`pages/alpha.md`,
    `./pages/alpha.md`, and `/pages/alpha.md` all map to the same key).
    Returns None when the target cannot be matched against `path_map` or when
    `node_ids` is provided and the resolved candidate is not in it.
    """
    norm = _normalise_md_target(target, base_dir, wiki_root)
    if not norm:
        return None
    stem = path_map.get(norm)
    if not stem:
        return None
    candidate = f"article:{stem}"
    if node_ids is not None and candidate not in node_ids:
        return None
    return candidate


def parse_wiki(root: Path) -> dict:
    """Parse a Karpathy-pattern wiki and produce the scan manifest."""
    detection = detect_format(root)
    if not detection["detected"]:
        print(json.dumps({"error": "Not a Karpathy-pattern wiki", "detection": detection}),
              file=sys.stderr)
        sys.exit(1)

    wiki_root = Path(detection["wiki_root"])
    raw_root = root / "raw"

    # Build name resolution map (wikilinks: by stem/basename)
    name_map = build_name_to_stem_map(wiki_root)
    # Build path resolution map (md-links: by full relative path)
    path_map = build_path_to_stem_map(wiki_root)

    # Find index.md and log.md
    index_path = wiki_root / "index.md"
    if not index_path.is_file():
        index_path = root / "index.md"
    log_path = wiki_root / "log.md"
    if not log_path.is_file():
        log_path = root / "log.md"

    # Parse index for categories
    categories = parse_index(index_path)
    log_entries = parse_log(log_path)

    # Resolve the index file's directory relative to wiki_root. This is the
    # base against which md-link targets inside index.md are resolved. When
    # the index lives outside wiki_root (e.g. repo-root index.md while
    # wiki_root is root/wiki), `_normalise_md_target` will reject targets
    # that escape via `..` — those won't have matching article IDs anyway.
    try:
        index_base = index_path.parent.relative_to(wiki_root)
    except ValueError:
        index_base = Path(".")

    # Build category lookups:
    #  - by wikilink target (lower-cased stem/basename) — existing behaviour
    #  - by md-link relative-stem (resolved against the index file's directory)
    # The md_category_lookup is keyed by the resolved `article:<stem>` ID so
    # the per-article lookup below is a single dict access.
    category_lookup: dict[str, str] = {}
    md_category_lookup: dict[str, str] = {}
    for cat in categories:
        for article_target in cat["articles"]:
            category_lookup[article_target.lower()] = cat["name"]
        for md_target in cat.get("md_links", []):
            norm = _normalise_md_target(md_target, index_base, wiki_root)
            if not norm:
                continue
            stem = path_map.get(norm)
            if stem:
                md_category_lookup[f"article:{stem}"] = cat["name"]

    # --- Pre-compute article IDs (for edge resolution validation) ---
    # Only skip infra files at the wiki root level, not in subdirectories
    # (e.g., wiki/index.md is infra, but wiki/concepts/index.md is content)
    article_ids: set[str] = set()
    for md_file in sorted(wiki_root.rglob("*.md")):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()
        # Only filter infra files at root level (no parent directory)
        if rel.parent == Path(".") and rel.name.lower() in INFRA_FILES:
            continue
        article_ids.add(f"article:{stem}")

    # --- Build article nodes ---
    nodes = []
    edges = []
    warnings = []
    stats = {
        "articles": 0,
        "sources": 0,
        "topics": 0,
        "wikilinks": 0,
        "mdLinks": 0,
        "unresolved": 0,
    }

    for md_file in sorted(wiki_root.rglob("*.md")):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()
        basename = md_file.stem

        # Skip infrastructure files only at wiki root level
        if rel.parent == Path(".") and rel.name.lower() in INFRA_FILES:
            continue

        text = md_file.read_text(encoding="utf-8", errors="replace")
        h1 = extract_h1(text)
        frontmatter = extract_frontmatter(text)
        wikilinks = extract_wikilinks(text)
        md_links = extract_md_links(text)
        headings = extract_headings(text)
        code_langs = extract_code_blocks(text)
        summary = extract_first_paragraph(text)
        line_count = text.count("\n") + 1
        word_count = len(text.split())

        node_id = f"article:{stem}"

        # Derive category from index.md lookup.
        # Order: wikilink basename → wikilink stem → md-link by article ID.
        category = category_lookup.get(basename.lower(), "")
        if not category:
            category = category_lookup.get(stem.lower(), "")
        if not category:
            category = md_category_lookup.get(node_id, "")

        # Derive tags (deduplicated)
        tag_set: set[str] = set()
        if category:
            tag_set.add(category.lower())
        if rel.parent != Path("."):
            tag_set.add(str(rel.parent))
        fm_tags = frontmatter.get("tags", "")
        if fm_tags:
            tag_set.update(t.strip() for t in fm_tags.split(",") if t.strip())
        tags = sorted(tag_set)

        # Complexity from total link density (wikilinks + md-links).
        link_count = len(wikilinks) + len(md_links)
        if link_count > 15:
            complexity = "complex"
        elif link_count > 5:
            complexity = "moderate"
        else:
            complexity = "simple"

        nodes.append({
            "id": node_id,
            "type": "article",
            "name": h1 or basename,
            "filePath": str(rel),
            "summary": summary or f"Wiki article: {h1 or basename}",
            "tags": tags,
            "complexity": complexity,
            "knowledgeMeta": {
                "wikilinks": [wl["target"] for wl in wikilinks],
                **({"mdLinks": [ml["target"] for ml in md_links]} if md_links else {}),
                **({"category": category} if category else {}),
                "content": text[:3000],  # First 3000 chars for LLM analysis
            },
        })
        stats["articles"] += 1
        stats["wikilinks"] += len(wikilinks)
        stats["mdLinks"] += len(md_links)

        # Build edges from wikilinks (resolve against known article IDs)
        for wl in wikilinks:
            target_id = resolve_wikilink(wl["target"], name_map, article_ids)
            if target_id and target_id != node_id:
                edges.append({
                    "source": node_id,
                    "target": target_id,
                    "type": "related",
                    "direction": "forward",
                    "weight": 0.7,
                })
            elif not target_id:
                warnings.append(f"Unresolved wikilink: [[{wl['target']}]] in {rel}")
                stats["unresolved"] += 1

        # Build edges from CommonMark md-links (resolved relative to this
        # file's directory). Same edge shape as wikilinks so downstream
        # consumers stay unchanged.
        for ml in md_links:
            target_id = resolve_md_link(
                ml["target"], rel.parent, wiki_root, path_map, article_ids
            )
            if target_id and target_id != node_id:
                edges.append({
                    "source": node_id,
                    "target": target_id,
                    "type": "related",
                    "direction": "forward",
                    "weight": 0.7,
                })
            elif not target_id:
                warnings.append(f"Unresolved md-link: [{ml['display']}]({ml['target']}) in {rel}")
                stats["unresolved"] += 1

    # --- Build topic nodes from index.md categories ---
    for cat in categories:
        topic_id = f"topic:{cat['name'].lower().replace(' ', '-')}"
        md_link_count = len(cat.get("md_links", []))
        article_count = len(cat["articles"]) + md_link_count
        nodes.append({
            "id": topic_id,
            "type": "topic",
            "name": cat["name"],
            "summary": f"Category from index: {cat['name']} ({article_count} articles)",
            "tags": ["category"],
            "complexity": "simple",
        })
        stats["topics"] += 1

        # categorized_under edges (only resolve to known article nodes).
        # Wikilink targets resolve via name_map; CommonMark md-link targets
        # resolve by relative path via path_map.
        for article_target in cat["articles"]:
            article_id = resolve_wikilink(article_target, name_map, article_ids)
            if article_id:
                edges.append({
                    "source": article_id,
                    "target": topic_id,
                    "type": "categorized_under",
                    "direction": "forward",
                    "weight": 0.6,
                })
        for md_target in cat.get("md_links", []):
            article_id = resolve_md_link(
                md_target, index_base, wiki_root, path_map, article_ids
            )
            if article_id:
                edges.append({
                    "source": article_id,
                    "target": topic_id,
                    "type": "categorized_under",
                    "direction": "forward",
                    "weight": 0.6,
                })

    # --- Build source nodes from raw/ ---
    if raw_root.is_dir():
        for raw_file in sorted(raw_root.rglob("*")):
            if raw_file.is_file() and not raw_file.name.startswith("."):
                rel_raw = raw_file.relative_to(root)
                ext = raw_file.suffix.lower()
                size_kb = raw_file.stat().st_size / 1024
                source_id = f"source:{raw_file.relative_to(raw_root).with_suffix('')}"
                nodes.append({
                    "id": source_id,
                    "type": "source",
                    "name": raw_file.name,
                    "filePath": str(rel_raw),
                    "summary": f"Raw source ({ext or 'unknown'}, {size_kb:.0f} KB)",
                    "tags": ["raw", ext.lstrip(".") or "unknown"],
                    "complexity": "simple",
                })
                stats["sources"] += 1

    # --- Compute backlinks ---
    backlink_map: dict[str, list[str]] = {}
    for edge in edges:
        if edge["type"] == "related":
            target = edge["target"]
            source = edge["source"]
            backlink_map.setdefault(target, []).append(source)
    for node in nodes:
        if node["type"] == "article" and "knowledgeMeta" in node:
            bl = backlink_map.get(node["id"], [])
            node["knowledgeMeta"]["backlinks"] = bl

    # --- Deduplicate edges ---
    seen_edges: set[tuple[str, str, str]] = set()
    deduped_edges = []
    for edge in edges:
        key = (edge["source"], edge["target"], edge["type"])
        if key not in seen_edges:
            seen_edges.add(key)
            deduped_edges.append(edge)

    return {
        "format": "karpathy",
        "stats": stats,
        "categories": [
            {
                "name": c["name"],
                "count": len(c["articles"]) + len(c.get("md_links", [])),
            }
            for c in categories
        ],
        "logEntries": len(log_entries),
        "nodes": nodes,
        "edges": deduped_edges,
        "warnings": warnings[:50],  # Cap warnings
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: parse-knowledge-base.py <wiki-directory>", file=sys.stderr)
        sys.exit(1)

    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    manifest = parse_wiki(root)

    # Write output
    out_dir = root / ".understand-anything" / "intermediate"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "scan-manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Report to stderr
    s = manifest["stats"]
    md_links = s.get("mdLinks", 0)
    link_summary = f"{s['wikilinks']} wikilinks"
    if md_links:
        link_summary += f", {md_links} md-links"
    print(f"[parse] Karpathy wiki: {s['articles']} articles, {s['sources']} sources, "
          f"{s['topics']} topics, {link_summary} "
          f"({s['unresolved']} unresolved)", file=sys.stderr)
    print(f"[parse] Output: {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()

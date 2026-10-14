#!/usr/bin/env python3
"""
Deterministic parser for Karpathy-pattern LLM wikis.

Detects the three-layer pattern (raw sources + wiki markdown + schema),
extracts structure from markdown files, resolves wikilinks, and derives
categories from index.md section headings.

Usage:
    python parse-knowledge-base.py <wiki-directory>

Output:
    Writes scan-manifest.json to <wiki-directory>/<ua-dir>/intermediate/, where
    <ua-dir> is `.ua/` (or legacy `.understand-anything/` when that directory
    already exists).
"""

import json
import os
import re
import sys
from pathlib import Path


def resolve_ua_dir(root: Path) -> Path:
    """Mirror core resolveUaDir: legacy .understand-anything/ wins if present."""
    legacy = root / ".understand-anything"
    return legacy if legacy.is_dir() else root / ".ua"

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
CODE_BLOCK_RE = re.compile(r"```(\w*)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
INDEX_SECTION_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)

# Doctrine-format signals: numbered files (NN-name.md), prose cross-refs
# like "canon/04 §6-7" or "Doctrine #11", and standard markdown links.
NUMBERED_FILE_RE = re.compile(r"^(\d{2,})-")
PROSE_REF_RE = re.compile(
    r"\b(canon|doctrine|chapter)\s*[/#]?\s*(\d{1,3})\b", re.IGNORECASE
)
MD_LINK_RE = re.compile(r"\[([^\]\n]+)\]\(([^)\s#]+\.md)(?:#[^)]*)?\)")

# Files that are part of wiki infrastructure, not content articles
INFRA_FILES = {"index.md", "log.md", "claude.md", "agents.md", "soul.md"}


def find_markdown_case_insensitive(parent: Path, name: str) -> Path:
    """Resolve a known markdown filename case-insensitively within one directory.

    An exact match always wins (so `index.md` beats `Index.md` when both
    exist); otherwise the first case-insensitive sibling is returned. The
    unmatched candidate comes back as-is so callers can keep using
    `.is_file()` checks. Deliberately single-directory — no recursive fuzzy
    matching (see #342 non-goals).
    """
    candidate = parent / name
    if candidate.is_file():
        return candidate
    if not parent.is_dir():
        return candidate
    wanted = name.lower()
    for child in sorted(parent.iterdir()):
        if child.is_file() and child.name.lower() == wanted:
            return child
    return candidate

# ---------------------------------------------------------------------------
# Detection: is this a Karpathy-pattern wiki?
# ---------------------------------------------------------------------------

def _scan_doctrine_signals(md_files: list[Path]) -> dict:
    """Scan markdown files for doctrine-format signals.

    Returns counts of numbered files (NN-name.md), whether prose
    cross-refs like 'canon/04' or 'Doctrine #11' are present, and
    whether standard markdown links '[name](file.md)' are used.
    """
    numbered_count = sum(
        1 for f in md_files if NUMBERED_FILE_RE.match(f.name)
    )
    has_prose_refs = False
    has_md_links = False
    # Sample up to 20 files to keep detection cheap on large corpora
    for f in md_files[:20]:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")[:10000]
        except OSError:
            continue
        if not has_prose_refs and PROSE_REF_RE.search(text):
            has_prose_refs = True
        if not has_md_links and MD_LINK_RE.search(text):
            has_md_links = True
        if has_prose_refs and has_md_links:
            break
    return {
        "numbered_count": numbered_count,
        "has_prose_refs": has_prose_refs,
        "has_md_links": has_md_links,
    }


def detect_format(root: Path) -> dict:
    """Detect a known markdown-knowledge-base format.

    Returns signals + a `format` field, one of:
      - "karpathy"  — three-layer LLM wiki (index.md + wikilinks)
      - "doctrine"  — numbered files + prose cross-refs + md links
      - "unknown"   — neither pattern detected

    Karpathy detection takes precedence when both signal sets are present
    so existing Karpathy users see zero behavioral change.
    """
    signals = {
        "has_index": find_markdown_case_insensitive(root, "index.md").is_file()
        or find_markdown_case_insensitive(root / "wiki", "index.md").is_file(),
        "has_log": find_markdown_case_insensitive(root, "log.md").is_file()
        or find_markdown_case_insensitive(root / "wiki", "log.md").is_file(),
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
        return signals

    # Secondary signal: doctrine format. Numbered files (NN-name.md) +
    # at least one of {prose refs, md links}, with a meaningful md_count.
    doctrine = _scan_doctrine_signals(md_files)
    signals.update(doctrine)
    if (
        doctrine["numbered_count"] >= 3
        and signals["md_count"] >= 3
        and (doctrine["has_prose_refs"] or doctrine["has_md_links"])
    ):
        signals["detected"] = True
        signals["format"] = "doctrine"
        return signals

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


def extract_md_links(text: str) -> list[dict]:
    """Extract standard markdown links to .md files.

    Skips links inside fenced code blocks. Returns dicts with display
    text and the raw target path (relative to the source file).
    """
    # Strip fenced code blocks to avoid extracting links from code samples
    stripped = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    links = []
    for m in MD_LINK_RE.finditer(stripped):
        target = m.group(2).strip()
        # Skip external URLs
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        links.append({
            "target": target,
            "display": m.group(1).strip(),
        })
    return links


def extract_prose_refs(text: str) -> list[dict]:
    """Extract prose cross-references like 'canon/04' or 'Doctrine #11'.

    Returns dicts with the matched namespace (canon|doctrine|chapter)
    and the numeric reference. Deduplicated within a single document.
    """
    seen: set[tuple[str, str]] = set()
    refs = []
    for m in PROSE_REF_RE.finditer(text):
        namespace = m.group(1).lower()
        num = m.group(2)
        key = (namespace, num)
        if key in seen:
            continue
        seen.add(key)
        refs.append({"namespace": namespace, "num": num})
    return refs


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
    """Parse index.md to extract categories from ## headings and their wikilinks."""
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
            }
            categories.append(current_category)
            continue

        # Collect wikilinks under current section
        if current_category:
            for wl in WIKILINK_RE.finditer(line):
                current_category["articles"].append(wl.group(1).strip())

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


def resolve_wikilink(
    target: str,
    name_map: dict[str, str],
    node_ids: set[str] | None = None,
    root_prefix: str | None = None,
) -> str | None:
    """Resolve a wikilink target to an article node ID.

    If node_ids is provided, only resolve to IDs that exist in the set.
    root_prefix is the article-root directory name (e.g. "wiki") — links
    written from the repository root include it ([[wiki/concepts/Index]])
    while name_map keys are relative to the article root, so such targets
    are tried both as written and with the prefix stripped.
    """
    key = target.lower().strip()
    # Skip targets that are clearly not page names (shell flags, etc.)
    if key.startswith("-"):
        return None
    keys = [key]
    if root_prefix and key.startswith(root_prefix + "/"):
        keys.append(key[len(root_prefix) + 1:])
    for k in keys:
        stem = name_map.get(k)
        if stem:
            candidate = f"article:{stem}"
            # If we have a node set, verify the target exists
            if node_ids is not None and candidate not in node_ids:
                return None
            return candidate
    # Try without directory prefix
    for k in keys:
        for stored_key, stored_stem in name_map.items():
            if stored_key.endswith("/" + k) or stored_key == k:
                candidate = f"article:{stored_stem}"
                if node_ids is not None and candidate not in node_ids:
                    return None
                return candidate
    return None


def parse_wiki(root: Path) -> dict:
    """Parse a markdown knowledge base and produce the scan manifest.

    Dispatches on detected format: Karpathy three-layer wikis use the
    original index.md + wikilinks path; doctrine corpora (numbered files
    + prose refs + md links) use the doctrine parser. Exits with a
    json-encoded error on stderr when the directory matches neither.
    """
    detection = detect_format(root)
    if not detection["detected"]:
        print(
            json.dumps({"error": "Not a recognized knowledge-base format", "detection": detection}),
            file=sys.stderr,
        )
        sys.exit(1)

    if detection["format"] == "doctrine":
        return _parse_doctrine_wiki(root, detection)
    return _parse_karpathy_wiki(root, detection)


def _parse_karpathy_wiki(root: Path, detection: dict) -> dict:
    """Parse a Karpathy-pattern wiki and produce the scan manifest."""
    wiki_root = Path(detection["wiki_root"])
    raw_root = root / "raw"

    # Build name resolution map
    name_map = build_name_to_stem_map(wiki_root)

    # Find index.md and log.md (case-insensitively — Index.md/Log.md are a
    # reasonable convention on case-sensitive filesystems)
    index_path = find_markdown_case_insensitive(wiki_root, "index.md")
    if not index_path.is_file():
        index_path = find_markdown_case_insensitive(root, "index.md")
    log_path = find_markdown_case_insensitive(wiki_root, "log.md")
    if not log_path.is_file():
        log_path = find_markdown_case_insensitive(root, "log.md")

    # Parse index for categories
    categories = parse_index(index_path)
    log_entries = parse_log(log_path)

    # Article ids are relative to wiki_root, but a root index.md commonly
    # links with the article-root prefix included ([[wiki/concepts/Index]]).
    # Register/resolve such targets both as written and prefix-stripped.
    root_prefix = wiki_root.name.lower() if wiki_root != root else None

    # Build category lookup: wikilink target → category name
    category_lookup: dict[str, str] = {}
    for cat in categories:
        for article_target in cat["articles"]:
            t = article_target.lower()
            category_lookup[t] = cat["name"]
            if root_prefix and t.startswith(root_prefix + "/"):
                category_lookup[t[len(root_prefix) + 1:]] = cat["name"]

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
    stats = {"articles": 0, "sources": 0, "topics": 0, "wikilinks": 0, "unresolved": 0}

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
        headings = extract_headings(text)
        code_langs = extract_code_blocks(text)
        summary = extract_first_paragraph(text)
        line_count = text.count("\n") + 1
        word_count = len(text.split())

        # Derive category from index.md lookup
        category = category_lookup.get(basename.lower(), "")
        if not category:
            # Try stem match
            category = category_lookup.get(stem.lower(), "")

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

        # Complexity from wikilink density
        wl_count = len(wikilinks)
        if wl_count > 15:
            complexity = "complex"
        elif wl_count > 5:
            complexity = "moderate"
        else:
            complexity = "simple"

        node_id = f"article:{stem}"
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
                **({"category": category} if category else {}),
                "content": text[:3000],  # First 3000 chars for LLM analysis
            },
        })
        stats["articles"] += 1
        stats["wikilinks"] += wl_count

        # Build edges from wikilinks (resolve against known article IDs)
        for wl in wikilinks:
            target_id = resolve_wikilink(wl["target"], name_map, article_ids, root_prefix)
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

    # --- Build topic nodes from index.md categories ---
    for cat in categories:
        topic_id = f"topic:{cat['name'].lower().replace(' ', '-')}"
        nodes.append({
            "id": topic_id,
            "type": "topic",
            "name": cat["name"],
            "summary": f"Category from index: {cat['name']} ({len(cat['articles'])} articles)",
            "tags": ["category"],
            "complexity": "simple",
        })
        stats["topics"] += 1

        # categorized_under edges (only resolve to known article nodes)
        for article_target in cat["articles"]:
            article_id = resolve_wikilink(article_target, name_map, article_ids, root_prefix)
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
        "categories": [{"name": c["name"], "count": len(c["articles"])} for c in categories],
        "logEntries": len(log_entries),
        "nodes": nodes,
        "edges": deduped_edges,
        "warnings": warnings[:50],  # Cap warnings
    }


# ---------------------------------------------------------------------------
# Doctrine-format parser
# ---------------------------------------------------------------------------

def _build_numbered_index(article_ids: set[str], wiki_root: Path) -> dict[str, list[str]]:
    """Map numeric prefix (e.g. '04') to article IDs whose filename starts with it.

    Multiple files can share a prefix in principle (e.g. across subdirs);
    callers resolve only when a single match exists. Returns prefix → list
    of article IDs to make ambiguity detectable.
    """
    prefix_map: dict[str, list[str]] = {}
    for aid in article_ids:
        if not aid.startswith("article:"):
            continue
        stem = aid.split(":", 1)[1]
        basename = stem.rsplit("/", 1)[-1]
        m = NUMBERED_FILE_RE.match(basename + ".md")
        if not m:
            continue
        # Store both zero-padded and unpadded forms so 'canon/4' resolves
        # to '04-foo.md' the same as 'canon/04'.
        raw = m.group(1)
        prefix_map.setdefault(raw, []).append(aid)
        unpadded = str(int(raw))
        if unpadded != raw:
            prefix_map.setdefault(unpadded, []).append(aid)
    return prefix_map


def _resolve_md_link(target: str, source_rel: Path, name_map: dict[str, str],
                     node_ids: set[str]) -> str | None:
    """Resolve a markdown link target to an article node ID.

    `target` is the raw href from `[label](target)`. Relative paths are
    resolved against the source file's parent directory; absolute-style
    paths (no leading dot) are resolved from the wiki root.
    """
    raw = target.strip()
    if not raw or raw.startswith(("#", "http://", "https://", "mailto:")):
        return None
    # Strip .md suffix + any fragment
    cleaned = raw.split("#", 1)[0]
    if cleaned.endswith(".md"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.lstrip("./")

    # Try resolution relative to source file's parent first
    parent = source_rel.parent.as_posix()
    if parent and parent != ".":
        candidate_path = (Path(parent) / cleaned).as_posix()
        # Normalize ../ segments
        parts: list[str] = []
        for seg in candidate_path.split("/"):
            if seg == ".." and parts:
                parts.pop()
            elif seg and seg != ".":
                parts.append(seg)
        candidate_path = "/".join(parts)
        candidate_id = f"article:{candidate_path}"
        if candidate_id in node_ids:
            return candidate_id

    # Fall back to wiki-root-relative + name_map lookup
    return resolve_wikilink(cleaned, name_map, node_ids)


def _parse_doctrine_wiki(root: Path, detection: dict) -> dict:
    """Parse a doctrine-format corpus and produce the scan manifest.

    Doctrine corpora identify articles by numeric filename prefix
    (NN-name.md), cross-reference each other through prose refs like
    'canon/04 §6-7' or 'Doctrine #11', and use standard markdown links
    '[name](path.md)' rather than wikilinks. Categories are derived from
    the tens-digit of each file's numeric prefix.
    """
    wiki_root = Path(detection["wiki_root"])
    raw_root = root / "raw"

    name_map = build_name_to_stem_map(wiki_root)

    # --- Pre-compute article IDs ---
    article_ids: set[str] = set()
    for md_file in sorted(wiki_root.rglob("*.md")):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()
        if rel.parent == Path(".") and rel.name.lower() in INFRA_FILES:
            continue
        article_ids.add(f"article:{stem}")

    numbered_index = _build_numbered_index(article_ids, wiki_root)

    nodes: list[dict] = []
    edges: list[dict] = []
    warnings: list[str] = []
    stats = {
        "articles": 0,
        "sources": 0,
        "topics": 0,
        "mdLinks": 0,
        "proseRefs": 0,
        "unresolved": 0,
    }

    # Track which numeric-prefix groups appear, for topic-node generation
    group_to_articles: dict[str, list[str]] = {}

    for md_file in sorted(wiki_root.rglob("*.md")):
        rel = md_file.relative_to(wiki_root)
        stem = rel.with_suffix("").as_posix()
        basename = md_file.stem

        if rel.parent == Path(".") and rel.name.lower() in INFRA_FILES:
            continue

        text = md_file.read_text(encoding="utf-8", errors="replace")
        h1 = extract_h1(text)
        frontmatter = extract_frontmatter(text)
        md_links = extract_md_links(text)
        prose_refs = extract_prose_refs(text)
        headings = extract_headings(text)  # noqa: F841 — kept for parity / future use
        code_langs = extract_code_blocks(text)  # noqa: F841
        summary = extract_first_paragraph(text)

        # Derive numeric-prefix group (tens digit) when present
        prefix_match = NUMBERED_FILE_RE.match(md_file.name)
        group_label = ""
        if prefix_match:
            n = int(prefix_match.group(1))
            tens = n // 10
            group_label = f"group-{tens}"

        # Tag set: numeric group + parent dir + frontmatter tags
        tag_set: set[str] = set()
        if group_label:
            tag_set.add(group_label)
        if rel.parent != Path("."):
            tag_set.add(str(rel.parent))
        fm_tags = frontmatter.get("tags", "")
        if fm_tags:
            tag_set.update(t.strip() for t in fm_tags.split(",") if t.strip())
        tags = sorted(tag_set)

        # Complexity from combined link density (md links + prose refs)
        link_count = len(md_links) + len(prose_refs)
        if link_count > 15:
            complexity = "complex"
        elif link_count > 5:
            complexity = "moderate"
        else:
            complexity = "simple"

        node_id = f"article:{stem}"
        nodes.append({
            "id": node_id,
            "type": "article",
            "name": h1 or basename,
            "filePath": str(rel),
            "summary": summary or f"Doctrine article: {h1 or basename}",
            "tags": tags,
            "complexity": complexity,
            "knowledgeMeta": {
                "mdLinks": [ml["target"] for ml in md_links],
                "proseRefs": [f"{r['namespace']}/{r['num']}" for r in prose_refs],
                **({"category": group_label} if group_label else {}),
                "content": text[:3000],
            },
        })
        stats["articles"] += 1
        stats["mdLinks"] += len(md_links)
        stats["proseRefs"] += len(prose_refs)

        if group_label:
            group_to_articles.setdefault(group_label, []).append(node_id)

        # --- Edges from markdown links ---
        for ml in md_links:
            target_id = _resolve_md_link(ml["target"], rel, name_map, article_ids)
            if target_id and target_id != node_id:
                edges.append({
                    "source": node_id,
                    "target": target_id,
                    "type": "related",
                    "direction": "forward",
                    "weight": 0.7,
                })
            elif not target_id:
                warnings.append(f"Unresolved md link: [{ml['display']}]({ml['target']}) in {rel}")
                stats["unresolved"] += 1

        # --- Edges from prose cross-refs ---
        for pr in prose_refs:
            candidates = numbered_index.get(pr["num"], [])
            if len(candidates) == 1:
                target_id = candidates[0]
                if target_id != node_id:
                    edges.append({
                        "source": node_id,
                        "target": target_id,
                        "type": "references",
                        "direction": "forward",
                        "weight": 0.5,
                    })
            elif len(candidates) > 1:
                warnings.append(
                    f"Ambiguous prose ref {pr['namespace']}/{pr['num']} in {rel} "
                    f"(matches {len(candidates)} files)"
                )
                stats["unresolved"] += 1
            else:
                # No numbered file with this prefix — common for back-refs to
                # non-existent sections; record without spamming.
                stats["unresolved"] += 1

    # --- Build topic nodes from numeric-prefix groups ---
    for group_label, member_ids in sorted(group_to_articles.items()):
        topic_id = f"topic:{group_label}"
        nodes.append({
            "id": topic_id,
            "type": "topic",
            "name": group_label,
            "summary": f"Doctrine group: {group_label} ({len(member_ids)} articles)",
            "tags": ["category", "doctrine-group"],
            "complexity": "simple",
        })
        stats["topics"] += 1
        for aid in member_ids:
            edges.append({
                "source": aid,
                "target": topic_id,
                "type": "categorized_under",
                "direction": "forward",
                "weight": 0.6,
            })

    # --- Build source nodes from raw/ (same as Karpathy) ---
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

    # --- Backlinks ---
    backlink_map: dict[str, list[str]] = {}
    for edge in edges:
        if edge["type"] in ("related", "references"):
            backlink_map.setdefault(edge["target"], []).append(edge["source"])
    for node in nodes:
        if node["type"] == "article" and "knowledgeMeta" in node:
            node["knowledgeMeta"]["backlinks"] = backlink_map.get(node["id"], [])

    # --- Dedupe edges ---
    seen_edges: set[tuple[str, str, str]] = set()
    deduped_edges = []
    for edge in edges:
        key = (edge["source"], edge["target"], edge["type"])
        if key not in seen_edges:
            seen_edges.add(key)
            deduped_edges.append(edge)

    return {
        "format": "doctrine",
        "stats": stats,
        "categories": [
            {"name": g, "count": len(members)}
            for g, members in sorted(group_to_articles.items())
        ],
        "logEntries": 0,
        "nodes": nodes,
        "edges": deduped_edges,
        "warnings": warnings[:50],
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
    out_dir = resolve_ua_dir(root) / "intermediate"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "scan-manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Report to stderr
    s = manifest["stats"]
    fmt = manifest.get("format", "unknown")
    if fmt == "doctrine":
        print(
            f"[parse] Doctrine corpus: {s['articles']} articles, {s['sources']} sources, "
            f"{s['topics']} groups, {s['mdLinks']} md-links, {s['proseRefs']} prose-refs "
            f"({s['unresolved']} unresolved)",
            file=sys.stderr,
        )
    else:
        print(
            f"[parse] Karpathy wiki: {s['articles']} articles, {s['sources']} sources, "
            f"{s['topics']} topics, {s['wikilinks']} wikilinks "
            f"({s['unresolved']} unresolved)",
            file=sys.stderr,
        )
    print(f"[parse] Output: {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()

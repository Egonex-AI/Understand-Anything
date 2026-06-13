#!/usr/bin/env python3
"""Tests for _score_node_relevance function in ua_query.py."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ua_query import _score_node_relevance


def test_exact_name_match() -> None:
    """Test exact name match gives highest score."""
    node = {"name": "UserService", "type": "class"}
    score = _score_node_relevance(node, "UserService")
    assert score >= 15.0


def test_partial_name_match() -> None:
    """Test partial name match gives bonus."""
    node = {"name": "UserService", "type": "class"}
    score = _score_node_relevance(node, "User")
    assert score >= 5.0


def test_id_match() -> None:
    """Test ID match gives bonus."""
    node = {"name": "test", "id": "user-service", "type": "class"}
    score = _score_node_relevance(node, "user")
    assert score >= 2.0


def test_type_bonus() -> None:
    """Test type bonus is applied."""
    node_class = {"name": "test", "type": "class"}
    node_function = {"name": "test", "type": "function"}

    score_class = _score_node_relevance(node_class, "test")
    score_function = _score_node_relevance(node_function, "test")

    assert score_class > score_function


def test_file_path_bonus() -> None:
    """Test file path gives bonus."""
    node_with_path = {"name": "test", "filePath": "src/user.ts"}
    node_without_path = {"name": "test"}

    score_with = _score_node_relevance(node_with_path, "test")
    score_without = _score_node_relevance(node_without_path, "test")

    assert score_with > score_without


def test_line_range_bonus() -> None:
    """Test line range gives bonus."""
    node_with_range = {"name": "test", "lineRange": [1, 10]}
    node_without_range = {"name": "test"}

    score_with = _score_node_relevance(node_with_range, "test")
    score_without = _score_node_relevance(node_without_range, "test")

    assert score_with > score_without


def test_tag_matching() -> None:
    """Test tag matching gives bonus."""
    node_with_tags = {"name": "test", "tags": ["order", "management"]}
    node_without_tags = {"name": "test"}

    score_with = _score_node_relevance(node_with_tags, "order")
    score_without = _score_node_relevance(node_without_tags, "order")

    assert score_with > score_without


def test_summary_matching() -> None:
    """Test summary matching gives bonus."""
    node_with_summary = {"name": "test", "summary": "Handles order processing"}
    node_without_summary = {"name": "test"}

    score_with = _score_node_relevance(node_with_summary, "order")
    score_without = _score_node_relevance(node_without_summary, "order")

    assert score_with > score_without


def test_implementation_suffix_bonus() -> None:
    """Test implementation suffix gives bonus."""
    node_impl = {"name": "UserServiceImpl", "type": "class"}
    node_normal = {"name": "UserService", "type": "class"}

    score_impl = _score_node_relevance(node_impl, "User")
    score_normal = _score_node_relevance(node_normal, "User")

    # Implementation suffix gives +3.0 bonus
    assert score_impl > score_normal


def test_config_suffix_penalty() -> None:
    """Test config suffix gives penalty."""
    node_config = {"name": "AppConfig", "type": "class"}
    node_normal = {"name": "App", "type": "class"}

    score_config = _score_node_relevance(node_config, "App")
    score_normal = _score_node_relevance(node_normal, "App")

    # Config suffix gives -2.0 penalty
    assert score_config < score_normal


def test_empty_query() -> None:
    """Test empty query returns base score."""
    node = {"name": "test", "type": "class"}
    score = _score_node_relevance(node, "")
    # Should return base type bonus only
    assert score == 2.0  # class type bonus


def test_case_insensitive() -> None:
    """Test matching is case insensitive."""
    node = {"name": "UserService", "type": "class"}
    score_lower = _score_node_relevance(node, "userservice")
    score_upper = _score_node_relevance(node, "USERSERVICE")

    assert score_lower == score_upper

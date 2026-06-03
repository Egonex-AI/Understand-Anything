"""Tests for wiki_meta_update.py — Wiki meta.json updater."""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "understand-anything-plugin", "skills", "understand-wiki"))

from wiki_meta_update import update_meta


class TestWikiMetaUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.meta_path = os.path.join(self.tmp, "wiki", "meta.json")
        os.makedirs(os.path.dirname(self.meta_path))

    def _write_meta(self, data):
        with open(self.meta_path, "w") as f:
            json.dump(data, f)

    def _read_meta(self):
        with open(self.meta_path) as f:
            return json.load(f)

    def test_updates_commit_hash(self):
        self._write_meta({
            "gitCommitHash": "old",
            "generatedAt": "2025-01-01T00:00:00Z",
            "version": "1.0.0",
            "outputLanguage": "zh",
        })
        update_meta(self.meta_path, commit_hash="abc123def")
        meta = self._read_meta()
        self.assertEqual(meta["gitCommitHash"], "abc123def")

    def test_updates_generated_at_timestamp(self):
        self._write_meta({
            "gitCommitHash": "x",
            "generatedAt": "2020-01-01T00:00:00Z",
            "version": "1.0.0",
            "outputLanguage": "zh",
        })
        update_meta(self.meta_path, commit_hash="y")
        meta = self._read_meta()
        ts = datetime.fromisoformat(meta["generatedAt"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        self.assertLess(abs((now - ts).total_seconds()), 5)

    def test_preserves_other_fields(self):
        self._write_meta({
            "gitCommitHash": "old",
            "generatedAt": "2025-01-01T00:00:00Z",
            "version": "2.3.0",
            "outputLanguage": "en",
            "customField": "keep-me",
        })
        update_meta(self.meta_path, commit_hash="new")
        meta = self._read_meta()
        self.assertEqual(meta["version"], "2.3.0")
        self.assertEqual(meta["outputLanguage"], "en")
        self.assertEqual(meta["customField"], "keep-me")

    def test_explicit_timestamp_override(self):
        self._write_meta({
            "gitCommitHash": "x",
            "generatedAt": "2020-01-01T00:00:00Z",
            "version": "1.0.0",
            "outputLanguage": "zh",
        })
        custom_ts = "2026-06-03T12:00:00Z"
        update_meta(self.meta_path, commit_hash="y", timestamp=custom_ts)
        meta = self._read_meta()
        self.assertEqual(meta["generatedAt"], custom_ts)

    def test_creates_meta_if_missing(self):
        self.assertFalse(os.path.exists(self.meta_path))
        update_meta(self.meta_path, commit_hash="first")
        self.assertTrue(os.path.exists(self.meta_path))
        meta = self._read_meta()
        self.assertEqual(meta["gitCommitHash"], "first")
        self.assertIn("generatedAt", meta)

    def test_handles_empty_commit_hash(self):
        self._write_meta({
            "gitCommitHash": "old",
            "generatedAt": "2025-01-01T00:00:00Z",
            "version": "1.0.0",
            "outputLanguage": "zh",
        })
        update_meta(self.meta_path, commit_hash="")
        meta = self._read_meta()
        self.assertEqual(meta["gitCommitHash"], "")

    def test_output_format_is_pretty_json(self):
        self._write_meta({"gitCommitHash": "x", "generatedAt": "x", "version": "1.0.0", "outputLanguage": "zh"})
        update_meta(self.meta_path, commit_hash="y")
        with open(self.meta_path) as f:
            content = f.read()
        self.assertIn("\n", content)
        self.assertIn("  ", content)


if __name__ == "__main__":
    unittest.main()

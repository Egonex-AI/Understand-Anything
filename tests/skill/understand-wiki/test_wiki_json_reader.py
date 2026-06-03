"""Tests for wiki_json_reader.py — safe JSON field reader for shell scripts."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "understand-anything-plugin",
        "skills",
        "understand-wiki",
    ),
)

from wiki_json_reader import read_json_field

SCRIPT = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "..",
    "understand-anything-plugin",
    "skills",
    "understand-wiki",
    "wiki_json_reader.py",
)


class TestReadJsonField(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _write_json(self, name, data):
        path = os.path.join(self.tmp, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return path

    def test_reads_string_field(self):
        path = self._write_json("config.json", {"outputLanguage": "zh"})
        self.assertEqual(read_json_field(path, "outputLanguage", "en"), "zh")

    def test_reads_nested_field(self):
        path = self._write_json(
            "meta.json",
            {"project": {"gitCommitHash": "abc123def456"}},
        )
        self.assertEqual(
            read_json_field(path, "project.gitCommitHash", ""),
            "abc123def456",
        )

    def test_reads_array_object_outputs_json(self):
        annotations = [
            {"provider": "@DubboService", "consumer": "@DubboReference", "type": "dubbo"}
        ]
        path = self._write_json("config.json", {"rpcAnnotations": annotations})
        result = read_json_field(path, "rpcAnnotations", "null")
        self.assertEqual(result, json.dumps(annotations, separators=(",", ":")))

    def test_missing_file_returns_default(self):
        missing = os.path.join(self.tmp, "does-not-exist.json")
        self.assertEqual(read_json_field(missing, "outputLanguage", "en"), "en")

    def test_missing_field_returns_default(self):
        path = self._write_json("config.json", {"other": "value"})
        self.assertEqual(read_json_field(path, "outputLanguage", "en"), "en")

    def test_malformed_json_returns_default(self):
        path = os.path.join(self.tmp, "bad.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write("{not valid json")
        self.assertEqual(read_json_field(path, "outputLanguage", "en"), "en")

    def test_empty_default(self):
        path = self._write_json("meta.json", {})
        self.assertEqual(read_json_field(path, "gitCommitHash"), "")


class TestWikiJsonReaderCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _write_json(self, name, data):
        path = os.path.join(self.tmp, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return path

    def _run_cli(self, *args):
        return subprocess.run(
            [sys.executable, SCRIPT, *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_cli_exit_code_always_zero(self):
        missing = os.path.join(self.tmp, "missing.json")
        result = self._run_cli(missing, "field", "default")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "default")

    def test_cli_prints_string_field(self):
        path = self._write_json("config.json", {"outputLanguage": "fr"})
        result = self._run_cli(path, "outputLanguage", "en")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "fr")


if __name__ == "__main__":
    unittest.main()

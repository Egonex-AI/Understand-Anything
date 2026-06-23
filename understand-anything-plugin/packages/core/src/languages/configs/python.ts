import type { LanguageConfig } from "../types.js";

export const pythonConfig = {
  id: "python",
  displayName: "Python",
  extensions: [".py", ".pyi"],
  treeSitter: {
    wasmPackage: "tree-sitter-python",
    wasmFile: "tree-sitter-python.wasm",
  },
  concepts: [
    "decorators",
    "list comprehensions",
    "generators",
    "context managers",
    "type hints",
    "dunder methods",
    "metaclasses",
    "dataclasses",
    "async/await",
    "descriptors",
    "protocols",
  ],
  filePatterns: {
    entryPoints: [
      "main.py",
      "manage.py",
      "app.py",
      "wsgi.py",
      "asgi.py",
      "run.py",
      "__main__.py",
    ],
    barrels: ["__init__.py"],
    tests: ["test_*.py", "*_test.py", "conftest.py"],
    config: [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
    ],
  },
} satisfies LanguageConfig;

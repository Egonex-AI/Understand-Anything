import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { PythonExtractor } from "../python-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Python grammar once
let Parser: any;
let Language: any;
let pythonLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-python/tree-sitter-python.wasm",
  );
  pythonLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(pythonLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("PythonExtractor", () => {
  const extractor = new PythonExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["python"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts simple functions with type annotations", () => {
      const { tree, parser, root } = parse(`
def hello(name: str) -> str:
    return f"Hello {name}"

def add(a: int, b: int) -> int:
    return a + b
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("hello");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("str");
      expect(result.functions[0].lineRange[0]).toBeGreaterThan(0);

      expect(result.functions[1].name).toBe("add");
      expect(result.functions[1].params).toEqual(["a", "b"]);
      expect(result.functions[1].returnType).toBe("int");

      tree.delete();
      parser.delete();
    });

    it("extracts functions without type annotations", () => {
      const { tree, parser, root } = parse(`
def greet(name):
    print(name)

def noop():
    pass
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBeUndefined();

      expect(result.functions[1].name).toBe("noop");
      expect(result.functions[1].params).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts functions with default parameters", () => {
      const { tree, parser, root } = parse(`
def connect(host: str, port: int = 8080, timeout: float = 30.0):
    pass
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("connect");
      expect(result.functions[0].params).toEqual(["host", "port", "timeout"]);

      tree.delete();
      parser.delete();
    });

    it("extracts functions with *args and **kwargs", () => {
      const { tree, parser, root } = parse(`
def flexible(*args, **kwargs):
    pass
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toEqual(["*args", "**kwargs"]);

      tree.delete();
      parser.delete();
    });

    it("extracts decorated functions", () => {
      const { tree, parser, root } = parse(`
@decorator
def decorated_func():
    pass

@app.route("/api")
def api_handler():
    pass
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("decorated_func");
      expect(result.functions[1].name).toBe("api_handler");

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges", () => {
      const { tree, parser, root } = parse(`
def multiline(
    a: int,
    b: int,
) -> int:
    result = a + b
    return result
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(2);
      expect(result.functions[0].lineRange[1]).toBe(7);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts classes with methods and properties", () => {
      const { tree, parser, root } = parse(`
class DataProcessor:
    name: str

    def __init__(self, name: str):
        self.name = name

    def process(self, data: list) -> dict:
        return transform(data)
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("DataProcessor");
      expect(result.classes[0].methods).toContain("__init__");
      expect(result.classes[0].methods).toContain("process");
      expect(result.classes[0].properties).toContain("name");

      tree.delete();
      parser.delete();
    });

    it("extracts dataclass-style annotated properties", () => {
      const { tree, parser, root } = parse(`
class Config:
    name: str
    value: int
    debug: bool
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].properties).toEqual(["name", "value", "debug"]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts decorated classes", () => {
      const { tree, parser, root } = parse(`
@dataclass
class Config:
    name: str
    value: int = 0
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Config");
      expect(result.classes[0].properties).toContain("name");
      expect(result.classes[0].properties).toContain("value");

      tree.delete();
      parser.delete();
    });

    it("extracts decorated methods within a class", () => {
      const { tree, parser, root } = parse(`
class MyClass:
    @staticmethod
    def static_method():
        pass

    @classmethod
    def class_method(cls):
        pass

    @property
    def prop(self):
        return self._prop
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].methods).toContain("static_method");
      expect(result.classes[0].methods).toContain("class_method");
      expect(result.classes[0].methods).toContain("prop");

      tree.delete();
      parser.delete();
    });

    it("filters self and cls from method params", () => {
      const { tree, parser, root } = parse(`
class Foo:
    def instance_method(self, x: int):
        pass

    @classmethod
    def class_method(cls, y: str):
        pass
`);
      const result = extractor.extractStructure(root);
      // Methods are on the class, but top-level functions should not include them
      expect(result.functions).toHaveLength(0);
      expect(result.classes[0].methods).toEqual(["instance_method", "class_method"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct class line ranges", () => {
      const { tree, parser, root } = parse(`
class MyClass:
    def method_a(self):
        pass

    def method_b(self):
        pass
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].lineRange[0]).toBe(2);
      expect(result.classes[0].lineRange[1]).toBe(7);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts simple import statements", () => {
      const { tree, parser, root } = parse(`
import os
import sys
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("os");
      expect(result.imports[0].specifiers).toEqual(["os"]);
      expect(result.imports[1].source).toBe("sys");
      expect(result.imports[1].specifiers).toEqual(["sys"]);

      tree.delete();
      parser.delete();
    });

    it("extracts from-import statements", () => {
      const { tree, parser, root } = parse(`
from pathlib import Path
from typing import Optional, List
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("pathlib");
      expect(result.imports[0].specifiers).toEqual(["Path"]);
      expect(result.imports[1].source).toBe("typing");
      expect(result.imports[1].specifiers).toEqual(["Optional", "List"]);

      tree.delete();
      parser.delete();
    });

    it("extracts aliased imports", () => {
      const { tree, parser, root } = parse(`
from foo import bar as baz
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("foo");
      expect(result.imports[0].specifiers).toEqual(["baz"]);

      tree.delete();
      parser.delete();
    });

    it("extracts dotted module imports", () => {
      const { tree, parser, root } = parse(`
import os.path
from os.path import join, exists
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("os.path");
      expect(result.imports[0].specifiers).toEqual(["os.path"]);
      expect(result.imports[1].source).toBe("os.path");
      expect(result.imports[1].specifiers).toEqual(["join", "exists"]);

      tree.delete();
      parser.delete();
    });

    it("extracts wildcard imports", () => {
      const { tree, parser, root } = parse(`
from os.path import *
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("os.path");
      expect(result.imports[0].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("handles all import types together", () => {
      const { tree, parser, root } = parse(`
import os
from pathlib import Path
from typing import Optional, List
`);
      const result = extractor.extractStructure(root);

      expect(result.imports.length).toBeGreaterThanOrEqual(3);

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`
import os
from pathlib import Path
`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].lineNumber).toBe(2);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("treats top-level functions as exports", () => {
      const { tree, parser, root } = parse(`
def public_func():
    pass

def another_func(x: int) -> str:
    return str(x)
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("public_func");
      expect(exportNames).toContain("another_func");
      expect(result.exports).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("treats top-level classes as exports", () => {
      const { tree, parser, root } = parse(`
class MyService:
    pass

class MyModel:
    pass
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("MyService");
      expect(exportNames).toContain("MyModel");
      expect(result.exports).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("treats decorated top-level definitions as exports", () => {
      const { tree, parser, root } = parse(`
@dataclass
class Config:
    name: str

@app.route("/")
def index():
    pass
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Config");
      expect(exportNames).toContain("index");

      tree.delete();
      parser.delete();
    });

    it("does not treat imports as exports", () => {
      const { tree, parser, root } = parse(`
import os
from pathlib import Path

def my_func():
    pass
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe("my_func");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple function calls", () => {
      const { tree, parser, root } = parse(`
def process(data):
    result = transform(data)
    return format_output(result)

def main():
    process([1, 2, 3])
`);
      const result = extractor.extractCallGraph(root);

      expect(result.length).toBeGreaterThanOrEqual(2);

      const processCallers = result.filter((e) => e.caller === "process");
      expect(processCallers.some((e) => e.callee === "transform")).toBe(true);
      expect(processCallers.some((e) => e.callee === "format_output")).toBe(true);

      const mainCallers = result.filter((e) => e.caller === "main");
      expect(mainCallers.some((e) => e.callee === "process")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts attribute-based calls (method calls)", () => {
      const { tree, parser, root } = parse(`
def process():
    self.method()
    os.path.join("a", "b")
    result.save()
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(callees).toContain("self.method");
      expect(callees).toContain("os.path.join");
      expect(callees).toContain("result.save");

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller context for nested calls", () => {
      const { tree, parser, root } = parse(`
def outer():
    helper()
    def inner():
        deep_call()
    another()
`);
      const result = extractor.extractCallGraph(root);

      const outerCalls = result.filter((e) => e.caller === "outer");
      expect(outerCalls.some((e) => e.callee === "helper")).toBe(true);
      expect(outerCalls.some((e) => e.callee === "another")).toBe(true);

      const innerCalls = result.filter((e) => e.caller === "inner");
      expect(innerCalls.some((e) => e.callee === "deep_call")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`
def main():
    foo()
    bar()
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(4);

      tree.delete();
      parser.delete();
    });

    it("ignores top-level calls (no caller)", () => {
      const { tree, parser, root } = parse(`
print("hello")
main()
`);
      const result = extractor.extractCallGraph(root);

      // Top-level calls have no enclosing function, so they are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("handles calls inside class methods", () => {
      const { tree, parser, root } = parse(`
class Service:
    def start(self):
        self.setup()
        run_server()
`);
      const result = extractor.extractCallGraph(root);

      const startCalls = result.filter((e) => e.caller === "start");
      expect(startCalls.some((e) => e.callee === "self.setup")).toBe(true);
      expect(startCalls.some((e) => e.callee === "run_server")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive Python file", () => {
    it("handles a realistic Python module", () => {
      const { tree, parser, root } = parse(`
import os
from pathlib import Path
from typing import Optional, List

class FileProcessor:
    name: str
    verbose: bool

    def __init__(self, name: str, verbose: bool = False):
        self.name = name
        self.verbose = verbose

    def process(self, paths: List[str]) -> dict:
        results = {}
        for p in paths:
            results[p] = self._read_file(p)
        return results

    def _read_file(self, path: str) -> Optional[str]:
        full = Path(path)
        if full.exists():
            return full.read_text()
        return None

def create_processor(name: str) -> FileProcessor:
    return FileProcessor(name)

@staticmethod
def utility_func(*args, **kwargs) -> None:
    print(args, kwargs)
`);
      const result = extractor.extractStructure(root);

      // Imports
      expect(result.imports.length).toBeGreaterThanOrEqual(3);

      // Class
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("FileProcessor");
      expect(result.classes[0].methods).toContain("__init__");
      expect(result.classes[0].methods).toContain("process");
      expect(result.classes[0].methods).toContain("_read_file");
      expect(result.classes[0].properties).toContain("name");
      expect(result.classes[0].properties).toContain("verbose");

      // Top-level functions
      expect(result.functions.some((f) => f.name === "create_processor")).toBe(
        true,
      );
      expect(result.functions.some((f) => f.name === "utility_func")).toBe(
        true,
      );

      // Exports (top-level defs)
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("FileProcessor");
      expect(exportNames).toContain("create_processor");
      expect(exportNames).toContain("utility_func");

      // Call graph
      const calls = extractor.extractCallGraph(root);
      expect(calls.length).toBeGreaterThan(0);

      tree.delete();
      parser.delete();
    });
  });
});

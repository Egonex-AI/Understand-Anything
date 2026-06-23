import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { GoExtractor } from "../go-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Go grammar once
let Parser: any;
let Language: any;
let goLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-go/tree-sitter-go.wasm",
  );
  goLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(goLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("GoExtractor", () => {
  const extractor = new GoExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["go"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts functions with params and return types", () => {
      const { tree, parser, root } = parse(`package main

func NewServer(host string, port int) *Server {
    return nil
}

func helper(x int) string {
    return ""
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("NewServer");
      expect(result.functions[0].params).toEqual(["host", "port"]);
      expect(result.functions[0].returnType).toBe("*Server");
      expect(result.functions[0].lineRange[0]).toBe(3);

      expect(result.functions[1].name).toBe("helper");
      expect(result.functions[1].params).toEqual(["x"]);
      expect(result.functions[1].returnType).toBe("string");

      tree.delete();
      parser.delete();
    });

    it("extracts functions with no params and no return type", () => {
      const { tree, parser, root } = parse(`package main

func noop() {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts functions with multiple return types", () => {
      const { tree, parser, root } = parse(`package main

func divide(a, b float64) (float64, error) {
    return 0, nil
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("divide");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("(float64, error)");

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges for multi-line functions", () => {
      const { tree, parser, root } = parse(`package main

func multiline(
    a int,
    b int,
) int {
    result := a + b
    return result
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(3);
      expect(result.functions[0].lineRange[1]).toBe(9);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Methods ----

  describe("extractStructure - methods", () => {
    it("extracts methods with receivers", () => {
      const { tree, parser, root } = parse(`package main

type Server struct {
    Host string
}

func (s *Server) Start() error {
    return nil
}

func (s Server) Name() string {
    return s.Host
}
`);
      const result = extractor.extractStructure(root);

      // Methods appear in functions list
      const methodNames = result.functions.map((f) => f.name);
      expect(methodNames).toContain("Start");
      expect(methodNames).toContain("Name");

      // Methods are also linked to the struct
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].methods).toContain("Start");
      expect(result.classes[0].methods).toContain("Name");

      // Method return types are extracted
      const startFn = result.functions.find((f) => f.name === "Start");
      expect(startFn?.returnType).toBe("error");
      expect(startFn?.params).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Structs ----

  describe("extractStructure - structs", () => {
    it("extracts struct with fields", () => {
      const { tree, parser, root } = parse(`package main

type Server struct {
    Host string
    Port int
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["Host", "Port"]);
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].lineRange[0]).toBe(3);

      tree.delete();
      parser.delete();
    });

    it("extracts empty struct", () => {
      const { tree, parser, root } = parse(`package main

type Empty struct{}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].properties).toEqual([]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts struct with multiple name fields sharing a type", () => {
      const { tree, parser, root } = parse(`package main

type Point struct {
    X, Y int
    Z    float64
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].properties).toContain("X");
      expect(result.classes[0].properties).toContain("Y");
      expect(result.classes[0].properties).toContain("Z");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Interfaces ----

  describe("extractStructure - interfaces", () => {
    it("extracts interface with method signatures", () => {
      const { tree, parser, root } = parse(`package main

type Reader interface {
    Read(buf []byte) (int, error)
    Close() error
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Reader");
      expect(result.classes[0].methods).toEqual(["Read", "Close"]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts empty interface", () => {
      const { tree, parser, root } = parse(`package main

type Any interface{}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Any");
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts grouped imports", () => {
      const { tree, parser, root } = parse(`package main

import (
    "fmt"
    "os"
)
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("fmt");
      expect(result.imports[0].specifiers).toEqual(["fmt"]);
      expect(result.imports[1].source).toBe("os");
      expect(result.imports[1].specifiers).toEqual(["os"]);

      tree.delete();
      parser.delete();
    });

    it("extracts single import", () => {
      const { tree, parser, root } = parse(`package main

import "fmt"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("fmt");
      expect(result.imports[0].specifiers).toEqual(["fmt"]);

      tree.delete();
      parser.delete();
    });

    it("extracts imports with path components", () => {
      const { tree, parser, root } = parse(`package main

import "net/http"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("net/http");
      expect(result.imports[0].specifiers).toEqual(["http"]);

      tree.delete();
      parser.delete();
    });

    it("extracts aliased imports", () => {
      const { tree, parser, root } = parse(`package main

import (
    f "fmt"
    myhttp "net/http"
)
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("fmt");
      expect(result.imports[0].specifiers).toEqual(["f"]);
      expect(result.imports[1].source).toBe("net/http");
      expect(result.imports[1].specifiers).toEqual(["myhttp"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`package main

import (
    "fmt"
    "os"
)
`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].lineNumber).toBe(4);
      expect(result.imports[1].lineNumber).toBe(5);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("exports uppercase function and type names", () => {
      const { tree, parser, root } = parse(`package main

type Server struct {
    Host string
    Port int
}

func (s *Server) Start() error {
    return nil
}

func NewServer(host string, port int) *Server {
    return nil
}

func helper(x int) string {
    return ""
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Server");
      expect(exportNames).toContain("Start");
      expect(exportNames).toContain("NewServer");
      expect(exportNames).not.toContain("helper");
      expect(result.exports).toHaveLength(3);

      tree.delete();
      parser.delete();
    });

    it("does not export lowercase names", () => {
      const { tree, parser, root } = parse(`package main

type internal struct {
    value int
}

func private() {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("exports uppercase interface names", () => {
      const { tree, parser, root } = parse(`package main

type Writer interface {
    Write(data []byte) error
}

type reader interface {
    read() error
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Writer");
      expect(exportNames).not.toContain("reader");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple function calls", () => {
      const { tree, parser, root } = parse(`package main

func process(data int) {
    transform(data)
    formatOutput(data)
}

func main() {
    process(42)
}
`);
      const result = extractor.extractCallGraph(root);

      const processCalls = result.filter((e) => e.caller === "process");
      expect(processCalls.some((e) => e.callee === "transform")).toBe(true);
      expect(processCalls.some((e) => e.callee === "formatOutput")).toBe(true);

      const mainCalls = result.filter((e) => e.caller === "main");
      expect(mainCalls.some((e) => e.callee === "process")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts selector expression calls (e.g. fmt.Println)", () => {
      const { tree, parser, root } = parse(`package main

import "fmt"

func Start() {
    fmt.Println("starting")
}

func helper(x int) string {
    return fmt.Sprintf("%d", x)
}
`);
      const result = extractor.extractCallGraph(root);

      const startCalls = result.filter((e) => e.caller === "Start");
      expect(startCalls.some((e) => e.callee === "fmt.Println")).toBe(true);

      const helperCalls = result.filter((e) => e.caller === "helper");
      expect(helperCalls.some((e) => e.callee === "fmt.Sprintf")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller for methods", () => {
      const { tree, parser, root } = parse(`package main

import "fmt"

func (s *Server) Start() error {
    fmt.Println("starting")
    return nil
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("Start");
      expect(result[0].callee).toBe("fmt.Println");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`package main

func main() {
    foo()
    bar()
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(4);
      expect(result[1].lineNumber).toBe(5);

      tree.delete();
      parser.delete();
    });

    it("ignores top-level calls (no caller)", () => {
      const { tree, parser, root } = parse(`package main

var _ = fmt.Println("hello")
`);
      const result = extractor.extractCallGraph(root);

      // Top-level calls have no enclosing function, so they are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive Go file", () => {
    it("handles a realistic Go module", () => {
      const { tree, parser, root } = parse(`package main

import (
    "fmt"
    "os"
)

type Server struct {
    Host string
    Port int
}

func (s *Server) Start() error {
    fmt.Println("starting")
    return nil
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}

func helper(x int) string {
    return fmt.Sprintf("%d", x)
}
`);
      const result = extractor.extractStructure(root);

      // Functions: Start, NewServer, helper
      expect(result.functions).toHaveLength(3);
      expect(result.functions.map((f) => f.name).sort()).toEqual(
        ["Start", "NewServer", "helper"].sort(),
      );

      // Struct: Server with properties Host, Port and method Start
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["Host", "Port"]);
      expect(result.classes[0].methods).toContain("Start");

      // Imports: fmt, os
      expect(result.imports).toHaveLength(2);
      expect(result.imports.map((i) => i.source).sort()).toEqual(["fmt", "os"]);

      // Exports: Server, Start, NewServer (all uppercase)
      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toEqual(["NewServer", "Server", "Start"]);

      // Call graph
      const calls = extractor.extractCallGraph(root);
      const startCalls = calls.filter((e) => e.caller === "Start");
      expect(startCalls.some((e) => e.callee === "fmt.Println")).toBe(true);

      const helperCalls = calls.filter((e) => e.caller === "helper");
      expect(helperCalls.some((e) => e.callee === "fmt.Sprintf")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

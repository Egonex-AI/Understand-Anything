import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { CppExtractor } from "../cpp-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + C++ grammar once
let Parser: any;
let Language: any;
let cppLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-cpp/tree-sitter-cpp.wasm",
  );
  cppLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(cppLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("CppExtractor", () => {
  const extractor = new CppExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["cpp", "c"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts top-level functions with params and return types", () => {
      const { tree, parser, root } = parse(`
int add(int a, int b) {
    return a + b;
}

void greet(const char* name) {
    printf("Hello %s", name);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("int");

      expect(result.functions[1].name).toBe("greet");
      expect(result.functions[1].params).toEqual(["name"]);
      expect(result.functions[1].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts functions with no params", () => {
      const { tree, parser, root } = parse(`
int get_value() {
    return 42;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("get_value");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBe("int");

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges for multi-line functions", () => {
      const { tree, parser, root } = parse(`
int multiline(
    int a,
    int b
) {
    int result = a + b;
    return result;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(2);
      expect(result.functions[0].lineRange[1]).toBe(8);

      tree.delete();
      parser.delete();
    });

    it("handles pointer and reference parameters", () => {
      const { tree, parser, root } = parse(`
void process(int* ptr, const char& ref, int arr[]) {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toEqual(["ptr", "ref", "arr"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts class with properties and method declarations", () => {
      const { tree, parser, root } = parse(`
class Server {
public:
    std::string host;
    int port;

    void start();
    int getPort() { return port; }
};
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
      expect(result.classes[0].methods).toContain("start");
      expect(result.classes[0].methods).toContain("getPort");

      tree.delete();
      parser.delete();
    });

    it("respects access specifiers for exports", () => {
      const { tree, parser, root } = parse(`
class Foo {
private:
    int secret;
    void hidden();
public:
    int visible;
    void exposed();
};
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      // Public members should be exported
      expect(exportNames).toContain("exposed");
      // Private members should NOT be exported (except the class name itself)
      expect(exportNames).not.toContain("hidden");
      expect(exportNames).not.toContain("secret");
      // The class itself is always exported
      expect(exportNames).toContain("Foo");

      tree.delete();
      parser.delete();
    });

    it("defaults class members to private access", () => {
      const { tree, parser, root } = parse(`
class Priv {
    int x;
    void secret();
};
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Priv");
      // Members without access specifier in a class default to private
      expect(exportNames).not.toContain("secret");

      tree.delete();
      parser.delete();
    });

    it("handles inline method definitions (function_definition inside class)", () => {
      const { tree, parser, root } = parse(`
class Calculator {
public:
    int add(int a, int b) { return a + b; }
};
`);
      const result = extractor.extractStructure(root);

      // Inline method should appear in both classes.methods and functions
      expect(result.classes[0].methods).toContain("add");

      const addFn = result.functions.find((f) => f.name === "add");
      expect(addFn).toBeDefined();
      expect(addFn!.params).toEqual(["a", "b"]);
      expect(addFn!.returnType).toBe("int");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Structs ----

  describe("extractStructure - structs", () => {
    it("extracts struct with fields", () => {
      const { tree, parser, root } = parse(`
struct Point {
    int x;
    int y;
};
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Point");
      expect(result.classes[0].properties).toEqual(["x", "y"]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("defaults struct members to public access and exports them", () => {
      const { tree, parser, root } = parse(`
struct Config {
    int port;
    void init();
};
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      // Struct members default to public
      expect(exportNames).toContain("Config");
      expect(exportNames).toContain("init");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Includes (imports) ----

  describe("extractStructure - includes", () => {
    it("extracts system includes (angle brackets)", () => {
      const { tree, parser, root } = parse(`
#include <iostream>
#include <vector>
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("iostream");
      expect(result.imports[0].specifiers).toEqual(["iostream"]);
      expect(result.imports[1].source).toBe("vector");

      tree.delete();
      parser.delete();
    });

    it("extracts local includes (quoted)", () => {
      const { tree, parser, root } = parse(`
#include "config.h"
#include "utils/helper.h"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("config.h");
      expect(result.imports[0].specifiers).toEqual(["config.h"]);
      expect(result.imports[1].source).toBe("utils/helper.h");

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`
#include <iostream>
#include "config.h"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].lineNumber).toBe(2);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Namespaces ----

  describe("extractStructure - namespaces", () => {
    it("extracts functions inside namespaces", () => {
      const { tree, parser, root } = parse(`
namespace utils {
    int add(int a, int b) {
        return a + b;
    }

    void log(const char* msg) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      const names = result.functions.map((f) => f.name);
      expect(names).toContain("add");
      expect(names).toContain("log");

      tree.delete();
      parser.delete();
    });

    it("extracts classes inside namespaces", () => {
      const { tree, parser, root } = parse(`
namespace models {
    class User {
    public:
        std::string name;
        int id;
    };
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].properties).toEqual(["name", "id"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Out-of-class method definitions ----

  describe("extractStructure - out-of-class methods", () => {
    it("associates out-of-class method with its class", () => {
      const { tree, parser, root } = parse(`
class Server {
public:
    void start();
};

void Server::start() {
    // implementation
}
`);
      const result = extractor.extractStructure(root);

      // The class should have start as a method (from both declaration and definition)
      expect(result.classes[0].methods).toContain("start");

      // The out-of-class definition should appear in functions
      const startFn = result.functions.find((f) => f.name === "start");
      expect(startFn).toBeDefined();
      expect(startFn!.returnType).toBe("void");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("exports non-static functions and not static ones", () => {
      const { tree, parser, root } = parse(`
int public_fn(int x) { return x; }

static void private_fn() {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("public_fn");
      expect(exportNames).not.toContain("private_fn");

      tree.delete();
      parser.delete();
    });

    it("reports correct export line numbers", () => {
      const { tree, parser, root } = parse(`
struct Point {
    int x;
    int y;
};

int compute(int n) { return n * 2; }
`);
      const result = extractor.extractStructure(root);

      const pointExport = result.exports.find((e) => e.name === "Point");
      expect(pointExport?.lineNumber).toBe(2);

      const computeExport = result.exports.find((e) => e.name === "compute");
      expect(computeExport?.lineNumber).toBe(7);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple function calls", () => {
      const { tree, parser, root } = parse(`
void helper(int x) {}

int main() {
    helper(42);
}
`);
      const result = extractor.extractCallGraph(root);

      const mainCalls = result.filter((e) => e.caller === "main");
      expect(mainCalls.some((e) => e.callee === "helper")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple calls from one function", () => {
      const { tree, parser, root } = parse(`
void foo() {}
void bar() {}

int main() {
    foo();
    bar();
}
`);
      const result = extractor.extractCallGraph(root);

      const mainCalls = result.filter((e) => e.caller === "main");
      expect(mainCalls).toHaveLength(2);
      expect(mainCalls.some((e) => e.callee === "foo")).toBe(true);
      expect(mainCalls.some((e) => e.callee === "bar")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts calls inside namespace functions", () => {
      const { tree, parser, root } = parse(`
int baz(int x) { return x; }

namespace ns {
    void inner() {
        baz(42);
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result.some((e) => e.caller === "inner" && e.callee === "baz")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`
int main() {
    foo();
    bar();
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(4);

      tree.delete();
      parser.delete();
    });

    it("ignores calls outside of functions (no caller)", () => {
      const { tree, parser, root } = parse(`
int x = compute();
`);
      const result = extractor.extractCallGraph(root);

      // Top-level initializers have no enclosing function
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("tracks member function calls (field_expression)", () => {
      const { tree, parser, root } = parse(`
void process() {
    obj.method();
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("process");
      expect(result[0].callee).toBe("method");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive C++ test ----

  describe("comprehensive C++ file", () => {
    it("handles the full C++ test scenario from the spec", () => {
      const { tree, parser, root } = parse(`#include <iostream>
#include "config.h"

class Server {
public:
    std::string host;
    int port;

    void start();
    int getPort() { return port; }
};

void Server::start() {
    std::cout << "starting" << std::endl;
}

namespace utils {
    int add(int a, int b) {
        return a + b;
    }
}
`);
      const result = extractor.extractStructure(root);

      // Imports: 2 includes
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("iostream");
      expect(result.imports[1].source).toBe("config.h");

      // Classes: Server
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
      expect(result.classes[0].methods).toContain("start");
      expect(result.classes[0].methods).toContain("getPort");

      // Functions: getPort (inline), start (out-of-class), add (namespace)
      expect(result.functions).toHaveLength(3);
      const fnNames = result.functions.map((f) => f.name).sort();
      expect(fnNames).toEqual(["add", "getPort", "start"]);

      // add() params
      const addFn = result.functions.find((f) => f.name === "add");
      expect(addFn?.params).toEqual(["a", "b"]);
      expect(addFn?.returnType).toBe("int");

      // getPort() inline
      const getPortFn = result.functions.find((f) => f.name === "getPort");
      expect(getPortFn?.params).toEqual([]);
      expect(getPortFn?.returnType).toBe("int");

      // Exports: Server, start, getPort, add (all non-static/public)
      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toContain("Server");
      expect(exportNames).toContain("start");
      expect(exportNames).toContain("getPort");
      expect(exportNames).toContain("add");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive pure C test ----

  describe("comprehensive pure C file", () => {
    it("handles pure C code with structs and functions", () => {
      const { tree, parser, root } = parse(`#include <stdio.h>
#include "helper.h"

struct Point {
    int x;
    int y;
};

void print_point(struct Point* p) {
    printf("(%d, %d)", p->x, p->y);
}

int main() {
    struct Point p = {1, 2};
    print_point(&p);
    return 0;
}
`);
      const result = extractor.extractStructure(root);

      // Imports: 2 includes
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("stdio.h");
      expect(result.imports[0].specifiers).toEqual(["stdio.h"]);
      expect(result.imports[1].source).toBe("helper.h");

      // Classes: Point (struct mapped to class)
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Point");
      expect(result.classes[0].properties).toEqual(["x", "y"]);
      expect(result.classes[0].methods).toEqual([]);

      // Functions: print_point and main
      expect(result.functions).toHaveLength(2);
      const fnNames = result.functions.map((f) => f.name).sort();
      expect(fnNames).toEqual(["main", "print_point"]);

      // print_point params
      const printFn = result.functions.find((f) => f.name === "print_point");
      expect(printFn?.params).toEqual(["p"]);
      expect(printFn?.returnType).toBe("void");

      // main params
      const mainFn = result.functions.find((f) => f.name === "main");
      expect(mainFn?.params).toEqual([]);
      expect(mainFn?.returnType).toBe("int");

      // Exports: non-static functions + struct name
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Point");
      expect(exportNames).toContain("print_point");
      expect(exportNames).toContain("main");

      // Call graph
      const calls = extractor.extractCallGraph(root);

      // print_point calls printf
      const printCalls = calls.filter((e) => e.caller === "print_point");
      expect(printCalls.some((e) => e.callee === "printf")).toBe(true);

      // main calls print_point
      const mainCalls = calls.filter((e) => e.caller === "main");
      expect(mainCalls.some((e) => e.callee === "print_point")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("handles pure C code without any classes or structs", () => {
      const { tree, parser, root } = parse(`
#include <stdlib.h>

int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(5);
    return 0;
}
`);
      const result = extractor.extractStructure(root);

      // No classes in pure C without structs
      expect(result.classes).toHaveLength(0);

      // Functions
      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("factorial");
      expect(result.functions[0].params).toEqual(["n"]);
      expect(result.functions[1].name).toBe("main");

      // Call graph: factorial is recursive, main calls factorial
      const calls = extractor.extractCallGraph(root);
      expect(calls.some((e) => e.caller === "factorial" && e.callee === "factorial")).toBe(true);
      expect(calls.some((e) => e.caller === "main" && e.callee === "factorial")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

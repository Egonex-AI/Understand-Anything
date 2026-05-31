import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { DartExtractor } from "../dart-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let dartLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "@repomix/tree-sitter-wasms/out/tree-sitter-dart.wasm",
  );
  dartLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(dartLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("DartExtractor", () => {
  const extractor = new DartExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["dart"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts a simple top-level function with params and return type", () => {
      const { tree, parser, root } = parse(`int add(int a, int b) => a + b;
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("int");

      tree.delete();
      parser.delete();
    });

    it("extracts a void function with no params", () => {
      const { tree, parser, root } = parse(`void noop() {}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts an async function returning a Future", () => {
      const { tree, parser, root } = parse(`Future<String> fetch(String id) async {
  return "";
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("fetch");
      expect(result.functions[0].params).toEqual(["id"]);
      // The grammar represents `Future<String>` as type_identifier + type_arguments
      expect(result.functions[0].returnType).toMatch(/^Future/);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple top-level functions in declaration order", () => {
      const { tree, parser, root } = parse(`void one() {}
int two(int x) => x;
String three() => "";
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toEqual([
        "one",
        "two",
        "three",
      ]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts a class with field + constructor + method", () => {
      const { tree, parser, root } = parse(`class Foo {
  final int bar;
  Foo(this.bar);
  int compute() => bar * 2;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Foo");
      expect(result.classes[0].properties).toContain("bar");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["Foo", "compute"]),
      );

      tree.delete();
      parser.delete();
    });

    it("extracts an abstract class with method signature only", () => {
      const { tree, parser, root } = parse(`abstract class Greeter {
  String greet(String name);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Greeter");
      expect(result.classes[0].methods).toContain("greet");

      tree.delete();
      parser.delete();
    });

    it("class methods appear in functions[] as well as the class's methods[]", () => {
      const { tree, parser, root } = parse(`class Foo {
  int bar() => 1;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toContain("bar");
      expect(result.classes[0].methods).toContain("bar");

      tree.delete();
      parser.delete();
    });

    it("extracts multiple field names declared as a comma list", () => {
      const { tree, parser, root } = parse(`class Point {
  double x, y;
  Point(this.x, this.y);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].properties).toEqual(
        expect.arrayContaining(["x", "y"]),
      );

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - mixins", () => {
    it("extracts a mixin with methods as a class-like entry", () => {
      const { tree, parser, root } = parse(`mixin Logger {
  void log(String msg) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Logger");
      expect(result.classes[0].methods).toContain("log");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - enums", () => {
    it("extracts enum cases as properties", () => {
      const { tree, parser, root } = parse(`enum Direction { north, south, east, west }
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Direction");
      expect(result.classes[0].properties).toEqual([
        "north",
        "south",
        "east",
        "west",
      ]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - extensions", () => {
    it("extracts an extension with methods as a class-like entry named after the extension", () => {
      const { tree, parser, root } = parse(`extension StringX on String {
  String shout() => toUpperCase();
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("StringX");
      expect(result.classes[0].methods).toContain("shout");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts a simple `dart:` import", () => {
      const { tree, parser, root } = parse(`import "dart:io";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("dart:io");
      expect(result.imports[0].specifiers).toEqual(["io"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a `package:` import with an `as` alias", () => {
      const { tree, parser, root } = parse(`import "package:foo/bar.dart" as bar;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("package:foo/bar.dart");
      expect(result.imports[0].specifiers).toEqual(["bar"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a `show` combinator's selectively imported identifiers", () => {
      const { tree, parser, root } = parse(`import "dart:async" show Future, Stream;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("dart:async");
      expect(result.imports[0].specifiers).toEqual(["Future", "Stream"]);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple imports in declaration order", () => {
      const { tree, parser, root } = parse(`import "dart:io";
import "package:flutter/material.dart";
import "dart:async" show Future;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe("dart:io");
      expect(result.imports[1].source).toBe("package:flutter/material.dart");
      expect(result.imports[2].source).toBe("dart:async");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports / privacy (underscore prefix)", () => {
    it("treats functions without a leading underscore as exported", () => {
      const { tree, parser, root } = parse(`void publicFn() {}
class Public {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(
        expect.arrayContaining(["publicFn", "Public"]),
      );

      tree.delete();
      parser.delete();
    });

    it("does NOT export declarations whose name starts with `_`", () => {
      const { tree, parser, root } = parse(`void _internal() {}
class _PrivateClass {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).not.toContain("_internal");
      expect(exportNames).not.toContain("_PrivateClass");

      tree.delete();
      parser.delete();
    });

    it("exports a mixin / extension / enum by default if not underscore-prefixed", () => {
      const { tree, parser, root } = parse(`mixin Logger {}
extension StringX on String {}
enum Direction { north }
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(
        expect.arrayContaining(["Logger", "StringX", "Direction"]),
      );

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts a direct function call", () => {
      const { tree, parser, root } = parse(`int helper() => 1;

int caller() {
  return helper();
}
`);
      const entries = extractor.extractCallGraph(root);

      const helperCall = entries.find((e) => e.callee === "helper");
      expect(helperCall).toBeDefined();
      expect(helperCall!.caller).toBe("caller");

      tree.delete();
      parser.delete();
    });

    it("extracts a method call on a value (x.foo())", () => {
      const { tree, parser, root } = parse(`void run() {
  var s = "hi".toUpperCase();
}
`);
      const entries = extractor.extractCallGraph(root);

      const callees = entries.map((e) => e.callee);
      expect(callees).toContain("toUpperCase");

      tree.delete();
      parser.delete();
    });
  });
});

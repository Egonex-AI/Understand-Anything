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
    "@understand-anything/tree-sitter-dart-wasm/tree-sitter-dart.wasm",
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
      const { tree, parser, root } = parse(`int add(int a, int b) => a + b;\n`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("int");

      tree.delete();
      parser.delete();
    });

    it("extracts a function with no params and void return type", () => {
      const { tree, parser, root } = parse(`void noop() {}\n`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts an async function with a generic return type", () => {
      const { tree, parser, root } = parse(`Future<String> fetch(String url) async { return ""; }\n`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("fetch");
      expect(result.functions[0].params).toEqual(["url"]);
      expect(result.functions[0].returnType).toBe("Future<String>");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - parameter kinds", () => {
    it("surfaces optional positional parameters", () => {
      const { tree, parser, root } = parse(`void show([String? title, int count = 0]) {}\n`);
      const result = extractor.extractStructure(root);

      expect(result.functions[0].params).toEqual(["title", "count"]);
      tree.delete();
      parser.delete();
    });

    it("surfaces named parameters wrapped in {...}", () => {
      const { tree, parser, root } = parse(`void show({String? title, int count = 0}) {}\n`);
      const result = extractor.extractStructure(root);

      expect(result.functions[0].params).toEqual(["title", "count"]);
      tree.delete();
      parser.delete();
    });

    it("mixes required and named parameters in one signature", () => {
      const { tree, parser, root } = parse(`String join(List<String> items, {String sep = ","}) => "";\n`);
      const result = extractor.extractStructure(root);

      expect(result.functions[0].params).toEqual(["items", "sep"]);
      tree.delete();
      parser.delete();
    });

    it("extracts `this.field` constructor parameters as the field name", () => {
      const { tree, parser, root } = parse(`class Foo {
  int x;
  String y;
  Foo(this.x, this.y);
}
`);
      const result = extractor.extractStructure(root);

      const ctor = result.functions.find((f) => f.name === "Foo");
      expect(ctor).toBeDefined();
      expect(ctor!.params).toEqual(["x", "y"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts a class with fields and methods", () => {
      const { tree, parser, root } = parse(`class Counter {
  int count = 0;
  String? label;
  void increment() { count++; }
  int get value => count;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Counter");
      expect(result.classes[0].methods).toContain("increment");
      // method declarations land in functions[] too (matching Kotlin convention)
      expect(result.functions.map((f) => f.name)).toContain("increment");
      // Field extraction: `int count = 0;` and `String? label;` both parse as
      // declaration > initialized_identifier_list > initialized_identifier > identifier
      expect(result.classes[0].properties).toEqual(
        expect.arrayContaining(["count", "label"]),
      );
      // Getters are surfaced as methods (`int get value` → "value").
      expect(result.classes[0].methods).toContain("value");

      tree.delete();
      parser.delete();
    });

    it("extracts an empty class", () => {
      const { tree, parser, root } = parse(`class Empty {}\n`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts an abstract class with method requirements", () => {
      const { tree, parser, root } = parse(`abstract class Shape {
  double area();
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Shape");
      expect(result.classes[0].methods).toContain("area");

      tree.delete();
      parser.delete();
    });

    it("extracts a class with extends + with + implements clauses", () => {
      const { tree, parser, root } = parse(`class Square extends Shape with Comparable<Square> implements Cloneable {
  double side;
  Square(this.side);
  double area() => side * side;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Square");
      expect(result.classes[0].methods).toContain("area");

      tree.delete();
      parser.delete();
    });

    it("extracts comma-list field declarations as separate properties", () => {
      const { tree, parser, root } = parse(`class Foo { int a, b, c; }\n`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].properties).toEqual(["a", "b", "c"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - getters and setters", () => {
    it("surfaces a concrete getter as a method", () => {
      const { tree, parser, root } = parse(`class Counter {
  int _v = 0;
  int get value => _v;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("value");
      expect(result.functions.map((f) => f.name)).toContain("value");
      tree.delete();
      parser.delete();
    });

    it("surfaces a concrete setter as a method", () => {
      const { tree, parser, root } = parse(`class Counter {
  int _v = 0;
  set value(int x) => _v = x;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("value");
      expect(result.functions.map((f) => f.name)).toContain("value");
      tree.delete();
      parser.delete();
    });

    it("surfaces an abstract getter as a method", () => {
      const { tree, parser, root } = parse(`abstract class Shape {
  double get area;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("area");
      tree.delete();
      parser.delete();
    });

    it("surfaces an abstract setter as a method", () => {
      const { tree, parser, root } = parse(`abstract class Box {
  set width(int w);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("width");
      tree.delete();
      parser.delete();
    });

    it("does NOT export an underscore-prefixed getter", () => {
      const { tree, parser, root } = parse(`class Counter {
  int _v = 0;
  int get _internal => _v;
  int get visible => _v;
}
`);
      const result = extractor.extractStructure(root);

      const names = result.exports.map((e) => e.name);
      expect(names).toContain("visible");
      expect(names).not.toContain("_internal");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - constructors", () => {
    it("treats an unnamed constructor as a method named after the class", () => {
      const { tree, parser, root } = parse(`class Foo {
  int x;
  Foo(this.x);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("Foo");
      tree.delete();
      parser.delete();
    });

    it("treats a named constructor as Class.named", () => {
      const { tree, parser, root } = parse(`class Foo {
  int x;
  Foo.zero() : x = 0;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("Foo.zero");
      tree.delete();
      parser.delete();
    });

    it("treats a factory named constructor as Class.named", () => {
      const { tree, parser, root } = parse(`class Foo {
  int x;
  Foo(this.x);
  factory Foo.fromString(String s) => Foo(int.parse(s));
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toContain("Foo.fromString");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - mixins", () => {
    it("extracts a plain mixin as a class-like entry", () => {
      const { tree, parser, root } = parse(`mixin Walker {
  void walk() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Walker");
      expect(result.classes[0].methods).toContain("walk");
      tree.delete();
      parser.delete();
    });

    it("extracts a mixin with an `on` constraint", () => {
      const { tree, parser, root } = parse(`mixin Runner on Walker {
  void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].name).toBe("Runner");
      expect(result.classes[0].methods).toContain("run");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - enums", () => {
    it("extracts a simple enum and surfaces its constants as properties", () => {
      const { tree, parser, root } = parse(`enum Color { red, green, blue }\n`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Color");
      expect(result.classes[0].properties).toEqual(["red", "green", "blue"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - extensions", () => {
    it("extracts a named extension on String", () => {
      const { tree, parser, root } = parse(`extension StringX on String {
  String shout() => toUpperCase() + '!';
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("StringX");
      expect(result.classes[0].methods).toContain("shout");
      tree.delete();
      parser.delete();
    });

    it("names an anonymous extension after its target type", () => {
      const { tree, parser, root } = parse(`extension on int {
  int squared() => this * this;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      // Anonymous extension on int → "on int" so it isn't dropped.
      expect(result.classes[0].name).toBe("on int");
      expect(result.classes[0].methods).toContain("squared");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts a package import with no specifiers", () => {
      const { tree, parser, root } = parse(`import 'package:flutter/material.dart';\n`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("package:flutter/material.dart");
      expect(result.imports[0].specifiers).toEqual([]);
      tree.delete();
      parser.delete();
    });

    it("extracts a relative import", () => {
      const { tree, parser, root } = parse(`import './foo.dart';\n`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].source).toBe("./foo.dart");
      tree.delete();
      parser.delete();
    });

    it("extracts a `show` clause as specifiers", () => {
      const { tree, parser, root } = parse(`import 'foo.dart' show Bar, Baz;\n`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].source).toBe("foo.dart");
      expect(result.imports[0].specifiers).toEqual(["Bar", "Baz"]);
      tree.delete();
      parser.delete();
    });

    it("extracts an `as` prefix as the sole specifier", () => {
      const { tree, parser, root } = parse(`import 'bar.dart' as b;\n`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].source).toBe("bar.dart");
      expect(result.imports[0].specifiers).toEqual(["b"]);
      tree.delete();
      parser.delete();
    });

    it("does NOT include `hide` names as specifiers", () => {
      const { tree, parser, root } = parse(`import 'foo.dart' hide Qux;\n`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].source).toBe("foo.dart");
      expect(result.imports[0].specifiers).toEqual([]);
      tree.delete();
      parser.delete();
    });

    it("extracts a `dart:` SDK import", () => {
      const { tree, parser, root } = parse(`import 'dart:io';\n`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("dart:io");
      expect(result.imports[0].specifiers).toEqual([]);
      tree.delete();
      parser.delete();
    });

    it("preserves declaration order across multiple imports", () => {
      const { tree, parser, root } = parse(`import 'dart:io';
import 'package:flutter/material.dart';
import './foo.dart';
`);
      const result = extractor.extractStructure(root);

      expect(result.imports.map((i) => i.source)).toEqual([
        "dart:io",
        "package:flutter/material.dart",
        "./foo.dart",
      ]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("extracts a top-level export directive", () => {
      const { tree, parser, root } = parse(`export 'shared.dart';\n`);
      const result = extractor.extractStructure(root);

      const sharedExport = result.exports.find((e) => e.name === "shared.dart");
      expect(sharedExport).toBeDefined();
      tree.delete();
      parser.delete();
    });

    it("extracts a `show` clause on an export directive (URI only)", () => {
      const { tree, parser, root } = parse(`export 'shared.dart' show PublicApi;\n`);
      const result = extractor.extractStructure(root);

      // We surface the export URI in exports[]; the show-list refinement is
      // not modeled in the shared schema (export entries carry name + line).
      const sharedExport = result.exports.find((e) => e.name === "shared.dart");
      expect(sharedExport).toBeDefined();
      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("attributes a top-level call to its enclosing function", () => {
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

    it("attributes a method call (x.foo()) to its enclosing function", () => {
      const { tree, parser, root } = parse(`void run() {
  "hi".toUpperCase();
}
`);
      const entries = extractor.extractCallGraph(root);

      const callees = entries.map((e) => e.callee);
      expect(callees).toContain("toUpperCase");
      tree.delete();
      parser.delete();
    });

    it("returns an empty array when there are no calls", () => {
      const { tree, parser, root } = parse(`int a() => 1;\n`);
      const entries = extractor.extractCallGraph(root);
      expect(entries).toEqual([]);
      tree.delete();
      parser.delete();
    });

    it("records a `const Foo()` constructor as a call edge (Flutter widget shape)", () => {
      const { tree, parser, root } = parse(`void main() {
  runApp(const MyApp());
}
`);
      const entries = extractor.extractCallGraph(root);

      const callees = entries.map((e) => e.callee);
      // Both the enclosing `runApp` call and the inner `MyApp` construction
      // must surface — the latter is the dependency edge that motivates
      // Flutter call-graph support.
      expect(callees).toContain("runApp");
      expect(callees).toContain("MyApp");
      const myAppCall = entries.find((e) => e.callee === "MyApp");
      expect(myAppCall!.caller).toBe("main");
      tree.delete();
      parser.delete();
    });

    it("records a `new Foo()` constructor as a call edge", () => {
      const { tree, parser, root } = parse(`void main() {
  var x = new Counter(1);
}
`);
      const entries = extractor.extractCallGraph(root);

      const counterCall = entries.find((e) => e.callee === "Counter");
      expect(counterCall).toBeDefined();
      expect(counterCall!.caller).toBe("main");
      tree.delete();
      parser.delete();
    });

    it("attributes calls inside a getter body to the getter", () => {
      const { tree, parser, root } = parse(`class C {
  int _v = 0;
  int get value {
    return helper();
  }
}
`);
      const entries = extractor.extractCallGraph(root);

      const helperCall = entries.find((e) => e.callee === "helper");
      expect(helperCall).toBeDefined();
      expect(helperCall!.caller).toBe("value");
      tree.delete();
      parser.delete();
    });

    it("attributes calls inside a setter body to the setter", () => {
      const { tree, parser, root } = parse(`class C {
  int _v = 0;
  set value(int x) {
    _v = clamp(x);
  }
}
`);
      const entries = extractor.extractCallGraph(root);

      const clampCall = entries.find((e) => e.callee === "clamp");
      expect(clampCall).toBeDefined();
      expect(clampCall!.caller).toBe("value");
      tree.delete();
      parser.delete();
    });

    it("attributes calls inside a constructor body to the constructor", () => {
      const { tree, parser, root } = parse(`class Foo {
  int x;
  Foo(this.x) {
    validate(x);
  }
}
`);
      const entries = extractor.extractCallGraph(root);

      const validateCall = entries.find((e) => e.callee === "validate");
      expect(validateCall).toBeDefined();
      expect(validateCall!.caller).toBe("Foo");
      tree.delete();
      parser.delete();
    });

    it("attributes calls inside a factory constructor body to `Class.named`", () => {
      const { tree, parser, root } = parse(`class Foo {
  int x;
  Foo(this.x);
  factory Foo.fromString(String s) {
    return Foo(int.parse(s));
  }
}
`);
      const entries = extractor.extractCallGraph(root);

      // Either the bare `Foo(...)` call inside the factory or the chained
      // `int.parse(...)` must be attributed to the factory's qualified name.
      const fromFactory = entries.filter((e) => e.caller === "Foo.fromString");
      expect(fromFactory.length).toBeGreaterThan(0);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - visibility", () => {
    it("does NOT export a top-level declaration whose name starts with _", () => {
      const { tree, parser, root } = parse(`int _helper() => 1;
class _PrivateImpl {}
`);
      const result = extractor.extractStructure(root);

      const names = result.exports.map((e) => e.name);
      expect(names).not.toContain("_helper");
      expect(names).not.toContain("_PrivateImpl");
      tree.delete();
      parser.delete();
    });

    it("DOES export a top-level declaration without an underscore prefix", () => {
      const { tree, parser, root } = parse(`int helper() => 1;
class Public {}
`);
      const result = extractor.extractStructure(root);

      const names = result.exports.map((e) => e.name);
      expect(names).toEqual(expect.arrayContaining(["helper", "Public"]));
      tree.delete();
      parser.delete();
    });

    it("does NOT export class members whose names start with _", () => {
      const { tree, parser, root } = parse(`class Counter {
  void _helper() {}
  void publicMethod() {}
}
`);
      const result = extractor.extractStructure(root);

      const names = result.exports.map((e) => e.name);
      expect(names).toContain("publicMethod");
      expect(names).not.toContain("_helper");
      tree.delete();
      parser.delete();
    });
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { KotlinExtractor } from "../kotlin-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let kotlinLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
  );
  kotlinLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(kotlinLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("KotlinExtractor", () => {
  const extractor = new KotlinExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["kotlin"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts a simple top-level function with params and return type", () => {
      const { tree, parser, root } = parse(`fun add(a: Int, b: Int): Int = a + b
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("Int");

      tree.delete();
      parser.delete();
    });

    it("extracts function with no params and no return type", () => {
      const { tree, parser, root } = parse(`fun noop() {}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts suspending and generic functions", () => {
      const { tree, parser, root } = parse(`suspend fun <T> fetch(id: String): T? {
    return null
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("fetch");
      expect(result.functions[0].params).toEqual(["id"]);
      // Nullable type — Kotlin formats it as "T?"
      expect(result.functions[0].returnType).toBe("T?");

      tree.delete();
      parser.delete();
    });

    it("extracts multiple top-level functions in declaration order", () => {
      const { tree, parser, root } = parse(`fun one() {}
fun two(x: Int): Int = x
fun three(): String = ""
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
    it("extracts a class with primary-constructor val properties + methods", () => {
      const { tree, parser, root } = parse(`class Foo(val bar: Int) {
    val baz: String = "hi"
    fun compute(): Int = bar * 2
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Foo");
      // Both the constructor val and the body val are properties
      expect(result.classes[0].properties).toEqual(
        expect.arrayContaining(["bar", "baz"]),
      );
      expect(result.classes[0].methods).toContain("compute");

      tree.delete();
      parser.delete();
    });

    it("extracts an empty class", () => {
      const { tree, parser, root } = parse(`class Empty
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts a data class and surfaces its constructor parameters as properties", () => {
      const { tree, parser, root } = parse(`data class Point(val x: Double, val y: Double)
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Point");
      expect(result.classes[0].properties).toEqual(["x", "y"]);

      tree.delete();
      parser.delete();
    });

    it("extracts class methods into functions[] as well as the class's methods[]", () => {
      // Mirrors the Go/Swift extractor convention so the graph builder can
      // create function nodes for class methods.
      const { tree, parser, root } = parse(`class Foo {
    fun bar(): Int = 1
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toContain("bar");
      expect(result.classes[0].methods).toContain("bar");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - interfaces", () => {
    it("extracts an interface with method requirements as a class-like entry", () => {
      const { tree, parser, root } = parse(`interface Greeter {
    fun greet(name: String): String
    fun farewell(): String
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Greeter");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["greet", "farewell"]),
      );

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - object declarations", () => {
    it("extracts a singleton `object` with methods", () => {
      const { tree, parser, root } = parse(`object Logger {
    fun info(msg: String) {}
    fun warn(msg: String) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Logger");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["info", "warn"]),
      );

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts a simple dotted import", () => {
      const { tree, parser, root } = parse(`import kotlin.io.println
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("kotlin.io.println");
      // The specifier is the final dotted segment
      expect(result.imports[0].specifiers).toEqual(["println"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a wildcard import", () => {
      const { tree, parser, root } = parse(`import kotlinx.coroutines.*
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("kotlinx.coroutines");
      // Wildcard is preserved as the specifier so consumers can distinguish it
      // from a regular dotted import of a specific symbol.
      expect(result.imports[0].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("extracts an aliased import", () => {
      const { tree, parser, root } = parse(`import com.example.foo.Bar as Baz
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("com.example.foo.Bar");
      // The alias is the user-visible name in this file
      expect(result.imports[0].specifiers).toEqual(["Baz"]);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple imports in declaration order", () => {
      const { tree, parser, root } = parse(`package com.example.app

import kotlinx.coroutines.flow.Flow
import kotlin.io.println
import kotlinx.coroutines.*
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe("kotlinx.coroutines.flow.Flow");
      expect(result.imports[1].source).toBe("kotlin.io.println");
      expect(result.imports[2].source).toBe("kotlinx.coroutines");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports / visibility", () => {
    it("treats no-modifier declarations as exported (Kotlin default is public)", () => {
      const { tree, parser, root } = parse(`fun greet() {}
class Greeter {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(expect.arrayContaining(["greet", "Greeter"]));

      tree.delete();
      parser.delete();
    });

    it("treats public/internal/protected as exported", () => {
      const { tree, parser, root } = parse(`public fun a() {}
internal class B {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(expect.arrayContaining(["a", "B"]));

      tree.delete();
      parser.delete();
    });

    it("does NOT treat private declarations as exported", () => {
      const { tree, parser, root } = parse(`private fun helper() {}
private class Internal {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).not.toContain("helper");
      expect(exportNames).not.toContain("Internal");

      tree.delete();
      parser.delete();
    });

    it("exports an object declaration by default", () => {
      const { tree, parser, root } = parse(`object Logger {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports.map((e) => e.name)).toContain("Logger");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts a call from one function to another", () => {
      const { tree, parser, root } = parse(`fun helper(): Int = 1

fun caller(): Int {
    return helper()
}
`);
      const entries = extractor.extractCallGraph(root);

      const helperCall = entries.find((e) => e.callee === "helper");
      expect(helperCall).toBeDefined();
      expect(helperCall!.caller).toBe("caller");

      tree.delete();
      parser.delete();
    });

    it("extracts method calls (x.foo()) and attributes them to the enclosing function", () => {
      const { tree, parser, root } = parse(`fun run() {
    val s = "hi".uppercase()
}
`);
      const entries = extractor.extractCallGraph(root);

      const callees = entries.map((e) => e.callee);
      expect(callees).toContain("uppercase");

      tree.delete();
      parser.delete();
    });

    it("returns an empty array when there are no calls", () => {
      const { tree, parser, root } = parse(`fun a(): Int = 1
`);
      const entries = extractor.extractCallGraph(root);
      expect(entries).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });
});

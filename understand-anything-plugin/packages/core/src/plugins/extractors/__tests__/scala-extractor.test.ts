import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { ScalaExtractor } from "../scala-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let scalaLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve("tree-sitter-scala/tree-sitter-scala.wasm");
  scalaLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(scalaLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("ScalaExtractor", () => {
  const extractor = new ScalaExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["scala"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts a Scala 3 top-level function with params and return type", () => {
      const { tree, parser, root } = parse(`def add(a: Int, b: Int): Int = a + b
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("Int");

      tree.delete();
      parser.delete();
    });

    it("extracts a function with an inferred return type", () => {
      const { tree, parser, root } = parse(`def greet(name: String) = s"hello $name"
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts curried and using-clause parameter lists", () => {
      const { tree, parser, root } = parse(
        `def run(a: Int)(b: String)(using ec: scala.concurrent.ExecutionContext): Unit = ()
`,
      );
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("run");
      expect(result.functions[0].params).toContain("a");
      expect(result.functions[0].params).toContain("b");
      expect(result.functions[0].returnType).toBe("Unit");

      tree.delete();
      parser.delete();
    });

    it("extracts an effect-typed function (Cats Effect IO)", () => {
      const { tree, parser, root } = parse(`import cats.effect.IO

def fetchUser(id: Long): IO[Option[String]] = IO.pure(None)
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("fetchUser");
      expect(result.functions[0].returnType).toBe("IO[Option[String]]");

      tree.delete();
      parser.delete();
    });

    it("extracts extension methods as top-level functions", () => {
      const { tree, parser, root } = parse(`extension (s: String)
  def shout: String = s.toUpperCase
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("shout");
      expect(result.functions[0].returnType).toBe("String");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes, traits, objects, enums", () => {
    it("extracts a case class with parameters as properties", () => {
      const { tree, parser, root } = parse(`case class User(id: Long, name: String)
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].properties).toEqual(["id", "name"]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("treats only val/var constructor params of a regular class as properties", () => {
      const { tree, parser, root } = parse(
        `class Service(val name: String, dep: Int, var counter: Long)
`,
      );
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].properties).toEqual(["name", "counter"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a class with methods and val members", () => {
      const { tree, parser, root } = parse(`class UserService(repo: AnyRef) {
  private val cacheSize: Int = 128

  def getUser(id: Long): Option[String] = None

  private def logAccess(id: Long): Unit = ()
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
      expect(result.classes[0].methods).toEqual(["getUser", "logAccess"]);
      expect(result.classes[0].properties).toEqual(["cacheSize"]);

      // Methods also land in the top-level functions array
      const names = result.functions.map((f) => f.name);
      expect(names).toEqual(["getUser", "logAccess"]);

      tree.delete();
      parser.delete();
    });

    it("extracts a trait with abstract method declarations", () => {
      const { tree, parser, root } = parse(`trait UserRepo[F[_]] {
  def find(id: Long): F[Option[String]]
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserRepo");
      expect(result.classes[0].methods).toEqual(["find"]);

      tree.delete();
      parser.delete();
    });

    it("extracts an object and recurses into companion-object ADT members", () => {
      const { tree, parser, root } = parse(`sealed trait Command

object Command {
  final case class Create(name: String) extends Command
  case object Refresh extends Command
}
`);
      const result = extractor.extractStructure(root);

      const names = result.classes.map((c) => c.name);
      expect(names).toContain("Command"); // trait + object entries
      expect(names).toContain("Create");
      expect(names).toContain("Refresh");
      const create = result.classes.find((c) => c.name === "Create")!;
      expect(create.properties).toEqual(["name"]);

      tree.delete();
      parser.delete();
    });

    it("extracts extension methods inside objects", () => {
      const { tree, parser, root } = parse(`object syntax {
  extension (s: String)
    def shout: String = s.toUpperCase
}
`);
      const result = extractor.extractStructure(root);

      const syntax = result.classes.find((c) => c.name === "syntax");
      expect(syntax?.methods).toContain("shout");
      expect(result.functions.map((f) => f.name)).toContain("shout");
      expect(result.exports.map((e) => e.name)).toEqual(
        expect.arrayContaining(["syntax", "shout"]),
      );

      tree.delete();
      parser.delete();
    });

    it("extracts declarations inside braced package clauses", () => {
      const { tree, parser, root } = parse(`package com.example {
  class Foo

  object Bar {
    def run(): Unit = ()
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes.map((c) => c.name)).toEqual(["Foo", "Bar"]);
      expect(result.functions.map((f) => f.name)).toEqual(["run"]);
      expect(result.exports.map((e) => e.name)).toEqual(
        expect.arrayContaining(["Foo", "run", "Bar"]),
      );

      tree.delete();
      parser.delete();
    });

    it("extracts package objects with their members", () => {
      const { tree, parser, root } = parse(`package com.example

package object syntax {
  val defaultTimeout: Int = 30
  def helper(x: Int): Int = x
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("syntax");
      expect(result.classes[0].properties).toEqual(["defaultTimeout"]);
      expect(result.classes[0].methods).toEqual(["helper"]);
      expect(result.functions.map((f) => f.name)).toEqual(["helper"]);
      expect(result.exports.map((e) => e.name)).toEqual(
        expect.arrayContaining(["defaultTimeout", "helper", "syntax"]),
      );

      tree.delete();
      parser.delete();
    });

    it("extracts a Scala 3 enum with its cases as properties", () => {
      const { tree, parser, root } = parse(`enum Color {
  case Red, Green, Blue
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Color");
      expect(result.classes[0].properties).toEqual(["Red", "Green", "Blue"]);

      tree.delete();
      parser.delete();
    });

  });

  describe("extractStructure - imports", () => {
    it("extracts a plain import", () => {
      const { tree, parser, root } = parse(`import cats.effect.IO
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("cats.effect.IO");
      expect(result.imports[0].specifiers).toEqual(["IO"]);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple importers from one import declaration", () => {
      const { tree, parser, root } = parse(`import cats.effect.IO, scala.concurrent.Future
import cats.effect.{Resource, ExitCode}, scala.concurrent.duration.*
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(4);
      expect(result.imports.map((i) => i.source)).toEqual([
        "cats.effect.IO",
        "scala.concurrent.Future",
        "cats.effect",
        "scala.concurrent.duration",
      ]);
      expect(result.imports.map((i) => i.specifiers)).toEqual([
        ["IO"],
        ["Future"],
        ["Resource", "ExitCode"],
        ["*"],
      ]);

      tree.delete();
      parser.delete();
    });

    it("extracts a selector-list import", () => {
      const { tree, parser, root } = parse(`import cats.effect.{IO, Resource}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("cats.effect");
      expect(result.imports[0].specifiers).toEqual(["IO", "Resource"]);

      tree.delete();
      parser.delete();
    });

    it("extracts Scala 2 and Scala 3 wildcard imports", () => {
      const { tree, parser, root } = parse(`import cats.syntax.all._
import scala.concurrent.duration.*
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("cats.syntax.all");
      expect(result.imports[0].specifiers).toEqual(["*"]);
      expect(result.imports[1].source).toBe("scala.concurrent.duration");
      expect(result.imports[1].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("extracts source names for renamed imports (Scala 2 arrow and Scala 3 as)", () => {
      const { tree, parser, root } = parse(`import cats.effect.{IO => Effect}
import cats.effect.kernel.{Async as AsyncEff}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].specifiers).toEqual(["IO"]);
      expect(result.imports[1].specifiers).toEqual(["Async"]);

      tree.delete();
      parser.delete();
    });

    it("does not treat excluded renamed imports as imported specifiers", () => {
      const { tree, parser, root } = parse(`import cats.effect.{IO, Resource => _, Async as AsyncEff}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("cats.effect");
      expect(result.imports[0].specifiers).toEqual(["IO", "Async"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports and visibility", () => {
    it("treats public declarations as exported and private ones as internal", () => {
      const { tree, parser, root } = parse(`class Api {
  def visible(): Unit = ()
  private def hidden(): Unit = ()
  protected def inherited(): Unit = ()
}

private class Internal
`);
      const result = extractor.extractStructure(root);

      const exported = result.exports.map((e) => e.name);
      expect(exported).toContain("Api");
      expect(exported).toContain("visible");
      expect(exported).toContain("inherited");
      expect(exported).not.toContain("hidden");
      expect(exported).not.toContain("Internal");

      tree.delete();
      parser.delete();
    });

    it("does not export public members inherited from a private outer type", () => {
      const { tree, parser, root } = parse(`private class Internal {
  def leak(): Unit = ()
}
`);
      const result = extractor.extractStructure(root);

      const exported = result.exports.map((e) => e.name);
      expect(exported).not.toContain("Internal");
      expect(exported).not.toContain("leak");

      tree.delete();
      parser.delete();
    });

    it("treats private[scope] as not exported", () => {
      const { tree, parser, root } = parse(`private[service] def helper(): Unit = ()
`);
      const result = extractor.extractStructure(root);

      expect(result.exports.map((e) => e.name)).not.toContain("helper");

      tree.delete();
      parser.delete();
    });

    it("exports Scala 3 top-level vals and given instances", () => {
      const { tree, parser, root } = parse(`val defaultTimeout: Int = 30

given intOrd: Ordering[Int] = Ordering.Int
`);
      const result = extractor.extractStructure(root);

      const exported = result.exports.map((e) => e.name);
      expect(exported).toContain("defaultTimeout");
      expect(exported).toContain("intOrd");

      tree.delete();
      parser.delete();
    });

    it("extracts Scala 3 export declarations", () => {
      const { tree, parser, root } = parse(`export service.{run as start, stop}
export config.defaultTimeout
`);
      const result = extractor.extractStructure(root);

      expect(result.exports.map((e) => e.name)).toEqual([
        "start",
        "stop",
        "defaultTimeout",
      ]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts direct and method calls with the enclosing caller", () => {
      const { tree, parser, root } = parse(`object Main {
  def run(args: List[String]): Unit = {
    val svc = helper(args)
    svc.getUser(1L)
  }

  def helper(args: List[String]): AnyRef = null
}
`);
      const entries = extractor.extractCallGraph(root);

      expect(entries).toContainEqual(
        expect.objectContaining({ caller: "run", callee: "helper" }),
      );
      expect(entries).toContainEqual(
        expect.objectContaining({ caller: "run", callee: "getUser" }),
      );

      tree.delete();
      parser.delete();
    });

    it("extracts generic calls and ignores calls outside functions", () => {
      const { tree, parser, root } = parse(`val eager = compute(1)

def caller(): Unit = {
  helper[Int](1)
  IO.pure[String]("x")
}
`);
      const entries = extractor.extractCallGraph(root);

      const callees = entries.map((e) => e.callee);
      expect(callees).toContain("helper");
      expect(callees).toContain("pure");
      // `compute(1)` is not inside a function definition
      expect(callees).not.toContain("compute");

      tree.delete();
      parser.delete();
    });

    it("extracts infix and constructor calls", () => {
      const { tree, parser, root } = parse(`def caller(xs: List[Int]): Unit = {
  xs map println
  val x = new Foo()
}
`);
      const entries = extractor.extractCallGraph(root);

      expect(entries).toContainEqual(
        expect.objectContaining({ caller: "caller", callee: "map" }),
      );
      expect(entries).toContainEqual(
        expect.objectContaining({ caller: "caller", callee: "Foo" }),
      );

      tree.delete();
      parser.delete();
    });

    it("tracks nested for-comprehension style calls (Cats Effect)", () => {
      const { tree, parser, root } = parse(`import cats.effect.IO

def program(): IO[Unit] = {
  IO.println("start").flatMap(_ => IO.println("done"))
}
`);
      const entries = extractor.extractCallGraph(root);

      const callees = entries.map((e) => e.callee);
      expect(callees).toContain("println");
      expect(callees).toContain("flatMap");
      expect(entries.every((e) => e.caller === "program")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

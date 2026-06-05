import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DartExtractor } from "../dart-extractor.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let Parser: any;
let Language: any;
let dartLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = resolve(__dirname, "../../../../grammars/tree-sitter-dart.wasm");
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
    it("extracts methods with params and return types", () => {
      const { tree, parser, root } = parse(`class Foo {
  String getName(int id) {
    return "";
  }
  void process(String data, int count) {
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("getName");
      expect(result.functions[0].params).toEqual(["id"]);
      expect(result.functions[0].returnType).toBe("String");
      expect(result.functions[1].name).toBe("process");
      expect(result.functions[1].params).toEqual(["data", "count"]);
      expect(result.functions[1].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts top-level functions", () => {
      const { tree, parser, root } = parse(`String greet(String name) {
  return "Hello";
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("String");

      tree.delete();
      parser.delete();
    });

    it("extracts getters and setters", () => {
      const { tree, parser, root } = parse(`class Foo {
  String get name => "";
  set name(String v) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("name");
      expect(result.functions[0].returnType).toBe("String");
      expect(result.functions[1].name).toBe("name");
      expect(result.functions[1].params).toEqual(["v"]);

      tree.delete();
      parser.delete();
    });

    it("extracts named and factory constructors as functions", () => {
      const { tree, parser, root } = parse(`class Foo {
  factory Foo.named() => Foo();
  Foo.bar(this.x);
}
`);
      const result = extractor.extractStructure(root);

      const names = result.functions.map((f) => f.name);
      expect(names).toContain("Foo.named");
      expect(names).toContain("Foo.bar");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parse(`class Server {
  final String host = "";
  int port = 0;
  void start() {}
  void stop() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
      expect(result.classes[0].methods).toEqual(["start", "stop"]);

      tree.delete();
      parser.delete();
    });

    it("extracts mixin declarations as classes", () => {
      const { tree, parser, root } = parse(`mixin LoggerMixin {
  void log(String msg) {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("LoggerMixin");
      expect(result.classes[0].methods).toEqual(["log"]);

      tree.delete();
      parser.delete();
    });

    it("extracts extension declarations as classes", () => {
      const { tree, parser, root } = parse(`extension StringExt on String {
  bool get isBlank => trim().isEmpty;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("StringExt");
      expect(result.classes[0].methods).toEqual(["isBlank"]);

      tree.delete();
      parser.delete();
    });

    it("extracts enum declarations as classes", () => {
      const { tree, parser, root } = parse(`enum Status { active, inactive }
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Status");
      expect(result.classes[0].properties).toEqual(["active", "inactive"]);

      tree.delete();
      parser.delete();
    });

    it("extracts abstract method signatures in abstract classes", () => {
      const { tree, parser, root } = parse(`abstract class Base {
  void run();
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Base");
      expect(result.classes[0].methods).toEqual(["run"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts regular imports", () => {
      const { tree, parser, root } = parse(`import 'package:flutter/material.dart';
import 'dart:async';
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("package:flutter/material.dart");
      expect(result.imports[0].specifiers).toEqual(["*"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("dart:async");
      expect(result.imports[1].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("extracts show imports", () => {
      const { tree, parser, root } = parse(`import 'src/models.dart' show User, Order;
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("src/models.dart");
      expect(result.imports[0].specifiers).toEqual(["User", "Order"]);

      tree.delete();
      parser.delete();
    });

    it("extracts hide imports", () => {
      const { tree, parser, root } = parse(`import 'dart:math' hide Random;
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("dart:math");
      expect(result.imports[0].specifiers).toEqual(["Random"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports public classes and members", () => {
      const { tree, parser, root } = parse(`class UserService {
  void start() {}
  void _helper() {}
  String _secret = "";
  void public() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("start");
      expect(exportNames).toContain("public");
      expect(exportNames).not.toContain("_helper");
      expect(exportNames).not.toContain("_secret");

      tree.delete();
      parser.delete();
    });

    it("exports top-level public declarations", () => {
      const { tree, parser, root } = parse(`final String appName = "test";
void run() {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("appName");
      expect(exportNames).toContain("run");

      tree.delete();
      parser.delete();
    });

    it("handles export directives with show", () => {
      const { tree, parser, root } = parse(`export 'src/models.dart' show User;
class Foo {}
`);
      const result = extractor.extractStructure(root);

      const userExport = result.exports.find((e) => e.name === "User");
      expect(userExport).toBeDefined();
      expect(userExport!.lineNumber).toBe(1);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - annotations", () => {
    it("extracts marker annotations on classes", () => {
      const { tree, parser, root } = parse(`@immutable
class MyWidget extends StatelessWidget {
  void build() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toEqual([{ name: "immutable" }]);

      tree.delete();
      parser.delete();
    });

    it("extracts annotations with arguments on classes", () => {
      const { tree, parser, root } = parse(`@JsonSerializable(fieldRename: FieldRename.snake)
class User {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toHaveLength(1);
      expect(result.classes[0].annotations![0].name).toBe("JsonSerializable");
      expect(result.classes[0].annotations![0].arguments?.fieldRename).toBe(
        "FieldRename.snake",
      );

      tree.delete();
      parser.delete();
    });

    it("extracts annotations on methods", () => {
      const { tree, parser, root } = parse(`class Svc {
  @override
  void run() {}
}
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "run");
      expect(fn).toBeDefined();
      expect(fn!.annotations).toEqual([{ name: "override" }]);

      tree.delete();
      parser.delete();
    });

    it("omits annotations field when class has none", () => {
      const { tree, parser, root } = parse(`class Plain {
  void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - inheritance", () => {
    it("extracts superclass and interfaces", () => {
      const { tree, parser, root } = parse(`class Dog extends Animal implements Runnable, Serializable {
  void bark() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("Animal");
      expect(result.classes[0].interfaces).toEqual(["Runnable", "Serializable"]);

      tree.delete();
      parser.delete();
    });

    it("extracts mixins in interfaces alongside implements", () => {
      const { tree, parser, root } = parse(`class MyWidget extends StatelessWidget with TickerMixin {
  void build() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("StatelessWidget");
      expect(result.classes[0].interfaces).toEqual(["TickerMixin"]);

      tree.delete();
      parser.delete();
    });

    it("omits superclass/interfaces when absent", () => {
      const { tree, parser, root } = parse(`class Simple {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBeUndefined();
      expect(result.classes[0].interfaces).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - typedProperties", () => {
    it("extracts property types", () => {
      const { tree, parser, root } = parse(`class Config {
  final String apiUrl;
  int retryCount = 3;
  List<String>? tags;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(3);

      const apiUrl = result.classes[0].typedProperties!.find((p) => p.name === "apiUrl");
      expect(apiUrl).toBeDefined();
      expect(apiUrl!.type).toBe("String");

      const retryCount = result.classes[0].typedProperties!.find(
        (p) => p.name === "retryCount",
      );
      expect(retryCount).toBeDefined();
      expect(retryCount!.type).toBe("int");

      const tags = result.classes[0].typedProperties!.find((p) => p.name === "tags");
      expect(tags).toBeDefined();
      expect(tags!.type).toBe("List<String>?");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts simple and qualified method calls", () => {
      const { tree, parser, root } = parse(`class Svc {
  void process() {
    validate();
    repo.save();
  }
  void validate() {}
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].caller).toBe("process");
      expect(result[0].callee).toBe("validate");
      expect(result[1].caller).toBe("process");
      expect(result[1].callee).toBe("repo.save");

      tree.delete();
      parser.delete();
    });

    it("extracts this and super calls", () => {
      const { tree, parser, root } = parse(`class Foo {
  void run() {
    this.validate();
    super.run();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(callees).toContain("this.validate");
      expect(callees).toContain("super.run");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`class Foo {
  void run() {
    foo();
    bar();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(4);

      tree.delete();
      parser.delete();
    });

    it("tracks top-level function callers", () => {
      const { tree, parser, root } = parse(`void main() {
  greet("hi");
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("main");
      expect(result[0].callee).toBe("greet");

      tree.delete();
      parser.delete();
    });
  });
});

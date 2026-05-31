import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { SwiftExtractor } from "../swift-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Swift grammar once
let Parser: any;
let Language: any;
let swiftLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "@repomix/tree-sitter-wasms/out/tree-sitter-swift.wasm",
  );
  swiftLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(swiftLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("SwiftExtractor", () => {
  const extractor = new SwiftExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["swift"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts a simple top-level function with params and return type", () => {
      const { tree, parser, root } = parse(`func add(a: Int, b: Int) -> Int {
    return a + b
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("Int");
      expect(result.functions[0].lineRange[0]).toBe(1);

      tree.delete();
      parser.delete();
    });

    it("extracts function with no params and no return type", () => {
      const { tree, parser, root } = parse(`func noop() {
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

    it("extracts generic function", () => {
      const { tree, parser, root } = parse(`func map<T, U>(value: T, fn: (T) -> U) -> U {
    return fn(value)
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("map");
      expect(result.functions[0].params).toEqual(["value", "fn"]);
      expect(result.functions[0].returnType).toBe("U");

      tree.delete();
      parser.delete();
    });

    it("extracts async throws function", () => {
      const { tree, parser, root } = parse(`func fetchUser(id: String) async throws -> User {
    return User()
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("fetchUser");
      expect(result.functions[0].params).toEqual(["id"]);
      expect(result.functions[0].returnType).toBe("User");

      tree.delete();
      parser.delete();
    });

    it("extracts parameter names ignoring external argument labels", () => {
      // In Swift, `func f(_ name: Type)` has no external label; `func f(label name: Type)` has both.
      // The internal name (`name`) is what's used inside the function body.
      const { tree, parser, root } = parse(`func greet(_ name: String, with prefix: String) -> String {
    return prefix + name
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toEqual(["name", "prefix"]);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple top-level functions", () => {
      const { tree, parser, root } = parse(`func one() {}
func two(x: Int) -> Int { return x }
func three() -> String { return "" }
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(3);
      expect(result.functions.map((f) => f.name)).toEqual([
        "one",
        "two",
        "three",
      ]);
      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts a simple class with properties and methods", () => {
      const { tree, parser, root } = parse(`class Foo {
    let bar: Int
    var baz: String

    init(bar: Int, baz: String) {
        self.bar = bar
        self.baz = baz
    }

    func compute() -> Int {
        return bar * 2
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Foo");
      expect(result.classes[0].properties).toEqual(["bar", "baz"]);
      // Both the initializer ("init") and named methods should be listed
      expect(result.classes[0].methods).toContain("compute");
      expect(result.classes[0].methods).toContain("init");
      tree.delete();
      parser.delete();
    });

    it("extracts class with no body", () => {
      const { tree, parser, root } = parse(`class Empty {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].properties).toEqual([]);
      tree.delete();
      parser.delete();
    });

    it("extracts class with inheritance and protocol conformance", () => {
      const { tree, parser, root } = parse(`class Service: BaseService, Codable {
    func run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Service");
      expect(result.classes[0].methods).toContain("run");
      tree.delete();
      parser.delete();
    });

    it("class methods appear in functions list too", () => {
      // Methods inside a class are still functions; the project's GoExtractor does the same.
      const { tree, parser, root } = parse(`class Foo {
    func bar() -> Int { return 1 }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toContain("bar");
      expect(result.classes[0].methods).toContain("bar");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - structs", () => {
    it("extracts a struct with properties", () => {
      const { tree, parser, root } = parse(`struct Point {
    var x: Double
    var y: Double
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Point");
      expect(result.classes[0].properties).toEqual(["x", "y"]);
      tree.delete();
      parser.delete();
    });

    it("extracts a generic struct with methods", () => {
      const { tree, parser, root } = parse(`struct Stack<T> {
    private var items: [T] = []

    mutating func push(_ item: T) {
        items.append(item)
    }

    mutating func pop() -> T? {
        return items.popLast()
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Stack");
      expect(result.classes[0].properties).toContain("items");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["push", "pop"]),
      );
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - enums", () => {
    it("extracts a simple enum with cases", () => {
      const { tree, parser, root } = parse(`enum Direction {
    case north
    case south
    case east
    case west
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Direction");
      // Enum cases are properties (constant values of the type)
      expect(result.classes[0].properties).toEqual(
        expect.arrayContaining(["north", "south", "east", "west"]),
      );
      tree.delete();
      parser.delete();
    });

    it("extracts a generic enum with associated values and methods", () => {
      const { tree, parser, root } = parse(`enum Result<T, E> {
    case success(T)
    case failure(E)

    func isSuccess() -> Bool {
        switch self {
        case .success: return true
        case .failure: return false
        }
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Result");
      expect(result.classes[0].properties).toEqual(
        expect.arrayContaining(["success", "failure"]),
      );
      expect(result.classes[0].methods).toContain("isSuccess");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - protocols", () => {
    it("extracts a protocol with required methods and properties", () => {
      const { tree, parser, root } = parse(`protocol Greeter {
    var prefix: String { get }

    func greet(name: String) -> String
    func farewell() -> String
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Greeter");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["greet", "farewell"]),
      );
      expect(result.classes[0].properties).toContain("prefix");
      tree.delete();
      parser.delete();
    });

    it("extracts a public protocol", () => {
      const { tree, parser, root } = parse(`public protocol Codec {
    func encode() -> Data
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Codec");
      expect(result.exports.map((e) => e.name)).toContain("Codec");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - actors", () => {
    it("extracts an actor with isolated state and methods", () => {
      const { tree, parser, root } = parse(`actor Counter {
    private var count: Int = 0

    func increment() async {
        count += 1
    }

    func value() -> Int {
        return count
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Counter");
      expect(result.classes[0].properties).toContain("count");
      expect(result.classes[0].methods).toEqual(
        expect.arrayContaining(["increment", "value"]),
      );
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - extensions", () => {
    it("extracts methods from extension on an external type", () => {
      // Extension on a type defined elsewhere (e.g., Foundation's String).
      // The extension itself is recorded as a class-like entry named after the extended type.
      const { tree, parser, root } = parse(`extension String {
    func shout() -> String { return self.uppercased() }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("String");
      expect(result.classes[0].methods).toContain("shout");
      tree.delete();
      parser.delete();
    });

    it("attaches extension methods to a class declared in the same file", () => {
      // When the extended type is declared in the same file, the extension's methods
      // are added to that type's existing class entry instead of creating a duplicate.
      const { tree, parser, root } = parse(`class Greeter {
    func greet() -> String { return "hi" }
}

extension Greeter {
    func shout() -> String { return greet().uppercased() }
}
`);
      const result = extractor.extractStructure(root);

      // Only one Greeter entry, not two
      const greeterEntries = result.classes.filter((c) => c.name === "Greeter");
      expect(greeterEntries).toHaveLength(1);
      expect(greeterEntries[0].methods).toEqual(
        expect.arrayContaining(["greet", "shout"]),
      );
      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts a simple import", () => {
      const { tree, parser, root } = parse(`import Foundation
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("Foundation");
      expect(result.imports[0].specifiers).toEqual(["Foundation"]);
      expect(result.imports[0].lineNumber).toBe(1);
      tree.delete();
      parser.delete();
    });

    it("extracts a submodule import like `import struct Combine.AnyPublisher`", () => {
      const { tree, parser, root } = parse(`import struct Combine.AnyPublisher
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      // Source is the dotted module path; specifier is the last component
      expect(result.imports[0].source).toBe("Combine.AnyPublisher");
      expect(result.imports[0].specifiers).toEqual(["AnyPublisher"]);
      tree.delete();
      parser.delete();
    });

    it("extracts an attributed import like `@testable import MyModule`", () => {
      const { tree, parser, root } = parse(`@testable import MyModule
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("MyModule");
      expect(result.imports[0].specifiers).toEqual(["MyModule"]);
      tree.delete();
      parser.delete();
    });

    it("extracts multiple imports in declaration order", () => {
      const { tree, parser, root } = parse(`import Foundation
import UIKit
import struct Combine.Publishers
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe("Foundation");
      expect(result.imports[1].source).toBe("UIKit");
      expect(result.imports[2].source).toBe("Combine.Publishers");
      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports / visibility ----

  describe("extractStructure - exports", () => {
    it("marks public functions as exported", () => {
      const { tree, parser, root } = parse(`public func greet() {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe("greet");
      expect(result.exports[0].lineNumber).toBe(1);
      tree.delete();
      parser.delete();
    });

    it("marks open classes as exported", () => {
      const { tree, parser, root } = parse(`open class Vehicle {
    public func drive() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Vehicle");
      expect(exportNames).toContain("drive");
      tree.delete();
      parser.delete();
    });

    it("does NOT mark internal (default) declarations as exported", () => {
      const { tree, parser, root } = parse(`func helper() {}
class Internal {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);
      tree.delete();
      parser.delete();
    });

    it("does NOT mark fileprivate or private declarations as exported", () => {
      const { tree, parser, root } = parse(`private func a() {}
fileprivate class B {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);
      tree.delete();
      parser.delete();
    });

    it("marks public structs, enums, protocols, and actors", () => {
      const { tree, parser, root } = parse(`public struct S {}
public enum E {}
public protocol P {}
public actor A {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toEqual(expect.arrayContaining(["S", "E", "P", "A"]));
      tree.delete();
      parser.delete();
    });
  });

  // ---- Call graph ----

  describe("extractCallGraph", () => {
    it("extracts simple call from one function to another", () => {
      const { tree, parser, root } = parse(`func helper() -> Int { return 1 }

func caller() -> Int {
    return helper()
}
`);
      const entries = extractor.extractCallGraph(root);

      expect(entries).toContainEqual({
        caller: "caller",
        callee: "helper",
        lineNumber: 4,
      });
      tree.delete();
      parser.delete();
    });

    it("extracts method calls with navigation expressions", () => {
      const { tree, parser, root } = parse(`func run() {
    let s = "hi".uppercased()
}
`);
      const entries = extractor.extractCallGraph(root);

      // For method calls like x.foo(), the callee should be the method name "uppercased"
      const callees = entries.map((e) => e.callee);
      expect(callees).toContain("uppercased");
      tree.delete();
      parser.delete();
    });

    it("attributes calls inside class methods to the method, not the file", () => {
      const { tree, parser, root } = parse(`class Service {
    func compute() {
        helper()
    }
}

func helper() {}
`);
      const entries = extractor.extractCallGraph(root);

      const helperCall = entries.find((e) => e.callee === "helper");
      expect(helperCall).toBeDefined();
      expect(helperCall!.caller).toBe("compute");
      tree.delete();
      parser.delete();
    });

    it("returns an empty array when there are no calls", () => {
      const { tree, parser, root } = parse(`func a() { return }
`);
      const entries = extractor.extractCallGraph(root);
      // No calls in this function body
      expect(entries).toEqual([]);
      tree.delete();
      parser.delete();
    });
  });
});

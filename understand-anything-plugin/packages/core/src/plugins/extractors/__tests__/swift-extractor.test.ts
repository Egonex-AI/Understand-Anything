import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { swiftConfig } from "../../../languages/configs/swift.js";
import { TreeSitterPlugin } from "../../tree-sitter-plugin.js";
import { SwiftExtractor } from "../swift-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let swiftLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "@understand-anything/tree-sitter-swift-wasm/tree-sitter-swift.wasm",
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

function withAnalysis<T>(
  code: string,
  fn: (result: ReturnType<SwiftExtractor["extractStructure"]>) => T,
): T {
  const { tree, parser, root } = parse(code);
  try {
    return fn(extractor.extractStructure(root));
  } finally {
    tree.delete();
    parser.delete();
  }
}

function withCalls<T>(
  code: string,
  fn: (result: ReturnType<SwiftExtractor["extractCallGraph"]>) => T,
): T {
  const { tree, parser, root } = parse(code);
  try {
    return fn(extractor.extractCallGraph(root));
  } finally {
    tree.delete();
    parser.delete();
  }
}

const extractor = new SwiftExtractor();

describe("SwiftExtractor", () => {
  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["swift"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts a top-level function with params and return type", () => {
      withAnalysis(`func add(_ a: Int, b: Int) -> Int { a + b }\n`, (result) => {
        expect(result.functions).toHaveLength(1);
        expect(result.functions[0].name).toBe("add");
        expect(result.functions[0].params).toEqual(["a", "b"]);
        expect(result.functions[0].returnType).toBe("Int");
      });
    });

    it("extracts a function with no params and inferred return type", () => {
      withAnalysis(`func noop() {}\n`, (result) => {
        expect(result.functions[0].name).toBe("noop");
        expect(result.functions[0].params).toEqual([]);
        expect(result.functions[0].returnType).toBeUndefined();
      });
    });

    it("ignores async and throws while preserving declared return type", () => {
      withAnalysis(
        `func fetch<T: Decodable>(_ type: T.Type) async throws -> T { fatalError() }\n`,
        (result) => {
          expect(result.functions[0].name).toBe("fetch");
          expect(result.functions[0].params).toEqual(["type"]);
          expect(result.functions[0].returnType).toBe("T");
        },
      );
    });

    it("uses local parameter names instead of external labels", () => {
      withAnalysis(`func update(_ value: Int = 0, forKey key: String) {}\n`, (result) => {
        expect(result.functions[0].params).toEqual(["value", "key"]);
      });
    });
  });

  describe("extractStructure - type declarations", () => {
    it("extracts class properties and methods", () => {
      withAnalysis(
        `final class User {
  let id: String
  var name: String
  static let kind = "user"
  func save() {}
}
`,
        (result) => {
          expect(result.classes).toHaveLength(1);
          expect(result.classes[0].name).toBe("User");
          expect(result.classes[0].properties).toEqual(
            expect.arrayContaining(["id", "name", "kind"]),
          );
          expect(result.classes[0].methods).toContain("save");
          expect(result.functions.map((f) => f.name)).toContain("save");
        },
      );
    });

    it("extracts initializers and deinitializers as callable members", () => {
      withAnalysis(
        `class Box {
  init(value: Int) {}
  deinit { cleanup() }
}
`,
        (result) => {
          const box = result.classes[0];
          expect(box.methods).toEqual(expect.arrayContaining(["init", "deinit"]));
          expect(result.functions.find((f) => f.name === "Box.init")?.params).toEqual(["value"]);
          expect(result.functions.map((f) => f.name)).toContain("Box.deinit");
        },
      );
    });

    it("extracts structs and ignores property wrapper attributes", () => {
      withAnalysis(`struct Model { @Published var count = 0 }\n`, (result) => {
        expect(result.classes[0].name).toBe("Model");
        expect(result.classes[0].properties).toContain("count");
      });
    });

    it("extracts enum cases as properties", () => {
      withAnalysis(`enum LoadState { case idle; case failed(Error); case loaded(User) }\n`, (result) => {
        expect(result.classes[0].name).toBe("LoadState");
        expect(result.classes[0].properties).toEqual(["idle", "failed", "loaded"]);
      });
    });

    it("extracts protocol associated types, properties, functions, and init requirements", () => {
      withAnalysis(
        `protocol Repository {
  associatedtype Item
  var id: String { get }
  func load(id: String) async throws -> Item
  init(seed: String)
}
`,
        (result) => {
          const repo = result.classes[0];
          expect(repo.name).toBe("Repository");
          expect(repo.properties).toEqual(expect.arrayContaining(["Item", "id"]));
          expect(repo.methods).toEqual(expect.arrayContaining(["load", "init"]));
          expect(result.functions.find((f) => f.name === "load")?.returnType).toBe("Item");
          expect(result.functions.find((f) => f.name === "Repository.init")?.params).toEqual(["seed"]);
        },
      );
    });

    it("extracts extensions as class-like entries without colliding with the nominal type", () => {
      withAnalysis(
        `struct User {}
extension User: Codable where ID == String {
  func displayName() -> String { "" }
}
`,
        (result) => {
          expect(result.classes.map((c) => c.name)).toEqual(["User", "extension User"]);
          const ext = result.classes.find((c) => c.name === "extension User");
          expect(ext?.methods).toContain("displayName");
          expect(result.functions.find((f) => f.name === "displayName")?.returnType).toBe("String");
        },
      );
    });

    it("extracts computed extension properties", () => {
      withAnalysis(`extension String { var trimmed: String { self.trimmingCharacters(in: .whitespaces) } }\n`, (result) => {
        expect(result.classes[0].name).toBe("extension String");
        expect(result.classes[0].properties).toContain("trimmed");
      });
    });

    it("extracts actor declarations", () => {
      withAnalysis(
        `actor Cache {
  var store: [String: Data] = [:]
  func get(_ key: String) -> Data? { store[key] }
}
`,
        (result) => {
          expect(result.classes[0].name).toBe("Cache");
          expect(result.classes[0].properties).toContain("store");
          expect(result.classes[0].methods).toContain("get");
          expect(result.functions.find((f) => f.name === "get")?.returnType).toBe("Data?");
        },
      );
    });

    it("extracts nested type declarations", () => {
      withAnalysis(`struct Outer { struct Inner {}; func make() {} }\n`, (result) => {
        expect(result.classes.map((c) => c.name)).toEqual(["Outer", "Inner"]);
        expect(result.classes.find((c) => c.name === "Outer")?.methods).toContain("make");
      });
    });

    it("extracts subscript declarations as callable members", () => {
      withAnalysis(`struct Bag { subscript(index: Int) -> Item { items[index] } }\n`, (result) => {
        expect(result.classes[0].methods).toContain("subscript");
        expect(result.functions.find((f) => f.name === "subscript")?.params).toEqual(["index"]);
        expect(result.functions.find((f) => f.name === "subscript")?.returnType).toBe("Item");
      });
    });

    it("extracts comma-list property declarations as separate properties", () => {
      withAnalysis(`struct Point { var x, y: Double }\n`, (result) => {
        expect(result.classes[0].properties).toEqual(["x", "y"]);
      });
    });

    it("does not treat local declarations in property initializers as properties", () => {
      withAnalysis(
        `public struct Store {
  public let value = { let local = 1; return local }()
}
`,
        (result) => {
          expect(result.classes[0].properties).toEqual(["value"]);
          expect(result.exports.map((e) => e.name)).toEqual(
            expect.arrayContaining(["Store", "value"]),
          );
          expect(result.exports.map((e) => e.name)).not.toContain("local");
        },
      );
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts a simple module import", () => {
      withAnalysis(`import Foundation\n`, (result) => {
        expect(result.imports).toEqual([
          { source: "Foundation", specifiers: ["Foundation"], lineNumber: 1 },
        ]);
      });
    });

    it("extracts qualified import specifiers", () => {
      withAnalysis(`import struct Foundation.Date\n`, (result) => {
        expect(result.imports[0].source).toBe("Foundation");
        expect(result.imports[0].specifiers).toEqual(["Date"]);
      });
    });

    it("preserves import order and ignores import kind tokens", () => {
      withAnalysis(`import class UIKit.UIView\nimport protocol Combine.Publisher\n`, (result) => {
        expect(result.imports.map((i) => i.source)).toEqual(["UIKit", "Combine"]);
        expect(result.imports.map((i) => i.specifiers[0])).toEqual(["UIView", "Publisher"]);
      });
    });

    it("handles @testable imports", () => {
      withAnalysis(`@testable import MyApp\n`, (result) => {
        expect(result.imports[0].source).toBe("MyApp");
        expect(result.imports[0].specifiers).toEqual(["MyApp"]);
      });
    });

    it("extracts conditional imports with correct line numbers", () => {
      withAnalysis(`#if canImport(UIKit)\nimport UIKit\n#endif\n`, (result) => {
        expect(result.imports[0]).toEqual({
          source: "UIKit",
          specifiers: ["UIKit"],
          lineNumber: 2,
        });
      });
    });
  });

  describe("extractStructure - visibility and exports", () => {
    it("exports default and internal declarations", () => {
      withAnalysis(`func helper() {}\ninternal struct Store {}\n`, (result) => {
        expect(result.exports.map((e) => e.name)).toEqual(expect.arrayContaining(["helper", "Store"]));
      });
    });

    it("exports public, open, and package declarations", () => {
      withAnalysis(`public func api() {}\nopen class Base {}\npackage struct ModuleOnly {}\n`, (result) => {
        expect(result.exports.map((e) => e.name)).toEqual(
          expect.arrayContaining(["api", "Base", "ModuleOnly"]),
        );
      });
    });

    it("does not export private or fileprivate declarations", () => {
      withAnalysis(`private func hidden() {}\nfileprivate class Local {}\n`, (result) => {
        expect(result.functions.map((f) => f.name)).toContain("hidden");
        expect(result.classes.map((c) => c.name)).toContain("Local");
        expect(result.exports.map((e) => e.name)).not.toContain("hidden");
        expect(result.exports.map((e) => e.name)).not.toContain("Local");
      });
    });

    it("exports visible members and excludes private members", () => {
      withAnalysis(
        `public class Service {
  public func start() {}
  private func debug() {}
}
`,
        (result) => {
          const exports = result.exports.map((e) => e.name);
          expect(exports).toContain("Service");
          expect(exports).toContain("start");
          expect(exports).not.toContain("debug");
        },
      );
    });

    it("exports public private(set) properties", () => {
      withAnalysis(`public struct Counter { public private(set) var value = 0 }\n`, (result) => {
        expect(result.exports.map((e) => e.name)).toEqual(
          expect.arrayContaining(["Counter", "value"]),
        );
      });
    });

    it("does not export members of a private extension", () => {
      withAnalysis(`private extension User { func secret() {} }\n`, (result) => {
        expect(result.classes[0].methods).toContain("secret");
        expect(result.exports.map((e) => e.name)).not.toContain("secret");
      });
    });

    it("exports declarations with attributes before access modifiers", () => {
      withAnalysis(`@objc public func bridge() {}\n`, (result) => {
        expect(result.exports.map((e) => e.name)).toContain("bridge");
      });
    });
  });

  describe("extractCallGraph", () => {
    it("attributes a bare call to its enclosing function", () => {
      withCalls(`func helper() {}\nfunc caller() { helper() }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "caller", callee: "helper", lineNumber: 2 });
      });
    });

    it("attributes member calls to the enclosing function", () => {
      withCalls(`func load() { service.fetch() }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "load", callee: "fetch", lineNumber: 1 });
      });
    });

    it("preserves obvious static qualifiers", () => {
      withCalls(`func log() { Logger.info("x") }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "log", callee: "Logger.info", lineNumber: 1 });
      });
    });

    it("records initializer-shaped calls", () => {
      withCalls(`func make() { let user = User(name: "A") }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "make", callee: "User", lineNumber: 1 });
      });
    });

    it("attributes calls inside an initializer", () => {
      withCalls(`class Child: Parent { override init() { super.init(); configure() } }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "Child.init", callee: "super.init", lineNumber: 1 });
        expect(calls).toContainEqual({ caller: "Child.init", callee: "configure", lineNumber: 1 });
      });
    });

    it("attributes SwiftUI result-builder calls to computed body", () => {
      withCalls(`struct AppView { var body: some View { VStack { Text("Hi") } } }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "body", callee: "VStack", lineNumber: 1 });
        expect(calls).toContainEqual({ caller: "body", callee: "Text", lineNumber: 1 });
      });
    });

    it("attributes calls inside closures to the enclosing function", () => {
      withCalls(`func build(_ items: [Item]) { items.map { transform($0) }.filter { isValid($0) } }\n`, (calls) => {
        expect(calls.map((c) => c.callee)).toEqual(
          expect.arrayContaining(["map", "transform", "filter", "isValid"]),
        );
        expect(calls.every((c) => c.caller === "build")).toBe(true);
      });
    });

    it("extracts async/await member calls", () => {
      withCalls(`func run() async throws { try await client.load() }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "run", callee: "load", lineNumber: 1 });
      });
    });

    it("attributes property observer calls to the property", () => {
      withCalls(`struct Counter { var value: Int { didSet { notify() } } }\n`, (calls) => {
        expect(calls).toContainEqual({ caller: "value", callee: "notify", lineNumber: 1 });
      });
    });

    it("does not record top-level calls without an enclosing callable", () => {
      withCalls(`let booted = bootstrap()\nfunc main() {}\n`, (calls) => {
        expect(calls).toEqual([]);
      });
    });
  });

  describe("TreeSitterPlugin integration", () => {
    it("analyzes Swift files through registered builtin configs and extractors", async () => {
      const plugin = new TreeSitterPlugin([swiftConfig]);
      await plugin.init();

      const result = plugin.analyzeFile("App.swift", `struct App { func run() {} }\n`);

      expect(result.classes[0].name).toBe("App");
      expect(result.functions[0].name).toBe("run");
    });

    it("extracts Swift call graphs through the plugin", async () => {
      const plugin = new TreeSitterPlugin([swiftConfig]);
      await plugin.init();

      const calls = plugin.extractCallGraph("File.swift", `func a() { b() }\nfunc b() {}\n`);

      expect(calls).toContainEqual({ caller: "a", callee: "b", lineNumber: 1 });
    });

    it("handles a SwiftUI app smoke test through the plugin", async () => {
      const plugin = new TreeSitterPlugin([swiftConfig]);
      await plugin.init();

      const code = `import SwiftUI
@main struct MyApp: App {
  var body: some Scene {
    WindowGroup { ContentView() }
  }
}
`;

      const result = plugin.analyzeFile("MyApp.swift", code);
      const calls = plugin.extractCallGraph("MyApp.swift", code);

      expect(result.imports[0].source).toBe("SwiftUI");
      expect(result.classes[0].name).toBe("MyApp");
      expect(result.classes[0].properties).toContain("body");
      expect(result.exports.map((e) => e.name)).toContain("MyApp");
      expect(calls.map((c) => c.callee)).toEqual(
        expect.arrayContaining(["WindowGroup", "ContentView"]),
      );
    });
  });
});

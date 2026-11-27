import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "../typescript-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + TypeScript grammar once
let Parser: any;
let Language: any;
let tsLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  tsLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(tsLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("TypeScriptExtractor", () => {
  const extractor = new TypeScriptExtractor();

  // Regression guard: a plain class is still extracted.
  it("extracts a plain class declaration", () => {
    const { tree, parser, root } = parse(`class Widget {
  run(): void {
    console.log("x");
  }
}
`);
    const result = extractor.extractStructure(root);
    expect(result.classes.some((c) => c.name === "Widget")).toBe(true);
    tree.delete();
    parser.delete();
  });

  // ---- Abstract classes ----

  describe("extractStructure - abstract classes", () => {
    it("extracts an abstract class as a class node with its concrete methods", () => {
      const { tree, parser, root } = parse(`abstract class Repository {
  abstract find(id: string): Promise<string>;
  save(value: string): void {
    this.items.push(value);
  }
  private items: string[] = [];
}
`);
      const result = extractor.extractStructure(root);

      const repo = result.classes.find((c) => c.name === "Repository");
      expect(repo).toBeDefined();
      expect(repo!.methods).toContain("save");
      // abstract method signatures (no body) are captured too
      expect(repo!.methods).toContain("find");

      tree.delete();
      parser.delete();
    });

    it("records an exported abstract class in exports", () => {
      const { tree, parser, root } = parse(`export abstract class Base {
  abstract run(): void;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes.some((c) => c.name === "Base")).toBe(true);
      const baseExport = result.exports.find((e) => e.name === "Base");
      expect(baseExport).toBeDefined();
      expect(baseExport!.isDefault).toBe(false);

      tree.delete();
      parser.delete();
    });
  });
});

describe("TypeScriptExtractor - file-scope calls", () => {
  const extractor = new TypeScriptExtractor();
  const calls = (code: string) => {
    const { tree, parser, root } = parse(code);
    const result = extractor.extractCallGraph(root);
    tree.delete();
    parser.delete();
    return result;
  };

  it("attributes a top-level main() call to <file>", () => {
    const result = calls(`function main() {}\nmain();\n`);
    expect(result).toContainEqual({ caller: "<file>", callee: "main", lineNumber: 2 });
  });

  it("captures app.use at module scope", () => {
    const result = calls(`const app = express();\napp.use(router);\n`);
    expect(result).toContainEqual({ caller: "<file>", callee: "express", lineNumber: 1 });
    expect(result).toContainEqual({ caller: "<file>", callee: "app.use", lineNumber: 2 });
  });

  it("captures calls inside a top-level IIFE", () => {
    const result = calls(`(function () {\n  boot();\n})();\n`);
    expect(result).toContainEqual({ caller: "<file>", callee: "boot", lineNumber: 2 });
  });

  it("captures calls inside an anonymous forEach callback at file scope", () => {
    const result = calls(`items.forEach((x) => {\n  register(x);\n});\n`);
    expect(result).toContainEqual({ caller: "<file>", callee: "items.forEach", lineNumber: 1 });
    expect(result).toContainEqual({ caller: "<file>", callee: "register", lineNumber: 2 });
  });

  it("keeps attributing calls inside named functions to the function", () => {
    const result = calls(`function a() {\n  b();\n  [1].forEach(() => c());\n}\n`);
    expect(result.every((e) => e.caller === "a")).toBe(true);
    expect(result.some((e) => e.caller === "<file>")).toBe(false);
  });
});

describe("TypeScriptExtractor - top-level segments", () => {
  const extractor = new TypeScriptExtractor();
  const structure = (code: string) => {
    const { tree, parser, root } = parse(code);
    const result = extractor.extractStructure(root);
    tree.delete();
    parser.delete();
    return result;
  };

  it("captures a segment between two functions with the right lineRange", () => {
    const result = structure(
      [
        "function a() {}",        // 1
        "setup();",               // 2
        "registry.add(a);",       // 3
        "function b() {}",        // 4
      ].join("\n"),
    );
    expect(result.topLevel).toEqual([
      { kind: "statement", lineRange: [2, 3], calls: ["setup", "registry.add"], text: "setup();" },
    ]);
  });

  it("detects require.main === module guards (either operand order)", () => {
    const result = structure(
      "function main() {}\nif (require.main === module) {\n  main();\n}\nif (module === require.main) start();\n",
    );
    expect(result.topLevel).toEqual([
      expect.objectContaining({ kind: "guard", lineRange: [2, 4], calls: ["main"] }),
      expect.objectContaining({ kind: "guard", lineRange: [5, 5], calls: ["start"] }),
    ]);
  });

  it("detects IIFEs (plain, arrow, async/await and unary forms) as standalone segments", () => {
    const result = structure(
      [
        "(function () { boot(); })();",
        "(() => init())();",
        "!function () { legacy(); }();",
        "await (async () => { await connect(); })();",
      ].join("\n"),
    );
    expect(result.topLevel?.map((s) => s.kind)).toEqual(["iife", "iife", "iife", "iife"]);
    expect(result.topLevel?.map((s) => s.lineRange)).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
    expect(result.topLevel?.[0].calls).toContain("boot");
    expect(result.topLevel?.[3].calls).toContain("connect");
  });

  it("groups config declarations/assignments and keeps function-valued consts as functions", () => {
    const result = structure(
      [
        "import express from 'express';",      // 1
        "const PORT = 3000;",                  // 2
        "const app = express();",              // 3
        "module.exports.port = PORT;",         // 4
        "const handler = () => app.listen();", // 5
        "app.use(router);",                    // 6
      ].join("\n"),
    );
    expect(result.functions.map((f) => f.name)).toEqual(["handler"]);
    expect(result.topLevel).toEqual([
      { kind: "config", lineRange: [2, 4], calls: ["express"], text: "const PORT = 3000;" },
      { kind: "statement", lineRange: [6, 6], calls: ["app.use"], text: "app.use(router);" },
    ]);
  });

  it("ignores comments and does not let them split a segment", () => {
    const result = structure("a();\n// note\nb();\n");
    expect(result.topLevel).toEqual([
      expect.objectContaining({ kind: "statement", lineRange: [1, 3], calls: ["a", "b"] }),
    ]);
  });

  it("omits topLevel for files with only symbols, imports, exports and types", () => {
    const result = structure(
      [
        "import { x } from './x';",
        "// comment",
        "export interface Opts { a: number }",
        "type Id = string;",
        "export function f() { x(); }",
        "export class C { m() {} }",
        "const g = () => 1;",
        "export default C;",
      ].join("\n"),
    );
    expect(result.topLevel).toBeUndefined();
    expect("topLevel" in result).toBe(false);
  });

  it("truncates long text previews", () => {
    const result = structure(`doSomething(${"'x', ".repeat(40)}'y');\n`);
    expect(result.topLevel?.[0].text?.length).toBeLessThanOrEqual(80);
    expect(result.topLevel?.[0].text?.endsWith("…")).toBe(true);
  });
});

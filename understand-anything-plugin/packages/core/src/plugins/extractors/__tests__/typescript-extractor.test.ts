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

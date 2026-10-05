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

  // ---- Re-exports ----

  describe("extractStructure - re-exports", () => {
    it("records every re-export form as an import of its source module", () => {
      const { tree, parser, root } = parse(`export * from "./all";
export * as ns from "./namespaced";
export { a, b as c } from "./named";
export type { T } from "./types";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toEqual([
        { source: "./all", specifiers: ["*"], lineNumber: 1 },
        { source: "./namespaced", specifiers: ["* as ns"], lineNumber: 2 },
        { source: "./named", specifiers: ["a", "c"], lineNumber: 3 },
        { source: "./types", specifiers: ["T"], lineNumber: 4 },
      ]);
      // Named re-exports stay visible as exports of the barrel.
      expect(result.exports.map((e) => e.name)).toEqual(["a", "c", "T"]);

      tree.delete();
      parser.delete();
    });

    it("does not treat local exports as imports", () => {
      const { tree, parser, root } = parse(`const local = 1;
export { local };
export const value = "./not-a-module";
export default "./also-not-a-module";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });
});

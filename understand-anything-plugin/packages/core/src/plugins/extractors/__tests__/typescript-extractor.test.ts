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

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["typescript", "javascript"]);
  });

  describe("extractStructure - arrow functions", () => {
    it("captures the param of a parenless single-param arrow function", () => {
      const { tree, parser, root } = parse(`const g = x => doThing(x);`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("g");
      // Today: params is [] because the lone param lives under field
      // `parameter` (singular) and is not wrapped in `formal_parameters`.
      expect(result.functions[0].params).toEqual(["x"]);

      tree.delete();
      parser.delete();
    });

    it("still captures parenthesised arrow params", () => {
      const { tree, parser, root } = parse(
        `const add = (a, b) => a + b;`,
      );
      const result = extractor.extractStructure(root);

      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - abstract classes", () => {
    it("extracts an exported abstract class and its methods", () => {
      const { tree, parser, root } = parse(
        `export abstract class Service { run(): void {} }`,
      );
      const result = extractor.extractStructure(root);

      // Today: classes is [] and exports is [] because the node type is
      // `abstract_class_declaration`, not `class_declaration`.
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Service");
      expect(result.classes[0].methods).toEqual(["run"]);
      expect(result.exports.some((e) => e.name === "Service")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts a non-exported abstract class", () => {
      const { tree, parser, root } = parse(
        `abstract class Foo { bar(): void {} }`,
      );
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Foo");
      expect(result.classes[0].methods).toEqual(["bar"]);

      tree.delete();
      parser.delete();
    });
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "../typescript-extractor.js";

const require = createRequire(import.meta.url);

// ---- TypeScript grammar (used for .ts/.tsx files) ----
let Parser: any;
let Language: any;
let tsLang: any;
let jsLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();

  const tsWasm = require.resolve(
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  tsLang = await Language.load(tsWasm);

  const jsWasm = require.resolve(
    "tree-sitter-javascript/tree-sitter-javascript.wasm",
  );
  jsLang = await Language.load(jsWasm);
});

function parseTs(code: string) {
  const parser = new Parser();
  parser.setLanguage(tsLang);
  const tree = parser.parse(code);
  return { tree, parser, root: tree.rootNode };
}

function parseJs(code: string) {
  const parser = new Parser();
  parser.setLanguage(jsLang);
  const tree = parser.parse(code);
  return { tree, parser, root: tree.rootNode };
}

describe("TypeScriptExtractor", () => {
  const extractor = new TypeScriptExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["typescript", "javascript"]);
  });

  // ---- TypeScript: functions ----

  describe("TypeScript - extractStructure - functions", () => {
    it("extracts function declaration with typed params and return type", () => {
      const { tree, parser, root } = parseTs(`
function greet(name: string, age: number): string {
  return name;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name", "age"]);
      expect(result.functions[0].returnType).toBe("string");
      expect(result.functions[0].lineRange[0]).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts function with no params and no return type", () => {
      const { tree, parser, root } = parseTs(`
function noop() {}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts arrow function assigned to const", () => {
      const { tree, parser, root } = parseTs(`
const add = (a: number, b: number): number => a + b;
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("number");

      tree.delete();
      parser.delete();
    });

    it("extracts function expression assigned to const", () => {
      const { tree, parser, root } = parseTs(`
const handler = function(req: Request, res: Response): void {
  res.send("ok");
};
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("handler");
      expect(result.functions[0].params).toEqual(["req", "res"]);

      tree.delete();
      parser.delete();
    });

    it("extracts rest parameter", () => {
      const { tree, parser, root } = parseTs(`
function concat(...args: string[]): string {
  return args.join("");
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toContain("...args");

      tree.delete();
      parser.delete();
    });

    it("extracts optional parameter", () => {
      const { tree, parser, root } = parseTs(`
function greet(name: string, title?: string): string {
  return name;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toEqual(["name", "title"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct line range for multi-line function", () => {
      const { tree, parser, root } = parseTs(`
function multiline(
  a: number,
  b: number,
): number {
  return a + b;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions[0].lineRange[0]).toBe(2);
      expect(result.functions[0].lineRange[1]).toBe(7);

      tree.delete();
      parser.delete();
    });
  });
});

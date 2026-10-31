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

  // ---- Generator functions (#746) ----

  describe("generator functions", () => {
    it("extracts sync and async generator declarations alongside plain functions", () => {
      const { tree, parser, root } = parse(`function* syncGen(n: number): Generator<number> { yield n; }
async function* asyncGen(): AsyncGenerator<number> { yield 4; }
function plain(): number { return 1; }
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toEqual([
        "syncGen",
        "asyncGen",
        "plain",
      ]);
      const syncGen = result.functions.find((f) => f.name === "syncGen")!;
      expect(syncGen.params).toEqual(["n"]);
      expect(syncGen.returnType).toBe("Generator<number>");
      expect(syncGen.lineRange).toEqual([1, 1]);

      tree.delete();
      parser.delete();
    });

    it("extracts and exports exported generator declarations", () => {
      const { tree, parser, root } = parse(`export function* syncGen(): Generator<number> { yield 3; }
export async function* asyncGen(): AsyncGenerator<number> { yield 4; }
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toEqual([
        "syncGen",
        "asyncGen",
      ]);
      expect(result.exports).toEqual([
        { name: "syncGen", lineNumber: 1, isDefault: false },
        { name: "asyncGen", lineNumber: 2, isDefault: false },
      ]);

      tree.delete();
      parser.delete();
    });

    it("extracts generator function expressions assigned to variables", () => {
      const { tree, parser, root } = parse(`const gen = function* (): Generator<number> { yield 1; };
export const exportedGen = async function* () { yield 2; };
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.map((f) => f.name)).toEqual([
        "gen",
        "exportedGen",
      ]);
      expect(result.exports.map((e) => e.name)).toEqual(["exportedGen"]);

      tree.delete();
      parser.delete();
    });

    it("attributes calls inside generators to the generator in the call graph", () => {
      const { tree, parser, root } = parse(`function* fromDecl() {
  yield helperA();
}
const fromExpr = async function* () {
  yield await helperB();
};
`);
      const entries = extractor.extractCallGraph(root);

      expect(entries).toEqual([
        { caller: "fromDecl", callee: "helperA", lineNumber: 2 },
        { caller: "fromExpr", callee: "helperB", lineNumber: 5 },
      ]);

      tree.delete();
      parser.delete();
    });
  });
});

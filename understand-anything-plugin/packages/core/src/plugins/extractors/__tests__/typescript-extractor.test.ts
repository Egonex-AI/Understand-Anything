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

  // ---- Function values wrapped in a call, array or object ----
  //
  // A declarator whose value is a call was previously skipped outright, so the
  // dominant idioms of modern React/TypeScript produced no symbol at all and
  // their files dropped out of the graph: forwardRef and memo components, cva
  // variants, Redux createSlice, TanStack column tables.

  describe("extractStructure - wrapped function values", () => {
    const names = (code: string): string[] => {
      const { tree, parser, root } = parse(code);
      const result = extractor.extractStructure(root);
      const out = result.functions.map((f) => f.name);
      tree.delete();
      parser.delete();
      return out;
    };

    it("extracts a component wrapped in forwardRef", () => {
      expect(
        names(`const Button = forwardRef((props, ref) => { return null; });`),
      ).toContain("Button");
    });

    it("extracts a component wrapped in memo", () => {
      expect(
        names(`const Card = memo(function Inner() { return null; });`),
      ).toContain("Card");
    });

    it("extracts through a member-call wrapper such as React.forwardRef", () => {
      expect(
        names(`const Input = React.forwardRef((p, ref) => { return null; });`),
      ).toContain("Input");
    });

    it("extracts a slice whose handlers sit inside an object argument", () => {
      expect(
        names(`const slice = createSlice({
  reducers: { setX: (state, action) => { state.x = action.payload; } },
});`),
      ).toContain("slice");
    });

    it("extracts a table whose cell renderers sit inside an array", () => {
      expect(
        names(`const columns = [{ accessorKey: "id", cell: (row) => row.id }];`),
      ).toContain("columns");
    });

    it("extracts a constructed value carrying a callback", () => {
      expect(
        names(`const client = new QueryClient({ retry: () => false });`),
      ).toContain("client");
    });

    // Guard against the obvious over-correction: a const bound to a plain
    // value is not a function and must not become one.
    it("does not invent a symbol for a plain literal", () => {
      const out = names(`const answer = 42;
const label = "hello";
const config = { retries: 3, verbose: true };
const list = [1, 2, 3];`);
      expect(out).not.toContain("answer");
      expect(out).not.toContain("label");
      expect(out).not.toContain("config");
      expect(out).not.toContain("list");
    });

    // Regression guards: the direct forms must keep working.
    it("still extracts a direct arrow function", () => {
      expect(names(`const add = (a: number, b: number) => a + b;`)).toContain(
        "add",
      );
    });

    it("still extracts a direct function expression", () => {
      expect(names(`const run = function () { return 1; };`)).toContain("run");
    });
  });
});

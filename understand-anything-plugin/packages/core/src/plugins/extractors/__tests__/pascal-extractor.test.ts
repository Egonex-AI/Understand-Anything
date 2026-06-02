import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { PascalExtractor } from "../pascal-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Pascal grammar at module top-level (top-level await).
// `describe.skipIf` is evaluated at COLLECTION time, so the flag has to
// be set before describe() runs. If the wasm isn't available — the
// upstream distribution story for tree-sitter-pascal.wasm is still open
// (see the language-support PR) — the suite skips cleanly so contributors
// without the grammar can still run the rest of the test suite.
let Parser: any;
let pascalLang: any;
let grammarAvailable = false;

try {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-pascal/tree-sitter-pascal.wasm",
  );
  pascalLang = await mod.Language.load(wasmPath);
  grammarAvailable = true;
} catch (e) {
  console.warn(
    "[pascal-extractor.test] grammar unavailable, skipping suite:",
    (e as Error)?.message ?? e,
  );
}

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(pascalLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe.skipIf(!grammarAvailable)("PascalExtractor", () => {
  const extractor = new PascalExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["pascal"]);
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("tags interface-section uses as `interface`", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

uses
  Windows, SysUtils, Classes;

implementation

end.
`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(3);
      expect(result.imports.map((i) => i.source)).toEqual([
        "Windows",
        "SysUtils",
        "Classes",
      ]);
      for (const imp of result.imports) {
        expect(imp.section).toBe("interface");
      }
      tree.delete();
      parser.delete();
    });

    it("tags implementation-section uses as `implementation`", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

implementation

uses
  MyHelper, DataModule1;

end.
`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(2);
      for (const imp of result.imports) {
        expect(imp.section).toBe("implementation");
      }
      tree.delete();
      parser.delete();
    });

    it("distinguishes interface vs implementation uses in the same unit", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

uses
  Windows, Classes;

implementation

uses
  MyHelper;

end.
`);
      const result = extractor.extractStructure(root);
      const ifaceUses = result.imports.filter(
        (i) => i.section === "interface",
      );
      const implUses = result.imports.filter(
        (i) => i.section === "implementation",
      );
      expect(ifaceUses.map((i) => i.source)).toEqual(["Windows", "Classes"]);
      expect(implUses.map((i) => i.source)).toEqual(["MyHelper"]);
      tree.delete();
      parser.delete();
    });

    it("leaves .dpr program-file uses untagged", () => {
      const { tree, parser, root } = parse(`
program MyApp;

uses
  Forms, MyForm;

begin
end.
`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(2);
      for (const imp of result.imports) {
        expect(imp.section).toBeUndefined();
      }
      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes / inheritance ----

  describe("extractStructure - classes", () => {
    it("extracts a class with parent (Pascal class(TParent))", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

type
  TMyForm = class(TForm)
    Button1: TButton;
    procedure Button1Click(Sender: TObject);
  end;

implementation

end.
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("TMyForm");
      expect(result.classes[0].parents).toEqual(["TForm"]);
      expect(result.classes[0].interfaces).toBeUndefined();
      expect(result.classes[0].methods).toContain("Button1Click");
      expect(result.classes[0].properties).toContain("Button1");
      tree.delete();
      parser.delete();
    });

    it("splits parent class from implemented interfaces (class(TParent, IFoo, IBar))", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

type
  TMyService = class(TBaseService, IFoo, IBar)
    procedure DoWork;
  end;

implementation

end.
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].parents).toEqual(["TBaseService"]);
      expect(result.classes[0].interfaces).toEqual(["IFoo", "IBar"]);
      tree.delete();
      parser.delete();
    });

    it("treats interface declaration ancestors as parents (interface inheritance)", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

type
  IExtended = interface(IBase)
    procedure DoExtra;
  end;

implementation

end.
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("IExtended");
      expect(result.classes[0].parents).toEqual(["IBase"]);
      expect(result.classes[0].interfaces).toBeUndefined();
      tree.delete();
      parser.delete();
    });

    it("emits no parents/interfaces for ancestor-less classes", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

type
  TStandalone = class
    value: Integer;
  end;

implementation

end.
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].parents).toBeUndefined();
      expect(result.classes[0].interfaces).toBeUndefined();
      tree.delete();
      parser.delete();
    });
  });

  // ---- Procedures / functions ----

  describe("extractStructure - routines", () => {
    it("extracts procedure with parameters", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

procedure Greet(name: string; const punctuation: string);

implementation

procedure Greet(name: string; const punctuation: string);
begin
end;

end.
`);
      const result = extractor.extractStructure(root);
      const greet = result.functions.find((f) => f.name === "Greet");
      expect(greet).toBeDefined();
      expect(greet!.params).toEqual(["name", "punctuation"]);
    });

    it("extracts function return type", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

function Add(a, b: Integer): Integer;

implementation

function Add(a, b: Integer): Integer;
begin
  Result := a + b;
end;

end.
`);
      const result = extractor.extractStructure(root);
      const add = result.functions.find((f) => f.name === "Add");
      expect(add).toBeDefined();
      expect(add!.params).toEqual(["a", "b"]);
      expect(add!.returnType).toBe("Integer");
    });

    it("preserves qualified method names (ClassName.MethodName)", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

type
  TMyForm = class(TForm)
    procedure FormCreate(Sender: TObject);
  end;

implementation

procedure TMyForm.FormCreate(Sender: TObject);
begin
end;

end.
`);
      const result = extractor.extractStructure(root);
      const qualified = result.functions.find(
        (f) => f.name === "TMyForm.FormCreate",
      );
      expect(qualified).toBeDefined();
      expect(qualified!.params).toEqual(["Sender"]);
    });
  });

  // ---- Call graph ----

  describe("extractCallGraph", () => {
    it("records caller→callee pairs within procedure bodies", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;

interface

implementation

procedure Helper;
begin
end;

procedure Main;
begin
  Helper;
  WriteLn('hi');
end;

end.
`);
      const calls = extractor.extractCallGraph(root);
      const callers = new Set(calls.map((c) => c.caller));
      expect(callers.has("Main")).toBe(true);
      const callees = calls
        .filter((c) => c.caller === "Main")
        .map((c) => c.callee);
      expect(callees).toContain("Helper");
    });
  });
});

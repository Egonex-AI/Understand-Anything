import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { PascalExtractor } from "../pascal-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let pascalLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve("tree-sitter-pascal/tree-sitter-pascal.wasm");
  pascalLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(pascalLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("PascalExtractor", () => {
  const extractor = new PascalExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["pascal"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts a procedure with params", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
implementation
procedure DoSomething(AValue: Integer; AName: string);
begin
end;
end.
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "DoSomething");
      expect(fn).toBeDefined();
      expect(fn!.params).toEqual(["AValue", "AName"]);
      expect(fn!.returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts a function with return type", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
implementation
function Add(A, B: Integer): Integer;
begin
  Result := A + B;
end;
end.
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "Add");
      expect(fn).toBeDefined();
      expect(fn!.params).toEqual(["A", "B"]);
      expect(fn!.returnType).toBeDefined();

      tree.delete();
      parser.delete();
    });

    it("extracts a parameterless procedure", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
implementation
procedure Run;
begin
end;
end.
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "Run");
      expect(fn).toBeDefined();
      expect(fn!.params).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("reports correct line range", () => {
      const { tree, parser, root } = parse(`unit MyUnit;
interface
implementation
procedure Greet;
begin
end;
end.
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "Greet");
      expect(fn).toBeDefined();
      expect(fn!.lineRange[0]).toBeGreaterThanOrEqual(4);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts a class with methods and properties", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
type
  TFoo = class
    FValue: Integer;
    procedure SetValue(V: Integer);
    function GetValue: Integer;
    property Value: Integer read GetValue write SetValue;
  end;
implementation
end.
`);
      const result = extractor.extractStructure(root);

      const cls = result.classes.find((c) => c.name === "TFoo");
      expect(cls).toBeDefined();
      expect(cls!.methods).toContain("SetValue");
      expect(cls!.methods).toContain("GetValue");
      expect(cls!.properties).toContain("Value");

      tree.delete();
      parser.delete();
    });

    it("extracts an empty class", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
type
  TEmpty = class
  end;
implementation
end.
`);
      const result = extractor.extractStructure(root);

      const cls = result.classes.find((c) => c.name === "TEmpty");
      expect(cls).toBeDefined();
      expect(cls!.methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts an interface type", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
type
  IFoo = interface
    procedure DoIt;
  end;
implementation
end.
`);
      const result = extractor.extractStructure(root);

      const cls = result.classes.find((c) => c.name === "IFoo");
      expect(cls).toBeDefined();
      expect(cls!.methods).toContain("DoIt");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts uses clause modules", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
uses
  SysUtils, Classes;
implementation
end.
`);
      const result = extractor.extractStructure(root);

      const sources = result.imports.map((i) => i.source);
      expect(sources).toContain("SysUtils");
      expect(sources).toContain("Classes");

      tree.delete();
      parser.delete();
    });

    it("extracts dotted module names", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
uses
  System.SysUtils;
implementation
end.
`);
      const result = extractor.extractStructure(root);

      const imp = result.imports.find((i) => i.source === "System.SysUtils");
      expect(imp).toBeDefined();
      expect(imp!.specifiers).toEqual(["SysUtils"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports (interface section)", () => {
    it("exports types declared in the interface section", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
type
  TFoo = class
    procedure Run;
  end;
implementation
end.
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("TFoo");

      tree.delete();
      parser.delete();
    });

    it("does not export types declared only in implementation", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
implementation
type
  TInternal = class
  end;
procedure Helper;
begin
end;
end.
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).not.toContain("TInternal");
      expect(exportNames).not.toContain("Helper");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts procedure calls", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
implementation
procedure Caller;
begin
  Foo;
  Bar;
end;
end.
`);
      const result = extractor.extractCallGraph(root);

      const callerEntries = result.filter((e) => e.caller === "Caller");
      const callees = callerEntries.map((e) => e.callee);
      expect(callees).toContain("Foo");
      expect(callees).toContain("Bar");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`unit MyUnit;
interface
implementation
procedure P;
begin
  Foo;
end;
end.
`);
      const result = extractor.extractCallGraph(root);
      const entry = result.find((e) => e.callee === "Foo");
      expect(entry).toBeDefined();
      expect(entry!.lineNumber).toBe(6);

      tree.delete();
      parser.delete();
    });

    it("tracks caller correctly for multiple functions", () => {
      const { tree, parser, root } = parse(`
unit MyUnit;
interface
implementation
procedure Alpha;
begin
  Beta;
end;
procedure Beta;
begin
  Gamma;
end;
end.
`);
      const result = extractor.extractCallGraph(root);

      const alphaCalls = result.filter((e) => e.caller === "Alpha");
      expect(alphaCalls.map((e) => e.callee)).toContain("Beta");

      const betaCalls = result.filter((e) => e.caller === "Beta");
      expect(betaCalls.map((e) => e.callee)).toContain("Gamma");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive Pascal unit", () => {
    it("handles a realistic unit", () => {
      const { tree, parser, root } = parse(`
unit Calculator;
interface
uses
  SysUtils, Math;
type
  TCalculator = class
    FValue: Double;
    procedure SetValue(V: Double);
    function GetValue: Double;
    function Add(A, B: Double): Double;
    property Value: Double read GetValue write SetValue;
  end;
procedure GlobalReset;
implementation
procedure TCalculator.SetValue(V: Double);
begin
  FValue := V;
end;
function TCalculator.GetValue: Double;
begin
  Result := FValue;
end;
function TCalculator.Add(A, B: Double): Double;
begin
  Result := A + B;
  SetValue(Result);
end;
procedure GlobalReset;
begin
  SysUtils.FreeAndNil(nil);
end;
end.
`);
      const result = extractor.extractStructure(root);

      // Classes
      const cls = result.classes.find((c) => c.name === "TCalculator");
      expect(cls).toBeDefined();
      expect(cls!.methods).toContain("SetValue");
      expect(cls!.methods).toContain("GetValue");
      expect(cls!.methods).toContain("Add");
      expect(cls!.properties).toContain("Value");

      // Imports
      const sources = result.imports.map((i) => i.source);
      expect(sources).toContain("SysUtils");
      expect(sources).toContain("Math");

      // Exports (interface section)
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("TCalculator");
      expect(exportNames).toContain("GlobalReset");

      // Call graph
      const calls = extractor.extractCallGraph(root);
      const addCalls = calls.filter((e) => e.caller.includes("Add"));
      expect(addCalls.some((e) => e.callee.includes("SetValue"))).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

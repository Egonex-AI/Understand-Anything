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

  // ---- TypeScript: classes ----

  describe("TypeScript - extractStructure - classes", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parseTs(`
class UserService {
  private db: Database;
  timeout: number;

  constructor(db: Database) {
    this.db = db;
  }

  async getUser(id: string): Promise<User> {
    return this.db.find(id);
  }

  deleteUser(id: string): void {
    this.db.delete(id);
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("getUser");
      expect(result.classes[0].methods).toContain("deleteUser");
      expect(result.classes[0].properties).toContain("db");
      expect(result.classes[0].properties).toContain("timeout");
      expect(result.classes[0].lineRange[0]).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts empty class", () => {
      const { tree, parser, root } = parseTs(`
class Empty {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple classes", () => {
      const { tree, parser, root } = parseTs(`
class Foo {}
class Bar {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(2);
      expect(result.classes.map((c) => c.name)).toEqual(["Foo", "Bar"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- TypeScript: imports ----

  describe("TypeScript - extractStructure - imports", () => {
    it("extracts named imports", () => {
      const { tree, parser, root } = parseTs(`
import { useState, useEffect } from "react";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("react");
      expect(result.imports[0].specifiers).toContain("useState");
      expect(result.imports[0].specifiers).toContain("useEffect");
      expect(result.imports[0].lineNumber).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts default import", () => {
      const { tree, parser, root } = parseTs(`
import React from "react";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("react");
      expect(result.imports[0].specifiers).toContain("React");

      tree.delete();
      parser.delete();
    });

    it("extracts namespace import", () => {
      const { tree, parser, root } = parseTs(`
import * as fs from "fs";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("fs");
      expect(result.imports[0].specifiers).toContain("* as fs");

      tree.delete();
      parser.delete();
    });

    it("extracts aliased named import", () => {
      const { tree, parser, root } = parseTs(`
import { Component as Comp } from "@angular/core";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toContain("Comp");

      tree.delete();
      parser.delete();
    });

    it("extracts multiple import statements", () => {
      const { tree, parser, root } = parseTs(`
import { A } from "./a";
import { B } from "./b";
import { C } from "./c";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(3);
      expect(result.imports.map((i) => i.source)).toEqual(["./a", "./b", "./c"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- TypeScript: exports ----

  describe("TypeScript - extractStructure - exports", () => {
    it("extracts named export of function", () => {
      const { tree, parser, root } = parseTs(`
export function fetchUser(id: string): Promise<User> {
  return db.find(id);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe("fetchUser");
      expect(result.exports[0].isDefault).toBeFalsy();

      tree.delete();
      parser.delete();
    });

    it("extracts default export of function", () => {
      const { tree, parser, root } = parseTs(`
export default function App() {
  return null;
}
`);
      const result = extractor.extractStructure(root);

      const defaultExport = result.exports.find((e) => e.isDefault);
      expect(defaultExport).toBeDefined();
      expect(defaultExport?.name).toBe("App");

      tree.delete();
      parser.delete();
    });

    it("extracts export of class", () => {
      const { tree, parser, root } = parseTs(`
export class AuthService {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports.some((e) => e.name === "AuthService")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts export clause (re-exports)", () => {
      const { tree, parser, root } = parseTs(`
export { foo, bar };
`);
      const result = extractor.extractStructure(root);

      const names = result.exports.map((e) => e.name);
      expect(names).toContain("foo");
      expect(names).toContain("bar");

      tree.delete();
      parser.delete();
    });

    it("extracts export of const arrow function", () => {
      const { tree, parser, root } = parseTs(`
export const multiply = (a: number, b: number) => a * b;
`);
      const result = extractor.extractStructure(root);

      expect(result.exports.some((e) => e.name === "multiply")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("does not duplicate exports", () => {
      const { tree, parser, root } = parseTs(`
export function doThing() {}
export function doThing() {}
`);
      const result = extractor.extractStructure(root);
      const names = result.exports.map((e) => e.name);
      const unique = new Set(names);
      expect(names.length).toBe(unique.size);

      tree.delete();
      parser.delete();
    });
  });

  // ---- TypeScript: call graph ----

  describe("TypeScript - extractCallGraph", () => {
    it("extracts calls from function declaration", () => {
      const { tree, parser, root } = parseTs(`
function process(data: string) {
  validate(data);
  transform(data);
}
`);
      const result = extractor.extractCallGraph(root);

      const calls = result.filter((e) => e.caller === "process");
      expect(calls.some((e) => e.callee === "validate")).toBe(true);
      expect(calls.some((e) => e.callee === "transform")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts method calls (dot notation)", () => {
      const { tree, parser, root } = parseTs(`
function start() {
  this.db.connect();
  console.log("started");
}
`);
      const result = extractor.extractCallGraph(root);

      const calls = result.filter((e) => e.caller === "start");
      expect(calls.some((e) => e.callee === "this.db.connect")).toBe(true);
      expect(calls.some((e) => e.callee === "console.log")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts calls from arrow function assigned to const", () => {
      const { tree, parser, root } = parseTs(`
const handler = () => {
  doSomething();
};
`);
      const result = extractor.extractCallGraph(root);

      const calls = result.filter((e) => e.caller === "handler");
      expect(calls.some((e) => e.callee === "doSomething")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts calls from class methods", () => {
      const { tree, parser, root } = parseTs(`
class Service {
  run() {
    this.init();
    fetch("url");
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const calls = result.filter((e) => e.caller === "run");
      expect(calls.some((e) => e.callee.includes("init"))).toBe(true);
      expect(calls.some((e) => e.callee === "fetch")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("reports correct line number for calls", () => {
      const { tree, parser, root } = parseTs(`
function main() {
  foo();
  bar();
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(4);

      tree.delete();
      parser.delete();
    });

    it("ignores calls outside any function (top-level)", () => {
      const { tree, parser, root } = parseTs(`
doSetup();
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });
});

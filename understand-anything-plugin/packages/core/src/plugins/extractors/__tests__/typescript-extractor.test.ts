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
const foo = 1;
export { foo, foo };
`);
      const result = extractor.extractStructure(root);
      expect(result.exports.filter((e) => e.name === "foo")).toHaveLength(1);

      tree.delete();
      parser.delete();
    });

    it("records name as 'default' for default-exported class", () => {
      const { tree, parser, root } = parseTs(`
export default class Handler {}
`);
      const result = extractor.extractStructure(root);

      const defaultExport = result.exports.find((e) => e.isDefault);
      expect(defaultExport).toBeDefined();
      expect(defaultExport?.name).toBe("default");

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
      expect(calls.some((e) => e.callee === "this.init")).toBe(true);
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

  // ---- TypeScript: comprehensive ----

  describe("TypeScript - comprehensive file", () => {
    it("handles a realistic TypeScript module", () => {
      const { tree, parser, root } = parseTs(`
import { EventEmitter } from "events";
import type { Logger } from "./logger";

export class AuthService extends EventEmitter {
  private logger: Logger;
  readonly maxRetries: number;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.maxRetries = 3;
  }

  async login(username: string, password: string): Promise<boolean> {
    this.logger.info("login attempt");
    return this.verify(username, password);
  }

  private verify(user: string, pass: string): boolean {
    return user.length > 0 && pass.length > 0;
  }
}

export function createAuth(logger: Logger): AuthService {
  return new AuthService(logger);
}

export const DEFAULT_TIMEOUT = 5000;
`);
      const result = extractor.extractStructure(root);

      // Imports
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("events");
      expect(result.imports[1].source).toBe("./logger");

      // Classes
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("AuthService");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("login");
      expect(result.classes[0].methods).toContain("verify");
      expect(result.classes[0].properties).toContain("logger");
      expect(result.classes[0].properties).toContain("maxRetries");

      // Functions
      const fnNames = result.functions.map((f) => f.name);
      expect(fnNames).toContain("createAuth");

      // Exports
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("AuthService");
      expect(exportNames).toContain("createAuth");
      expect(exportNames).toContain("DEFAULT_TIMEOUT");

      // Call graph
      const calls = extractor.extractCallGraph(root);
      const loginCalls = calls.filter((e) => e.caller === "login");
      expect(loginCalls.some((e) => e.callee.includes("verify"))).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

describe("TypeScriptExtractor - JavaScript grammar", () => {
  const extractor = new TypeScriptExtractor();

  // ---- JS: functions ----

  describe("JavaScript - extractStructure - functions", () => {
    it("extracts function declaration (no types)", () => {
      const { tree, parser, root } = parseJs(`
function greet(name, age) {
  return name;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name", "age"]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts arrow function assigned to const", () => {
      const { tree, parser, root } = parseJs(`
const add = (a, b) => a + b;
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
      expect(result.functions[0].params).toEqual(["a", "b"]);

      tree.delete();
      parser.delete();
    });

    it("extracts function expression assigned to const", () => {
      const { tree, parser, root } = parseJs(`
const handler = function(req, res) {
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
  });

  // ---- JS: classes ----

  describe("JavaScript - extractStructure - classes", () => {
    it("extracts ES6 class with methods", () => {
      const { tree, parser, root } = parseJs(`
class Animal {
  constructor(name) {
    this.name = name;
  }

  speak() {
    console.log(this.name);
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Animal");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("speak");

      tree.delete();
      parser.delete();
    });
  });

  // ---- JS: imports (ESM) ----

  describe("JavaScript - extractStructure - imports", () => {
    it("extracts ESM named imports", () => {
      const { tree, parser, root } = parseJs(`
import { readFile, writeFile } from "fs/promises";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("fs/promises");
      expect(result.imports[0].specifiers).toContain("readFile");
      expect(result.imports[0].specifiers).toContain("writeFile");

      tree.delete();
      parser.delete();
    });

    it("extracts ESM default import", () => {
      const { tree, parser, root } = parseJs(`
import express from "express";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("express");
      expect(result.imports[0].specifiers).toContain("express");

      tree.delete();
      parser.delete();
    });
  });

  // ---- JS: exports ----

  describe("JavaScript - extractStructure - exports", () => {
    it("extracts named function export", () => {
      const { tree, parser, root } = parseJs(`
export function doWork() {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports.some((e) => e.name === "doWork")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts default export", () => {
      const { tree, parser, root } = parseJs(`
export default function App() {}
`);
      const result = extractor.extractStructure(root);

      const def = result.exports.find((e) => e.isDefault);
      expect(def).toBeDefined();

      tree.delete();
      parser.delete();
    });
  });

  // ---- JS: call graph ----

  describe("JavaScript - extractCallGraph", () => {
    it("extracts simple function calls", () => {
      const { tree, parser, root } = parseJs(`
function main() {
  setup();
  run();
}
`);
      const result = extractor.extractCallGraph(root);

      const calls = result.filter((e) => e.caller === "main");
      expect(calls.some((e) => e.callee === "setup")).toBe(true);
      expect(calls.some((e) => e.callee === "run")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts method calls from arrow function", () => {
      const { tree, parser, root } = parseJs(`
const start = () => {
  server.listen(3000);
};
`);
      const result = extractor.extractCallGraph(root);

      const calls = result.filter((e) => e.caller === "start");
      expect(calls.some((e) => e.callee === "server.listen")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });

  // ---- JS: comprehensive ----

  describe("JavaScript - comprehensive file", () => {
    it("handles a realistic JS module using ESM exports", () => {
      const { tree, parser, root } = parseJs(`
import path from "path";
import { readFileSync } from "fs";

class ConfigLoader {
  constructor(dir) {
    this.dir = dir;
  }

  load(filename) {
    const fullPath = path.join(this.dir, filename);
    return readFileSync(fullPath, "utf8");
  }
}

export function createLoader(dir) {
  return new ConfigLoader(dir);
}

export default ConfigLoader;
`);
      const result = extractor.extractStructure(root);

      // Imports
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("path");
      expect(result.imports[1].source).toBe("fs");

      // Classes
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("ConfigLoader");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("load");

      // Functions
      const fnNames = result.functions.map((f) => f.name);
      expect(fnNames).toContain("createLoader");

      // Exports
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("createLoader");
      // Note: bare `export default Identifier;` is not captured by the extractor;
      // only default-exported declarations (functions/classes) set isDefault.

      // Call graph
      const calls = extractor.extractCallGraph(root);
      const loadCalls = calls.filter((e) => e.caller === "load");
      expect(loadCalls.some((e) => e.callee.includes("join"))).toBe(true);
      expect(loadCalls.some((e) => e.callee === "readFileSync")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

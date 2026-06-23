import { describe, it, expect, beforeAll } from "vitest";
import { TreeSitterPlugin } from "./tree-sitter-plugin.js";

describe("TreeSitterPlugin", () => {
  let plugin: TreeSitterPlugin;

  beforeAll(async () => {
    plugin = new TreeSitterPlugin();
    await plugin.init();
  });

  describe("analyzeFile", () => {
    it("should extract function declarations from TypeScript", () => {
      const code = `
function greet(name: string): string {
  return "Hello " + name;
}

function add(a: number, b: number): number {
  return a + b;
}
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("string");
      expect(result.functions[0].lineRange[0]).toBeGreaterThan(0);

      expect(result.functions[1].name).toBe("add");
      expect(result.functions[1].params).toEqual(["a", "b"]);
      expect(result.functions[1].returnType).toBe("number");
    });

    it("should extract arrow functions assigned to variables", () => {
      const code = `
const multiply = (a: number, b: number): number => a * b;
const log = (msg: string) => { console.log(msg); };
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("multiply");
      expect(result.functions[0].params).toEqual(["a", "b"]);
      expect(result.functions[0].returnType).toBe("number");

      expect(result.functions[1].name).toBe("log");
      expect(result.functions[1].params).toEqual(["msg"]);
    });

    it("should extract class declarations with methods and properties", () => {
      const code = `
class Calculator {
  private value: number;
  public name: string;

  constructor(initial: number) {
    this.value = initial;
  }

  add(n: number): number {
    return this.value + n;
  }

  subtract(n: number): number {
    return this.value - n;
  }
}
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.classes).toHaveLength(1);
      const cls = result.classes[0];
      expect(cls.name).toBe("Calculator");
      expect(cls.methods).toContain("constructor");
      expect(cls.methods).toContain("add");
      expect(cls.methods).toContain("subtract");
      expect(cls.properties).toContain("value");
      expect(cls.properties).toContain("name");
      expect(cls.lineRange[0]).toBeGreaterThan(0);
    });

    it("should extract import statements with specifiers and source", () => {
      const code = `
import { foo, bar } from './utils';
import * as path from 'path';
import type { MyType } from './types';
import defaultExport from './module';
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.imports).toHaveLength(4);

      expect(result.imports[0].source).toBe("./utils");
      expect(result.imports[0].specifiers).toEqual(["foo", "bar"]);
      expect(result.imports[0].lineNumber).toBeGreaterThan(0);

      expect(result.imports[1].source).toBe("path");
      expect(result.imports[1].specifiers).toEqual(["* as path"]);

      expect(result.imports[2].source).toBe("./types");
      expect(result.imports[2].specifiers).toEqual(["MyType"]);

      expect(result.imports[3].source).toBe("./module");
      expect(result.imports[3].specifiers).toEqual(["defaultExport"]);
    });

    it("should extract export names", () => {
      const code = `
export function greet(name: string): string {
  return "Hello " + name;
}

export const add = (a: number, b: number): number => a + b;

export class Logger {}

const helper = () => true;
export { helper };
`;
      const result = plugin.analyzeFile("test.ts", code);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("greet");
      expect(exportNames).toContain("add");
      expect(exportNames).toContain("Logger");
      expect(exportNames).toContain("helper");
      expect(result.exports.length).toBe(4);
    });

    it("should extract default exports", () => {
      const code = `
export default class AppController {}
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("AppController");

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("default");
    });

    it("should handle export with aliases", () => {
      const code = `
const originalName = () => true;
export { originalName as renamedExport };
`;
      const result = plugin.analyzeFile("test.ts", code);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("renamedExport");
    });

    it("should handle arrow functions without parameters", () => {
      const code = `
const noParams = () => { return 42; };
const withReturn = () => "hello";
`;
      const result = plugin.analyzeFile("test.ts", code);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("noParams");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[1].name).toBe("withReturn");
      expect(result.functions[1].params).toEqual([]);
    });

    it("should extract functions from JavaScript files", () => {
      const code = `
function hello() {
  return "world";
}

const double = (x) => x * 2;
`;
      const result = plugin.analyzeFile("test.js", code);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("hello");
      expect(result.functions[0].params).toEqual([]);

      expect(result.functions[1].name).toBe("double");
      expect(result.functions[1].params).toEqual(["x"]);
    });

    it("should handle a comprehensive TypeScript file", () => {
      const code = `
import { EventEmitter } from 'events';
import type { Config } from './config';

export interface Options {
  timeout: number;
}

export class Server extends EventEmitter {
  private port: number;

  constructor(port: number) {
    super();
    this.port = port;
  }

  start(): void {
    console.log("Starting on port " + this.port);
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

export function createServer(port: number): Server {
  return new Server(port);
}

export const DEFAULT_PORT = 3000;
`;
      const result = plugin.analyzeFile("server.ts", code);

      expect(result.imports.length).toBeGreaterThanOrEqual(2);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("start");
      expect(result.classes[0].methods).toContain("stop");
      expect(result.classes[0].properties).toContain("port");

      expect(result.functions.some((f) => f.name === "createServer")).toBe(true);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Server");
      expect(exportNames).toContain("createServer");
    });
  });

  describe("resolveImports", () => {
    it("should resolve relative imports to absolute paths", () => {
      const code = `
import { foo } from './utils';
import { bar } from '../shared/helpers';
import * as path from 'path';
`;
      const result = plugin.resolveImports("/project/src/index.ts", code);

      expect(result).toHaveLength(3);

      // Relative imports should be resolved
      expect(result[0].source).toBe("./utils");
      expect(result[0].resolvedPath).toContain("utils");
      expect(result[0].specifiers).toEqual(["foo"]);

      expect(result[1].source).toBe("../shared/helpers");
      expect(result[1].resolvedPath).toContain("shared");
      expect(result[1].specifiers).toEqual(["bar"]);

      // External packages keep their original path
      expect(result[2].source).toBe("path");
      expect(result[2].resolvedPath).toBe("path");
      expect(result[2].specifiers).toEqual(["* as path"]);
    });
  });

  describe("extractCallGraph", () => {
    it("should extract function calls within functions", () => {
      const code = `
function greet(name: string): string {
  return formatMessage("Hello " + name);
}

function formatMessage(msg: string): string {
  return msg.trim();
}

function main() {
  const result = greet("World");
  console.log(result);
}
`;
      const result = plugin.extractCallGraph!("test.ts", code);

      expect(result.length).toBeGreaterThan(0);

      const greetCall = result.find(
        (e) => e.caller === "main" && e.callee === "greet",
      );
      expect(greetCall).toBeDefined();

      const formatCall = result.find(
        (e) => e.caller === "greet" && e.callee === "formatMessage",
      );
      expect(formatCall).toBeDefined();
    });
  });

  describe("plugin metadata", () => {
    it("should have correct name", () => {
      expect(plugin.name).toBe("tree-sitter");
    });

    it("should support typescript and javascript", () => {
      expect(plugin.languages).toContain("typescript");
      expect(plugin.languages).toContain("javascript");
    });
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";
import { TypeScriptExtractor } from "../typescript-extractor.js";

const require = createRequire(import.meta.url);
const languages = new Map<string, Language>();
beforeAll(async () => {
  await Parser.init();
  languages.set(
    "javascript",
    await Language.load(
      require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
    ),
  );
  languages.set(
    "typescript",
    await Language.load(
      require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"),
    ),
  );
});

function analyze(code: string, language: string) {
  const parser = new Parser();
  parser.setLanguage(languages.get(language)!);
  const tree = parser.parse(code);
  if (!tree) throw new Error("Fixture did not parse");
  try {
    return new TypeScriptExtractor().extractStructure(tree.rootNode);
  } finally {
    tree.delete();
    parser.delete();
  }
}

describe.each(["javascript", "typescript"])(
  "CommonJS extraction (%s)",
  (language) => {
    it("records default, destructured, aliased and side-effect require imports", () => {
      const result = analyze(
        `const db = require('../db');
const { ApiError, log: logger } = require('../utils');
require('./register');`,
        language,
      );
      expect(result.imports).toEqual([
        { source: "../db", specifiers: ["db"], lineNumber: 1 },
        {
          source: "../utils",
          specifiers: ["ApiError", "logger"],
          lineNumber: 2,
        },
        { source: "./register", specifiers: [], lineNumber: 3 },
      ]);
    });

    it("records each declarator and static template require paths", () => {
      const result = analyze(
        "const first = require('a'), second = require(`b`);",
        language,
      );
      expect(
        result.imports.map(({ source, specifiers }) => ({
          source,
          specifiers,
        })),
      ).toEqual([
        { source: "a", specifiers: ["first"] },
        { source: "b", specifiers: ["second"] },
      ]);
    });

    it("records destructuring defaults and rest bindings", () => {
      const result = analyze(
        "const { first = 1, renamed: second = 2, ...others } = require('pkg');",
        language,
      );
      expect(result.imports[0].specifiers).toEqual([
        "first",
        "second",
        "others",
      ]);
    });

    it("records named exports and deduplicates an object barrel", () => {
      const result = analyze(
        `exports.list = async () => {};
module.exports.find = find;
exports['remove'] = remove;
module.exports = { list, get: find, save() {}, 'read-all': readAll };`,
        language,
      );
      expect(
        result.exports.map(({ name, isDefault }) => ({ name, isDefault })),
      ).toEqual([
        { name: "list", isDefault: false },
        { name: "find", isDefault: false },
        { name: "remove", isDefault: false },
        { name: "get", isDefault: false },
        { name: "save", isDefault: false },
        { name: "read-all", isDefault: false },
      ]);
    });

    it.each([
      ["router", "router"],
      ["function handler() {}", "handler"],
      ["function () {}", "default"],
      ["() => {}", "default"],
    ])("records a default module.exports value: %s", (value, name) => {
      expect(analyze(`module.exports = ${value};`, language).exports).toEqual([
        { name, isDefault: true, lineNumber: 1 },
      ]);
    });

    it("ignores dynamic require paths and unrelated methods", () => {
      const result = analyze(
        "const a = require(config.path); const b = require(`./${name}`); require(path, 'not-the-source'); notRequire('x'); object.require('y');",
        language,
      );
      expect(result.imports).toEqual([]);
    });

    it.each([
      "function require(name) { return {}; } const item = require('./not-a-dependency');",
      "const require = (name) => ({}); const item = require('./not-a-dependency');",
    ])(
      "does not treat a locally defined require as a module loader",
      (source) => {
        expect(analyze(source, language).imports).toEqual([]);
      },
    );

    it.each([
      "const module = { exports: {} }; module.exports.Item = Item;",
      "const exports = {}; exports.Item = Item;",
    ])(
      "does not treat locally declared objects as CommonJS exports",
      (source) => {
        expect(analyze(source, language).exports).toEqual([]);
      },
    );

    it.each([
      "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      "import { createRequire as makeRequire } from 'module'; const require = makeRequire(import.meta.url);",
      "import * as nodeModule from 'node:module'; const require = nodeModule.createRequire(import.meta.url);",
    ])("recognizes a Node createRequire bridge", (bridge) => {
      const result = analyze(
        `${bridge} const item = require('./dependency');`,
        language,
      );
      expect(result.imports).toContainEqual({
        source: "./dependency",
        specifiers: ["item"],
        lineNumber: 1,
      });
    });

    it("ignores unrelated assignments and dynamic export keys", () => {
      expect(
        analyze(
          "object.exports = value; object.exports.name = value; window.exports.name = value; exports[key] = value;",
          language,
        ).exports,
      ).toEqual([]);
    });

    it("keeps ES modules and existing structural extraction in mixed files", () => {
      const result = analyze(
        "import esm from './esm'; const cjs = require('./cjs'); export function handler() {} exports.handler = handler; class Model {}",
        language,
      );
      expect(result.imports.map(({ source }) => source)).toEqual([
        "./esm",
        "./cjs",
      ]);
      expect(result.exports.map(({ name }) => name)).toEqual(["handler"]);
      expect(result.functions.map(({ name }) => name)).toEqual(["handler"]);
      expect(result.classes.map(({ name }) => name)).toEqual(["Model"]);
    });
  },
);

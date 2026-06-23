import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { RustExtractor } from "../rust-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Rust grammar once
let Parser: any;
let Language: any;
let rustLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-rust/tree-sitter-rust.wasm",
  );
  rustLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(rustLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("RustExtractor", () => {
  const extractor = new RustExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["rust"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts top-level functions with params and return types", () => {
      const { tree, parser, root } = parse(`
pub fn check_port(port: u16) -> bool {
    port > 0
}

fn helper(name: String, count: i32) -> String {
    name.repeat(count)
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("check_port");
      expect(result.functions[0].params).toEqual(["port"]);
      expect(result.functions[0].returnType).toBe("bool");

      expect(result.functions[1].name).toBe("helper");
      expect(result.functions[1].params).toEqual(["name", "count"]);
      expect(result.functions[1].returnType).toBe("String");

      tree.delete();
      parser.delete();
    });

    it("extracts functions with no params and no return type", () => {
      const { tree, parser, root } = parse(`
fn noop() {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges for multi-line functions", () => {
      const { tree, parser, root } = parse(`
fn multiline(
    a: i32,
    b: i32,
) -> i32 {
    let result = a + b;
    result
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(2);
      expect(result.functions[0].lineRange[1]).toBe(8);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Methods (impl blocks) ----

  describe("extractStructure - impl blocks and methods", () => {
    it("extracts methods from impl blocks and links them to structs", () => {
      const { tree, parser, root } = parse(`
pub struct Config {
    name: String,
    port: u16,
}

impl Config {
    pub fn new(name: String, port: u16) -> Self {
        Config { name, port }
    }

    fn validate(&self) -> bool {
        true
    }
}
`);
      const result = extractor.extractStructure(root);

      // Methods appear in functions list
      const fnNames = result.functions.map((f) => f.name);
      expect(fnNames).toContain("new");
      expect(fnNames).toContain("validate");

      // new() skips self parameter, captures real params
      const newFn = result.functions.find((f) => f.name === "new");
      expect(newFn?.params).toEqual(["name", "port"]);
      expect(newFn?.returnType).toBe("Self");

      // validate() has &self — should have no params
      const validateFn = result.functions.find((f) => f.name === "validate");
      expect(validateFn?.params).toEqual([]);
      expect(validateFn?.returnType).toBe("bool");

      // Methods linked to struct
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Config");
      expect(result.classes[0].methods).toContain("new");
      expect(result.classes[0].methods).toContain("validate");

      tree.delete();
      parser.delete();
    });

    it("handles impl blocks for enums", () => {
      const { tree, parser, root } = parse(`
enum Status {
    Active,
    Inactive,
}

impl Status {
    fn is_active(&self) -> bool {
        true
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Status");
      expect(result.classes[0].methods).toContain("is_active");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Structs ----

  describe("extractStructure - structs", () => {
    it("extracts struct with fields", () => {
      const { tree, parser, root } = parse(`
pub struct Config {
    name: String,
    port: u16,
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Config");
      expect(result.classes[0].properties).toEqual(["name", "port"]);
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].lineRange[0]).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts empty struct (unit struct)", () => {
      const { tree, parser, root } = parse(`
struct Empty;
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].properties).toEqual([]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Enums ----

  describe("extractStructure - enums", () => {
    it("extracts enum with variants as properties", () => {
      const { tree, parser, root } = parse(`
enum Status {
    Active,
    Inactive,
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Status");
      expect(result.classes[0].properties).toEqual(["Active", "Inactive"]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts pub enum", () => {
      const { tree, parser, root } = parse(`
pub enum Direction {
    North,
    South,
    East,
    West,
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Direction");
      expect(result.classes[0].properties).toEqual(["North", "South", "East", "West"]);

      // pub enum should be exported
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Direction");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Traits ----

  describe("extractStructure - traits", () => {
    it("extracts trait with method signatures", () => {
      const { tree, parser, root } = parse(`
pub trait Validator {
    fn validate(&self) -> bool;
    fn name(&self) -> &str;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Validator");
      expect(result.classes[0].methods).toEqual(["validate", "name"]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts empty trait", () => {
      const { tree, parser, root } = parse(`
trait Marker {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Marker");
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("exports pub traits", () => {
      const { tree, parser, root } = parse(`
pub trait Serializable {
    fn serialize(&self) -> String;
}

trait Internal {
    fn process(&self);
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Serializable");
      expect(exportNames).not.toContain("Internal");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts scoped identifier imports", () => {
      const { tree, parser, root } = parse(`
use std::collections::HashMap;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("std::collections");
      expect(result.imports[0].specifiers).toEqual(["HashMap"]);

      tree.delete();
      parser.delete();
    });

    it("extracts scoped use list imports", () => {
      const { tree, parser, root } = parse(`
use std::io::{self, Read, Write};
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("std::io");
      expect(result.imports[0].specifiers).toEqual(["self", "Read", "Write"]);

      tree.delete();
      parser.delete();
    });

    it("extracts wildcard imports", () => {
      const { tree, parser, root } = parse(`
use std::prelude::*;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("std::prelude");
      expect(result.imports[0].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("extracts simple identifier imports", () => {
      const { tree, parser, root } = parse(`
use foo;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("foo");
      expect(result.imports[0].specifiers).toEqual(["foo"]);

      tree.delete();
      parser.delete();
    });

    it("extracts crate-relative imports", () => {
      const { tree, parser, root } = parse(`
use crate::config::Settings;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("crate::config");
      expect(result.imports[0].specifiers).toEqual(["Settings"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`
use std::collections::HashMap;
use std::io::{self, Read};
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].lineNumber).toBe(2);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("exports pub items and not private items", () => {
      const { tree, parser, root } = parse(`
pub struct Config {
    name: String,
}

struct Internal {
    value: i32,
}

pub fn check_port(port: u16) -> bool {
    port > 0
}

fn helper() {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Config");
      expect(exportNames).toContain("check_port");
      expect(exportNames).not.toContain("Internal");
      expect(exportNames).not.toContain("helper");

      tree.delete();
      parser.delete();
    });

    it("exports pub methods inside impl blocks", () => {
      const { tree, parser, root } = parse(`
pub struct Config {
    name: String,
}

impl Config {
    pub fn new(name: String) -> Self {
        Config { name }
    }

    fn validate(&self) -> bool {
        true
    }
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Config");
      expect(exportNames).toContain("new");
      expect(exportNames).not.toContain("validate");

      tree.delete();
      parser.delete();
    });

    it("reports correct export line numbers", () => {
      const { tree, parser, root } = parse(`
pub struct Config {
    name: String,
}

pub fn check_port(port: u16) -> bool {
    port > 0
}
`);
      const result = extractor.extractStructure(root);

      const configExport = result.exports.find((e) => e.name === "Config");
      expect(configExport?.lineNumber).toBe(2);

      const checkPortExport = result.exports.find((e) => e.name === "check_port");
      expect(checkPortExport?.lineNumber).toBe(6);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple function calls", () => {
      const { tree, parser, root } = parse(`
fn validate(port: u16) -> bool {
    check_port(port)
}

fn main() {
    validate(8080);
}
`);
      const result = extractor.extractCallGraph(root);

      const validateCalls = result.filter((e) => e.caller === "validate");
      expect(validateCalls.some((e) => e.callee === "check_port")).toBe(true);

      const mainCalls = result.filter((e) => e.caller === "main");
      expect(mainCalls.some((e) => e.callee === "validate")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts method calls (field_expression)", () => {
      const { tree, parser, root } = parse(`
fn process(&self) {
    self.validate();
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("process");
      expect(result[0].callee).toBe("self.validate");

      tree.delete();
      parser.delete();
    });

    it("extracts scoped calls (e.g., Vec::new)", () => {
      const { tree, parser, root } = parse(`
fn create() {
    Vec::new();
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("create");
      expect(result[0].callee).toBe("Vec::new");

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller for methods in impl blocks", () => {
      const { tree, parser, root } = parse(`
impl Config {
    fn validate(&self) -> bool {
        check_port(self.port)
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("validate");
      expect(result[0].callee).toBe("check_port");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`
fn main() {
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

    it("ignores top-level calls (no caller)", () => {
      const { tree, parser, root } = parse(`
static X: i32 = compute();
`);
      const result = extractor.extractCallGraph(root);

      // Top-level calls have no enclosing function, so they are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive Rust file", () => {
    it("handles the full test scenario from the spec", () => {
      const { tree, parser, root } = parse(`use std::collections::HashMap;
use std::io::{self, Read};

pub struct Config {
    name: String,
    port: u16,
}

impl Config {
    pub fn new(name: String, port: u16) -> Self {
        Config { name, port }
    }

    fn validate(&self) -> bool {
        check_port(self.port)
    }
}

pub fn check_port(port: u16) -> bool {
    port > 0
}

enum Status {
    Active,
    Inactive,
}
`);
      const result = extractor.extractStructure(root);

      // Functions: new, validate, check_port
      expect(result.functions).toHaveLength(3);
      const fnNames = result.functions.map((f) => f.name).sort();
      expect(fnNames).toEqual(["check_port", "new", "validate"]);

      // new() params
      const newFn = result.functions.find((f) => f.name === "new");
      expect(newFn?.params).toEqual(["name", "port"]);
      expect(newFn?.returnType).toBe("Self");

      // validate() has &self — no visible params
      const validateFn = result.functions.find((f) => f.name === "validate");
      expect(validateFn?.params).toEqual([]);
      expect(validateFn?.returnType).toBe("bool");

      // check_port()
      const checkPortFn = result.functions.find((f) => f.name === "check_port");
      expect(checkPortFn?.params).toEqual(["port"]);
      expect(checkPortFn?.returnType).toBe("bool");

      // Classes: Config (struct) and Status (enum)
      expect(result.classes).toHaveLength(2);

      const configClass = result.classes.find((c) => c.name === "Config");
      expect(configClass).toBeDefined();
      expect(configClass!.properties).toEqual(["name", "port"]);
      expect(configClass!.methods).toContain("new");
      expect(configClass!.methods).toContain("validate");

      const statusClass = result.classes.find((c) => c.name === "Status");
      expect(statusClass).toBeDefined();
      expect(statusClass!.properties).toEqual(["Active", "Inactive"]);
      expect(statusClass!.methods).toEqual([]);

      // Imports: 2
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("std::collections");
      expect(result.imports[0].specifiers).toEqual(["HashMap"]);
      expect(result.imports[1].source).toBe("std::io");
      expect(result.imports[1].specifiers).toEqual(["self", "Read"]);

      // Exports: Config, new, check_port (those with pub)
      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toEqual(["Config", "check_port", "new"]);

      // Call graph: validate -> check_port
      const calls = extractor.extractCallGraph(root);
      const validateCalls = calls.filter((e) => e.caller === "validate");
      expect(validateCalls).toHaveLength(1);
      expect(validateCalls[0].callee).toBe("check_port");

      tree.delete();
      parser.delete();
    });

    it("handles a realistic Rust module with traits and multiple impls", () => {
      const { tree, parser, root } = parse(`use std::fmt;
use std::io::{self, Write};

pub trait Displayable {
    fn display(&self) -> String;
}

pub struct Server {
    host: String,
    port: u16,
}

impl Server {
    pub fn new(host: String, port: u16) -> Self {
        Server { host, port }
    }

    pub fn start(&self) {
        listen(self.port);
    }
}

impl Displayable for Server {
    fn display(&self) -> String {
        format_server(self.host.clone(), self.port)
    }
}

fn listen(port: u16) {
    println!("Listening on port {}", port);
}

fn format_server(host: String, port: u16) -> String {
    format!("{}:{}", host, port)
}
`);
      const result = extractor.extractStructure(root);

      // Functions: new, start, display, listen, format_server
      expect(result.functions).toHaveLength(5);

      // Trait: Displayable
      const trait_ = result.classes.find((c) => c.name === "Displayable");
      expect(trait_).toBeDefined();
      expect(trait_!.methods).toEqual(["display"]);

      // Struct: Server
      const server = result.classes.find((c) => c.name === "Server");
      expect(server).toBeDefined();
      expect(server!.properties).toEqual(["host", "port"]);
      // Methods from both impl blocks (Server and Displayable for Server)
      expect(server!.methods).toContain("new");
      expect(server!.methods).toContain("start");
      expect(server!.methods).toContain("display");

      // Exports: pub items
      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toContain("Displayable");
      expect(exportNames).toContain("Server");
      expect(exportNames).toContain("new");
      expect(exportNames).toContain("start");
      expect(exportNames).not.toContain("listen");
      expect(exportNames).not.toContain("format_server");

      // Call graph
      const calls = extractor.extractCallGraph(root);
      const startCalls = calls.filter((e) => e.caller === "start");
      expect(startCalls.some((e) => e.callee === "listen")).toBe(true);

      const displayCalls = calls.filter((e) => e.caller === "display");
      expect(displayCalls.some((e) => e.callee === "format_server")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

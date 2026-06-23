import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { RubyExtractor } from "../ruby-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Ruby grammar once
let Parser: any;
let Language: any;
let rubyLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-ruby/tree-sitter-ruby.wasm",
  );
  rubyLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(rubyLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("RubyExtractor", () => {
  const extractor = new RubyExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["ruby"]);
  });

  // ---- Functions / Methods ----

  describe("extractStructure - functions", () => {
    it("extracts simple methods", () => {
      const { tree, parser, root } = parse(`
def hello(name)
  puts name
end

def add(a, b)
  a + b
end
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("hello");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].lineRange[0]).toBeGreaterThan(0);

      expect(result.functions[1].name).toBe("add");
      expect(result.functions[1].params).toEqual(["a", "b"]);

      tree.delete();
      parser.delete();
    });

    it("extracts methods with optional parameters", () => {
      const { tree, parser, root } = parse(`
def connect(host, port = 8080, timeout = 30.0)
end
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("connect");
      expect(result.functions[0].params).toEqual(["host", "port", "timeout"]);

      tree.delete();
      parser.delete();
    });

    it("extracts methods with splat, hash splat, and block parameters", () => {
      const { tree, parser, root } = parse(`
def flexible(*args, **kwargs, &block)
end
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toEqual(["*args", "**kwargs", "&block"]);

      tree.delete();
      parser.delete();
    });

    it("extracts methods with no parameters", () => {
      const { tree, parser, root } = parse(`
def noop
end
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("does not assign return types (Ruby has none)", () => {
      const { tree, parser, root } = parse(`
def compute(x)
  x * 2
end
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges", () => {
      const { tree, parser, root } = parse(`
def multiline(
    a,
    b
)
  result = a + b
  result
end
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(2);
      expect(result.functions[0].lineRange[1]).toBe(8);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts classes with methods", () => {
      const { tree, parser, root } = parse(`
class UserService
  def initialize(name)
    @name = name
  end

  def find_user(id)
    db_query(id)
  end
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
      expect(result.classes[0].methods).toContain("initialize");
      expect(result.classes[0].methods).toContain("find_user");

      tree.delete();
      parser.delete();
    });

    it("extracts attr_accessor, attr_reader, attr_writer as properties", () => {
      const { tree, parser, root } = parse(`
class Model
  attr_accessor :name, :email
  attr_reader :id
  attr_writer :status
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].properties).toEqual(["name", "email", "id", "status"]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts singleton methods (def self.foo) within classes", () => {
      const { tree, parser, root } = parse(`
class Factory
  def self.create(attrs)
    new(attrs)
  end

  def instance_method
  end
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].methods).toContain("self.create");
      expect(result.classes[0].methods).toContain("instance_method");

      tree.delete();
      parser.delete();
    });

    it("also adds class methods to the functions array", () => {
      const { tree, parser, root } = parse(`
class Svc
  def run(x)
    x
  end
end
`);
      const result = extractor.extractStructure(root);

      // Class methods appear in the top-level functions array
      expect(result.functions.some((f) => f.name === "run")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts namespaced class names", () => {
      const { tree, parser, root } = parse(`
class Foo::Bar
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Foo::Bar");

      tree.delete();
      parser.delete();
    });

    it("reports correct class line ranges", () => {
      const { tree, parser, root } = parse(`
class MyClass
  def method_a
  end

  def method_b
  end
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].lineRange[0]).toBe(2);
      expect(result.classes[0].lineRange[1]).toBe(8);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Modules ----

  describe("extractStructure - modules", () => {
    it("treats modules as classes", () => {
      const { tree, parser, root } = parse(`
module Helpers
  def format_date(date)
    date.strftime("%Y-%m-%d")
  end
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Helpers");
      expect(result.classes[0].methods).toContain("format_date");

      tree.delete();
      parser.delete();
    });

    it("extracts module properties from attr_* calls", () => {
      const { tree, parser, root } = parse(`
module Config
  attr_accessor :debug
end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].properties).toContain("debug");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts require statements", () => {
      const { tree, parser, root } = parse(`
require "json"
require "net/http"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("json");
      expect(result.imports[0].specifiers).toEqual(["json"]);
      expect(result.imports[1].source).toBe("net/http");
      expect(result.imports[1].specifiers).toEqual(["net/http"]);

      tree.delete();
      parser.delete();
    });

    it("extracts require_relative statements", () => {
      const { tree, parser, root } = parse(`
require_relative "./helper"
require_relative "../lib/utils"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("./helper");
      expect(result.imports[1].source).toBe("../lib/utils");

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`
require "json"
require_relative "./helper"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].lineNumber).toBe(2);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });

    it("handles mixed require and require_relative", () => {
      const { tree, parser, root } = parse(`
require "json"
require_relative "./helper"
require "yaml"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe("json");
      expect(result.imports[1].source).toBe("./helper");
      expect(result.imports[2].source).toBe("yaml");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("treats top-level methods as exports", () => {
      const { tree, parser, root } = parse(`
def public_func
end

def another_func(x)
end
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("public_func");
      expect(exportNames).toContain("another_func");
      expect(result.exports).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("treats top-level classes as exports", () => {
      const { tree, parser, root } = parse(`
class MyService
end

class MyModel
end
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("MyService");
      expect(exportNames).toContain("MyModel");
      expect(result.exports).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("treats top-level modules as exports", () => {
      const { tree, parser, root } = parse(`
module Helpers
end
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Helpers");

      tree.delete();
      parser.delete();
    });

    it("does not treat imports as exports", () => {
      const { tree, parser, root } = parse(`
require "json"
require_relative "./helper"

def my_func
end
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe("my_func");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple method calls", () => {
      const { tree, parser, root } = parse(`
def process(data)
  result = transform(data)
  format_output(result)
end

def main
  process([1, 2, 3])
end
`);
      const result = extractor.extractCallGraph(root);

      const processCallers = result.filter((e) => e.caller === "process");
      expect(processCallers.some((e) => e.callee === "transform")).toBe(true);
      expect(processCallers.some((e) => e.callee === "format_output")).toBe(true);

      const mainCallers = result.filter((e) => e.caller === "main");
      expect(mainCallers.some((e) => e.callee === "process")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts receiver-based calls (method calls on objects)", () => {
      const { tree, parser, root } = parse(`
def process
  result.save
  date.strftime("%Y-%m-%d")
end
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(callees).toContain("result.save");
      expect(callees).toContain("date.strftime");

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller context for calls inside class methods", () => {
      const { tree, parser, root } = parse(`
class Service
  def start
    setup
    run_server
  end
end
`);
      const result = extractor.extractCallGraph(root);

      const startCalls = result.filter((e) => e.caller === "start");
      expect(startCalls.some((e) => e.callee === "setup")).toBe(true);
      expect(startCalls.some((e) => e.callee === "run_server")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("does not include require/require_relative in call graph", () => {
      const { tree, parser, root } = parse(`
def setup
  require "json"
  do_work
end
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(callees).not.toContain("require");
      expect(callees).toContain("do_work");

      tree.delete();
      parser.delete();
    });

    it("does not include attr_* macros in call graph", () => {
      const { tree, parser, root } = parse(`
class Foo
  attr_accessor :bar

  def init
    setup
  end
end
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(callees).not.toContain("attr_accessor");
      expect(callees).toContain("setup");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`
def main
  foo
  bar
end
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
puts "hello"
main
`);
      const result = extractor.extractCallGraph(root);

      // Top-level calls have no enclosing method, so they are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("tracks singleton method callers with self. prefix", () => {
      const { tree, parser, root } = parse(`
class Foo
  def self.create(attrs)
    new(attrs)
  end
end
`);
      const result = extractor.extractCallGraph(root);

      const createCalls = result.filter((e) => e.caller === "self.create");
      expect(createCalls.some((e) => e.callee === "new")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive Ruby file", () => {
    it("handles the full test fixture", () => {
      const { tree, parser, root } = parse(`
require "json"
require_relative "./helper"

class UserService
  attr_accessor :name, :email
  attr_reader :id

  def initialize(name, email)
    @name = name
    @email = email
  end

  def find_user(id)
    result = db_query(id)
    format_user(result)
  end

  def self.create(attrs)
    new(attrs[:name], attrs[:email])
  end
end

module Helpers
  def format_date(date)
    date.strftime("%Y-%m-%d")
  end
end

def standalone_helper(x)
  puts x.to_s
end
`);
      const result = extractor.extractStructure(root);

      // Functions: initialize, find_user, self.create, format_date, standalone_helper
      const funcNames = result.functions.map((f) => f.name);
      expect(funcNames).toContain("initialize");
      expect(funcNames).toContain("find_user");
      expect(funcNames).toContain("self.create");
      expect(funcNames).toContain("format_date");
      expect(funcNames).toContain("standalone_helper");
      expect(result.functions).toHaveLength(5);

      // Classes: UserService (methods: initialize, find_user, self.create; properties: name, email, id)
      expect(result.classes).toHaveLength(2);

      const userService = result.classes.find((c) => c.name === "UserService");
      expect(userService).toBeDefined();
      expect(userService!.methods).toContain("initialize");
      expect(userService!.methods).toContain("find_user");
      expect(userService!.methods).toContain("self.create");
      expect(userService!.properties).toEqual(
        expect.arrayContaining(["name", "email", "id"]),
      );

      // Helpers module (methods: format_date)
      const helpers = result.classes.find((c) => c.name === "Helpers");
      expect(helpers).toBeDefined();
      expect(helpers!.methods).toContain("format_date");

      // Imports: 2 (json, ./helper)
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("json");
      expect(result.imports[1].source).toBe("./helper");

      // Exports: UserService, Helpers, standalone_helper (all top-level)
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("Helpers");
      expect(exportNames).toContain("standalone_helper");

      // Call graph
      const calls = extractor.extractCallGraph(root);

      // find_user -> db_query, find_user -> format_user
      const findUserCalls = calls.filter((e) => e.caller === "find_user");
      expect(findUserCalls.some((e) => e.callee === "db_query")).toBe(true);
      expect(findUserCalls.some((e) => e.callee === "format_user")).toBe(true);

      // standalone_helper -> puts
      const standaloneHelperCalls = calls.filter(
        (e) => e.caller === "standalone_helper",
      );
      expect(standaloneHelperCalls.some((e) => e.callee === "puts")).toBe(true);

      // Verify require/require_relative not in call graph
      const allCallees = calls.map((e) => e.callee);
      expect(allCallees).not.toContain("require");
      expect(allCallees).not.toContain("require_relative");

      tree.delete();
      parser.delete();
    });
  });
});

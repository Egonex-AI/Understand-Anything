import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { PhpExtractor } from "../php-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + PHP grammar once
let Parser: any;
let Language: any;
let phpLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-php/tree-sitter-php.wasm",
  );
  phpLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(phpLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("PhpExtractor", () => {
  const extractor = new PhpExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["php"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts top-level functions with params and return types", () => {
      const { tree, parser, root } = parse(`<?php
function helper(string $x): string {
    return strtoupper($x);
}

function greet(string $name, int $times): void {
    echo $name;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("helper");
      expect(result.functions[0].params).toEqual(["$x"]);
      expect(result.functions[0].returnType).toBe("string");

      expect(result.functions[1].name).toBe("greet");
      expect(result.functions[1].params).toEqual(["$name", "$times"]);
      expect(result.functions[1].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts functions without return type", () => {
      const { tree, parser, root } = parse(`<?php
function noReturn($x) {
    echo $x;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noReturn");
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts functions with no parameters", () => {
      const { tree, parser, root } = parse(`<?php
function noop(): void {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges", () => {
      const { tree, parser, root } = parse(`<?php
function multiline(
    string $a,
    string $b
): string {
    $result = $a . $b;
    return $result;
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

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts classes with methods and properties", () => {
      const { tree, parser, root } = parse(`<?php
class UserService {
    private string $name;
    protected int $maxRetries;

    public function __construct(string $name) {
        $this->name = $name;
    }

    public function getUser(int $id): User {
        return $this->fetchFromDb($id);
    }

    private function log(string $message): void {
        error_log($message);
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
      expect(result.classes[0].methods).toContain("__construct");
      expect(result.classes[0].methods).toContain("getUser");
      expect(result.classes[0].methods).toContain("log");
      expect(result.classes[0].methods).toHaveLength(3);
      expect(result.classes[0].properties).toContain("name");
      expect(result.classes[0].properties).toContain("maxRetries");
      expect(result.classes[0].properties).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("also adds class methods to the functions array", () => {
      const { tree, parser, root } = parse(`<?php
class Svc {
    public function run(string $x): string {
        return $x;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions.some((f) => f.name === "run")).toBe(true);
      expect(result.functions[0].params).toEqual(["$x"]);
      expect(result.functions[0].returnType).toBe("string");

      tree.delete();
      parser.delete();
    });

    it("extracts classes with static methods", () => {
      const { tree, parser, root } = parse(`<?php
class Factory {
    public static function create(): self {
        return new self();
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].methods).toContain("create");

      tree.delete();
      parser.delete();
    });

    it("extracts nullable and optional type properties", () => {
      const { tree, parser, root } = parse(`<?php
class Config {
    public ?string $nullable;
    public static int $counter = 0;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].properties).toContain("nullable");
      expect(result.classes[0].properties).toContain("counter");

      tree.delete();
      parser.delete();
    });

    it("reports correct class line ranges", () => {
      const { tree, parser, root } = parse(`<?php
class MyClass {
    public function a(): void {}
    public function b(): void {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].lineRange[0]).toBe(2);
      expect(result.classes[0].lineRange[1]).toBe(5);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Interfaces ----

  describe("extractStructure - interfaces", () => {
    it("extracts interfaces with method signatures", () => {
      const { tree, parser, root } = parse(`<?php
interface Loggable {
    public function log(string $msg): void;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Loggable");
      expect(result.classes[0].methods).toContain("log");
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("treats interfaces as exports", () => {
      const { tree, parser, root } = parse(`<?php
interface Repository {
    public function find(int $id): mixed;
    public function save(object $entity): void;
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Repository");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports (use statements) ----

  describe("extractStructure - imports", () => {
    it("extracts simple use statements", () => {
      const { tree, parser, root } = parse(`<?php
use App\\Models\\User;
use App\\Contracts\\Repository;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("App\\Models\\User");
      expect(result.imports[0].specifiers).toEqual(["User"]);
      expect(result.imports[1].source).toBe("App\\Contracts\\Repository");
      expect(result.imports[1].specifiers).toEqual(["Repository"]);

      tree.delete();
      parser.delete();
    });

    it("extracts grouped use statements", () => {
      const { tree, parser, root } = parse(`<?php
use App\\Models\\{User, Post};
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toEqual(["User", "Post"]);

      tree.delete();
      parser.delete();
    });

    it("extracts aliased use statements", () => {
      const { tree, parser, root } = parse(`<?php
use App\\Contracts\\Repository as Repo;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("App\\Contracts\\Repository");
      expect(result.imports[0].specifiers).toEqual(["Repository"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`<?php
use App\\Models\\User;
use App\\Models\\Post;
`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].lineNumber).toBe(2);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("treats top-level functions as exports", () => {
      const { tree, parser, root } = parse(`<?php
function publicFunc(): void {}
function anotherFunc(string $x): string { return $x; }
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("publicFunc");
      expect(exportNames).toContain("anotherFunc");
      expect(result.exports).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("treats classes as exports", () => {
      const { tree, parser, root } = parse(`<?php
class MyService {}
class MyModel {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("MyService");
      expect(exportNames).toContain("MyModel");
      expect(result.exports).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("does not treat use statements as exports", () => {
      const { tree, parser, root } = parse(`<?php
use App\\Models\\User;

function myFunc(): void {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe("myFunc");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts standalone function calls", () => {
      const { tree, parser, root } = parse(`<?php
function process(string $data): string {
    $result = transform($data);
    return format_output($result);
}
`);
      const result = extractor.extractCallGraph(root);

      const callees = result.map((e) => e.callee);
      expect(result.every((e) => e.caller === "process")).toBe(true);
      expect(callees).toContain("transform");
      expect(callees).toContain("format_output");

      tree.delete();
      parser.delete();
    });

    it("extracts instance method calls ($this->method())", () => {
      const { tree, parser, root } = parse(`<?php
class Svc {
    public function getUser(int $id): User {
        return $this->fetchFromDb($id);
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result.some((e) => e.caller === "getUser" && e.callee === "$this->fetchFromDb")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts static method calls (Class::method())", () => {
      const { tree, parser, root } = parse(`<?php
class Foo {
    public function doWork(): void {
        $result = Bar::staticMethod();
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result.some((e) => e.caller === "doWork" && e.callee === "Bar::staticMethod")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller context across nested calls", () => {
      const { tree, parser, root } = parse(`<?php
class Service {
    public function start(): void {
        $this->setup();
        run_server();
    }

    private function setup(): void {
        init_config();
    }
}
`);
      const result = extractor.extractCallGraph(root);

      const startCalls = result.filter((e) => e.caller === "start");
      expect(startCalls.some((e) => e.callee === "$this->setup")).toBe(true);
      expect(startCalls.some((e) => e.callee === "run_server")).toBe(true);

      const setupCalls = result.filter((e) => e.caller === "setup");
      expect(setupCalls.some((e) => e.callee === "init_config")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("ignores top-level calls (no caller)", () => {
      const { tree, parser, root } = parse(`<?php
echo "hello";
main();
`);
      const result = extractor.extractCallGraph(root);

      // Top-level calls have no enclosing function, so they are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`<?php
function main(): void {
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
  });

  // ---- Comprehensive ----

  describe("comprehensive PHP file", () => {
    it("handles the full test fixture", () => {
      const { tree, parser, root } = parse(`<?php
namespace App\\Services;

use App\\Models\\User;
use App\\Contracts\\Repository;

class UserService {
    private string $name;
    protected int $maxRetries;

    public function __construct(string $name) {
        $this->name = $name;
    }

    public function getUser(int $id): User {
        return $this->fetchFromDb($id);
    }

    private function log(string $message): void {
        error_log($message);
    }
}

function helper(string $x): string {
    return strtoupper($x);
}
`);
      const result = extractor.extractStructure(root);

      // Functions: __construct, getUser, log (from class), helper (top-level)
      const funcNames = result.functions.map((f) => f.name);
      expect(funcNames).toContain("__construct");
      expect(funcNames).toContain("getUser");
      expect(funcNames).toContain("log");
      expect(funcNames).toContain("helper");
      expect(result.functions).toHaveLength(4);

      // Classes: UserService
      expect(result.classes).toHaveLength(1);
      const userService = result.classes[0];
      expect(userService.name).toBe("UserService");
      expect(userService.methods).toContain("__construct");
      expect(userService.methods).toContain("getUser");
      expect(userService.methods).toContain("log");
      expect(userService.properties).toContain("name");
      expect(userService.properties).toContain("maxRetries");

      // Imports: 2 use statements
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("App\\Models\\User");
      expect(result.imports[0].specifiers).toEqual(["User"]);
      expect(result.imports[1].source).toBe("App\\Contracts\\Repository");
      expect(result.imports[1].specifiers).toEqual(["Repository"]);

      // Exports: UserService (class) + helper (function)
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("helper");
      expect(result.exports).toHaveLength(2);

      // Return types
      const getUser = result.functions.find((f) => f.name === "getUser");
      expect(getUser).toBeDefined();
      expect(getUser!.returnType).toBe("User");

      const log = result.functions.find((f) => f.name === "log");
      expect(log).toBeDefined();
      expect(log!.returnType).toBe("void");

      const helper = result.functions.find((f) => f.name === "helper");
      expect(helper).toBeDefined();
      expect(helper!.returnType).toBe("string");

      // Call graph
      const calls = extractor.extractCallGraph(root);

      // getUser -> $this->fetchFromDb
      const getUserCalls = calls.filter((e) => e.caller === "getUser");
      expect(getUserCalls.some((e) => e.callee === "$this->fetchFromDb")).toBe(true);

      // log -> error_log
      const logCalls = calls.filter((e) => e.caller === "log");
      expect(logCalls.some((e) => e.callee === "error_log")).toBe(true);

      // helper -> strtoupper
      const helperCalls = calls.filter((e) => e.caller === "helper");
      expect(helperCalls.some((e) => e.callee === "strtoupper")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Block-scoped namespaces ----

  describe("extractStructure - block-scoped namespaces", () => {
    it("extracts classes and functions inside block-scoped namespaces", () => {
      const { tree, parser, root } = parse(`<?php
namespace App\\Controllers {
    class UserController {
        public function index(): void {}
    }

    function helperInNs(): string {
        return "ok";
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserController");
      expect(result.classes[0].methods).toContain("index");

      expect(result.functions.some((f) => f.name === "helperInNs")).toBe(true);
      expect(result.functions.some((f) => f.name === "index")).toBe(true);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserController");
      expect(exportNames).toContain("helperInNs");

      tree.delete();
      parser.delete();
    });

    it("extracts interfaces inside block-scoped namespaces", () => {
      const { tree, parser, root } = parse(`<?php
namespace App\\Contracts {
    interface Repository {
        public function find(int $id): mixed;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Repository");
      expect(result.classes[0].methods).toContain("find");

      tree.delete();
      parser.delete();
    });

    it("extracts use statements inside block-scoped namespaces", () => {
      const { tree, parser, root } = parse(`<?php
namespace App\\Services {
    use App\\Models\\User;

    class UserService {
        public function get(): void {}
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("App\\Models\\User");
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Nullable return types ----

  describe("nullable return types", () => {
    it("extracts nullable return type", () => {
      const { tree, parser, root } = parse(`<?php
function findUser(int $id): ?User {
    return null;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].returnType).toBe("?User");

      tree.delete();
      parser.delete();
    });
  });
});

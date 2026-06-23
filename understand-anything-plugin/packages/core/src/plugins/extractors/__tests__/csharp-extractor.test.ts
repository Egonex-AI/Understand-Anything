import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { CSharpExtractor } from "../csharp-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + C# grammar once
let Parser: any;
let Language: any;
let csharpLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
  );
  csharpLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(csharpLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("CSharpExtractor", () => {
  const extractor = new CSharpExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["csharp"]);
  });

  // ---- Methods/Constructors (mapped to functions) ----

  describe("extractStructure - functions (methods & constructors)", () => {
    it("extracts methods with params and return types", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public string GetName(int id) {
            return "";
        }
        private void Process(string data, int count) {
        }
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("GetName");
      expect(result.functions[0].params).toEqual(["id"]);
      expect(result.functions[0].returnType).toBe("string");

      expect(result.functions[1].name).toBe("Process");
      expect(result.functions[1].params).toEqual(["data", "count"]);
      expect(result.functions[1].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts constructors", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public Foo(string name, int value) {
            this.name = name;
        }
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("Foo");
      expect(result.functions[0].params).toEqual(["name", "value"]);
      expect(result.functions[0].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts methods with no params", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public void Run() {}
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("Run");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts methods with generic return types", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public List<string> GetItems() {
            return null;
        }
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("GetItems");
      expect(result.functions[0].returnType).toBe("List<string>");

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges for multi-line methods", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public int Calculate(
            int a,
            int b
        ) {
            int result = a + b;
            return result;
        }
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(3);
      expect(result.functions[0].lineRange[1]).toBe(9);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts class with methods, properties, and fields", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Server {
        private string _host;
        private int _port;
        public string Address { get; set; }
        public void Start() {}
        public void Stop() {}
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["_host", "_port", "Address"]);
      expect(result.classes[0].methods).toEqual(["Start", "Stop"]);
      expect(result.classes[0].lineRange[0]).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts empty class", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Empty {
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].properties).toEqual([]);
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("includes constructors in methods list", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public Foo() {}
        public void Run() {}
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toEqual(["Foo", "Run"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Interfaces ----

  describe("extractStructure - interfaces", () => {
    it("extracts interface with method signatures", () => {
      const { tree, parser, root } = parse(`namespace App {
    interface IRepository {
        List<User> FindAll();
        User FindById(int id);
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("IRepository");
      expect(result.classes[0].methods).toEqual(["FindAll", "FindById"]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts empty interface", () => {
      const { tree, parser, root } = parse(`namespace App {
    interface IMarker {
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("IMarker");
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports (using directives) ----

  describe("extractStructure - imports", () => {
    it("extracts simple using directives", () => {
      const { tree, parser, root } = parse(`using System;
namespace App {
    public class Foo {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("System");
      expect(result.imports[0].specifiers).toEqual(["System"]);
      expect(result.imports[0].lineNumber).toBe(1);

      tree.delete();
      parser.delete();
    });

    it("extracts qualified using directives", () => {
      const { tree, parser, root } = parse(`using System;
using System.Collections.Generic;
namespace App {
    public class Foo {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("System");
      expect(result.imports[0].specifiers).toEqual(["System"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("System.Collections.Generic");
      expect(result.imports[1].specifiers).toEqual(["Generic"]);
      expect(result.imports[1].lineNumber).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers with gaps", () => {
      const { tree, parser, root } = parse(`using System;

using System.Linq;
namespace App {
    public class Foo {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("exports public class, methods, constructor, and properties", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class UserService {
        private string _name;
        public int MaxRetries { get; set; }
        public UserService(string name) {
            _name = name;
        }
        public void Start() {}
        private void Helper() {}
    }
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService"); // class
      // Constructor is also named UserService
      const userServiceExports = result.exports.filter(
        (e) => e.name === "UserService",
      );
      expect(userServiceExports.length).toBe(2); // class + constructor
      expect(exportNames).toContain("MaxRetries"); // public property
      expect(exportNames).toContain("Start");
      expect(exportNames).not.toContain("Helper");
      expect(exportNames).not.toContain("_name"); // private field

      tree.delete();
      parser.delete();
    });

    it("does not export non-public classes", () => {
      const { tree, parser, root } = parse(`namespace App {
    class Internal {
        void Run() {}
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("exports public fields", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Config {
        public string ApiKey;
        private int _retries;
    }
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Config");
      expect(exportNames).toContain("ApiKey");
      expect(exportNames).not.toContain("_retries");

      tree.delete();
      parser.delete();
    });

    it("exports public interface", () => {
      const { tree, parser, root } = parse(`namespace App {
    public interface IRepository {
        void Save();
    }
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("IRepository");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple method calls", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public void Process(int data) {
            Transform(data);
            Format(data);
        }
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].caller).toBe("Process");
      expect(result[0].callee).toBe("Transform");
      expect(result[1].caller).toBe("Process");
      expect(result[1].callee).toBe("Format");

      tree.delete();
      parser.delete();
    });

    it("extracts qualified method calls (e.g. Console.WriteLine)", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        private void Log(string message) {
            Console.WriteLine(message);
        }
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("Log");
      expect(result[0].callee).toBe("Console.WriteLine");

      tree.delete();
      parser.delete();
    });

    it("extracts object creation expressions", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public void Create() {
            var b = new Bar();
        }
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("Create");
      expect(result[0].callee).toBe("new Bar");

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller for constructors", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public Foo() {
            Init();
        }
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("Foo");
      expect(result[0].callee).toBe("Init");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        public void Run() {
            Foo();
            Bar();
        }
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(4);
      expect(result[1].lineNumber).toBe(5);

      tree.delete();
      parser.delete();
    });

    it("ignores calls outside methods (no caller)", () => {
      const { tree, parser, root } = parse(`namespace App {
    public class Foo {
        private string _value = String.Empty;
    }
}
`);
      const result = extractor.extractCallGraph(root);

      // No enclosing method, so these are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Namespace handling ----

  describe("namespace handling", () => {
    it("extracts declarations from block-scoped namespace", () => {
      const { tree, parser, root } = parse(`namespace App.Services {
    public class Svc {
        public void Run() {}
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Svc");
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("Run");

      tree.delete();
      parser.delete();
    });

    it("extracts declarations alongside file-scoped namespace", () => {
      const { tree, parser, root } = parse(`namespace App.Services;

public class Svc {
    public void Run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Svc");
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("Run");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive C# file", () => {
    it("handles a realistic C# module", () => {
      const { tree, parser, root } = parse(`using System;
using System.Collections.Generic;

namespace App.Services
{
    public class UserService
    {
        private string _name;
        public int MaxRetries { get; set; }

        public UserService(string name)
        {
            _name = name;
        }

        public List<User> GetUsers(int limit)
        {
            return FetchFromDb(limit);
        }

        private void Log(string message)
        {
            Console.WriteLine(message);
        }
    }

    public interface IRepository
    {
        List<User> FindAll();
        User FindById(int id);
    }
}
`);
      const result = extractor.extractStructure(root);

      // Functions: UserService (constructor), GetUsers, Log
      expect(result.functions).toHaveLength(3);
      expect(result.functions.map((f) => f.name).sort()).toEqual(
        ["GetUsers", "Log", "UserService"].sort(),
      );

      // Constructor has params but no return type
      const ctor = result.functions.find((f) => f.name === "UserService");
      expect(ctor?.params).toEqual(["name"]);
      expect(ctor?.returnType).toBeUndefined();

      // GetUsers has params and generic return type
      const getUsers = result.functions.find((f) => f.name === "GetUsers");
      expect(getUsers?.params).toEqual(["limit"]);
      expect(getUsers?.returnType).toBe("List<User>");

      // Log has params and void return type
      const log = result.functions.find((f) => f.name === "Log");
      expect(log?.params).toEqual(["message"]);
      expect(log?.returnType).toBe("void");

      // Classes: UserService, IRepository
      expect(result.classes).toHaveLength(2);

      const userService = result.classes.find(
        (c) => c.name === "UserService",
      );
      expect(userService).toBeDefined();
      expect(userService!.methods.sort()).toEqual(
        ["GetUsers", "Log", "UserService"].sort(),
      );
      expect(userService!.properties.sort()).toEqual(
        ["MaxRetries", "_name"].sort(),
      );

      const repository = result.classes.find(
        (c) => c.name === "IRepository",
      );
      expect(repository).toBeDefined();
      expect(repository!.methods).toEqual(["FindAll", "FindById"]);
      expect(repository!.properties).toEqual([]);

      // Imports: 2 (System, System.Collections.Generic)
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("System");
      expect(result.imports[0].specifiers).toEqual(["System"]);
      expect(result.imports[1].source).toBe("System.Collections.Generic");
      expect(result.imports[1].specifiers).toEqual(["Generic"]);

      // Exports: UserService (class + constructor), MaxRetries, GetUsers, IRepository
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("GetUsers");
      expect(exportNames).toContain("MaxRetries");
      expect(exportNames).toContain("IRepository");
      expect(exportNames).not.toContain("Log"); // private
      expect(exportNames).not.toContain("_name"); // private field

      // Call graph
      const calls = extractor.extractCallGraph(root);

      const getUsersCalls = calls.filter((e) => e.caller === "GetUsers");
      expect(getUsersCalls.some((e) => e.callee === "FetchFromDb")).toBe(
        true,
      );

      const logCalls = calls.filter((e) => e.caller === "Log");
      expect(
        logCalls.some((e) => e.callee === "Console.WriteLine"),
      ).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

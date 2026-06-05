import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { KotlinExtractor } from "../kotlin-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let kotlinLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  kotlinLang = await Language.load(
    require.resolve(
      "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
    ),
  );
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(kotlinLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("KotlinExtractor", () => {
  const extractor = new KotlinExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["kotlin"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts methods with params and return types", () => {
      const { tree, parser, root } = parse(`class Foo {
    fun getName(id: Int): String {
        return ""
    }
    private fun process(data: String, count: Int) {
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("getName");
      expect(result.functions[0].params).toEqual(["id"]);
      expect(result.functions[0].returnType).toBe("String");
      expect(result.functions[1].name).toBe("process");
      expect(result.functions[1].params).toEqual(["data", "count"]);
      expect(result.functions[1].returnType).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("extracts top-level functions", () => {
      const { tree, parser, root } = parse(`fun greet(name: String): String = name
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("String");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parse(`class Server {
    val host: String = ""
    var port: Int = 0
    fun start() {}
    fun stop() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
      expect(result.classes[0].methods).toEqual(["start", "stop"]);

      tree.delete();
      parser.delete();
    });

    it("extracts data class primary constructor properties", () => {
      const { tree, parser, root } = parse(
        `data class User(val name: String, val age: Int)`,
      );
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].properties).toEqual(["name", "age"]);
      expect(result.classes[0].typedProperties).toEqual([
        { name: "name", type: "String" },
        { name: "age", type: "Int" },
      ]);

      tree.delete();
      parser.delete();
    });

    it("extracts object declarations as classes", () => {
      const { tree, parser, root } = parse(`object Singleton {
    fun get(): Singleton = this
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Singleton");
      expect(result.classes[0].methods).toEqual(["get"]);

      tree.delete();
      parser.delete();
    });

    it("extracts interface method signatures", () => {
      const { tree, parser, root } = parse(`interface Repo {
    fun findAll(): List<User>
    fun findById(id: Int): User
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Repo");
      expect(result.classes[0].methods).toEqual(["findAll", "findById"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts regular imports", () => {
      const { tree, parser, root } = parse(`import com.example.OrderService
import com.example.util.Helper
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("com.example.OrderService");
      expect(result.imports[0].specifiers).toEqual(["OrderService"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("com.example.util.Helper");
      expect(result.imports[1].specifiers).toEqual(["Helper"]);

      tree.delete();
      parser.delete();
    });

    it("extracts wildcard imports", () => {
      const { tree, parser, root } = parse(`import com.example.util.*
class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("com.example.util");
      expect(result.imports[0].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports public-by-default and internal declarations", () => {
      const { tree, parser, root } = parse(`class UserService {
    fun start() {}
    private fun helper() {}
}
internal class InternalSvc {
    internal fun run() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("start");
      expect(exportNames).toContain("InternalSvc");
      expect(exportNames).toContain("run");
      expect(exportNames).not.toContain("helper");

      tree.delete();
      parser.delete();
    });

    it("does not export private classes or members", () => {
      const { tree, parser, root } = parse(`private class Internal {
    private fun helper() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - annotations", () => {
    it("extracts marker annotations on classes", () => {
      const { tree, parser, root } = parse(`@RestController
class OrderController {
    fun list() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toEqual([{ name: "RestController" }]);

      tree.delete();
      parser.delete();
    });

    it("extracts annotations with arguments on methods", () => {
      const { tree, parser, root } = parse(`class Consumer {
    @KafkaListener(topics = "order-events")
    fun onMessage(msg: String) {}
}
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find((f) => f.name === "onMessage");
      expect(fn).toBeDefined();
      expect(fn!.annotations).toHaveLength(1);
      expect(fn!.annotations![0].name).toBe("KafkaListener");
      expect(fn!.annotations![0].arguments?.topics).toBe("order-events");

      tree.delete();
      parser.delete();
    });

    it("omits annotations field when class has none", () => {
      const { tree, parser, root } = parse(`class Plain {
    fun run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - inheritance", () => {
    it("extracts superclass and interfaces from delegation specifiers", () => {
      const { tree, parser, root } = parse(`@RestController
class OrderController : BaseController(), OrderService {
    fun list(): List<Order> = emptyList()
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("BaseController");
      expect(result.classes[0].interfaces).toEqual(["OrderService"]);

      tree.delete();
      parser.delete();
    });

    it("omits superclass/interfaces when absent", () => {
      const { tree, parser, root } = parse(`class Simple {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBeUndefined();
      expect(result.classes[0].interfaces).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - typedProperties", () => {
    it("extracts property types and annotations", () => {
      const { tree, parser, root } = parse(`class Svc {
    @Autowired
    lateinit var client: PaymentClient
    val name: String = ""
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(2);

      const client = result.classes[0].typedProperties!.find(
        (p) => p.name === "client",
      );
      expect(client).toBeDefined();
      expect(client!.type).toBe("PaymentClient");
      expect(client!.annotations).toEqual([{ name: "Autowired" }]);

      const name = result.classes[0].typedProperties!.find(
        (p) => p.name === "name",
      );
      expect(name).toBeDefined();
      expect(name!.type).toBe("String");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts simple and qualified method calls", () => {
      const { tree, parser, root } = parse(`class Svc {
    fun process() {
        validate()
        repo.save()
    }
    fun validate() {}
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].caller).toBe("process");
      expect(result[0].callee).toBe("validate");
      expect(result[1].caller).toBe("process");
      expect(result[1].callee).toBe("repo.save");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`class Foo {
    fun run() {
        foo()
        bar()
    }
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
});

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { JavaExtractor } from "../java-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + Java grammar once
let Parser: any;
let Language: any;
let javaLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-java/tree-sitter-java.wasm",
  );
  javaLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(javaLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("JavaExtractor", () => {
  const extractor = new JavaExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["java"]);
  });

  // ---- Methods/Constructors (mapped to functions) ----

  describe("extractStructure - functions (methods & constructors)", () => {
    it("extracts methods with params and return types", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public String getName(int id) {
        return "";
    }
    private void process(String data, int count) {
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
      expect(result.functions[1].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts constructors", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public Foo(String name, int value) {
        this.name = name;
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
      const { tree, parser, root } = parse(`public class Foo {
    public void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("run");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBe("void");

      tree.delete();
      parser.delete();
    });

    it("extracts methods with generic return types", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public List<String> getItems() {
        return null;
    }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("getItems");
      expect(result.functions[0].returnType).toBe("List<String>");

      tree.delete();
      parser.delete();
    });

    it("reports correct line ranges for multi-line methods", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public int calculate(
        int a,
        int b
    ) {
        int result = a + b;
        return result;
    }
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
    it("extracts class with methods and fields", () => {
      const { tree, parser, root } = parse(`public class Server {
    private String host;
    private int port;
    public void start() {}
    public void stop() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Server");
      expect(result.classes[0].properties).toEqual(["host", "port"]);
      expect(result.classes[0].methods).toEqual(["start", "stop"]);
      expect(result.classes[0].lineRange[0]).toBe(1);

      tree.delete();
      parser.delete();
    });

    it("extracts empty class", () => {
      const { tree, parser, root } = parse(`public class Empty {
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
      const { tree, parser, root } = parse(`public class Foo {
    public Foo() {}
    public void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toEqual(["Foo", "run"]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Interfaces ----

  describe("extractStructure - interfaces", () => {
    it("extracts interface with method signatures", () => {
      const { tree, parser, root } = parse(`interface Repository {
    List<User> findAll();
    User findById(int id);
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Repository");
      expect(result.classes[0].methods).toEqual(["findAll", "findById"]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts empty interface", () => {
      const { tree, parser, root } = parse(`interface Marker {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Marker");
      expect(result.classes[0].methods).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts regular imports", () => {
      const { tree, parser, root } = parse(`import java.util.List;
import java.util.Map;
public class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("java.util.List");
      expect(result.imports[0].specifiers).toEqual(["List"]);
      expect(result.imports[0].lineNumber).toBe(1);
      expect(result.imports[1].source).toBe("java.util.Map");
      expect(result.imports[1].specifiers).toEqual(["Map"]);
      expect(result.imports[1].lineNumber).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts wildcard imports", () => {
      const { tree, parser, root } = parse(`import java.util.*;
public class Foo {}
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("java.util");
      expect(result.imports[0].specifiers).toEqual(["*"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`import java.util.List;

import java.util.Map;
public class Foo {}
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
    it("exports public class, methods, and constructor", () => {
      const { tree, parser, root } = parse(`public class UserService {
    private String name;
    public UserService(String name) {
        this.name = name;
    }
    public void start() {}
    private void helper() {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService"); // class
      // The constructor is also named UserService, check it's listed
      const userServiceExports = result.exports.filter(
        (e) => e.name === "UserService",
      );
      expect(userServiceExports.length).toBe(2); // class + constructor
      expect(exportNames).toContain("start");
      expect(exportNames).not.toContain("helper");
      expect(exportNames).not.toContain("name"); // private field

      tree.delete();
      parser.delete();
    });

    it("does not export non-public classes", () => {
      const { tree, parser, root } = parse(`class Internal {
    void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("exports public fields", () => {
      const { tree, parser, root } = parse(`public class Config {
    public String apiKey;
    private int retries;
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Config");
      expect(exportNames).toContain("apiKey");
      expect(exportNames).not.toContain("retries");

      tree.delete();
      parser.delete();
    });

    it("exports public interface", () => {
      const { tree, parser, root } = parse(`public interface Repository {
    void save();
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Repository");

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts simple method calls", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public void process(int data) {
        transform(data);
        format(data);
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].caller).toBe("process");
      expect(result[0].callee).toBe("transform");
      expect(result[1].caller).toBe("process");
      expect(result[1].callee).toBe("format");

      tree.delete();
      parser.delete();
    });

    it("extracts qualified method calls (e.g. System.out.println)", () => {
      const { tree, parser, root } = parse(`public class Foo {
    private void log(String message) {
        System.out.println(message);
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("log");
      expect(result[0].callee).toBe("System.out.println");

      tree.delete();
      parser.delete();
    });

    it("extracts object creation expressions", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public void create() {
        Bar b = new Bar();
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("create");
      expect(result[0].callee).toBe("new Bar");

      tree.delete();
      parser.delete();
    });

    it("tracks correct caller for constructors", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public Foo() {
        init();
    }
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(1);
      expect(result[0].caller).toBe("Foo");
      expect(result[0].callee).toBe("init");

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`public class Foo {
    public void run() {
        foo();
        bar();
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

    it("ignores calls outside methods (no caller)", () => {
      // Java doesn't really allow top-level calls, but field initializers
      // can have method calls. We skip those without a method context.
      const { tree, parser, root } = parse(`public class Foo {
    private String value = String.valueOf(42);
}
`);
      const result = extractor.extractCallGraph(root);

      // No enclosing method, so these are skipped
      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Annotations ----

  describe("extractStructure - annotations", () => {
    it("extracts marker annotations on classes", () => {
      const { tree, parser, root } = parse(`@MoaProvider
public class OrderServiceImpl {
    public void createOrder() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].annotations).toEqual([{ name: "MoaProvider" }]);

      tree.delete();
      parser.delete();
    });

    it("extracts annotations with arguments on classes", () => {
      const { tree, parser, root } = parse(`@FeignClient(name = "payment-service", url = "http://localhost:8080")
public class PaymentClient {
    public void pay() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].annotations).toHaveLength(1);
      expect(result.classes[0].annotations![0].name).toBe("FeignClient");
      expect(result.classes[0].annotations![0].arguments).toEqual({
        name: "payment-service",
        url: "http://localhost:8080",
      });

      tree.delete();
      parser.delete();
    });

    it("extracts multiple annotations on a class", () => {
      const { tree, parser, root } = parse(`@RestController
@RequestMapping("/api/orders")
public class OrderController {
    public void list() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toHaveLength(2);
      expect(result.classes[0].annotations![0].name).toBe("RestController");
      expect(result.classes[0].annotations![1].name).toBe("RequestMapping");

      tree.delete();
      parser.delete();
    });

    it("extracts annotations on methods", () => {
      const { tree, parser, root } = parse(`public class Consumer {
    @KafkaListener(topics = "order-events")
    public void onMessage(String msg) {}
}
`);
      const result = extractor.extractStructure(root);

      const fn = result.functions.find(f => f.name === "onMessage");
      expect(fn).toBeDefined();
      expect(fn!.annotations).toHaveLength(1);
      expect(fn!.annotations![0].name).toBe("KafkaListener");
      expect(fn!.annotations![0].arguments?.topics).toBe("order-events");

      tree.delete();
      parser.delete();
    });

    it("omits annotations field when class has none", () => {
      const { tree, parser, root } = parse(`public class Plain {
    public void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].annotations).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  // ---- Inheritance ----

  describe("extractStructure - inheritance", () => {
    it("extracts superclass from extends", () => {
      const { tree, parser, root } = parse(`public class Dog extends Animal {
    public void bark() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("Animal");

      tree.delete();
      parser.delete();
    });

    it("extracts implemented interfaces", () => {
      const { tree, parser, root } = parse(`public class OrderServiceImpl implements OrderService, Serializable {
    public void createOrder() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].interfaces).toEqual(["OrderService", "Serializable"]);

      tree.delete();
      parser.delete();
    });

    it("extracts both extends and implements", () => {
      const { tree, parser, root } = parse(`public class SpecialService extends BaseService implements ServiceInterface {
    public void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBe("BaseService");
      expect(result.classes[0].interfaces).toEqual(["ServiceInterface"]);

      tree.delete();
      parser.delete();
    });

    it("extracts interface extends", () => {
      const { tree, parser, root } = parse(`public interface ExtendedRepo extends BaseRepo {
    void customQuery();
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].interfaces).toEqual(["BaseRepo"]);
      expect(result.classes[0].superclass).toBeUndefined();

      tree.delete();
      parser.delete();
    });

    it("omits superclass/interfaces when absent", () => {
      const { tree, parser, root } = parse(`public class Simple {
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].superclass).toBeUndefined();
      expect(result.classes[0].interfaces).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  // ---- Typed Properties ----

  describe("extractStructure - typedProperties", () => {
    it("extracts field types", () => {
      const { tree, parser, root } = parse(`public class Service {
    private String name;
    private int count;
    private List<Order> orders;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(3);
      expect(result.classes[0].typedProperties![0]).toEqual({ name: "name", type: "String" });
      expect(result.classes[0].typedProperties![1]).toEqual({ name: "count", type: "int" });
      expect(result.classes[0].typedProperties![2]).toEqual({ name: "orders", type: "List<Order>" });

      tree.delete();
      parser.delete();
    });

    it("extracts field annotations (MoaConsumer/DubboReference)", () => {
      const { tree, parser, root } = parse(`public class OrderService {
    @MoaConsumer
    private PaymentFacade paymentFacade;

    @Resource
    private UserMapper userMapper;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toHaveLength(2);

      const payment = result.classes[0].typedProperties!.find(p => p.name === "paymentFacade");
      expect(payment).toBeDefined();
      expect(payment!.type).toBe("PaymentFacade");
      expect(payment!.annotations).toEqual([{ name: "MoaConsumer" }]);

      const userMapper = result.classes[0].typedProperties!.find(p => p.name === "userMapper");
      expect(userMapper).toBeDefined();
      expect(userMapper!.annotations).toEqual([{ name: "Resource" }]);

      tree.delete();
      parser.delete();
    });

    it("omits typedProperties when class has no fields", () => {
      const { tree, parser, root } = parse(`public class Empty {
    public void run() {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].typedProperties).toBeUndefined();

      tree.delete();
      parser.delete();
    });
  });

  // ---- RPC-style comprehensive test ----

  describe("RPC annotation comprehensive test", () => {
    it("extracts complete RPC provider/consumer structure", () => {
      const { tree, parser, root } = parse(`import com.example.api.OrderService;
import com.example.api.PaymentFacade;

@MoaProvider
public class OrderServiceImpl implements OrderService {
    @MoaConsumer
    private PaymentFacade paymentFacade;

    @Override
    public void createOrder(String orderId) {
        paymentFacade.charge(orderId);
    }
}
`);
      const result = extractor.extractStructure(root);

      const cls = result.classes[0];
      expect(cls.name).toBe("OrderServiceImpl");
      expect(cls.annotations).toEqual([{ name: "MoaProvider" }]);
      expect(cls.interfaces).toEqual(["OrderService"]);

      const paymentField = cls.typedProperties!.find(p => p.name === "paymentFacade");
      expect(paymentField!.type).toBe("PaymentFacade");
      expect(paymentField!.annotations).toEqual([{ name: "MoaConsumer" }]);

      const createOrder = result.functions.find(f => f.name === "createOrder");
      expect(createOrder!.annotations).toEqual([{ name: "Override" }]);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive Java file", () => {
    it("handles a realistic Java module", () => {
      const { tree, parser, root } = parse(`import java.util.List;
import java.util.Map;

public class UserService {
    private String name;
    private int maxRetries;

    public UserService(String name) {
        this.name = name;
    }

    public List<User> getUsers(int limit) {
        return fetchFromDb(limit);
    }

    private void log(String message) {
        System.out.println(message);
    }
}

interface Repository {
    List<User> findAll();
    User findById(int id);
}
`);
      const result = extractor.extractStructure(root);

      // Functions: UserService (constructor), getUsers, log
      expect(result.functions).toHaveLength(3);
      expect(result.functions.map((f) => f.name).sort()).toEqual(
        ["UserService", "getUsers", "log"].sort(),
      );

      // Constructor has params but no return type
      const ctor = result.functions.find((f) => f.name === "UserService");
      expect(ctor?.params).toEqual(["name"]);
      expect(ctor?.returnType).toBeUndefined();

      // getUsers has params and generic return type
      const getUsers = result.functions.find((f) => f.name === "getUsers");
      expect(getUsers?.params).toEqual(["limit"]);
      expect(getUsers?.returnType).toBe("List<User>");

      // log has params and void return type
      const log = result.functions.find((f) => f.name === "log");
      expect(log?.params).toEqual(["message"]);
      expect(log?.returnType).toBe("void");

      // Classes: UserService, Repository
      expect(result.classes).toHaveLength(2);

      const userService = result.classes.find(
        (c) => c.name === "UserService",
      );
      expect(userService).toBeDefined();
      expect(userService!.methods.sort()).toEqual(
        ["UserService", "getUsers", "log"].sort(),
      );
      expect(userService!.properties.sort()).toEqual(
        ["name", "maxRetries"].sort(),
      );

      const repository = result.classes.find(
        (c) => c.name === "Repository",
      );
      expect(repository).toBeDefined();
      expect(repository!.methods).toEqual(["findAll", "findById"]);
      expect(repository!.properties).toEqual([]);

      // Imports: 2 (java.util.List, java.util.Map)
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("java.util.List");
      expect(result.imports[0].specifiers).toEqual(["List"]);
      expect(result.imports[1].source).toBe("java.util.Map");
      expect(result.imports[1].specifiers).toEqual(["Map"]);

      // Exports: UserService (class), UserService (constructor), getUsers (public method)
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("UserService");
      expect(exportNames).toContain("getUsers");
      expect(exportNames).not.toContain("log"); // private
      expect(exportNames).not.toContain("name"); // private field
      expect(exportNames).not.toContain("maxRetries"); // private field

      // Call graph
      const calls = extractor.extractCallGraph(root);

      const getUsersCalls = calls.filter((e) => e.caller === "getUsers");
      expect(getUsersCalls.some((e) => e.callee === "fetchFromDb")).toBe(
        true,
      );

      const logCalls = calls.filter((e) => e.caller === "log");
      expect(
        logCalls.some((e) => e.callee === "System.out.println"),
      ).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

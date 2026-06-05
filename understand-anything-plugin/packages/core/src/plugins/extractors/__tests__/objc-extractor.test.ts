import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { ObjcExtractor } from "../objc-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let objcLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-objc/tree-sitter-objc.wasm",
  );
  objcLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(objcLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("ObjcExtractor", () => {
  const extractor = new ObjcExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["objc"]);
  });

  describe("extractStructure - @interface", () => {
    it("extracts class with superclass and protocols", () => {
      const { tree, parser, root } = parse(`@interface Dog : Animal <Runnable, Serializable>
- (void)bark;
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Dog");
      expect(result.classes[0].superclass).toBe("Animal");
      expect(result.classes[0].interfaces).toEqual(["Runnable", "Serializable"]);
      expect(result.classes[0].methods).toEqual(["bark"]);

      tree.delete();
      parser.delete();
    });

    it("extracts category interface as ClassName(CategoryName)", () => {
      const { tree, parser, root } = parse(`@interface NSString (MyCategory)
- (NSString *)myMethod;
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("NSString(MyCategory)");
      expect(result.classes[0].methods).toEqual(["myMethod"]);

      tree.delete();
      parser.delete();
    });

    it("extracts methods with multi-part selectors", () => {
      const { tree, parser, root } = parse(`@interface Calc : NSObject
- (NSInteger)add:(NSInteger)a to:(NSInteger)b;
+ (Calc *)sharedInstance;
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].methods).toEqual(["add:to:", "sharedInstance"]);
      expect(result.functions).toHaveLength(2);

      const add = result.functions.find((f) => f.name === "add:to:");
      expect(add).toBeDefined();
      expect(add!.params).toEqual(["a", "b"]);
      expect(add!.returnType).toBe("NSInteger");

      const shared = result.functions.find((f) => f.name === "sharedInstance");
      expect(shared).toBeDefined();
      expect(shared!.params).toEqual([]);
      expect(shared!.returnType).toContain("Calc");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - @property", () => {
    it("extracts typed properties with attributes", () => {
      const { tree, parser, root } = parse(`@interface User : NSObject
@property (nonatomic, strong) NSString *name;
@property (nonatomic, assign) NSInteger age;
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes[0].properties).toEqual(["name", "age"]);
      expect(result.classes[0].typedProperties).toHaveLength(2);

      const nameProp = result.classes[0].typedProperties!.find((p) => p.name === "name");
      expect(nameProp).toEqual({
        name: "name",
        type: "NSString *",
        annotations: [{ name: "nonatomic" }, { name: "strong" }],
      });

      const ageProp = result.classes[0].typedProperties!.find((p) => p.name === "age");
      expect(ageProp).toEqual({
        name: "age",
        type: "NSInteger",
        annotations: [{ name: "nonatomic" }, { name: "assign" }],
      });

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - @protocol", () => {
    it("maps protocol to classes array like an interface", () => {
      const { tree, parser, root } = parse(`@protocol Drawable
- (void)draw;
- (void)resize:(CGSize)size;
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Drawable");
      expect(result.classes[0].methods).toEqual(["draw", "resize:"]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - @implementation", () => {
    it("extracts method definitions from implementation", () => {
      const { tree, parser, root } = parse(`@implementation Dog
- (void)bark {
  NSLog(@"Woof");
}
+ (Dog *)create {
  return nil;
}
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Dog");
      expect(result.classes[0].methods).toEqual(["bark", "create"]);

      expect(result.functions).toHaveLength(2);
      expect(result.functions.map((f) => f.name)).toEqual(["bark", "create"]);

      tree.delete();
      parser.delete();
    });

    it("merges interface and implementation for the same class", () => {
      const { tree, parser, root } = parse(`@interface Dog : Animal
- (void)bark;
@end

@implementation Dog
- (void)bark {
  NSLog(@"Woof");
}
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Dog");
      expect(result.classes[0].superclass).toBe("Animal");
      expect(result.classes[0].methods).toEqual(["bark"]);

      // Both declaration and definition produce function entries
      expect(result.functions.filter((f) => f.name === "bark")).toHaveLength(2);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts system and local #import directives", () => {
      const { tree, parser, root } = parse(`#import <Foundation/Foundation.h>
#import "MyClass.h"
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("Foundation/Foundation.h");
      expect(result.imports[0].specifiers).toEqual(["Foundation/Foundation.h"]);
      expect(result.imports[0].lineNumber).toBe(1);

      expect(result.imports[1].source).toBe("MyClass.h");
      expect(result.imports[1].specifiers).toEqual(["MyClass.h"]);
      expect(result.imports[1].lineNumber).toBe(2);

      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports interface declarations as public API", () => {
      const { tree, parser, root } = parse(`@interface User : NSObject
@property (nonatomic, strong) NSString *name;
- (void)login;
@end
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("User");
      expect(exportNames).toContain("name");
      expect(exportNames).toContain("login");

      tree.delete();
      parser.delete();
    });

    it("exports protocol name and methods", () => {
      const { tree, parser, root } = parse(`@protocol Service
- (void)start;
@end
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Service");
      expect(exportNames).toContain("start");

      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts message sends with receiver-qualified callees", () => {
      const { tree, parser, root } = parse(`@implementation Svc
- (void)process {
  [self validate];
  [repo save];
  [obj insertObject:item atIndex:idx];
}
- (void)validate {}
@end
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        caller: "process",
        callee: "self.validate",
        lineNumber: 3,
      });
      expect(result[1]).toEqual({
        caller: "process",
        callee: "repo.save",
        lineNumber: 4,
      });
      expect(result[2]).toEqual({
        caller: "process",
        callee: "obj.insertObject:atIndex:",
        lineNumber: 5,
      });

      tree.delete();
      parser.delete();
    });

    it("ignores message sends outside method definitions", () => {
      const { tree, parser, root } = parse(`void helper() {
  [obj doSomething];
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });
  });

  describe("comprehensive Objective-C file", () => {
    it("handles a realistic header and implementation module", () => {
      const { tree, parser, root } = parse(`#import <Foundation/Foundation.h>
#import "Animal.h"

@protocol Runnable
- (void)run;
@end

@interface Dog : Animal <Runnable>
@property (nonatomic, strong) NSString *name;
- (void)bark;
- (NSInteger)add:(NSInteger)a to:(NSInteger)b;
@end

@implementation Dog
- (void)bark {
  [self notify];
  NSLog(@"Woof");
}
- (NSInteger)add:(NSInteger)a to:(NSInteger)b {
  return a + b;
}
@end
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(2);
      expect(result.classes.map((c) => c.name).sort()).toEqual(
        ["Dog", "Runnable"].sort(),
      );

      const dog = result.classes.find((c) => c.name === "Dog");
      expect(dog!.superclass).toBe("Animal");
      expect(dog!.interfaces).toEqual(["Runnable"]);
      expect(dog!.properties).toEqual(["name"]);
      expect(dog!.methods).toEqual(["bark", "add:to:"]);

      const runnable = result.classes.find((c) => c.name === "Runnable");
      expect(runnable!.methods).toEqual(["run"]);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Dog");
      expect(exportNames).toContain("Runnable");
      expect(exportNames).toContain("bark");
      expect(exportNames).toContain("name");

      const calls = extractor.extractCallGraph(root);
      const barkCalls = calls.filter((e) => e.caller === "bark");
      expect(barkCalls.some((e) => e.callee === "self.notify")).toBe(true);

      tree.delete();
      parser.delete();
    });
  });
});

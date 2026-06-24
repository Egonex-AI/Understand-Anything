import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { ObjectiveCExtractor } from "../objectivec-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let objcLang: any;

beforeAll(async () => {
  const wts = await import("web-tree-sitter");
  Parser = wts.Parser;
  Language = wts.Language;
  await Parser.init();
  const wasmPath = require.resolve("tree-sitter-objc/tree-sitter-objc.wasm");
  objcLang = await Language.load(wasmPath);
});

function parse(source: string) {
  const parser = new Parser();
  parser.setLanguage(objcLang);
  const tree = parser.parse(source);
  return { root: tree.rootNode, tree, parser };
}

describe("ObjectiveCExtractor", () => {
  const extractor = new ObjectiveCExtractor();

  describe("languageIds", () => {
    it("claims the objectivec language", () => {
      expect(extractor.languageIds).toContain("objectivec");
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts #import <System/Header.h>", () => {
      const { root, tree, parser } = parse(`#import <Foundation/Foundation.h>`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("Foundation/Foundation.h");
      tree.delete();
      parser.delete();
    });

    it("extracts #import \"LocalHeader.h\"", () => {
      const { root, tree, parser } = parse(`#import "MyClass.h"`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("MyClass.h");
      tree.delete();
      parser.delete();
    });

    it("extracts @import ModuleName;", () => {
      const { root, tree, parser } = parse(`@import UIKit;`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("UIKit");
      tree.delete();
      parser.delete();
    });

    it("treats #include the same as #import", () => {
      const { root, tree, parser } = parse(`#include "stdio.h"`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("stdio.h");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts @interface declarations with methods", () => {
      const { root, tree, parser } = parse(`
@interface MyClass : NSObject
- (void)doStuff;
- (NSString *)name;
@end`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("MyClass");
      expect(result.classes[0].methods).toEqual(["doStuff", "name"]);
      tree.delete();
      parser.delete();
    });

    it("extracts @property declarations", () => {
      const { root, tree, parser } = parse(`
@interface MyClass : NSObject
@property (nonatomic, strong) NSString *name;
@property (nonatomic) NSInteger count;
@end`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].properties).toContain("name");
      expect(result.classes[0].properties).toContain("count");
      tree.delete();
      parser.delete();
    });

    it("merges @implementation methods into the matching @interface entry", () => {
      const { root, tree, parser } = parse(`
@interface MyClass : NSObject
- (void)declared;
@end

@implementation MyClass
- (void)declared { }
- (void)addedInImpl { }
@end`);
      const result = extractor.extractStructure(root);
      // Single class entry, both methods present
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].methods).toContain("declared");
      expect(result.classes[0].methods).toContain("addedInImpl");
      tree.delete();
      parser.delete();
    });

    it("attaches category methods to the base class entry", () => {
      const { root, tree, parser } = parse(`
@interface NSString (Reversal)
- (NSString *)reversed;
@end`);
      const result = extractor.extractStructure(root);
      const nsString = result.classes.find((c) => c.name === "NSString");
      expect(nsString).toBeDefined();
      expect(nsString?.methods).toContain("reversed");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - protocols", () => {
    it("treats @protocol like a class entry", () => {
      const { root, tree, parser } = parse(`
@protocol MyDelegate <NSObject>
- (void)didUpdate;
- (BOOL)shouldProceed;
@end`);
      const result = extractor.extractStructure(root);
      const proto = result.classes.find((c) => c.name === "MyDelegate");
      expect(proto).toBeDefined();
      expect(proto?.methods).toEqual(["didUpdate", "shouldProceed"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - C functions", () => {
    it("extracts top-level C function definitions", () => {
      const { root, tree, parser } = parse(`
int helperAdd(int a, int b) {
  return a + b;
}

void doNothing(void) { }`);
      const result = extractor.extractStructure(root);
      const names = result.functions.map((f) => f.name).sort();
      expect(names).toEqual(["doNothing", "helperAdd"]);
      tree.delete();
      parser.delete();
    });

    it("captures parameter names", () => {
      const { root, tree, parser } = parse(`
int compute(int x, int y) { return x * y; }`);
      const result = extractor.extractStructure(root);
      expect(result.functions[0].params).toEqual(["x", "y"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - exports", () => {
    it("exports @interface, @protocol and top-level C functions", () => {
      const { root, tree, parser } = parse(`
@interface MyClass : NSObject @end
@protocol MyProto @end
int someFn(void) { return 0; }`);
      const result = extractor.extractStructure(root);
      const exportNames = result.exports.map((e) => e.name).sort();
      expect(exportNames).toEqual(["MyClass", "MyProto", "someFn"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("attributes C function calls to the enclosing function", () => {
      const { root, tree, parser } = parse(`
int helper(void) { return 1; }
int caller(void) { return helper(); }`);
      const calls = extractor.extractCallGraph(root);
      const callerCall = calls.find((c) => c.caller === "caller");
      expect(callerCall?.callee).toBe("helper");
      tree.delete();
      parser.delete();
    });

    it("attributes Obj-C message sends to the enclosing method", () => {
      const { root, tree, parser } = parse(`
@implementation X
- (void)go {
  [self helper];
  [array addObject:item];
}
@end`);
      const calls = extractor.extractCallGraph(root);
      const callees = calls.filter((c) => c.caller === "go").map((c) => c.callee);
      expect(callees).toContain("helper");
      expect(callees).toContain("addObject");
      tree.delete();
      parser.delete();
    });

    it("resolves chained message sends to the outer selector", () => {
      const { root, tree, parser } = parse(`
@implementation X
- (void)go {
  [[self window] makeKeyAndOrderFront:self];
}
@end`);
      const calls = extractor.extractCallGraph(root);
      // We expect both the inner [self window] call and the outer
      // [...makeKeyAndOrderFront:] call to be tracked.
      const callees = calls.filter((c) => c.caller === "go").map((c) => c.callee);
      expect(callees).toContain("makeKeyAndOrderFront");
      expect(callees).toContain("window");
      tree.delete();
      parser.delete();
    });
  });

  describe("comprehensive Obj-C file", () => {
    it("extracts a realistic mix of constructs", () => {
      const { root, tree, parser } = parse(`
#import <Foundation/Foundation.h>
#import "MyDelegate.h"
@import UIKit;

@interface Calculator : NSObject <MyDelegate>
@property (nonatomic, assign) NSInteger total;
- (void)addValue:(NSInteger)value;
- (NSInteger)result;
@end

@implementation Calculator
- (void)addValue:(NSInteger)value {
  self.total += value;
}
- (NSInteger)result {
  return self.total;
}
- (void)logResult {
  NSLog(@"%ld", (long)[self result]);
}
@end

int main(int argc, char *argv[]) {
  Calculator *c = [[Calculator alloc] init];
  [c addValue:5];
  return 0;
}`);
      const result = extractor.extractStructure(root);

      // Imports
      expect(result.imports).toHaveLength(3);
      expect(result.imports.map((i) => i.source).sort()).toEqual([
        "Foundation/Foundation.h",
        "MyDelegate.h",
        "UIKit",
      ]);

      // Single Calculator class, methods from both interface and impl
      const calc = result.classes.find((c) => c.name === "Calculator");
      expect(calc).toBeDefined();
      expect(calc?.methods).toContain("addValue");
      expect(calc?.methods).toContain("result");
      expect(calc?.methods).toContain("logResult");
      expect(calc?.properties).toContain("total");

      // C function
      expect(result.functions.find((f) => f.name === "main")).toBeDefined();

      // Exports include Calculator and main
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("Calculator");
      expect(exportNames).toContain("main");

      // Call graph: main calls alloc + init + addValue
      const calls = extractor.extractCallGraph(root);
      const fromMain = calls.filter((c) => c.caller === "main").map((c) => c.callee);
      expect(fromMain).toContain("addValue");

      tree.delete();
      parser.delete();
    });
  });
});

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
  return { tree, parser, root: tree.rootNode };
}

function withAnalysis<T>(
  code: string,
  fn: (result: ReturnType<ObjcExtractor["extractStructure"]>) => T,
): T {
  const { tree, parser, root } = parse(code);
  try {
    return fn(extractor.extractStructure(root));
  } finally {
    tree.delete();
    parser.delete();
  }
}

function withCalls<T>(
  code: string,
  fn: (result: ReturnType<ObjcExtractor["extractCallGraph"]>) => T,
): T {
  const { tree, parser, root } = parse(code);
  try {
    return fn(extractor.extractCallGraph(root));
  } finally {
    tree.delete();
    parser.delete();
  }
}

const extractor = new ObjcExtractor();

describe("ObjcExtractor", () => {
  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["objective-c"]);
  });

  // ---------------------------------------------------------------------------
  // Imports
  // ---------------------------------------------------------------------------

  describe("extractStructure - imports", () => {
    it("extracts system framework imports (#import <...>)", () => {
      withAnalysis(
        `
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
`,
        (result) => {
          expect(result.imports).toHaveLength(2);
          expect(result.imports[0].source).toBe("<Foundation/Foundation.h>");
          expect(result.imports[0].lineNumber).toBeGreaterThan(0);
          expect(result.imports[1].source).toBe("<UIKit/UIKit.h>");
        },
      );
    });

    it("extracts local header imports (#import \"...\")", () => {
      withAnalysis(
        `
#import "DataService.h"
#import "UserModel.h"
`,
        (result) => {
          expect(result.imports).toHaveLength(2);
          expect(result.imports[0].source).toBe("DataService.h");
          expect(result.imports[1].source).toBe("UserModel.h");
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // @interface — class declarations
  // ---------------------------------------------------------------------------

  describe("extractStructure - @interface (class declarations)", () => {
    it("extracts class name from @interface", () => {
      withAnalysis(
        `
@interface SomeManager : NSObject
@end
`,
        (result) => {
          expect(result.classes).toHaveLength(1);
          expect(result.classes[0].name).toBe("SomeManager");
          expect(result.classes[0].lineRange[0]).toBeGreaterThan(0);
        },
      );
    });

    it("extracts @property names from @interface", () => {
      withAnalysis(
        `
@interface SomeManager : NSObject
@property (nonatomic, strong) NSString *name;
@property (nonatomic, assign) BOOL isLoaded;
@end
`,
        (result) => {
          expect(result.classes).toHaveLength(1);
          const cls = result.classes[0];
          expect(cls.properties).toContain("name");
          expect(cls.properties).toContain("isLoaded");
        },
      );
    });

    it("extracts instance method declarations from @interface", () => {
      withAnalysis(
        `
@interface SomeManager : NSObject
- (void)loadData;
- (NSArray *)processItems:(NSArray *)rawItems;
@end
`,
        (result) => {
          expect(result.classes).toHaveLength(1);
          const cls = result.classes[0];
          expect(cls.methods).toContain("loadData");
          expect(cls.methods).toContain("processItems:");
        },
      );
    });

    it("extracts class method declarations from @interface", () => {
      withAnalysis(
        `
@interface SomeManager : NSObject
+ (SomeManager *)sharedInstance;
+ (instancetype)new;
@end
`,
        (result) => {
          const cls = result.classes[0];
          expect(cls.methods).toContain("sharedInstance");
          expect(cls.methods).toContain("new");
        },
      );
    });

    it("extracts multi-part selector method names", () => {
      withAnalysis(
        `
@interface SomeManager : NSObject
- (NSArray *)processItems:(NSArray *)rawItems withFilter:(NSString *)filter;
@end
`,
        (result) => {
          const cls = result.classes[0];
          expect(cls.methods).toContain("processItems:withFilter:");
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // @implementation — class implementations
  // ---------------------------------------------------------------------------

  describe("extractStructure - @implementation", () => {
    it("extracts methods from @implementation", () => {
      withAnalysis(
        `
@implementation SomeManager
- (void)loadData {
    NSLog(@"loading");
}
+ (SomeManager *)sharedInstance {
    static SomeManager *instance = nil;
    return instance;
}
@end
`,
        (result) => {
          expect(result.classes).toHaveLength(1);
          const cls = result.classes[0];
          expect(cls.name).toBe("SomeManager");
          expect(cls.methods).toContain("loadData");
          expect(cls.methods).toContain("sharedInstance");
        },
      );
    });

    it("surfaces methods in functions[] array", () => {
      withAnalysis(
        `
@implementation SomeManager
- (void)loadData {
    NSLog(@"loading");
}
- (NSArray *)processItems:(NSArray *)rawItems withFilter:(NSString *)filter {
    return rawItems;
}
@end
`,
        (result) => {
          const funcNames = result.functions.map((f) => f.name);
          expect(funcNames).toContain("loadData");
          expect(funcNames).toContain("processItems:withFilter:");
        },
      );
    });

    it("merges @interface and @implementation into one class entry", () => {
      withAnalysis(
        `
@interface SomeManager : NSObject
@property (nonatomic, strong) NSString *name;
- (void)loadData;
@end

@implementation SomeManager
- (void)loadData {
    NSLog(@"loading");
}
@end
`,
        (result) => {
          // Both @interface and @implementation refer to the same class —
          // they should be merged into ONE class entry.
          expect(result.classes).toHaveLength(1);
          const cls = result.classes[0];
          expect(cls.name).toBe("SomeManager");
          expect(cls.properties).toContain("name");
          expect(cls.methods).toContain("loadData");
        },
      );
    });

    it("extracts method params from @implementation", () => {
      withAnalysis(
        `
@implementation SomeManager
- (NSArray *)processItems:(NSArray *)rawItems withFilter:(NSString *)filter {
    return rawItems;
}
@end
`,
        (result) => {
          const func = result.functions.find(
            (f) => f.name === "processItems:withFilter:",
          );
          expect(func).toBeDefined();
          expect(func!.params).toEqual(["rawItems", "filter"]);
        },
      );
    });

    it("extracts return type from @implementation methods", () => {
      withAnalysis(
        `
@implementation SomeManager
- (NSArray *)processItems:(NSArray *)rawItems {
    return rawItems;
}
@end
`,
        (result) => {
          const func = result.functions.find(
            (f) => f.name === "processItems:",
          );
          expect(func).toBeDefined();
          expect(func!.returnType).toContain("NSArray");
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  describe("extractStructure - exports", () => {
    it("surfaces classes as exports (ObjC public header convention)", () => {
      withAnalysis(
        `
@interface Foo : NSObject
@end
@interface Bar : NSObject
@end
`,
        (result) => {
          const names = result.exports.map((e) => e.name);
          expect(names).toContain("Foo");
          expect(names).toContain("Bar");
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // @protocol
  // ---------------------------------------------------------------------------

  describe("extractStructure - @protocol", () => {
    it("extracts protocol as a class entry with methods", () => {
      withAnalysis(
        `
@protocol DataDelegate <NSObject>
- (void)didLoadData:(NSArray *)data;
- (void)didFailWithError:(NSError *)error;
@end
`,
        (result) => {
          expect(result.classes).toHaveLength(1);
          const proto = result.classes[0];
          expect(proto.name).toBe("DataDelegate");
          expect(proto.methods).toContain("didLoadData:");
          expect(proto.methods).toContain("didFailWithError:");
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Full combined file
  // ---------------------------------------------------------------------------

  describe("extractStructure - comprehensive file", () => {
    const code = `
#import <Foundation/Foundation.h>
#import "DataService.h"

@interface SomeManager : NSObject
@property (nonatomic, strong) DataService *dataService;
@property (nonatomic, assign) BOOL isLoaded;
- (instancetype)initWithService:(DataService *)service;
- (void)loadDataWithCompletion:(void (^)(NSArray *items, NSError *error))completion;
- (NSArray *)processItems:(NSArray *)rawItems;
+ (SomeManager *)sharedInstance;
@end

@implementation SomeManager
+ (SomeManager *)sharedInstance {
    static SomeManager *instance = nil;
    return instance;
}
- (instancetype)initWithService:(DataService *)service {
    self = [super init];
    if (self) {
        _dataService = service;
        _isLoaded = NO;
    }
    return self;
}
- (void)loadDataWithCompletion:(void (^)(NSArray *items, NSError *error))completion {
    [self.dataService fetchItemsWithCompletion:^(NSArray *raw, NSError *err) {
        completion(nil, err);
    }];
}
- (NSArray *)processItems:(NSArray *)rawItems {
    NSMutableArray *result = [NSMutableArray array];
    return [result copy];
}
@end
`;

    it("extracts imports", () =>
      withAnalysis(code, (result) => {
        expect(result.imports.length).toBeGreaterThanOrEqual(2);
      }));

    it("extracts exactly one class (merged @interface + @implementation)", () =>
      withAnalysis(code, (result) => {
        expect(result.classes).toHaveLength(1);
        expect(result.classes[0].name).toBe("SomeManager");
      }));

    it("extracts all properties", () =>
      withAnalysis(code, (result) => {
        const props = result.classes[0].properties;
        expect(props).toContain("dataService");
        expect(props).toContain("isLoaded");
      }));

    it("extracts all methods", () =>
      withAnalysis(code, (result) => {
        const methods = result.classes[0].methods;
        expect(methods).toContain("sharedInstance");
        expect(methods).toContain("initWithService:");
        expect(methods).toContain("loadDataWithCompletion:");
        expect(methods).toContain("processItems:");
      }));

    it("functions array has non-zero length", () =>
      withAnalysis(code, (result) => {
        expect(result.functions.length).toBeGreaterThan(0);
      }));
  });

  // ---------------------------------------------------------------------------
  // Call graph
  // ---------------------------------------------------------------------------

  describe("extractCallGraph", () => {
    it("extracts message sends as caller→callee edges", () => {
      withCalls(
        `
@implementation SomeManager
- (void)loadData {
    [self processItems:nil];
    NSLog(@"done");
}
- (NSArray *)processItems:(NSArray *)raw {
    return raw;
}
@end
`,
        (calls) => {
          expect(calls.length).toBeGreaterThan(0);
          const msgCall = calls.find(
            (c) => c.caller === "loadData" && c.callee === "processItems",
          );
          expect(msgCall).toBeDefined();
        },
      );
    });

    it("extracts C-style function calls (NSLog, dispatch_once, etc.)", () => {
      withCalls(
        `
@implementation SomeManager
- (void)loadData {
    NSLog(@"loading");
}
@end
`,
        (calls) => {
          const logCall = calls.find(
            (c) => c.caller === "loadData" && c.callee === "NSLog",
          );
          expect(logCall).toBeDefined();
        },
      );
    });
  });
});

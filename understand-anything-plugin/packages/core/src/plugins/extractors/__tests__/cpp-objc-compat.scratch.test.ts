/**
 * Scratch test: Can tree-sitter-cpp grammar parse Objective-C syntax?
 *
 * This answers the question: "Can we just reuse CppExtractor for ObjC?"
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { CppExtractor } from "../cpp-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let cppLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve("tree-sitter-cpp/tree-sitter-cpp.wasm");
  cppLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(cppLang);
  const tree = parser.parse(code);
  return { tree, parser, root: tree.rootNode };
}

const OBJC_CODE = `
#import <Foundation/Foundation.h>
#import "DataService.h"

@interface SomeManager : NSObject
@property (nonatomic, strong) NSString *name;
- (void)loadData;
+ (SomeManager *)sharedInstance;
@end

@implementation SomeManager
+ (SomeManager *)sharedInstance {
    static SomeManager *instance = nil;
    return instance;
}
- (void)loadData {
    NSLog(@"loading");
}
@end
`;

describe("Can tree-sitter-cpp parse Objective-C?", () => {
  const extractor = new CppExtractor();

  it("tree-sitter-cpp produces ERROR nodes when parsing @interface/@implementation", () => {
    const { tree, parser, root } = parse(OBJC_CODE);
    const rootStr = root.toString();
    console.log("AST root:", rootStr.slice(0, 500));
    // ObjC syntax (@interface, @implementation, message sends) is NOT valid C++
    // The parser will produce ERROR nodes, confirming it can't handle ObjC
    const hasErrors = rootStr.includes("ERROR");
    expect(hasErrors).toBe(true); // C++ grammar chokes on ObjC syntax
    tree.delete();
    parser.delete();
  });

  it("CppExtractor.extractStructure produces empty results for ObjC code (even with cpp grammar)", () => {
    const { tree, parser, root } = parse(OBJC_CODE);
    const result = extractor.extractStructure(root);
    console.log("Functions found:", result.functions.map(f => f.name));
    console.log("Classes found:", result.classes.map(c => c.name));
    // The CppExtractor won't find @interface/@implementation as classes,
    // and won't find - (void)method: signatures as functions
    expect(result.classes).toHaveLength(0); // confirms we CANNOT reuse CppExtractor
    expect(result.functions).toHaveLength(0);
    tree.delete();
    parser.delete();
  });
});

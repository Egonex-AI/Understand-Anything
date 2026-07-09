/**
 * Reproduction test for GitHub Issue #554:
 * "bug: No Objective-C support"
 *
 * This test file documents the FAILING state of the codebase before the fix.
 * All tests here are expected to FAIL on the current main branch, confirming
 * the bug is reproducible. They will PASS once the fix is implemented.
 *
 * @see https://github.com/Egonex-AI/Understand-Anything/issues/554
 */

import { describe, it, expect, beforeAll } from "vitest";
import { LanguageRegistry } from "../../../languages/language-registry.js";
import { TreeSitterPlugin } from "../../tree-sitter-plugin.js";

// ---------------------------------------------------------------------------
// Fixtures — representative Objective-C / Objective-C++ source snippets
// ---------------------------------------------------------------------------

const OBJC_MANAGER = `
#import <Foundation/Foundation.h>
#import "DataService.h"
#import "UserModel.h"

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
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[SomeManager alloc] init];
    });
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
        if (err) {
            completion(nil, err);
            return;
        }
        NSArray *processed = [self processItems:raw];
        self.isLoaded = YES;
        completion(processed, nil);
    }];
}

- (NSArray *)processItems:(NSArray *)rawItems {
    NSMutableArray *result = [NSMutableArray array];
    for (id item in rawItems) {
        [result addObject:[UserModel modelWithRaw:item]];
    }
    return [result copy];
}

@end
`;

const OBJCPP_WRAPPER = `
#import <Foundation/Foundation.h>
#include <vector>
#include <string>

@interface CppBridge : NSObject

- (instancetype)init;
- (NSArray *)processData:(NSData *)data;

@end

@implementation CppBridge {
    std::vector<std::string> _cache;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _cache.reserve(64);
    }
    return self;
}

- (NSArray *)processData:(NSData *)data {
    const char *bytes = (const char *)[data bytes];
    _cache.push_back(std::string(bytes));
    return @[@(bytes)];
}

@end
`;

// ---------------------------------------------------------------------------
// 1. Language Registry — must NOT recognise .m/.mm yet (bug confirmation)
// ---------------------------------------------------------------------------

describe("Issue #554 reproduction — LanguageRegistry", () => {
  let registry: LanguageRegistry;

  beforeAll(() => {
    registry = LanguageRegistry.createDefault();
  });

  it("FIXED: getForFile returns objectivec config for .m files", () => {
    const config = registry.getForFile("SomeManager.m");
    expect(config).not.toBeNull();
    expect(config!.id).toBe("objective-c");
  });

  it("FIXED: getForFile returns objectivec config for .mm files", () => {
    const config = registry.getForFile("CppBridge.mm");
    expect(config).not.toBeNull();
    expect(config!.id).toBe("objective-c");
  });

  it("FIXED: getById returns the config for 'objective-c'", () => {
    const config = registry.getById("objective-c");
    expect(config).not.toBeNull();
    expect(config!.displayName).toBe("Objective-C");
  });

  it("reference: getForFile correctly returns a config for .swift (sanity check)", () => {
    const config = registry.getForFile("AppDelegate.swift");
    expect(config).not.toBeNull();
    expect(config!.id).toBe("swift");
  });
});

// ---------------------------------------------------------------------------
// 2. TreeSitterPlugin — analyzeFile must return empty results for .m/.mm
// ---------------------------------------------------------------------------

describe("Issue #554 reproduction — TreeSitterPlugin structural analysis", () => {
  let plugin: TreeSitterPlugin;

  beforeAll(async () => {
    // Initialize plugin with all builtin configs — including objectivecConfig —
    // which is how the plugin is used in production via plugin-discovery.
    const registry = LanguageRegistry.createDefault();
    plugin = new TreeSitterPlugin(registry.getAllLanguages());
    await plugin.init();
  });

  it("FIXED: analyzeFile returns functions and classes for a .m file", () => {
    const result = plugin.analyzeFile("SomeManager.m", OBJC_MANAGER);
    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.classes.length).toBeGreaterThan(0);
    expect(result.imports.length).toBeGreaterThan(0);
  });

  it("FIXED: analyzeFile returns functions and classes for a .mm file", () => {
    const result = plugin.analyzeFile("CppBridge.mm", OBJCPP_WRAPPER);
    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.classes.length).toBeGreaterThan(0);
  });

  it("FIXED: 'objective-c' is now in the list of supported languages", () => {
    expect(plugin.languages).toContain("objective-c");
  });

  it("reference: analyzeFile correctly extracts functions from .ts (sanity check)", () => {
    const tsCode = `
function greet(name: string): string {
  return "Hello " + name;
}
class Foo {
  bar(): void {}
}
`;
    const result = plugin.analyzeFile("test.ts", tsCode);
    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.classes.length).toBeGreaterThan(0);
  });
});

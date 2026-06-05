# Multi-Language Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create extractors with full enhanced metadata support (annotations, inheritance, typed properties) for Kotlin, Dart/Flutter, and Objective-C, aligned with the Java extractor.

**Architecture:** Each language gets an independent `*-extractor.ts` implementing the `LanguageExtractor` interface, using `base-extractor.ts` utilities and shared `AnnotationInfo`/`PropertyInfo` types. Language configs are updated to include `treeSitter` WASM references. All extractors are registered in the central `index.ts`.

**Tech Stack:** TypeScript, web-tree-sitter (WASM), Vitest, `@tree-sitter-grammars/tree-sitter-kotlin`, `tree-sitter-objc`, UserNobody14/tree-sitter-dart (compiled WASM)

**Spec:** `docs/superpowers/specs/2026-06-05-multi-lang-extractor-design.md`

---

## Task 0: Install Dependencies & Prepare WASM

**Files:**
- Modify: `understand-anything-plugin/packages/core/package.json`

- [ ] **Step 1: Install Kotlin and ObjC tree-sitter WASM packages**

```bash
cd understand-anything-plugin/packages/core
pnpm add @tree-sitter-grammars/tree-sitter-kotlin tree-sitter-objc
```

- [ ] **Step 2: Verify WASM files exist**

```bash
ls node_modules/@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm
ls node_modules/tree-sitter-objc/tree-sitter-objc.wasm
```

Expected: Both files exist.

- [ ] **Step 3: Prepare Dart WASM**

Install tree-sitter-cli and compile:

```bash
pnpm add -D tree-sitter-cli
git clone --depth 1 https://github.com/UserNobody14/tree-sitter-dart /tmp/tree-sitter-dart
cd /tmp/tree-sitter-dart && npm install
npx tree-sitter build --wasm /tmp/tree-sitter-dart
```

If compilation succeeds, copy the WASM file:

```bash
mkdir -p understand-anything-plugin/packages/core/grammars
cp /tmp/tree-sitter-dart.wasm understand-anything-plugin/packages/core/grammars/
```

If compilation fails (requires Emscripten/Docker), defer Dart to a follow-up task and proceed with Kotlin + ObjC.

- [ ] **Step 4: Commit dependency changes**

```bash
git add understand-anything-plugin/packages/core/package.json understand-anything-plugin/pnpm-lock.yaml
git commit -m "chore: add tree-sitter-kotlin and tree-sitter-objc dependencies"
```

---

## Task 1: Kotlin Language Config

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/languages/configs/kotlin.ts`
- Modify: `understand-anything-plugin/packages/core/src/languages/configs/index.ts`

- [ ] **Step 1: Add treeSitter field to kotlin.ts**

Replace the contents of `understand-anything-plugin/packages/core/src/languages/configs/kotlin.ts`:

```typescript
import type { LanguageConfig } from "../types.js";

export const kotlinConfig = {
  id: "kotlin",
  displayName: "Kotlin",
  extensions: [".kt", ".kts"],
  treeSitter: {
    wasmPackage: "@tree-sitter-grammars/tree-sitter-kotlin",
    wasmFile: "tree-sitter-kotlin.wasm",
  },
  concepts: [
    "coroutines",
    "data classes",
    "sealed classes",
    "extension functions",
    "null safety",
    "delegation",
    "DSL builders",
    "inline functions",
    "companion objects",
    "flow",
  ],
  filePatterns: {
    entryPoints: ["**/Application.kt", "**/Main.kt"],
    barrels: [],
    tests: ["*Test.kt", "*Tests.kt"],
    config: ["build.gradle.kts", "build.gradle"],
  },
} satisfies LanguageConfig;
```

- [ ] **Step 2: Verify build**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

Expected: TypeScript compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/configs/kotlin.ts
git commit -m "feat(kotlin): add treeSitter WASM config to Kotlin language"
```

---

## Task 2: Kotlin Extractor — Structure Extraction

**Files:**
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts`

- [ ] **Step 1: Write failing tests for basic structure extraction**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts`:

```typescript
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
  const wasmPath = require.resolve(
    "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
  );
  kotlinLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(kotlinLang);
  const tree = parser.parse(code);
  return { tree, parser, root: tree.rootNode };
}

const extractor = new KotlinExtractor();

describe("KotlinExtractor", () => {
  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["kotlin"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts top-level functions with params and return types", () => {
      const { tree, parser, root } = parse(`
fun greet(name: String): String {
    return "Hello, $name"
}
`);
      const result = extractor.extractStructure(root);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("String");
      tree.delete();
      parser.delete();
    });

    it("extracts functions with no return type", () => {
      const { tree, parser, root } = parse(`
fun doSomething() {
    println("hello")
}
`);
      const result = extractor.extractStructure(root);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("doSomething");
      expect(result.functions[0].returnType).toBeUndefined();
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - classes", () => {
    it("extracts class with methods and properties", () => {
      const { tree, parser, root } = parse(`
class OrderService {
    val name: String = "order"
    fun createOrder(id: String): Order {
        return Order(id)
    }
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("OrderService");
      expect(result.classes[0].methods).toContain("createOrder");
      expect(result.classes[0].properties).toContain("name");
      tree.delete();
      parser.delete();
    });

    it("extracts data class with primary constructor properties", () => {
      const { tree, parser, root } = parse(`
data class User(val name: String, val age: Int)
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("User");
      expect(result.classes[0].properties).toContain("name");
      expect(result.classes[0].properties).toContain("age");
      expect(result.classes[0].typedProperties).toBeDefined();
      expect(result.classes[0].typedProperties).toContainEqual({ name: "name", type: "String" });
      expect(result.classes[0].typedProperties).toContainEqual({ name: "age", type: "Int" });
      tree.delete();
      parser.delete();
    });

    it("extracts object declarations", () => {
      const { tree, parser, root } = parse(`
object Singleton {
    fun getInstance(): Singleton = this
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Singleton");
      expect(result.classes[0].methods).toContain("getInstance");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts import statements", () => {
      const { tree, parser, root } = parse(`
import com.example.OrderService
import com.example.util.*
`);
      const result = extractor.extractStructure(root);
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("com.example.OrderService");
      expect(result.imports[0].specifiers).toEqual(["OrderService"]);
      expect(result.imports[1].source).toBe("com.example.util");
      expect(result.imports[1].specifiers).toEqual(["*"]);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - annotations", () => {
    it("extracts class annotations", () => {
      const { tree, parser, root } = parse(`
@RestController
@RequestMapping("/api/orders")
class OrderController {
    fun list(): List<Order> = emptyList()
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].annotations).toHaveLength(2);
      expect(result.classes[0].annotations![0].name).toBe("RestController");
      expect(result.classes[0].annotations![1].name).toBe("RequestMapping");
      tree.delete();
      parser.delete();
    });

    it("extracts method annotations", () => {
      const { tree, parser, root } = parse(`
class Consumer {
    @KafkaListener(topics = ["order-events"])
    fun onMessage(msg: String) {}
}
`);
      const result = extractor.extractStructure(root);
      const fn = result.functions.find(f => f.name === "onMessage");
      expect(fn).toBeDefined();
      expect(fn!.annotations).toHaveLength(1);
      expect(fn!.annotations![0].name).toBe("KafkaListener");
      tree.delete();
      parser.delete();
    });

    it("extracts property annotations", () => {
      const { tree, parser, root } = parse(`
class OrderService {
    @Autowired
    lateinit var paymentClient: PaymentClient
}
`);
      const result = extractor.extractStructure(root);
      const prop = result.classes[0].typedProperties?.find(p => p.name === "paymentClient");
      expect(prop).toBeDefined();
      expect(prop!.type).toBe("PaymentClient");
      expect(prop!.annotations).toEqual([{ name: "Autowired" }]);
      tree.delete();
      parser.delete();
    });

    it("omits annotations when class has none", () => {
      const { tree, parser, root } = parse(`
class Plain {
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
    it("extracts superclass", () => {
      const { tree, parser, root } = parse(`
class Dog : Animal() {
    fun bark() {}
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].superclass).toBe("Animal");
      tree.delete();
      parser.delete();
    });

    it("extracts implemented interfaces", () => {
      const { tree, parser, root } = parse(`
class OrderServiceImpl : OrderService, Serializable {
    override fun createOrder() {}
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].interfaces).toContain("OrderService");
      expect(result.classes[0].interfaces).toContain("Serializable");
      tree.delete();
      parser.delete();
    });

    it("extracts both extends and implements", () => {
      const { tree, parser, root } = parse(`
class SpecialService : BaseService(), ServiceInterface {
    override fun run() {}
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].superclass).toBe("BaseService");
      expect(result.classes[0].interfaces).toContain("ServiceInterface");
      tree.delete();
      parser.delete();
    });

    it("omits inheritance when absent", () => {
      const { tree, parser, root } = parse(`class Simple`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].superclass).toBeUndefined();
      expect(result.classes[0].interfaces).toBeUndefined();
      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts method calls", () => {
      const { tree, parser, root } = parse(`
class Service {
    fun process() {
        validate()
        repository.save()
    }
    fun validate() {}
}
`);
      const result = extractor.extractCallGraph(root);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(e => e.caller === "process" && e.callee === "validate")).toBe(true);
      tree.delete();
      parser.delete();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd understand-anything-plugin/packages/core
pnpm vitest run src/plugins/extractors/__tests__/kotlin-extractor.test.ts
```

Expected: FAIL (module `../kotlin-extractor.js` not found)

- [ ] **Step 3: Implement KotlinExtractor**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts`.

The implementation must:
1. Parse Kotlin AST nodes: `class_declaration`, `object_declaration`, `function_declaration`, `property_declaration`, `import_header`
2. Extract annotations from `modifiers` → `annotation` nodes
3. Extract superclass/interfaces from delegation specifiers (`:` clause)
4. Extract typed properties from `property_declaration` with type annotations
5. Extract primary constructor properties from `primary_constructor` → `class_parameter` nodes
6. Extract call graph from `call_expression` nodes

**Key AST node types to handle** (verify with AST debugging if needed):
- `source_file` → top-level declarations
- `class_declaration` → `modifiers`, `type_identifier` (name), `delegation_specifier`, `class_body`
- `object_declaration` → similar to class but no constructor
- `function_declaration` → `modifiers`, `simple_identifier` (name), `function_value_parameters`, return type
- `property_declaration` → `modifiers`, `variable_declaration` (name + type), initializer
- `import_header` → `identifier` (dotted path)

Use the Java extractor as a reference pattern. Import from `base-extractor.ts`: `findChild`, `findChildren`, `traverse`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd understand-anything-plugin/packages/core
pnpm vitest run src/plugins/extractors/__tests__/kotlin-extractor.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Build to verify TypeScript compiles**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

Expected: No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/kotlin-extractor.ts \
       understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/kotlin-extractor.test.ts
git commit -m "feat(kotlin): add KotlinExtractor with annotations, inheritance, typed properties"
```

---

## Task 3: Objective-C Language Config

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/configs/objc.ts`
- Modify: `understand-anything-plugin/packages/core/src/languages/configs/index.ts`

- [ ] **Step 1: Create objc.ts language config**

Create `understand-anything-plugin/packages/core/src/languages/configs/objc.ts`:

```typescript
import type { LanguageConfig } from "../types.js";

export const objcConfig = {
  id: "objc",
  displayName: "Objective-C",
  extensions: [".m", ".mm", ".h"],
  treeSitter: {
    wasmPackage: "tree-sitter-objc",
    wasmFile: "tree-sitter-objc.wasm",
  },
  concepts: [
    "protocols",
    "categories",
    "message passing",
    "properties",
    "memory management",
    "blocks",
    "KVC/KVO",
    "runtime",
    "delegation",
    "notifications",
  ],
  filePatterns: {
    entryPoints: ["main.m", "AppDelegate.m"],
    barrels: [],
    tests: ["*Tests.m", "Tests/**/*.m"],
    config: ["Podfile", "*.xcodeproj/project.pbxproj"],
  },
} satisfies LanguageConfig;
```

- [ ] **Step 2: Register in configs/index.ts**

Add import and registration for `objcConfig` in `understand-anything-plugin/packages/core/src/languages/configs/index.ts`:

Add import line after `csharpConfig`:
```typescript
import { objcConfig } from "./objc.js";
```

Add `objcConfig` to `builtinLanguageConfigs` array after `csharpConfig`:
```typescript
  csharpConfig,
  objcConfig,
```

Add to named exports:
```typescript
  objcConfig,
```

- [ ] **Step 3: Verify build**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/configs/objc.ts \
       understand-anything-plugin/packages/core/src/languages/configs/index.ts
git commit -m "feat(objc): add Objective-C language config with treeSitter WASM"
```

---

## Task 4: Objective-C Extractor — Structure Extraction

**Files:**
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts`:

```typescript
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

const extractor = new ObjcExtractor();

describe("ObjcExtractor", () => {
  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["objc"]);
  });

  describe("extractStructure - class interface", () => {
    it("extracts @interface with superclass and protocols", () => {
      const { tree, parser, root } = parse(`
@interface Dog : Animal <Runnable, Serializable>
- (void)bark;
@end
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Dog");
      expect(result.classes[0].superclass).toBe("Animal");
      expect(result.classes[0].interfaces).toContain("Runnable");
      expect(result.classes[0].interfaces).toContain("Serializable");
      expect(result.classes[0].methods).toContain("bark");
      tree.delete();
      parser.delete();
    });

    it("extracts @interface with no protocols", () => {
      const { tree, parser, root } = parse(`
@interface Simple : NSObject
@end
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].name).toBe("Simple");
      expect(result.classes[0].superclass).toBe("NSObject");
      expect(result.classes[0].interfaces).toBeUndefined();
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - properties", () => {
    it("extracts @property declarations with types", () => {
      const { tree, parser, root } = parse(`
@interface User : NSObject
@property (nonatomic, strong) NSString *name;
@property (nonatomic, assign) NSInteger age;
@end
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].typedProperties).toBeDefined();
      const nameProp = result.classes[0].typedProperties?.find(p => p.name === "name");
      expect(nameProp).toBeDefined();
      expect(nameProp!.type).toBeDefined();
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - methods", () => {
    it("extracts instance and class methods", () => {
      const { tree, parser, root } = parse(`
@interface Calculator : NSObject
- (NSInteger)add:(NSInteger)a to:(NSInteger)b;
+ (Calculator *)sharedInstance;
@end
`);
      const result = extractor.extractStructure(root);
      expect(result.functions.length).toBeGreaterThanOrEqual(2);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - protocol", () => {
    it("extracts @protocol as class entry", () => {
      const { tree, parser, root } = parse(`
@protocol Drawable
- (void)draw;
- (void)resize:(CGSize)size;
@end
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Drawable");
      expect(result.classes[0].methods).toContain("draw");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts #import statements", () => {
      const { tree, parser, root } = parse(`
#import <Foundation/Foundation.h>
#import "MyClass.h"
`);
      const result = extractor.extractStructure(root);
      expect(result.imports.length).toBeGreaterThanOrEqual(2);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - implementation", () => {
    it("extracts @implementation with method bodies", () => {
      const { tree, parser, root } = parse(`
@implementation Dog
- (void)bark {
    NSLog(@"Woof!");
}
@end
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Dog");
      expect(result.functions.some(f => f.name === "bark")).toBe(true);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts message send expressions", () => {
      const { tree, parser, root } = parse(`
@implementation Service
- (void)process {
    [self validate];
    [repository save];
}
- (void)validate {}
@end
`);
      const result = extractor.extractCallGraph(root);
      expect(result.length).toBeGreaterThanOrEqual(1);
      tree.delete();
      parser.delete();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd understand-anything-plugin/packages/core
pnpm vitest run src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement ObjcExtractor**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts`.

The implementation must handle:
1. `class_interface` → class with superclass, protocols, methods, properties
2. `class_implementation` → class with method bodies
3. `protocol_declaration` → class entry (like Java interface)
4. `category_interface` → class with name format `ClassName(CategoryName)`
5. Method declarations with ObjC selector naming: `- (void)insertObject:(id)obj atIndex:(NSUInteger)idx` → name = `insertObject:atIndex:`
6. `@property` → typedProperties
7. `preproc_import` → imports
8. Message send expressions (`[obj method]`) → call graph

Debug the AST structure first if needed:
```bash
node --input-type=module -e "
const mod = await import('web-tree-sitter');
const { createRequire } = await import('module');
const req = createRequire(import.meta.url);
await mod.Parser.init();
const lang = await mod.Language.load(req.resolve('tree-sitter-objc/tree-sitter-objc.wasm'));
const parser = new mod.Parser();
parser.setLanguage(lang);
const tree = parser.parse('@interface Dog : Animal <Proto> \\n- (void)bark;\\n@end');
function dump(node, indent) {
  console.log(' '.repeat(indent) + node.type + ' = ' + JSON.stringify(node.text.substring(0,40)));
  for (let i = 0; i < node.childCount; i++) dump(node.child(i), indent+2);
}
dump(tree.rootNode, 0);
"
```

- [ ] **Step 4: Run tests**

```bash
cd understand-anything-plugin/packages/core
pnpm vitest run src/plugins/extractors/__tests__/objc-extractor.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Build**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/objc-extractor.ts \
       understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/objc-extractor.test.ts
git commit -m "feat(objc): add ObjcExtractor with superclass, protocols, properties, selectors"
```

---

## Task 5: Dart Language Config & WASM Setup

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/configs/dart.ts`
- Modify: `understand-anything-plugin/packages/core/src/languages/configs/index.ts`

- [ ] **Step 1: Create dart.ts language config**

Create `understand-anything-plugin/packages/core/src/languages/configs/dart.ts`:

```typescript
import type { LanguageConfig } from "../types.js";

export const dartConfig = {
  id: "dart",
  displayName: "Dart",
  extensions: [".dart"],
  treeSitter: {
    wasmPackage: "tree-sitter-dart",
    wasmFile: "tree-sitter-dart.wasm",
  },
  concepts: [
    "null safety",
    "mixins",
    "extensions",
    "async/await",
    "isolates",
    "streams",
    "generics",
    "factory constructors",
    "named constructors",
    "cascades",
    "records",
    "patterns",
  ],
  filePatterns: {
    entryPoints: ["lib/main.dart", "bin/main.dart"],
    barrels: [],
    tests: ["*_test.dart", "test/**/*.dart"],
    config: ["pubspec.yaml", "analysis_options.yaml"],
  },
} satisfies LanguageConfig;
```

Note: The `wasmPackage` and `wasmFile` values depend on how the Dart WASM is distributed. If using a vendored file, the tree-sitter-plugin loading logic may need a small adjustment to support local paths.

- [ ] **Step 2: Register in configs/index.ts**

Add import and registration for `dartConfig` alongside `objcConfig`.

- [ ] **Step 3: Verify build**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/configs/dart.ts \
       understand-anything-plugin/packages/core/src/languages/configs/index.ts
git commit -m "feat(dart): add Dart language config with treeSitter WASM"
```

---

## Task 6: Dart Extractor — Structure Extraction

**Files:**
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { DartExtractor } from "../dart-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let dartLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  // Adjust path if WASM is vendored locally
  const wasmPath = require.resolve("tree-sitter-dart/tree-sitter-dart.wasm");
  dartLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(dartLang);
  const tree = parser.parse(code);
  return { tree, parser, root: tree.rootNode };
}

const extractor = new DartExtractor();

describe("DartExtractor", () => {
  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["dart"]);
  });

  describe("extractStructure - functions", () => {
    it("extracts top-level functions", () => {
      const { tree, parser, root } = parse(`
String greet(String name) {
  return 'Hello, \$name';
}
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
    it("extracts class with methods and fields", () => {
      const { tree, parser, root } = parse(`
class OrderService {
  final String name = 'order';
  void createOrder(String id) {}
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("OrderService");
      expect(result.classes[0].methods).toContain("createOrder");
      expect(result.classes[0].properties).toContain("name");
      tree.delete();
      parser.delete();
    });

    it("extracts class with superclass and interfaces", () => {
      const { tree, parser, root } = parse(`
class Dog extends Animal implements Runnable, Serializable {
  void bark() {}
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].superclass).toBe("Animal");
      expect(result.classes[0].interfaces).toContain("Runnable");
      expect(result.classes[0].interfaces).toContain("Serializable");
      tree.delete();
      parser.delete();
    });

    it("extracts class with mixins", () => {
      const { tree, parser, root } = parse(`
class MyWidget extends StatelessWidget with TickerProviderMixin {
  Widget build(BuildContext context) => Container();
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].superclass).toBe("StatelessWidget");
      expect(result.classes[0].interfaces).toContain("TickerProviderMixin");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - annotations", () => {
    it("extracts class annotations", () => {
      const { tree, parser, root } = parse(`
@immutable
class MyWidget extends StatelessWidget {
  Widget build(BuildContext context) => Container();
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].annotations).toHaveLength(1);
      expect(result.classes[0].annotations![0].name).toBe("immutable");
      tree.delete();
      parser.delete();
    });

    it("extracts method annotations", () => {
      const { tree, parser, root } = parse(`
class Service {
  @override
  void run() {}

  @Deprecated('Use runV2')
  void oldRun() {}
}
`);
      const result = extractor.extractStructure(root);
      const runFn = result.functions.find(f => f.name === "run");
      expect(runFn?.annotations).toHaveLength(1);
      expect(runFn!.annotations![0].name).toBe("override");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - imports", () => {
    it("extracts Dart imports", () => {
      const { tree, parser, root } = parse(`
import 'package:flutter/material.dart';
import 'dart:async';
import 'src/models.dart';
`);
      const result = extractor.extractStructure(root);
      expect(result.imports.length).toBeGreaterThanOrEqual(3);
      tree.delete();
      parser.delete();
    });
  });

  describe("extractStructure - typed properties", () => {
    it("extracts field types", () => {
      const { tree, parser, root } = parse(`
class Config {
  final String apiUrl;
  int retryCount = 3;
  List<String>? tags;
  Config(this.apiUrl);
}
`);
      const result = extractor.extractStructure(root);
      expect(result.classes[0].typedProperties).toBeDefined();
      const apiUrl = result.classes[0].typedProperties?.find(p => p.name === "apiUrl");
      expect(apiUrl?.type).toBe("String");
      tree.delete();
      parser.delete();
    });
  });

  describe("extractCallGraph", () => {
    it("extracts function calls", () => {
      const { tree, parser, root } = parse(`
class Service {
  void process() {
    validate();
    repository.save();
  }
  void validate() {}
}
`);
      const result = extractor.extractCallGraph(root);
      expect(result.length).toBeGreaterThanOrEqual(1);
      tree.delete();
      parser.delete();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd understand-anything-plugin/packages/core
pnpm vitest run src/plugins/extractors/__tests__/dart-extractor.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement DartExtractor**

Create `understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts`.

Handle Dart AST nodes:
1. `class_definition` → classes with superclass, interfaces, mixins, annotations (metadata)
2. `mixin_declaration` → class entries
3. `extension_declaration` → class entries
4. `enum_declaration` → class entries
5. `function_signature` / `method_signature` → functions with annotations
6. Field declarations → properties + typedProperties
7. `import_specification` → imports
8. `export_specification` → exports
9. Privacy: members starting with `_` are NOT exports

Debug AST structure if needed (same pattern as ObjC debugging above).

- [ ] **Step 4: Run tests**

```bash
cd understand-anything-plugin/packages/core
pnpm vitest run src/plugins/extractors/__tests__/dart-extractor.test.ts
```

- [ ] **Step 5: Build**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/dart-extractor.ts \
       understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/dart-extractor.test.ts
git commit -m "feat(dart): add DartExtractor with annotations, inheritance, mixins, typed properties"
```

---

## Task 7: Register All Extractors & Final Integration

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/index.ts`

- [ ] **Step 1: Register all new extractors in index.ts**

Add to `understand-anything-plugin/packages/core/src/plugins/extractors/index.ts`:

Exports section:
```typescript
export { KotlinExtractor } from "./kotlin-extractor.js";
export { ObjcExtractor } from "./objc-extractor.js";
export { DartExtractor } from "./dart-extractor.js";
```

Imports section:
```typescript
import { KotlinExtractor } from "./kotlin-extractor.js";
import { ObjcExtractor } from "./objc-extractor.js";
import { DartExtractor } from "./dart-extractor.js";
```

Add to `builtinExtractors` array:
```typescript
  new KotlinExtractor(),
  new ObjcExtractor(),
  new DartExtractor(),
```

- [ ] **Step 2: Run full test suite**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core test
```

Expected: All tests pass (existing + new).

- [ ] **Step 3: Build entire project**

```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core build
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/extractors/index.ts
git commit -m "feat: register Kotlin, ObjC, Dart extractors in builtinExtractors"
```

---

## Task 8: Verify extract-structure.mjs Pass-through

**Files:**
- Read (no modify expected): `understand-anything-plugin/skills/understand/extract-structure.mjs`

- [ ] **Step 1: Verify extract-structure.mjs handles enhanced fields**

Read `understand-anything-plugin/skills/understand/extract-structure.mjs` and confirm the `buildResult` function passes through:
- `classes[].annotations`
- `classes[].superclass`
- `classes[].interfaces`
- `classes[].typedProperties`
- `functions[].annotations`

These were added for Java in the previous session. Since the code uses the same `StructuralAnalysis` interface, it should work for all languages automatically.

If any field is not passed through, add the conditional pass-through (same pattern as Java).

- [ ] **Step 2: Final integration commit (if changes needed)**

```bash
git add -A
git commit -m "chore: verify extract-structure pass-through for all new extractors"
```

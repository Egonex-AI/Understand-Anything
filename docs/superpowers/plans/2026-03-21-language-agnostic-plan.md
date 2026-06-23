# Language-Agnostic Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Understand-Anything language-agnostic by introducing a config-driven language framework, replacing the TS-only tree-sitter plugin, and creating language-aware prompts for 12 languages.

**Architecture:** Config-first hybrid approach — each language defined by a `LanguageConfig` object (tree-sitter node mappings, concepts, extensions) plus a prompt snippet markdown file. A single `GenericTreeSitterPlugin` replaces the hardcoded TS-only plugin, driven by whichever config matches the file extension.

**Tech Stack:** TypeScript, web-tree-sitter (WASM), Zod v4, Vitest

---

### Task 1: Create LanguageConfig types and Zod schema

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/types.ts`

**Step 1: Write the failing test**

Create: `understand-anything-plugin/packages/core/src/languages/__tests__/types.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { LanguageConfigSchema } from "../types.js";

describe("LanguageConfigSchema", () => {
  it("validates a complete language config", () => {
    const config = {
      id: "python",
      displayName: "Python",
      extensions: [".py", ".pyi"],
      treeSitter: {
        grammarPackage: "tree-sitter-python",
        wasmFile: "tree-sitter-python.wasm",
        nodeTypes: {
          function: ["function_definition"],
          class: ["class_definition"],
          import: ["import_statement", "import_from_statement"],
          export: [],
          typeAnnotation: ["type"],
        },
      },
      concepts: ["decorators", "list comprehensions", "generators"],
    };
    const result = LanguageConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects config missing required fields", () => {
    const result = LanguageConfigSchema.safeParse({ id: "python" });
    expect(result.success).toBe(false);
  });

  it("accepts optional filePatterns", () => {
    const config = {
      id: "python",
      displayName: "Python",
      extensions: [".py"],
      treeSitter: {
        grammarPackage: "tree-sitter-python",
        wasmFile: "tree-sitter-python.wasm",
        nodeTypes: {
          function: ["function_definition"],
          class: ["class_definition"],
          import: ["import_statement"],
          export: [],
          typeAnnotation: [],
        },
      },
      concepts: ["decorators"],
      filePatterns: { config: "pyproject.toml" },
    };
    const result = LanguageConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/languages/__tests__/types.test.ts`
Expected: FAIL — module `../types.js` not found

**Step 3: Write minimal implementation**

Create: `understand-anything-plugin/packages/core/src/languages/types.ts`

```typescript
import { z } from "zod/v4";

export const TreeSitterConfigSchema = z.object({
  grammarPackage: z.string(),
  wasmFile: z.string(),
  nodeTypes: z.object({
    function: z.array(z.string()),
    class: z.array(z.string()),
    import: z.array(z.string()),
    export: z.array(z.string()),
    typeAnnotation: z.array(z.string()),
  }),
});

export const LanguageConfigSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  extensions: z.array(z.string()),
  treeSitter: TreeSitterConfigSchema,
  concepts: z.array(z.string()),
  filePatterns: z.record(z.string(), z.string()).optional(),
});

export type LanguageConfig = z.infer<typeof LanguageConfigSchema>;
export type TreeSitterConfig = z.infer<typeof TreeSitterConfigSchema>;
```

**Step 4: Run test to verify it passes**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/languages/__tests__/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/
git commit -m "feat: add LanguageConfig types and Zod schema"
```

---

### Task 2: Create LanguageRegistry

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/registry.ts`

**Step 1: Write the failing test**

Create: `understand-anything-plugin/packages/core/src/languages/__tests__/registry.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { LanguageRegistry } from "../registry.js";
import type { LanguageConfig } from "../types.js";

const pythonConfig: LanguageConfig = {
  id: "python",
  displayName: "Python",
  extensions: [".py", ".pyi"],
  treeSitter: {
    grammarPackage: "tree-sitter-python",
    wasmFile: "tree-sitter-python.wasm",
    nodeTypes: {
      function: ["function_definition"],
      class: ["class_definition"],
      import: ["import_statement", "import_from_statement"],
      export: [],
      typeAnnotation: ["type"],
    },
  },
  concepts: ["decorators", "generators"],
};

const tsConfig: LanguageConfig = {
  id: "typescript",
  displayName: "TypeScript",
  extensions: [".ts", ".tsx"],
  treeSitter: {
    grammarPackage: "tree-sitter-typescript",
    wasmFile: "tree-sitter-typescript.wasm",
    nodeTypes: {
      function: ["function_declaration"],
      class: ["class_declaration"],
      import: ["import_statement"],
      export: ["export_statement"],
      typeAnnotation: ["type_annotation"],
    },
  },
  concepts: ["generics", "type guards", "decorators"],
};

describe("LanguageRegistry", () => {
  it("registers and retrieves a config by id", () => {
    const registry = new LanguageRegistry();
    registry.register(pythonConfig);
    expect(registry.getById("python")).toBe(pythonConfig);
  });

  it("retrieves config by file extension", () => {
    const registry = new LanguageRegistry();
    registry.register(pythonConfig);
    expect(registry.getByExtension(".py")).toBe(pythonConfig);
    expect(registry.getByExtension(".pyi")).toBe(pythonConfig);
  });

  it("returns null for unknown extension", () => {
    const registry = new LanguageRegistry();
    registry.register(pythonConfig);
    expect(registry.getByExtension(".rs")).toBeNull();
  });

  it("returns all registered configs", () => {
    const registry = new LanguageRegistry();
    registry.register(pythonConfig);
    registry.register(tsConfig);
    expect(registry.getAll()).toHaveLength(2);
  });

  it("later registration overrides same id", () => {
    const registry = new LanguageRegistry();
    const updated = { ...pythonConfig, displayName: "Python 3" };
    registry.register(pythonConfig);
    registry.register(updated);
    expect(registry.getById("python")?.displayName).toBe("Python 3");
  });

  it("throws on invalid config", () => {
    const registry = new LanguageRegistry();
    expect(() => registry.register({ id: "bad" } as LanguageConfig)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/languages/__tests__/registry.test.ts`
Expected: FAIL — module `../registry.js` not found

**Step 3: Write minimal implementation**

```typescript
// understand-anything-plugin/packages/core/src/languages/registry.ts
import { LanguageConfigSchema } from "./types.js";
import type { LanguageConfig } from "./types.js";

export class LanguageRegistry {
  private configs = new Map<string, LanguageConfig>();
  private extensionMap = new Map<string, string>();

  register(config: LanguageConfig): void {
    const result = LanguageConfigSchema.safeParse(config);
    if (!result.success) {
      throw new Error(`Invalid LanguageConfig for "${config.id}": ${result.error.message}`);
    }
    this.configs.set(config.id, config);
    for (const ext of config.extensions) {
      this.extensionMap.set(ext, config.id);
    }
  }

  getById(id: string): LanguageConfig | null {
    return this.configs.get(id) ?? null;
  }

  getByExtension(ext: string): LanguageConfig | null {
    const id = this.extensionMap.get(ext);
    if (!id) return null;
    return this.configs.get(id) ?? null;
  }

  getAll(): LanguageConfig[] {
    return [...this.configs.values()];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/languages/__tests__/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/
git commit -m "feat: add LanguageRegistry with Zod validation"
```

---

### Task 3: Create all 12 language configs

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/configs/typescript.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/javascript.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/python.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/go.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/java.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/rust.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/cpp.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/csharp.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/ruby.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/php.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/swift.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/kotlin.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/index.ts`

**Step 1: Write the failing test**

Create: `understand-anything-plugin/packages/core/src/languages/__tests__/configs.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { LanguageConfigSchema } from "../types.js";
import { builtinConfigs } from "../configs/index.js";

describe("builtin language configs", () => {
  it("has 12 language configs", () => {
    expect(builtinConfigs).toHaveLength(12);
  });

  it("all configs pass Zod validation", () => {
    for (const config of builtinConfigs) {
      const result = LanguageConfigSchema.safeParse(config);
      expect(result.success, `${config.id} failed validation: ${result.error?.message}`).toBe(true);
    }
  });

  it("all configs have unique ids", () => {
    const ids = builtinConfigs.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no duplicate extensions across configs", () => {
    const allExts: string[] = [];
    for (const config of builtinConfigs) {
      allExts.push(...config.extensions);
    }
    expect(new Set(allExts).size).toBe(allExts.length);
  });

  it("all configs have non-empty function and class node types", () => {
    for (const config of builtinConfigs) {
      expect(config.treeSitter.nodeTypes.function.length, `${config.id} missing function types`).toBeGreaterThan(0);
      expect(config.treeSitter.nodeTypes.class.length, `${config.id} missing class types`).toBeGreaterThanOrEqual(0);
    }
  });

  it("all configs have at least one concept", () => {
    for (const config of builtinConfigs) {
      expect(config.concepts.length, `${config.id} has no concepts`).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/languages/__tests__/configs.test.ts`
Expected: FAIL — module not found

**Step 3: Write all config files**

Each config file exports a `LanguageConfig`. Here are the key ones (the rest follow the same pattern):

**typescript.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const typescriptConfig: LanguageConfig = {
  id: "typescript",
  displayName: "TypeScript",
  extensions: [".ts", ".tsx"],
  treeSitter: {
    grammarPackage: "tree-sitter-typescript",
    wasmFile: "tree-sitter-typescript.wasm",
    nodeTypes: {
      function: ["function_declaration"],
      class: ["class_declaration"],
      import: ["import_statement"],
      export: ["export_statement"],
      typeAnnotation: ["type_annotation"],
    },
  },
  concepts: [
    "generics", "type guards", "discriminated unions", "utility types",
    "decorators", "enums", "interfaces", "type inference",
    "mapped types", "conditional types", "template literal types",
  ],
  filePatterns: { config: "tsconfig.json", manifest: "package.json" },
};
```

**python.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const pythonConfig: LanguageConfig = {
  id: "python",
  displayName: "Python",
  extensions: [".py", ".pyi"],
  treeSitter: {
    grammarPackage: "tree-sitter-python",
    wasmFile: "tree-sitter-python.wasm",
    nodeTypes: {
      function: ["function_definition"],
      class: ["class_definition"],
      import: ["import_statement", "import_from_statement"],
      export: [],
      typeAnnotation: ["type"],
    },
  },
  concepts: [
    "decorators", "list comprehensions", "generators", "context managers",
    "type hints", "dunder methods", "metaclasses", "dataclasses",
    "async/await", "descriptors",
  ],
  filePatterns: { config: "pyproject.toml", manifest: "setup.py" },
};
```

**go.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const goConfig: LanguageConfig = {
  id: "go",
  displayName: "Go",
  extensions: [".go"],
  treeSitter: {
    grammarPackage: "tree-sitter-go",
    wasmFile: "tree-sitter-go.wasm",
    nodeTypes: {
      function: ["function_declaration", "method_declaration"],
      class: ["type_declaration"],
      import: ["import_declaration"],
      export: [],
      typeAnnotation: [],
    },
  },
  concepts: [
    "goroutines", "channels", "interfaces", "struct embedding",
    "error handling patterns", "defer/panic/recover", "slices",
    "pointers", "concurrency patterns",
  ],
  filePatterns: { config: "go.mod" },
};
```

**java.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const javaConfig: LanguageConfig = {
  id: "java",
  displayName: "Java",
  extensions: [".java"],
  treeSitter: {
    grammarPackage: "tree-sitter-java",
    wasmFile: "tree-sitter-java.wasm",
    nodeTypes: {
      function: ["method_declaration", "constructor_declaration"],
      class: ["class_declaration", "interface_declaration", "enum_declaration"],
      import: ["import_declaration"],
      export: [],
      typeAnnotation: ["type_identifier"],
    },
  },
  concepts: [
    "generics", "annotations", "interfaces", "abstract classes",
    "streams API", "lambdas", "sealed classes", "records",
    "dependency injection", "checked exceptions",
  ],
  filePatterns: { config: "pom.xml", manifest: "build.gradle" },
};
```

**rust.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const rustConfig: LanguageConfig = {
  id: "rust",
  displayName: "Rust",
  extensions: [".rs"],
  treeSitter: {
    grammarPackage: "tree-sitter-rust",
    wasmFile: "tree-sitter-rust.wasm",
    nodeTypes: {
      function: ["function_item"],
      class: ["struct_item", "enum_item", "impl_item", "trait_item"],
      import: ["use_declaration"],
      export: [],
      typeAnnotation: ["type_identifier"],
    },
  },
  concepts: [
    "ownership", "borrowing", "lifetimes", "traits", "pattern matching",
    "enums with data", "error handling (Result/Option)", "macros",
    "async/await", "unsafe blocks", "generics", "closures",
  ],
  filePatterns: { config: "Cargo.toml" },
};
```

**cpp.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const cppConfig: LanguageConfig = {
  id: "cpp",
  displayName: "C/C++",
  extensions: [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx"],
  treeSitter: {
    grammarPackage: "tree-sitter-cpp",
    wasmFile: "tree-sitter-cpp.wasm",
    nodeTypes: {
      function: ["function_definition"],
      class: ["class_specifier", "struct_specifier"],
      import: ["preproc_include"],
      export: [],
      typeAnnotation: [],
    },
  },
  concepts: [
    "templates", "RAII", "smart pointers", "move semantics",
    "operator overloading", "virtual functions", "namespaces",
    "constexpr", "lambda expressions", "STL containers",
  ],
  filePatterns: { config: "CMakeLists.txt", manifest: "Makefile" },
};
```

**csharp.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const csharpConfig: LanguageConfig = {
  id: "csharp",
  displayName: "C#",
  extensions: [".cs"],
  treeSitter: {
    grammarPackage: "tree-sitter-c-sharp",
    wasmFile: "tree-sitter-c_sharp.wasm",
    nodeTypes: {
      function: ["method_declaration", "constructor_declaration"],
      class: ["class_declaration", "interface_declaration", "struct_declaration", "enum_declaration", "record_declaration"],
      import: ["using_directive"],
      export: [],
      typeAnnotation: ["type_identifier"],
    },
  },
  concepts: [
    "LINQ", "async/await", "generics", "properties",
    "delegates and events", "attributes", "nullable reference types",
    "pattern matching", "records", "dependency injection",
  ],
  filePatterns: { config: "*.csproj" },
};
```

**ruby.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const rubyConfig: LanguageConfig = {
  id: "ruby",
  displayName: "Ruby",
  extensions: [".rb", ".rake"],
  treeSitter: {
    grammarPackage: "tree-sitter-ruby",
    wasmFile: "tree-sitter-ruby.wasm",
    nodeTypes: {
      function: ["method"],
      class: ["class", "module"],
      import: ["call"],
      export: [],
      typeAnnotation: [],
    },
  },
  concepts: [
    "blocks and procs", "mixins", "metaprogramming", "duck typing",
    "DSLs", "monkey patching", "gems", "symbols",
    "method_missing", "open classes",
  ],
  filePatterns: { config: "Gemfile" },
};
```

**php.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const phpConfig: LanguageConfig = {
  id: "php",
  displayName: "PHP",
  extensions: [".php"],
  treeSitter: {
    grammarPackage: "tree-sitter-php",
    wasmFile: "tree-sitter-php.wasm",
    nodeTypes: {
      function: ["function_definition", "method_declaration"],
      class: ["class_declaration", "interface_declaration", "trait_declaration"],
      import: ["namespace_use_declaration"],
      export: [],
      typeAnnotation: ["type_list", "named_type"],
    },
  },
  concepts: [
    "namespaces", "traits", "type declarations", "attributes",
    "enums", "fibers", "closures", "magic methods",
    "dependency injection", "middleware",
  ],
  filePatterns: { config: "composer.json" },
};
```

**swift.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const swiftConfig: LanguageConfig = {
  id: "swift",
  displayName: "Swift",
  extensions: [".swift"],
  treeSitter: {
    grammarPackage: "tree-sitter-swift",
    wasmFile: "tree-sitter-swift.wasm",
    nodeTypes: {
      function: ["function_declaration", "init_declaration"],
      class: ["class_declaration", "struct_declaration", "protocol_declaration", "enum_declaration"],
      import: ["import_declaration"],
      export: [],
      typeAnnotation: ["type_annotation"],
    },
  },
  concepts: [
    "optionals", "protocols", "extensions", "generics",
    "closures", "property wrappers", "result builders",
    "actors", "structured concurrency", "value types vs reference types",
  ],
  filePatterns: { config: "Package.swift" },
};
```

**kotlin.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const kotlinConfig: LanguageConfig = {
  id: "kotlin",
  displayName: "Kotlin",
  extensions: [".kt", ".kts"],
  treeSitter: {
    grammarPackage: "tree-sitter-kotlin",
    wasmFile: "tree-sitter-kotlin.wasm",
    nodeTypes: {
      function: ["function_declaration"],
      class: ["class_declaration", "object_declaration", "interface_declaration"],
      import: ["import_header"],
      export: [],
      typeAnnotation: ["type_identifier"],
    },
  },
  concepts: [
    "coroutines", "data classes", "sealed classes", "extension functions",
    "null safety", "delegation", "DSL builders", "inline functions",
    "companion objects", "flow",
  ],
  filePatterns: { config: "build.gradle.kts" },
};
```

**javascript.ts:**
```typescript
import type { LanguageConfig } from "../types.js";

export const javascriptConfig: LanguageConfig = {
  id: "javascript",
  displayName: "JavaScript",
  extensions: [".js", ".mjs", ".cjs", ".jsx"],
  treeSitter: {
    grammarPackage: "tree-sitter-javascript",
    wasmFile: "tree-sitter-javascript.wasm",
    nodeTypes: {
      function: ["function_declaration"],
      class: ["class_declaration"],
      import: ["import_statement"],
      export: ["export_statement"],
      typeAnnotation: [],
    },
  },
  concepts: [
    "closures", "prototypes", "promises", "async/await",
    "event loop", "destructuring", "spread operator",
    "proxies", "generators", "modules (ESM/CJS)",
  ],
  filePatterns: { config: "package.json" },
};
```

**configs/index.ts:**
```typescript
import { typescriptConfig } from "./typescript.js";
import { javascriptConfig } from "./javascript.js";
import { pythonConfig } from "./python.js";
import { goConfig } from "./go.js";
import { javaConfig } from "./java.js";
import { rustConfig } from "./rust.js";
import { cppConfig } from "./cpp.js";
import { csharpConfig } from "./csharp.js";
import { rubyConfig } from "./ruby.js";
import { phpConfig } from "./php.js";
import { swiftConfig } from "./swift.js";
import { kotlinConfig } from "./kotlin.js";
import type { LanguageConfig } from "../types.js";

export const builtinConfigs: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  goConfig,
  javaConfig,
  rustConfig,
  cppConfig,
  csharpConfig,
  rubyConfig,
  phpConfig,
  swiftConfig,
  kotlinConfig,
];
```

**Step 4: Run test to verify it passes**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/languages/__tests__/configs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/configs/
git commit -m "feat: add 12 builtin language configs"
```

---

### Task 4: Create languages/index.ts barrel and export from core

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/index.ts`
- Modify: `understand-anything-plugin/packages/core/src/index.ts`

**Step 1: Create barrel export**

```typescript
// understand-anything-plugin/packages/core/src/languages/index.ts
export { LanguageRegistry } from "./registry.js";
export { LanguageConfigSchema } from "./types.js";
export type { LanguageConfig, TreeSitterConfig } from "./types.js";
export { builtinConfigs } from "./configs/index.js";
```

**Step 2: Add export to core index.ts**

Add to `understand-anything-plugin/packages/core/src/index.ts`:

```typescript
// Languages
export { LanguageRegistry, builtinConfigs, LanguageConfigSchema } from "./languages/index.js";
export type { LanguageConfig, TreeSitterConfig } from "./languages/index.js";
```

**Step 3: Build and verify**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/index.ts understand-anything-plugin/packages/core/src/index.ts
git commit -m "feat: export language types and registry from core"
```

---

### Task 5: Install tree-sitter WASM grammar packages

**Files:**
- Modify: `understand-anything-plugin/packages/core/package.json`

**Step 1: Install new grammar packages**

Run:
```bash
cd understand-anything-plugin && pnpm --filter @understand-anything/core add \
  tree-sitter-python \
  tree-sitter-go \
  tree-sitter-java \
  tree-sitter-rust \
  tree-sitter-cpp \
  tree-sitter-c-sharp \
  tree-sitter-ruby \
  tree-sitter-php \
  tree-sitter-swift \
  tree-sitter-kotlin
```

Note: Some grammar packages may not ship `.wasm` files. For those, we need to check availability and potentially build from source or use the `tree-sitter` CLI to generate WASM. Verify each package after install:

```bash
cd understand-anything-plugin && for lang in python go java rust cpp c-sharp ruby php swift kotlin; do
  echo "=== tree-sitter-$lang ==="
  ls node_modules/tree-sitter-$lang/*.wasm 2>/dev/null || echo "NO WASM FOUND"
done
```

For packages without pre-built WASM, use `tree-sitter build --wasm` to compile them, or find alternative npm packages that ship WASM builds. Document which packages needed manual WASM generation.

**Step 2: Verify build still passes**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`
Expected: PASS

**Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/package.json understand-anything-plugin/pnpm-lock.yaml
git commit -m "feat: add tree-sitter grammar packages for 10 new languages"
```

---

### Task 6: Build GenericTreeSitterPlugin

**Files:**
- Create: `understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.ts`

**Step 1: Write the failing test**

Create: `understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { GenericTreeSitterPlugin } from "./generic-tree-sitter-plugin.js";
import { LanguageRegistry } from "../languages/registry.js";
import { typescriptConfig } from "../languages/configs/typescript.js";
import { javascriptConfig } from "../languages/configs/javascript.js";
import { pythonConfig } from "../languages/configs/python.js";

describe("GenericTreeSitterPlugin", () => {
  let plugin: GenericTreeSitterPlugin;

  beforeAll(async () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptConfig);
    registry.register(javascriptConfig);
    registry.register(pythonConfig);
    plugin = new GenericTreeSitterPlugin(registry);
    await plugin.init();
  });

  describe("TypeScript (migration parity)", () => {
    it("extracts function declarations", () => {
      const code = `
function greet(name: string): string {
  return "Hello " + name;
}
`;
      const result = plugin.analyzeFile("test.ts", code);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("greet");
    });

    it("extracts class declarations", () => {
      const code = `
class UserService {
  getName(): string { return "test"; }
}
`;
      const result = plugin.analyzeFile("test.ts", code);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
    });

    it("extracts imports", () => {
      const code = `import { readFile } from "fs";`;
      const result = plugin.analyzeFile("test.ts", code);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("fs");
    });

    it("extracts exports", () => {
      const code = `export function hello() {}`;
      const result = plugin.analyzeFile("test.ts", code);
      expect(result.exports.length).toBeGreaterThanOrEqual(1);
    });

    it("extracts arrow functions", () => {
      const code = `const add = (a: number, b: number): number => a + b;`;
      const result = plugin.analyzeFile("test.ts", code);
      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("add");
    });
  });

  describe("Python", () => {
    it("extracts function definitions", () => {
      const code = `
def greet(name):
    return f"Hello {name}"

def add(a, b):
    return a + b
`;
      const result = plugin.analyzeFile("test.py", code);
      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[1].name).toBe("add");
    });

    it("extracts class definitions", () => {
      const code = `
class UserService:
    def get_name(self):
        return "test"
`;
      const result = plugin.analyzeFile("test.py", code);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("UserService");
    });

    it("extracts import statements", () => {
      const code = `
import os
from pathlib import Path
from typing import Optional
`;
      const result = plugin.analyzeFile("test.py", code);
      expect(result.imports).toHaveLength(3);
    });
  });

  it("returns null for unsupported file extension", () => {
    expect(plugin.canAnalyze("test.unknown")).toBe(false);
  });

  it("reports all registered languages", () => {
    const langs = plugin.supportedLanguages();
    expect(langs).toContain("typescript");
    expect(langs).toContain("python");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/plugins/generic-tree-sitter-plugin.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.ts`:

This file implements a `GenericTreeSitterPlugin` that:
- Takes a `LanguageRegistry` in the constructor
- In `init()`, lazily loads WASM grammars per language using `require.resolve(config.treeSitter.grammarPackage + '/' + config.treeSitter.wasmFile)`
- In `analyzeFile()`, determines language from extension via registry, then walks the AST using `config.treeSitter.nodeTypes` to extract functions/classes/imports/exports
- Reuses the same helper patterns from the old `TreeSitterPlugin` (traverse, getStringValue, extractParams) but driven by config instead of hardcoded node types
- Implements `resolveImports()` and `extractCallGraph()` with the same logic as before

Key implementation notes:
- The `extractNodes()` method walks the AST and matches nodes against `nodeTypes.function`, `nodeTypes.class`, etc.
- For TS/JS, also handle `lexical_declaration`/`variable_declaration` with arrow function values (existing behavior)
- For import extraction, use the same `getStringValue()` approach but match against language-specific import node types
- For export extraction, same pattern matching against export node types
- Grammar loading: try `require.resolve()` first; if WASM not found, log warning and skip that language

**Step 4: Run test to verify it passes**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/plugins/generic-tree-sitter-plugin.test.ts`
Expected: PASS

**Step 5: Run old TreeSitterPlugin tests with new plugin to verify migration parity**

Ensure the existing `tree-sitter-plugin.test.ts` test cases also pass with `GenericTreeSitterPlugin` + TS/JS configs.

**Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.ts
git add understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.test.ts
git commit -m "feat: add GenericTreeSitterPlugin driven by LanguageConfig"
```

---

### Task 7: Add per-language test fixtures for remaining languages

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.test.ts`

**Step 1: Add test cases for Go, Java, Rust, C++, C#, Ruby, PHP, Swift, Kotlin**

For each language, add a `describe` block with a small fixture testing function/class/import extraction. Example for Go:

```typescript
describe("Go", () => {
  it("extracts function declarations", () => {
    const code = `
package main

func greet(name string) string {
    return "Hello " + name
}
`;
    const result = plugin.analyzeFile("test.go", code);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("greet");
  });

  it("extracts type declarations", () => {
    const code = `
package main

type UserService struct {
    Name string
}
`;
    const result = plugin.analyzeFile("test.go", code);
    expect(result.classes).toHaveLength(1);
  });

  it("extracts imports", () => {
    const code = `
package main

import (
    "fmt"
    "os"
)
`;
    const result = plugin.analyzeFile("test.go", code);
    expect(result.imports).toHaveLength(2);
  });
});
```

Follow same pattern for each language with appropriate syntax. Each test uses ~10-20 lines of idiomatic code.

Note: Some WASM grammars may not be available. For languages where the grammar fails to load, register them in the `beforeAll` with a try/catch and use `it.skipIf()` to conditionally skip tests. This prevents CI failures while still testing what's available.

**Step 2: Run all tests**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/plugins/generic-tree-sitter-plugin.test.ts`
Expected: PASS for all languages with available grammars

**Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/generic-tree-sitter-plugin.test.ts
git commit -m "test: add per-language fixtures for GenericTreeSitterPlugin"
```

---

### Task 8: Replace TreeSitterPlugin with GenericTreeSitterPlugin

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Modify: `understand-anything-plugin/packages/core/src/plugins/registry.ts`
- Delete: `understand-anything-plugin/packages/core/src/plugins/tree-sitter-plugin.ts` (after confirming no other imports)

**Step 1: Update core exports**

In `understand-anything-plugin/packages/core/src/index.ts`:
- Replace `export { TreeSitterPlugin }` with `export { GenericTreeSitterPlugin }`
- Also export `GenericTreeSitterPlugin` as `TreeSitterPlugin` for backward compat if needed (check consumers)

**Step 2: Update PluginRegistry extension map**

In `understand-anything-plugin/packages/core/src/plugins/registry.ts`:
- The `EXTENSION_TO_LANGUAGE` map is already comprehensive (has py, go, rs, etc.)
- No changes needed here — the registry just dispatches to whatever plugin is registered

**Step 3: Update all imports in skill source**

Search for all imports of `TreeSitterPlugin` across the codebase:

Run: `grep -r "TreeSitterPlugin" understand-anything-plugin/`

Update each import to use `GenericTreeSitterPlugin`. The main consumers are:
- `understand-anything-plugin/packages/core/src/index.ts`
- Any skill source files that instantiate the plugin

**Step 4: Delete old TreeSitterPlugin**

Once all imports are updated and tests pass:

Run: `rm understand-anything-plugin/packages/core/src/plugins/tree-sitter-plugin.ts`

Keep the old test file temporarily — rename it to verify parity.

**Step 5: Run full test suite**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: replace TreeSitterPlugin with GenericTreeSitterPlugin"
```

---

### Task 9: Update language-lesson.ts to use LanguageRegistry

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/analyzer/language-lesson.ts`
- Modify: `understand-anything-plugin/packages/core/src/__tests__/language-lesson.test.ts`

**Step 1: Update the test**

Update `language-lesson.test.ts` to verify concepts come from the registry:

```typescript
it("detects concepts from language config", () => {
  const node = {
    ...sampleNode,
    summary: "Uses decorators and async/await with generators",
    tags: ["decorators"],
  };
  const concepts = detectLanguageConcepts(node, "python");
  expect(concepts).toContain("decorators");
  expect(concepts).toContain("async/await");
});
```

**Step 2: Run test to verify it fails (or passes with old behavior)**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/language-lesson.test.ts`

**Step 3: Update implementation**

In `language-lesson.ts`:
- Import `LanguageRegistry` and `builtinConfigs`
- Create a module-level registry instance, pre-populated with builtinConfigs
- Replace `LANGUAGE_DISPLAY_NAMES` lookups with `registry.getById(lang)?.displayName`
- Replace hardcoded `CONCEPT_PATTERNS` with `registry.getById(lang)?.concepts` merged with generic patterns (async/await, error handling, etc. that apply to all languages)
- Keep the detection logic (search tags/summary for concept keywords) but source keywords from the config

**Step 4: Run test to verify it passes**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test -- --run src/__tests__/language-lesson.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/analyzer/language-lesson.ts
git add understand-anything-plugin/packages/core/src/__tests__/language-lesson.test.ts
git commit -m "refactor: source language concepts from LanguageRegistry"
```

---

### Task 10: Create language prompt snippet files

**Files:**
- Create: `understand-anything-plugin/skills/understand/languages/typescript.md`
- Create: `understand-anything-plugin/skills/understand/languages/javascript.md`
- Create: `understand-anything-plugin/skills/understand/languages/python.md`
- Create: `understand-anything-plugin/skills/understand/languages/go.md`
- Create: `understand-anything-plugin/skills/understand/languages/java.md`
- Create: `understand-anything-plugin/skills/understand/languages/rust.md`
- Create: `understand-anything-plugin/skills/understand/languages/cpp.md`
- Create: `understand-anything-plugin/skills/understand/languages/csharp.md`
- Create: `understand-anything-plugin/skills/understand/languages/ruby.md`
- Create: `understand-anything-plugin/skills/understand/languages/php.md`
- Create: `understand-anything-plugin/skills/understand/languages/swift.md`
- Create: `understand-anything-plugin/skills/understand/languages/kotlin.md`

**Step 1: Create all 12 language markdown files**

Each file follows this structure:

```markdown
# [Language Name]

## Key Concepts
- [5-10 language-specific concepts with brief explanations]

## Import Patterns
- [All common import syntax patterns for this language]

## Notable File Patterns
- [Special files like __init__.py, go.mod, Cargo.toml, etc.]

## Common Frameworks
- [Top 3-5 frameworks/libraries in this ecosystem]

## Example Summary Style
> "[Example of how to summarize a function/class in this language's idiom]"
```

Each file should be 30-50 lines, with content specific to that language's ecosystem and idioms. The content should help the LLM produce better analysis by understanding language-specific patterns.

**Step 2: Verify files are well-formed**

Manually review each file for accuracy and completeness.

**Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand/languages/
git commit -m "feat: add language-specific prompt snippet files for 12 languages"
```

---

### Task 11: Make base prompts language-neutral with injection points

**Files:**
- Modify: `understand-anything-plugin/skills/understand/file-analyzer-prompt.md`
- Modify: `understand-anything-plugin/skills/understand/tour-builder-prompt.md`
- Modify: `understand-anything-plugin/skills/understand/project-scanner-prompt.md`

**Step 1: Update file-analyzer-prompt.md**

- Remove all TypeScript-specific examples (e.g., "TypeScript barrel file", type guard references)
- Replace TS-specific concept lists with generic placeholders
- Add injection point:

```markdown
## Language-Specific Guidance

{{LANGUAGE_CONTEXT}}
```

- Make the Phase 1 script detection language-aware (not just "Node.js recommended")

**Step 2: Update tour-builder-prompt.md**

- Remove TS-specific language lesson examples ("generics, discriminated unions, utility types")
- Replace with injection point for detected languages:

```markdown
## Language-Specific Concepts

{{LANGUAGE_CONTEXT}}
```

**Step 3: Update project-scanner-prompt.md**

- Remove `tsconfig.json` hardcoded check
- Make framework detection generic (inject detected languages' framework lists)
- Add multi-language section:

```markdown
## Detected Languages

{{LANGUAGE_CONTEXT}}
```

**Step 4: Verify prompts are well-formed**

Read each modified prompt to ensure it's coherent with injection points and no residual TS bias.

**Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/file-analyzer-prompt.md
git add understand-anything-plugin/skills/understand/tour-builder-prompt.md
git add understand-anything-plugin/skills/understand/project-scanner-prompt.md
git commit -m "refactor: make agent prompts language-neutral with injection points"
```

---

### Task 12: Implement prompt injection logic in skill source

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (the `/understand` skill definition)

**Step 1: Update the skill orchestration**

In the `/understand` skill (SKILL.md), update the agent dispatch logic:

- **Phase 0 (Pre-flight):** After scanning files, detect languages present and load corresponding `languages/*.md` files
- **Phase 2 (File Analyzer dispatch):** For each file batch, inject the matching language's `.md` content into the file-analyzer prompt's `{{LANGUAGE_CONTEXT}}` placeholder
- **Phase 4 (Architecture Analyzer):** Inject all detected languages' concepts
- **Phase 5 (Tour Builder):** Inject all detected languages' `.md` content into the `{{LANGUAGE_CONTEXT}}` placeholder
- **Phase 1 (Project Scanner):** Inject all detected languages' `.md` content

The injection logic:
1. Map file extensions to language IDs (reuse `LanguageRegistry.getByExtension()`)
2. Read the corresponding `languages/<id>.md` file
3. Replace `{{LANGUAGE_CONTEXT}}` in the base prompt with the file contents

For multi-language projects, concatenate all detected language files.

**Step 2: Verify by reading modified SKILL.md**

Ensure the orchestration flow includes language detection and prompt injection steps.

**Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat: add language detection and prompt injection to /understand skill"
```

---

### Task 13: Update old tree-sitter-plugin test to use GenericTreeSitterPlugin

**Files:**
- Modify or Delete: `understand-anything-plugin/packages/core/src/plugins/tree-sitter-plugin.test.ts`

**Step 1: Migrate or delete**

If the old `tree-sitter-plugin.test.ts` still exists:
- Either update it to import `GenericTreeSitterPlugin` and instantiate with a `LanguageRegistry` containing TS/JS configs
- Or delete it if all its test cases are covered in `generic-tree-sitter-plugin.test.ts`

Prefer deleting to avoid duplication.

**Step 2: Run full test suite**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "test: migrate old tree-sitter-plugin tests to generic plugin"
```

---

### Task 14: Build and lint verification

**Step 1: Build core**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core build`
Expected: PASS

**Step 2: Build skill package**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/skill build`
Expected: PASS

**Step 3: Build dashboard**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/dashboard build`
Expected: PASS (dashboard doesn't import language modules directly)

**Step 4: Run lint**

Run: `cd understand-anything-plugin && pnpm lint`
Expected: PASS (or fix any lint issues)

**Step 5: Run all tests**

Run: `cd understand-anything-plugin && pnpm --filter @understand-anything/core test && pnpm --filter @understand-anything/skill test`
Expected: ALL PASS

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build and lint issues from language-agnostic refactor"
```

---

### Task 15: Update CLAUDE.md and documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (if it exists and mentions TS-only support)

**Step 1: Update CLAUDE.md**

Add to the Architecture section:
- Mention the `languages/` directories (both in core and skills)
- Document how to add a new language (create config + prompt snippet)
- List supported languages

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with language-agnostic architecture"
```

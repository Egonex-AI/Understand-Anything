# Language-Specific Extractor Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Decouple AST extraction logic from TS/JS-specific node types so 8 additional code languages (Python, Go, Rust, Java, Ruby, PHP, C/C++, C#) get tree-sitter-powered structural analysis. Swift and Kotlin are excluded — no WASM grammar packages available. (2) Replace the file-analyzer agent's ad-hoc regex script generation with a deterministic, pre-built tree-sitter extraction script.

**Architecture:** Introduce a `LanguageExtractor` interface that each language implements. `TreeSitterPlugin` delegates extraction to the registered extractor for the file's language. A bundled `extract-structure.mjs` script in `skills/understand/` uses `PluginRegistry` (which includes both `TreeSitterPlugin` and the non-code parsers) to provide deterministic structural extraction for the file-analyzer agent — replacing the current approach where the LLM writes throwaway regex scripts every run.

**Tech Stack:** web-tree-sitter (WASM), TypeScript, Vitest

---

## File Structure

```
packages/core/src/plugins/
├── extractors/
│   ├── types.ts              # LanguageExtractor interface + TreeSitterNode re-export
│   ├── base-extractor.ts     # Shared utilities (traverse, getStringValue)
│   ├── typescript-extractor.ts  # TS/JS (moved from tree-sitter-plugin.ts)
│   ├── python-extractor.ts
│   ├── go-extractor.ts
│   ├── rust-extractor.ts
│   ├── java-extractor.ts
│   ├── ruby-extractor.ts
│   ├── php-extractor.ts
│   ├── cpp-extractor.ts
│   ├── csharp-extractor.ts
│   └── index.ts              # builtinExtractors array + re-exports
├── tree-sitter-plugin.ts     # Refactored to use extractors
└── tree-sitter-plugin.test.ts  # Existing tests (should still pass)

packages/core/src/plugins/__tests__/
└── extractors.test.ts        # Tests for all new extractors

skills/understand/
├── extract-structure.mjs     # Pre-built tree-sitter extraction script (NEW)
└── SKILL.md                  # Updated to reference extract-structure.mjs

agents/
└── file-analyzer.md          # Phase 1 rewritten to execute pre-built script
```

---

### Task 1: Create LanguageExtractor interface and shared utilities

**Files:**
- Create: `packages/core/src/plugins/extractors/types.ts`
- Create: `packages/core/src/plugins/extractors/base-extractor.ts`

- [ ] **Step 1: Create the extractor interface**

```typescript
// packages/core/src/plugins/extractors/types.ts
import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";

// Re-export the tree-sitter Node type for use by extractors
export type TreeSitterNode = import("web-tree-sitter").Node;

/**
 * Language-specific extractor that maps a tree-sitter AST
 * to the common StructuralAnalysis / CallGraphEntry types.
 */
export interface LanguageExtractor {
  /** Language IDs this extractor handles (must match LanguageConfig.id) */
  languageIds: string[];

  /** Extract functions, classes, imports, exports from the root AST node */
  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis;

  /** Extract caller→callee relationships from the root AST node */
  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[];
}
```

- [ ] **Step 2: Create base-extractor with shared utilities**

Move `traverse()` and `getStringValue()` from `tree-sitter-plugin.ts` into a shared module:

```typescript
// packages/core/src/plugins/extractors/base-extractor.ts
import type { TreeSitterNode } from "./types.js";

/** Recursively traverse an AST tree, calling the visitor for each node. */
export function traverse(
  node: TreeSitterNode,
  visitor: (node: TreeSitterNode) => void,
): void {
  visitor(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) traverse(child, visitor);
  }
}

/** Extract the unquoted string value from a string-like node. */
export function getStringValue(node: TreeSitterNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === "string_fragment") {
      return child.text;
    }
  }
  return node.text.replace(/^['"`]|['"`]$/g, "");
}

/** Find the first child matching a type. */
export function findChild(node: TreeSitterNode, type: string): TreeSitterNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return child;
  }
  return null;
}

/** Find all children matching a type. */
export function findChildren(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const result: TreeSitterNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) result.push(child);
  }
  return result;
}

/** Check if a node has a child of the given type (used for export/visibility checks). */
export function hasChildOfType(node: TreeSitterNode, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === type) return true;
  }
  return false;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/extractors/types.ts packages/core/src/plugins/extractors/base-extractor.ts
git commit -m "feat: add LanguageExtractor interface and shared base utilities"
```

---

### Task 2: Move TS/JS extraction logic into TypeScriptExtractor

**Files:**
- Create: `packages/core/src/plugins/extractors/typescript-extractor.ts`
- Modify: `packages/core/src/plugins/tree-sitter-plugin.ts`

This is a pure refactor. All existing tests must still pass with zero changes.

- [ ] **Step 1: Create TypeScriptExtractor**

Move all the TS/JS-specific extraction methods (`extractFunction`, `extractClass`, `extractVariableDeclarations`, `extractImport`, `processExportStatement`, `extractParams`, `extractReturnType`, `extractImportSpecifiers`, and the call graph walker) from `tree-sitter-plugin.ts` into `typescript-extractor.ts`, implementing the `LanguageExtractor` interface.

The `languageIds` should be `["typescript", "javascript"]`. Do NOT include `"tsx"` — it is a synthetic key internal to `TreeSitterPlugin` for grammar selection, not a `LanguageConfig.id`. The tsx→typescript mapping is handled in `getExtractor()` below.

- [ ] **Step 2: Refactor TreeSitterPlugin to use extractors**

Replace the hardcoded extraction logic in `TreeSitterPlugin` with extractor dispatch:

```typescript
// In TreeSitterPlugin
private extractors = new Map<string, LanguageExtractor>();

registerExtractor(extractor: LanguageExtractor): void {
  for (const id of extractor.languageIds) {
    this.extractors.set(id, extractor);
  }
}

private getExtractor(langKey: string): LanguageExtractor | null {
  // tsx is a synthetic grammar key — extraction logic is identical to typescript
  const key = langKey === "tsx" ? "typescript" : langKey;
  return this.extractors.get(key) ?? null;
}
```

The `analyzeFile()` method becomes:

```typescript
analyzeFile(filePath: string, content: string): StructuralAnalysis {
  const parser = this.getParser(filePath);
  if (!parser) return { functions: [], classes: [], imports: [], exports: [] };

  const tree = parser.parse(content);
  if (!tree) { parser.delete(); return { functions: [], classes: [], imports: [], exports: [] }; }

  const langKey = this.languageKeyFromPath(filePath);
  const extractor = langKey ? this.getExtractor(langKey) : null;

  let result: StructuralAnalysis;
  if (extractor) {
    result = extractor.extractStructure(tree.rootNode);
  } else {
    result = { functions: [], classes: [], imports: [], exports: [] };
  }

  tree.delete();
  parser.delete();
  return result;
}
```

The `extractCallGraph()` method follows the same pattern — parser lifecycle must be managed identically:

```typescript
extractCallGraph(filePath: string, content: string): CallGraphEntry[] {
  const parser = this.getParser(filePath);
  if (!parser) return [];

  const tree = parser.parse(content);
  if (!tree) { parser.delete(); return []; }

  const langKey = this.languageKeyFromPath(filePath);
  const extractor = langKey ? this.getExtractor(langKey) : null;
  const result = extractor ? extractor.extractCallGraph(tree.rootNode) : [];

  tree.delete();
  parser.delete();
  return result;
}
```

The constructor should accept an optional `extractors` array and register them. If none provided, register the built-in `TypeScriptExtractor` for backward compatibility.

- [ ] **Step 3: Run existing tests to verify zero behavior change**

Run: `pnpm --filter @understand-anything/core test`
Expected: All 426 tests pass (identical to before)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/plugins/extractors/typescript-extractor.ts packages/core/src/plugins/tree-sitter-plugin.ts
git commit -m "refactor: move TS/JS extraction logic to TypeScriptExtractor, dispatch via LanguageExtractor interface"
```

---

### Task 2.5: Add extractCallGraph to PluginRegistry and update DEFAULT_PLUGIN_CONFIG

**Files:**
- Modify: `packages/core/src/plugins/registry.ts`
- Modify: `packages/core/src/plugins/discovery.ts`

**Context:** `PluginRegistry` currently only exposes `analyzeFile` and `resolveImports` — it has no `extractCallGraph`. The `extract-structure.mjs` script (Task 13) needs call graph data through the registry. Also, `DEFAULT_PLUGIN_CONFIG` hardcodes `["typescript", "javascript"]` which needs to reflect all supported languages.

- [ ] **Step 1: Add extractCallGraph to PluginRegistry**

```typescript
// In PluginRegistry (registry.ts)
extractCallGraph(filePath: string, content: string): CallGraphEntry[] | null {
  const plugin = this.getPluginForFile(filePath);
  if (!plugin?.extractCallGraph) return null;
  return plugin.extractCallGraph(filePath, content);
}
```

- [ ] **Step 2: Update DEFAULT_PLUGIN_CONFIG to derive languages dynamically**

In `discovery.ts`, replace the hardcoded `["typescript", "javascript"]` with a dynamic derivation from `builtinLanguageConfigs`:

```typescript
import { builtinLanguageConfigs } from "../languages/configs/index.js";

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  plugins: [
    {
      name: "tree-sitter",
      enabled: true,
      languages: builtinLanguageConfigs
        .filter((c) => c.treeSitter)
        .map((c) => c.id),
    },
  ],
};
```

- [ ] **Step 3: Run tests, commit**

```bash
pnpm --filter @understand-anything/core test
git add packages/core/src/plugins/registry.ts packages/core/src/plugins/discovery.ts
git commit -m "feat: add extractCallGraph to PluginRegistry, derive DEFAULT_PLUGIN_CONFIG from configs"
```

---

### Task 3: Add npm dependencies and treeSitter configs for all 10 languages

**Files:**
- Modify: `packages/core/package.json` (add 8 deps: python, go, rust, java, ruby, php, cpp, c-sharp)
- Modify: 10 config files in `packages/core/src/languages/configs/`

- [ ] **Step 1: Add tree-sitter grammar dependencies to package.json**

Add to `dependencies`:

```json
"tree-sitter-c-sharp": "^0.23.1",
"tree-sitter-cpp": "^0.23.4",
"tree-sitter-go": "^0.25.0",
"tree-sitter-java": "^0.23.5",
"tree-sitter-php": "^0.23.11",
"tree-sitter-python": "^0.25.0",
"tree-sitter-ruby": "^0.23.1",
"tree-sitter-rust": "^0.24.0"
```

Then run `pnpm install`.

- [ ] **Step 2: Add treeSitter field to all 10 language configs**

Each config gets a `treeSitter` block. Examples:

```typescript
// python.ts
treeSitter: { wasmPackage: "tree-sitter-python", wasmFile: "tree-sitter-python.wasm" },

// go.ts
treeSitter: { wasmPackage: "tree-sitter-go", wasmFile: "tree-sitter-go.wasm" },

// rust.ts
treeSitter: { wasmPackage: "tree-sitter-rust", wasmFile: "tree-sitter-rust.wasm" },

// java.ts
treeSitter: { wasmPackage: "tree-sitter-java", wasmFile: "tree-sitter-java.wasm" },

// ruby.ts
treeSitter: { wasmPackage: "tree-sitter-ruby", wasmFile: "tree-sitter-ruby.wasm" },

// php.ts
treeSitter: { wasmPackage: "tree-sitter-php", wasmFile: "tree-sitter-php.wasm" },

// cpp.ts
treeSitter: { wasmPackage: "tree-sitter-cpp", wasmFile: "tree-sitter-cpp.wasm" },

// csharp.ts
treeSitter: { wasmPackage: "tree-sitter-c-sharp", wasmFile: "tree-sitter-c_sharp.wasm" },
```

Note: Swift and Kotlin configs are NOT changed (no WASM packages available).

- [ ] **Step 3: Run pnpm install and verify WASM files resolve**

```bash
pnpm install
node -e "const r=require('module').createRequire(import.meta.url??__filename); console.log(r.resolve('tree-sitter-python/tree-sitter-python.wasm'))"
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/languages/configs/
git commit -m "feat: add tree-sitter grammar deps and treeSitter configs for 10 languages"
```

---

### Task 4: Create Python extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/python-extractor.ts`

- [ ] **Step 1: Write the Python extractor**

Key Python tree-sitter node types:
- Functions: `function_definition` (name, parameters, return_type)
- Classes: `class_definition` (name, body → methods + assignments as properties)
- Imports: `import_statement`, `import_from_statement`
- Decorated: `decorated_definition` wrapping function_definition or class_definition
- Calls: `call` (function field)
- No formal exports (all top-level names are "exported")

```typescript
languageIds: ["python"]
```

- [ ] **Step 2: Write tests for Python extractor**

Test with representative Python code:

```python
import os
from pathlib import Path
from typing import Optional

class DataProcessor:
    name: str
    
    def __init__(self, name: str):
        self.name = name
    
    def process(self, data: list) -> dict:
        return transform(data)

def helper(x: int) -> str:
    return str(x)

@decorator
def decorated_func():
    pass
```

Verify: 2 functions (helper, decorated_func), 1 class (DataProcessor with methods __init__/process and property name), 3 imports, call graph (process→transform).

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @understand-anything/core test`

- [ ] **Step 4: Commit**

---

### Task 5: Create Go extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/go-extractor.ts`

- [ ] **Step 1: Write the Go extractor**

Key Go tree-sitter node types:
- Functions: `function_declaration` (name, parameter_list, result)
- Methods: `method_declaration` (receiver, name, parameter_list, result)
- Structs: `type_declaration` → `type_spec` → `struct_type`
- Interfaces: `type_declaration` → `type_spec` → `interface_type`
- Imports: `import_declaration` → `import_spec_list` → `import_spec`
- Exports: capitalized first letter of name
- Calls: `call_expression` (function field)

```typescript
languageIds: ["go"]
```

- [ ] **Step 2: Write tests**

Test with:
```go
package main

import (
    "fmt"
    "os"
)

type Server struct {
    Host string
    Port int
}

func (s *Server) Start() error {
    fmt.Println("starting")
    return nil
}

func NewServer(host string, port int) *Server {
    return &Server{Host: host, Port: port}
}
```

Verify: 2 functions (Start, NewServer), 1 class/struct (Server with method Start, properties Host/Port), 2 imports, exports (Server, Start, NewServer — all capitalized), call graph (Start→fmt.Println).

- [ ] **Step 3: Run tests and commit**

---

### Task 6: Create Rust extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/rust-extractor.ts`

- [ ] **Step 1: Write the Rust extractor**

Key Rust tree-sitter node types:
- Functions: `function_item` (name, parameters, return_type via `->`)
- Structs: `struct_item` (name, field_declaration_list)
- Enums: `enum_item`
- Impl blocks: `impl_item` (type, body containing function_items)
- Traits: `trait_item`
- Imports: `use_declaration` (scoped_identifier, use_list, use_wildcard)
- Exports: `visibility_modifier` containing `pub`
- Calls: `call_expression` (function field)

```typescript
languageIds: ["rust"]
```

- [ ] **Step 2: Write tests**

Test with:
```rust
use std::collections::HashMap;
use std::io::{self, Read};

pub struct Config {
    name: String,
    port: u16,
}

impl Config {
    pub fn new(name: String, port: u16) -> Self {
        Config { name, port }
    }

    fn validate(&self) -> bool {
        check_port(self.port)
    }
}

pub fn check_port(port: u16) -> bool {
    port > 0
}
```

Verify: 3 functions (new, validate, check_port), 1 class/struct (Config with methods new/validate, properties name/port), 2 imports, exports (Config, new, check_port — those with `pub`), call graph (validate→check_port).

- [ ] **Step 3: Run tests and commit**

---

### Task 7: Create Java extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/java-extractor.ts`

- [ ] **Step 1: Write the Java extractor**

Key Java tree-sitter node types:
- Methods: `method_declaration` (name, formal_parameters, type/dimensions)
- Constructors: `constructor_declaration` (name, formal_parameters)
- Classes: `class_declaration` (name, class_body)
- Interfaces: `interface_declaration`
- Fields: `field_declaration` (declarator → variable_declarator → identifier)
- Imports: `import_declaration` (scoped_identifier)
- Exports: `public` modifier (modifiers node)
- Calls: `method_invocation` (name, object, arguments)

```typescript
languageIds: ["java"]
```

- [ ] **Step 2: Write tests with representative Java code, run, commit**

---

### Task 8: Create Ruby extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/ruby-extractor.ts`

- [ ] **Step 1: Write the Ruby extractor**

Key Ruby tree-sitter node types:
- Methods: `method` (name, parameters)
- Classes: `class` (name, body containing methods)
- Modules: `module` (name)
- Imports: `call` where method is `require` or `require_relative` (Ruby uses method calls for imports)
- Calls: `call` (method, receiver, arguments)
- No formal export syntax

```typescript
languageIds: ["ruby"]
```

- [ ] **Step 2: Write tests, run, commit**

---

### Task 9: Create PHP extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/php-extractor.ts`

- [ ] **Step 1: Write the PHP extractor**

Key PHP tree-sitter node types:
- Functions: `function_definition` (name, formal_parameters, return_type)
- Methods: `method_declaration` (name, formal_parameters, return_type)
- Classes: `class_declaration` (name, declaration_list)
- Imports: `namespace_use_declaration` (namespace_use_clause)
- Calls: `function_call_expression` / `member_call_expression`
- Note: PHP tree wraps everything in a `program` → `php_tag` + statements

```typescript
languageIds: ["php"]
```

- [ ] **Step 2: Write tests, run, commit**

---

### Task 10: Create C/C++ extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/cpp-extractor.ts`

- [ ] **Step 1: Write the C/C++ extractor**

Key C/C++ tree-sitter node types:
- Functions: `function_definition` (declarator → function_declarator → identifier + parameter_list)
- Classes: `class_specifier` (name, body → field_declaration_list)
- Structs: `struct_specifier` (name, body)
- Includes: `preproc_include` (path → string_literal or system_lib_string)
- Namespaces: `namespace_definition`
- Calls: `call_expression` (function, arguments)

Note: C/C++ function signatures are nested (the name is inside a `function_declarator` inside the `declarator` field).

The `cppConfig` has `id: "cpp"` and `extensions: [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx"]`. Pure C files (`.c`, `.h`) are parsed with the C++ grammar, which works but won't produce C++-specific node types like `class_specifier`. The extractor must handle their absence gracefully (return empty arrays for classes when parsing pure C).

```typescript
languageIds: ["cpp"]
```

- [ ] **Step 2: Write tests for both C++ and pure C code, run, commit**

---

### Task 11: Create C# extractor

**Files:**
- Create: `packages/core/src/plugins/extractors/csharp-extractor.ts`

- [ ] **Step 1: Write the C# extractor**

Key C# tree-sitter node types:
- Methods: `method_declaration` (name, parameter_list, return type)
- Constructors: `constructor_declaration`
- Classes: `class_declaration` (name, declaration_list)
- Interfaces: `interface_declaration`
- Properties: `property_declaration` (name, type)
- Imports: `using_directive` (qualified_name)
- Calls: `invocation_expression` (identifier/member_access, argument_list)

```typescript
languageIds: ["csharp"]
```

- [ ] **Step 2: Write tests, run, commit**

---

### Task 12: Create extractor index and wire into TreeSitterPlugin

**Files:**
- Create: `packages/core/src/plugins/extractors/index.ts`
- Modify: `packages/core/src/plugins/tree-sitter-plugin.ts` (import builtinExtractors)

- [ ] **Step 1: Create index.ts exporting all extractors**

```typescript
// packages/core/src/plugins/extractors/index.ts
export type { LanguageExtractor, TreeSitterNode } from "./types.js";
export { traverse, getStringValue, findChild, findChildren, hasChildOfType } from "./base-extractor.js";
export { TypeScriptExtractor } from "./typescript-extractor.js";
export { PythonExtractor } from "./python-extractor.js";
export { GoExtractor } from "./go-extractor.js";
export { RustExtractor } from "./rust-extractor.js";
export { JavaExtractor } from "./java-extractor.js";
export { RubyExtractor } from "./ruby-extractor.js";
export { PhpExtractor } from "./php-extractor.js";
export { CppExtractor } from "./cpp-extractor.js";
export { CSharpExtractor } from "./csharp-extractor.js";

import type { LanguageExtractor } from "./types.js";
import { TypeScriptExtractor } from "./typescript-extractor.js";
import { PythonExtractor } from "./python-extractor.js";
import { GoExtractor } from "./go-extractor.js";
import { RustExtractor } from "./rust-extractor.js";
import { JavaExtractor } from "./java-extractor.js";
import { RubyExtractor } from "./ruby-extractor.js";
import { PhpExtractor } from "./php-extractor.js";
import { CppExtractor } from "./cpp-extractor.js";
import { CSharpExtractor } from "./csharp-extractor.js";

export const builtinExtractors: LanguageExtractor[] = [
  new TypeScriptExtractor(),
  new PythonExtractor(),
  new GoExtractor(),
  new RustExtractor(),
  new JavaExtractor(),
  new RubyExtractor(),
  new PhpExtractor(),
  new CppExtractor(),
  new CSharpExtractor(),
];
```

- [ ] **Step 2: Wire builtinExtractors into TreeSitterPlugin constructor**

When no extractors are provided, default to `builtinExtractors`.

- [ ] **Step 3: Run full test suite**

Run: `pnpm --filter @understand-anything/core test`
Expected: All tests pass (existing + new extractor tests)

- [ ] **Step 4: Commit**

---

### Task 13: Create bundled extract-structure.mjs script

**Files:**
- Create: `skills/understand/extract-structure.mjs`

**Context:** Currently the file-analyzer agent (Phase 1) instructs the LLM to write a throwaway regex-based Node.js/Python script every run. This is slow, non-deterministic, and ignores the tree-sitter infrastructure we just built. This task replaces that with a pre-built script that uses `PluginRegistry` (which routes to `TreeSitterPlugin` for code files and to the regex parsers for non-code files).

- [ ] **Step 1: Create extract-structure.mjs**

The script:
1. Accepts input JSON path (arg 1) and output JSON path (arg 2)
2. Input format matches what file-analyzer.md already specifies: `{ projectRoot, batchFiles: [{path, language, sizeLines, fileCategory}], batchImportData }`
3. Resolves `@understand-anything/core` from the plugin's own `node_modules` using `createRequire` relative to the script's own location (two directories up to plugin root)
4. Creates a `PluginRegistry` with `TreeSitterPlugin` (all builtin language configs) + all non-code parsers registered
5. For each file: reads content, calls `registry.analyzeFile()`, formats output to match the existing script output schema (functions, classes, exports, sections, definitions, services, etc.)
6. For code files with tree-sitter support: also extracts call graph via `plugin.extractCallGraph()`
7. For files where no plugin exists (Swift, Kotlin, unknown languages): outputs `{ path, language, fileCategory, totalLines, nonEmptyLines, metrics }` with empty structural data — the LLM agent handles these in Phase 2
8. Writes output JSON matching the existing `scriptCompleted/filesAnalyzed/filesSkipped/results` schema

Key resolution logic (with fallback for different install layouts):
```javascript
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(require.resolve('@understand-anything/core'));
} catch {
  // Fallback: direct path for installed plugin cache where pnpm symlinks may differ
  core = await import(resolve(pluginRoot, 'packages/core/dist/index.js'));
}
```

- [ ] **Step 2: Test the script locally**

Create a small test input JSON with a TS file, a Python file, and a YAML file. Run:
```bash
node skills/understand/extract-structure.mjs test-input.json test-output.json
```
Verify the output contains structural data for all three.

- [ ] **Step 3: Commit**

```bash
git add skills/understand/extract-structure.mjs
git commit -m "feat: add bundled tree-sitter extraction script for file-analyzer agent"
```

---

### Task 14: Rewrite file-analyzer.md Phase 1 to use bundled script

**Files:**
- Modify: `agents/file-analyzer.md`

**Context:** Phase 1 currently has ~150 lines instructing the agent to write a custom extraction script from scratch. Replace this with a short section that tells the agent to execute the pre-built `extract-structure.mjs` script.

- [ ] **Step 1: Replace Phase 1 in file-analyzer.md**

Delete the entire current Phase 1 (~150 lines of regex script generation instructions). Replace with:

1. Tell the agent to prepare the input JSON file (same format as before):
   ```bash
   cat > $PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<batchIndex>.json << 'ENDJSON'
   {
     "projectRoot": "<project-root>",
     "batchFiles": [<this batch's files including fileCategory>],
     "batchImportData": <batchImportData JSON>
   }
   ENDJSON
   ```

2. Execute the bundled script:
   ```bash
   node <SKILL_DIR>/extract-structure.mjs \
     $PROJECT_ROOT/.understand-anything/tmp/ua-file-analyzer-input-<batchIndex>.json \
     $PROJECT_ROOT/.understand-anything/tmp/ua-file-extract-results-<batchIndex>.json
   ```

3. If the script exits non-zero, read stderr, diagnose and report the error. Do NOT fall back to writing a manual script — the bundled script is the sole extraction path.

4. Keep the existing output format — Phase 2 (semantic analysis) is unchanged.

- [ ] **Step 2: Update SKILL.md to pass SKILL_DIR to file-analyzer dispatch**

In SKILL.md Phase 2, the file-analyzer dispatch prompt must include the skill directory path so the agent can locate `extract-structure.mjs`.

Add to the dispatch parameters:
```
> Skill directory (for bundled scripts): `<SKILL_DIR>`
```

This follows the established pattern — SKILL.md already passes `<SKILL_DIR>` for `merge-batch-graphs.py` (line 213) and `merge-subdomain-graphs.py` (line 44) using the same mechanism.

- [ ] **Step 3: Verify the file-analyzer output format is unchanged**

Phase 2 of file-analyzer.md should NOT need changes — it reads the same JSON structure from the script results. Verify the output schema from `extract-structure.mjs` matches what Phase 2 expects.

- [ ] **Step 4: Commit**

```bash
git add agents/file-analyzer.md skills/understand/SKILL.md
git commit -m "feat: file-analyzer uses bundled tree-sitter script instead of LLM-generated regex"
```

---

### Task 15: Final integration verification and cleanup

- [ ] **Step 1: Add exports to packages/core/src/index.ts**

This is required — `extract-structure.mjs` and external consumers need these exports:

```typescript
export type { LanguageExtractor } from "./plugins/extractors/types.js";
export { builtinExtractors } from "./plugins/extractors/index.js";
```

- [ ] **Step 2: Build the full package**

```bash
pnpm --filter @understand-anything/core build
```

- [ ] **Step 3: Run full test suite one final time**

```bash
pnpm --filter @understand-anything/core test
```

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat: complete language extractor architecture — 10 languages with tree-sitter support"
```

---

## Implementation Notes

**Test file convention:** Each language extractor gets its own test file at `packages/core/src/plugins/extractors/__tests__/<language>-extractor.test.ts`. This follows the existing pattern where `tree-sitter-plugin.test.ts` is co-located.

**Lazy grammar loading (future optimization):** The current `TreeSitterPlugin.init()` loads all grammar WASMs upfront via `Promise.all`. With 10 grammars (~12MB total WASM), this may cause noticeable init delay. A future improvement: load TS/JS eagerly (most common), defer others to first use. Not required for this PR — measure first.

**Fingerprint side effect:** `buildFingerprintStore` in `fingerprint.ts` uses `PluginRegistry.analyzeFile` internally. Once the new extractors are wired up, fingerprinting for Python/Go/Rust/etc. will automatically produce structural fingerprints instead of content-hash-only. No code changes needed — it happens for free.

**PHP grammar note:** `tree-sitter-php` ships both `tree-sitter-php.wasm` (full PHP + embedded HTML/CSS/JS) and `tree-sitter-php_only.wasm` (PHP only). We use `tree-sitter-php.wasm`. The PHP extractor should be robust to non-PHP AST nodes that appear when parsing files with embedded HTML templates.

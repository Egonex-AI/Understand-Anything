# Understand Anything — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundational MVP — a pnpm monorepo with a core analysis engine (LLM + tree-sitter), a `/understand` skill command, and a basic React dashboard with graph view and code viewer.

**Architecture:** Monorepo with 3 packages (core, skill, dashboard) sharing a knowledge graph JSON schema. The core package handles analysis and persistence. The skill invokes core and launches the dashboard. The dashboard reads the JSON and renders a multi-panel workspace.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, React 18, Vite, @xyflow/react (React Flow v12), @monaco-editor/react, Zustand, TailwindCSS, tree-sitter

---

## Task 1: Project Scaffolding — Monorepo Root

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.npmrc`

**Step 1: Create root package.json**

```json
{
  "name": "understand-anything",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.6.2",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest",
    "dev:dashboard": "pnpm --filter @understand-anything/dashboard dev",
    "lint": "eslint ."
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

**Step 3: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.understand-anything/
*.tsbuildinfo
.DS_Store
```

**Step 5: Create .npmrc**

```
shamefully-hoist=false
strict-peer-dependencies=false
```

**Step 6: Run pnpm install**

Run: `pnpm install`
Expected: lockfile created, no errors

**Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.json .gitignore .npmrc pnpm-lock.yaml
git commit -m "chore: scaffold monorepo root with pnpm workspaces"
```

---

## Task 2: Core Package — Scaffolding & Knowledge Graph Types

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/types.ts`

**Step 1: Create packages/core/package.json**

```json
{
  "name": "@understand-anything/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

**Step 2: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Create packages/core/src/types.ts**

This is the full Knowledge Graph type system from the design doc:

```typescript
// === Edge Types ===

export type EdgeType =
  // Structural
  | "imports"
  | "exports"
  | "contains"
  | "inherits"
  | "implements"
  // Behavioral
  | "calls"
  | "subscribes"
  | "publishes"
  | "middleware"
  // Data flow
  | "reads_from"
  | "writes_to"
  | "transforms"
  | "validates"
  // Dependencies
  | "depends_on"
  | "tested_by"
  | "configures"
  // Semantic
  | "related"
  | "similar_to";

// === Graph Node ===

export interface GraphNode {
  id: string;
  type: "file" | "function" | "class" | "module" | "concept";
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
}

// === Graph Edge ===

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number;
}

// === Layer ===

export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

// === Tour Step ===

export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// === Project Metadata ===

export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
}

// === Knowledge Graph (root) ===

export interface KnowledgeGraph {
  version: string;
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

// === Analysis Metadata ===

export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
}

// === Plugin Interface ===

export interface StructuralAnalysis {
  functions: Array<{
    name: string;
    lineRange: [number, number];
    params: string[];
    returnType?: string;
  }>;
  classes: Array<{
    name: string;
    lineRange: [number, number];
    methods: string[];
    properties: string[];
  }>;
  imports: Array<{
    source: string;
    specifiers: string[];
    lineNumber: number;
  }>;
  exports: Array<{
    name: string;
    lineNumber: number;
  }>;
}

export interface ImportResolution {
  source: string;
  resolvedPath: string;
  specifiers: string[];
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
}

export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
}
```

**Step 4: Create packages/core/src/index.ts**

```typescript
export * from "./types.js";
```

**Step 5: Run pnpm install and build**

Run: `cd /path/to/project && pnpm install && pnpm --filter @understand-anything/core build`
Expected: Compiles with no errors, `packages/core/dist/` created

**Step 6: Write a type validation test**

Create: `packages/core/src/types.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  ProjectMeta,
} from "./types.js";

describe("KnowledgeGraph types", () => {
  it("should create a valid empty knowledge graph", () => {
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test-project",
        languages: ["typescript"],
        frameworks: [],
        description: "A test project",
        analyzedAt: new Date().toISOString(),
        gitCommitHash: "abc123",
      },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    };

    expect(graph.version).toBe("1.0.0");
    expect(graph.nodes).toHaveLength(0);
  });

  it("should create valid graph nodes", () => {
    const node: GraphNode = {
      id: "node-1",
      type: "function",
      name: "handleLogin",
      filePath: "src/auth/login.ts",
      lineRange: [10, 25],
      summary: "Handles user login with email and password",
      tags: ["auth", "login", "api"],
      complexity: "moderate",
      languageNotes: "Uses async/await for API calls",
    };

    expect(node.type).toBe("function");
    expect(node.tags).toContain("auth");
  });

  it("should create valid graph edges", () => {
    const edge: GraphEdge = {
      source: "node-1",
      target: "node-2",
      type: "calls",
      direction: "forward",
      description: "handleLogin calls validateCredentials",
      weight: 0.8,
    };

    expect(edge.type).toBe("calls");
    expect(edge.weight).toBeGreaterThan(0);
    expect(edge.weight).toBeLessThanOrEqual(1);
  });
});
```

**Step 7: Run tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All 3 tests PASS

**Step 8: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add knowledge graph type system and validation tests"
```

---

## Task 3: Core Package — JSON Persistence

**Files:**
- Create: `packages/core/src/persistence/index.ts`
- Create: `packages/core/src/persistence/persistence.test.ts`

**Step 1: Write the failing test**

Create: `packages/core/src/persistence/persistence.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadGraph, saveGraph, loadMeta, saveMeta } from "./index.js";
import type { KnowledgeGraph, AnalysisMeta } from "../types.js";

describe("Persistence", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ua-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const makeGraph = (): KnowledgeGraph => ({
    version: "1.0.0",
    project: {
      name: "test",
      languages: ["typescript"],
      frameworks: [],
      description: "test project",
      analyzedAt: new Date().toISOString(),
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "n1",
        type: "file",
        name: "index.ts",
        summary: "Entry point",
        tags: ["entry"],
        complexity: "simple",
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  });

  it("saveGraph writes knowledge-graph.json", () => {
    const graph = makeGraph();
    saveGraph(testDir, graph);

    const filePath = join(testDir, ".understand-anything", "knowledge-graph.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("loadGraph reads back the saved graph", () => {
    const graph = makeGraph();
    saveGraph(testDir, graph);
    const loaded = loadGraph(testDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.project.name).toBe("test");
    expect(loaded!.nodes).toHaveLength(1);
  });

  it("loadGraph returns null when no graph exists", () => {
    const loaded = loadGraph(testDir);
    expect(loaded).toBeNull();
  });

  it("saveMeta writes meta.json", () => {
    const meta: AnalysisMeta = {
      lastAnalyzedAt: new Date().toISOString(),
      gitCommitHash: "abc123",
      version: "1.0.0",
      analyzedFiles: 5,
    };
    saveMeta(testDir, meta);

    const filePath = join(testDir, ".understand-anything", "meta.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("loadMeta reads back saved meta", () => {
    const meta: AnalysisMeta = {
      lastAnalyzedAt: new Date().toISOString(),
      gitCommitHash: "def456",
      version: "1.0.0",
      analyzedFiles: 10,
    };
    saveMeta(testDir, meta);
    const loaded = loadMeta(testDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.gitCommitHash).toBe("def456");
    expect(loaded!.analyzedFiles).toBe(10);
  });

  it("loadMeta returns null when no meta exists", () => {
    const loaded = loadMeta(testDir);
    expect(loaded).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test`
Expected: FAIL — module `./index.js` not found

**Step 3: Implement persistence module**

Create: `packages/core/src/persistence/index.ts`

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeGraph, AnalysisMeta } from "../types.js";

const UA_DIR = ".understand-anything";
const GRAPH_FILE = "knowledge-graph.json";
const META_FILE = "meta.json";

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, UA_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);
  const filePath = join(dir, GRAPH_FILE);
  writeFileSync(filePath, JSON.stringify(graph, null, 2), "utf-8");
}

export function loadGraph(projectRoot: string): KnowledgeGraph | null {
  const filePath = join(projectRoot, UA_DIR, GRAPH_FILE);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as KnowledgeGraph;
}

export function saveMeta(projectRoot: string, meta: AnalysisMeta): void {
  const dir = ensureDir(projectRoot);
  const filePath = join(dir, META_FILE);
  writeFileSync(filePath, JSON.stringify(meta, null, 2), "utf-8");
}

export function loadMeta(projectRoot: string): AnalysisMeta | null {
  const filePath = join(projectRoot, UA_DIR, META_FILE);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as AnalysisMeta;
}
```

**Step 4: Update packages/core/src/index.ts**

```typescript
export * from "./types.js";
export * from "./persistence/index.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All 6 persistence tests PASS + 3 type tests PASS = 9 total

**Step 6: Commit**

```bash
git add packages/core/src/persistence/ packages/core/src/index.ts
git commit -m "feat(core): add JSON persistence for knowledge graph and meta"
```

---

## Task 4: Core Package — Tree-sitter Analyzer Plugin

**Files:**
- Create: `packages/core/src/plugins/tree-sitter-plugin.ts`
- Create: `packages/core/src/plugins/tree-sitter-plugin.test.ts`

**Step 1: Install tree-sitter dependencies**

Run: `pnpm --filter @understand-anything/core add tree-sitter tree-sitter-javascript tree-sitter-typescript`
Expected: packages installed

**Step 2: Write the failing test**

Create: `packages/core/src/plugins/tree-sitter-plugin.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { TreeSitterPlugin } from "./tree-sitter-plugin.js";

describe("TreeSitterPlugin", () => {
  const plugin = new TreeSitterPlugin();

  describe("analyzeFile — TypeScript", () => {
    const tsCode = `
import { Request, Response } from "express";
import { db } from "../db/connection";

export function handleLogin(req: Request, res: Response): void {
  const { email, password } = req.body;
  validateCredentials(email, password);
}

function validateCredentials(email: string, password: string): boolean {
  return email.length > 0 && password.length > 0;
}

export class AuthService {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  verify(token: string): boolean {
    return token.length > 0;
  }

  refresh(token: string): string {
    return token;
  }
}
`;

    it("extracts function declarations", () => {
      const result = plugin.analyzeFile("src/auth.ts", tsCode);
      const funcNames = result.functions.map((f) => f.name);
      expect(funcNames).toContain("handleLogin");
      expect(funcNames).toContain("validateCredentials");
    });

    it("extracts class declarations with methods", () => {
      const result = plugin.analyzeFile("src/auth.ts", tsCode);
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("AuthService");
      expect(result.classes[0].methods).toContain("verify");
      expect(result.classes[0].methods).toContain("refresh");
    });

    it("extracts import statements", () => {
      const result = plugin.analyzeFile("src/auth.ts", tsCode);
      const sources = result.imports.map((i) => i.source);
      expect(sources).toContain("express");
      expect(sources).toContain("../db/connection");
    });

    it("extracts export names", () => {
      const result = plugin.analyzeFile("src/auth.ts", tsCode);
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("handleLogin");
      expect(exportNames).toContain("AuthService");
    });
  });

  describe("analyzeFile — JavaScript", () => {
    const jsCode = `
const express = require("express");

function middleware(req, res, next) {
  next();
}

module.exports = { middleware };
`;

    it("extracts functions from JavaScript", () => {
      const result = plugin.analyzeFile("src/app.js", jsCode);
      const funcNames = result.functions.map((f) => f.name);
      expect(funcNames).toContain("middleware");
    });
  });

  describe("resolveImports", () => {
    const code = `
import { foo } from "./utils";
import bar from "../lib/bar";
import * as path from "path";
`;

    it("resolves relative import paths", () => {
      const imports = plugin.resolveImports("src/index.ts", code);
      const paths = imports.map((i) => i.source);
      expect(paths).toContain("./utils");
      expect(paths).toContain("../lib/bar");
      expect(paths).toContain("path");
    });
  });

  describe("languages", () => {
    it("supports typescript and javascript", () => {
      expect(plugin.languages).toContain("typescript");
      expect(plugin.languages).toContain("javascript");
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test`
Expected: FAIL — module not found

**Step 4: Implement the tree-sitter plugin**

Create: `packages/core/src/plugins/tree-sitter-plugin.ts`

```typescript
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";
import type {
  AnalyzerPlugin,
  StructuralAnalysis,
  ImportResolution,
  CallGraphEntry,
} from "../types.js";

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

const jsParser = new Parser();
jsParser.setLanguage(JavaScript);

function getParser(filePath: string): Parser {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return tsParser;
  return jsParser;
}

function traverse(
  node: Parser.SyntaxNode,
  callback: (node: Parser.SyntaxNode) => void,
): void {
  callback(node);
  for (let i = 0; i < node.childCount; i++) {
    traverse(node.child(i)!, callback);
  }
}

export class TreeSitterPlugin implements AnalyzerPlugin {
  name = "tree-sitter";
  languages = ["typescript", "javascript"];

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    const parser = getParser(filePath);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    traverse(root, (node) => {
      // Function declarations
      if (
        node.type === "function_declaration" ||
        node.type === "function_signature"
      ) {
        const nameNode = node.childByFieldName("name");
        if (nameNode) {
          functions.push({
            name: nameNode.text,
            lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
            params: this.extractParams(node),
          });
        }
      }

      // Arrow functions assigned to variables
      if (
        node.type === "lexical_declaration" ||
        node.type === "variable_declaration"
      ) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === "variable_declarator") {
            const nameNode = child.childByFieldName("name");
            const valueNode = child.childByFieldName("value");
            if (nameNode && valueNode?.type === "arrow_function") {
              functions.push({
                name: nameNode.text,
                lineRange: [
                  node.startPosition.row + 1,
                  node.endPosition.row + 1,
                ],
                params: this.extractParams(valueNode),
              });
            }
          }
        }
      }

      // Class declarations
      if (node.type === "class_declaration") {
        const nameNode = node.childByFieldName("name");
        const bodyNode = node.childByFieldName("body");
        if (nameNode && bodyNode) {
          const methods: string[] = [];
          const properties: string[] = [];

          for (let i = 0; i < bodyNode.childCount; i++) {
            const member = bodyNode.child(i);
            if (member?.type === "method_definition") {
              const methodName = member.childByFieldName("name");
              if (methodName && methodName.text !== "constructor") {
                methods.push(methodName.text);
              }
            }
            if (
              member?.type === "public_field_definition" ||
              member?.type === "property_definition"
            ) {
              const propName = member.childByFieldName("name");
              if (propName) properties.push(propName.text);
            }
          }

          classes.push({
            name: nameNode.text,
            lineRange: [
              node.startPosition.row + 1,
              node.endPosition.row + 1,
            ],
            methods,
            properties,
          });
        }
      }

      // Import statements
      if (node.type === "import_statement") {
        const sourceNode = node.children.find(
          (c) => c.type === "string" || c.type === "string_fragment",
        );
        let source = "";
        if (sourceNode) {
          source = sourceNode.text.replace(/['"]/g, "");
        }
        // Try to find string_fragment inside string
        if (!source) {
          traverse(node, (child) => {
            if (child.type === "string_fragment" || child.type === "string_content") {
              source = child.text;
            }
          });
        }

        const specifiers: string[] = [];
        traverse(node, (child) => {
          if (child.type === "import_specifier") {
            const nameChild = child.childByFieldName("name");
            if (nameChild) specifiers.push(nameChild.text);
          }
          if (child.type === "identifier" && child.parent?.type === "import_clause") {
            specifiers.push(child.text);
          }
          if (child.type === "namespace_import") {
            const nameChild = child.children.find((c) => c.type === "identifier");
            if (nameChild) specifiers.push(`* as ${nameChild.text}`);
          }
        });

        if (source) {
          imports.push({
            source,
            specifiers,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }

      // Export statements
      if (node.type === "export_statement") {
        // export function / export class
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (
            child?.type === "function_declaration" ||
            child?.type === "class_declaration"
          ) {
            const nameNode = child.childByFieldName("name");
            if (nameNode) {
              exports.push({
                name: nameNode.text,
                lineNumber: node.startPosition.row + 1,
              });
            }
          }
          if (child?.type === "lexical_declaration") {
            traverse(child, (grandchild) => {
              if (grandchild.type === "variable_declarator") {
                const nameNode = grandchild.childByFieldName("name");
                if (nameNode) {
                  exports.push({
                    name: nameNode.text,
                    lineNumber: node.startPosition.row + 1,
                  });
                }
              }
            });
          }
        }
      }
    });

    return { functions, classes, imports, exports };
  }

  resolveImports(filePath: string, content: string): ImportResolution[] {
    const analysis = this.analyzeFile(filePath, content);
    return analysis.imports.map((imp) => ({
      source: imp.source,
      resolvedPath: imp.source, // Basic — full resolution needs fs access
      specifiers: imp.specifiers,
    }));
  }

  extractCallGraph(filePath: string, content: string): CallGraphEntry[] {
    const parser = getParser(filePath);
    const tree = parser.parse(content);
    const entries: CallGraphEntry[] = [];

    // Find all function scopes and call expressions within them
    const functionScopes: Array<{
      name: string;
      node: Parser.SyntaxNode;
    }> = [];

    traverse(tree.rootNode, (node) => {
      if (node.type === "function_declaration") {
        const nameNode = node.childByFieldName("name");
        if (nameNode) {
          functionScopes.push({ name: nameNode.text, node });
        }
      }
    });

    for (const scope of functionScopes) {
      traverse(scope.node, (node) => {
        if (node.type === "call_expression") {
          const funcNode = node.childByFieldName("function");
          if (funcNode) {
            const callee =
              funcNode.type === "member_expression"
                ? funcNode.text
                : funcNode.text;
            entries.push({
              caller: scope.name,
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      });
    }

    return entries;
  }

  private extractParams(node: Parser.SyntaxNode): string[] {
    const params: string[] = [];
    const paramsNode = node.childByFieldName("parameters");
    if (paramsNode) {
      for (let i = 0; i < paramsNode.childCount; i++) {
        const param = paramsNode.child(i);
        if (
          param &&
          param.type !== "," &&
          param.type !== "(" &&
          param.type !== ")"
        ) {
          const nameNode = param.childByFieldName("name") ||
            param.childByFieldName("pattern");
          if (nameNode) params.push(nameNode.text);
          else if (param.type === "identifier") params.push(param.text);
        }
      }
    }
    return params;
  }
}
```

**Step 5: Update packages/core/src/index.ts**

```typescript
export * from "./types.js";
export * from "./persistence/index.js";
export { TreeSitterPlugin } from "./plugins/tree-sitter-plugin.js";
```

**Step 6: Run tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All tree-sitter tests PASS. Some tests may need adjustment based on exact tree-sitter parse output — iterate until green.

**Step 7: Commit**

```bash
git add packages/core/src/plugins/ packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add tree-sitter analyzer plugin for TS/JS"
```

---

## Task 5: Core Package — LLM Analysis Engine

**Files:**
- Create: `packages/core/src/analyzer/llm-analyzer.ts`
- Create: `packages/core/src/analyzer/llm-analyzer.test.ts`
- Create: `packages/core/src/analyzer/graph-builder.ts`
- Create: `packages/core/src/analyzer/graph-builder.test.ts`

**Step 1: Write the graph builder test**

The graph builder takes structural analysis + LLM summaries and assembles a KnowledgeGraph.

Create: `packages/core/src/analyzer/graph-builder.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { GraphBuilder } from "./graph-builder.js";
import type { StructuralAnalysis } from "../types.js";

describe("GraphBuilder", () => {
  it("creates file nodes from file list", () => {
    const builder = new GraphBuilder("test-project", "abc123");

    builder.addFile("src/index.ts", {
      summary: "Application entry point",
      tags: ["entry", "main"],
      complexity: "simple" as const,
    });

    const graph = builder.build();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].type).toBe("file");
    expect(graph.nodes[0].name).toBe("index.ts");
    expect(graph.nodes[0].filePath).toBe("src/index.ts");
  });

  it("creates function nodes from structural analysis", () => {
    const builder = new GraphBuilder("test-project", "abc123");
    const analysis: StructuralAnalysis = {
      functions: [
        { name: "handleLogin", lineRange: [5, 15], params: ["req", "res"] },
      ],
      classes: [],
      imports: [],
      exports: [],
    };

    builder.addFileWithAnalysis("src/auth.ts", analysis, {
      summaries: { handleLogin: "Handles user login" },
      fileSummary: "Authentication module",
      tags: ["auth"],
      complexity: "moderate" as const,
    });

    const graph = builder.build();
    const funcNodes = graph.nodes.filter((n) => n.type === "function");
    expect(funcNodes).toHaveLength(1);
    expect(funcNodes[0].name).toBe("handleLogin");
    expect(funcNodes[0].summary).toBe("Handles user login");
  });

  it("creates contains edges between files and their functions", () => {
    const builder = new GraphBuilder("test-project", "abc123");
    const analysis: StructuralAnalysis = {
      functions: [
        { name: "foo", lineRange: [1, 5], params: [] },
      ],
      classes: [],
      imports: [],
      exports: [],
    };

    builder.addFileWithAnalysis("src/utils.ts", analysis, {
      summaries: { foo: "A utility function" },
      fileSummary: "Utility functions",
      tags: ["utils"],
      complexity: "simple" as const,
    });

    const graph = builder.build();
    const containsEdges = graph.edges.filter((e) => e.type === "contains");
    expect(containsEdges).toHaveLength(1);
    expect(containsEdges[0].direction).toBe("forward");
  });

  it("creates import edges from structural analysis", () => {
    const builder = new GraphBuilder("test-project", "abc123");

    builder.addFile("src/index.ts", {
      summary: "Entry",
      tags: [],
      complexity: "simple" as const,
    });
    builder.addFile("src/utils.ts", {
      summary: "Utils",
      tags: [],
      complexity: "simple" as const,
    });

    builder.addImportEdge("src/index.ts", "src/utils.ts");

    const graph = builder.build();
    const importEdges = graph.edges.filter((e) => e.type === "imports");
    expect(importEdges).toHaveLength(1);
  });

  it("sets project metadata correctly", () => {
    const builder = new GraphBuilder("my-project", "def456");
    const graph = builder.build();

    expect(graph.project.name).toBe("my-project");
    expect(graph.project.gitCommitHash).toBe("def456");
    expect(graph.version).toBe("1.0.0");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test`
Expected: FAIL — module not found

**Step 3: Implement GraphBuilder**

Create: `packages/core/src/analyzer/graph-builder.ts`

```typescript
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  StructuralAnalysis,
} from "../types.js";

interface FileMeta {
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
}

interface FileAnalysisMeta extends FileMeta {
  summaries: Record<string, string>; // function/class name -> summary
  fileSummary: string;
}

function fileId(filePath: string): string {
  return `file:${filePath}`;
}

function funcId(filePath: string, funcName: string): string {
  return `func:${filePath}:${funcName}`;
}

function classId(filePath: string, className: string): string {
  return `class:${filePath}:${className}`;
}

export class GraphBuilder {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private projectName: string;
  private gitHash: string;
  private languages: Set<string> = new Set();

  constructor(projectName: string, gitHash: string) {
    this.projectName = projectName;
    this.gitHash = gitHash;
  }

  addFile(filePath: string, meta: FileMeta): void {
    const ext = filePath.split(".").pop() || "";
    this.detectLanguage(ext);

    const name = filePath.split("/").pop() || filePath;
    this.nodes.push({
      id: fileId(filePath),
      type: "file",
      name,
      filePath,
      summary: meta.summary,
      tags: meta.tags,
      complexity: meta.complexity,
    });
  }

  addFileWithAnalysis(
    filePath: string,
    analysis: StructuralAnalysis,
    meta: FileAnalysisMeta,
  ): void {
    // Add the file node
    this.addFile(filePath, {
      summary: meta.fileSummary,
      tags: meta.tags,
      complexity: meta.complexity,
    });

    const fId = fileId(filePath);

    // Add function nodes
    for (const func of analysis.functions) {
      const id = funcId(filePath, func.name);
      this.nodes.push({
        id,
        type: "function",
        name: func.name,
        filePath,
        lineRange: func.lineRange,
        summary: meta.summaries[func.name] || `Function ${func.name}`,
        tags: meta.tags,
        complexity: meta.complexity,
      });

      // File contains function
      this.edges.push({
        source: fId,
        target: id,
        type: "contains",
        direction: "forward",
        weight: 1.0,
      });
    }

    // Add class nodes
    for (const cls of analysis.classes) {
      const id = classId(filePath, cls.name);
      this.nodes.push({
        id,
        type: "class",
        name: cls.name,
        filePath,
        lineRange: cls.lineRange,
        summary: meta.summaries[cls.name] || `Class ${cls.name}`,
        tags: meta.tags,
        complexity: meta.complexity,
      });

      // File contains class
      this.edges.push({
        source: fId,
        target: id,
        type: "contains",
        direction: "forward",
        weight: 1.0,
      });
    }
  }

  addImportEdge(fromFile: string, toFile: string): void {
    this.edges.push({
      source: fileId(fromFile),
      target: fileId(toFile),
      type: "imports",
      direction: "forward",
      weight: 0.7,
    });
  }

  addCallEdge(
    callerFile: string,
    callerFunc: string,
    calleeFile: string,
    calleeFunc: string,
  ): void {
    this.edges.push({
      source: funcId(callerFile, callerFunc),
      target: funcId(calleeFile, calleeFunc),
      type: "calls",
      direction: "forward",
      weight: 0.8,
    });
  }

  build(): KnowledgeGraph {
    return {
      version: "1.0.0",
      project: {
        name: this.projectName,
        languages: Array.from(this.languages),
        frameworks: [],
        description: "",
        analyzedAt: new Date().toISOString(),
        gitCommitHash: this.gitHash,
      },
      nodes: this.nodes,
      edges: this.edges,
      layers: [],
      tour: [],
    };
  }

  private detectLanguage(ext: string): void {
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      go: "go",
      rs: "rust",
      java: "java",
      c: "c",
      cpp: "cpp",
      h: "c",
    };
    if (langMap[ext]) this.languages.add(langMap[ext]);
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All GraphBuilder tests PASS

**Step 5: Create the LLM analyzer interface**

Create: `packages/core/src/analyzer/llm-analyzer.ts`

This defines the interface for LLM-based analysis. The actual LLM calls happen via the skill (which has access to the Claude session). The core package defines the prompts and expected response format.

```typescript
/**
 * LLM Analyzer — defines prompts and response parsing for LLM-based code analysis.
 *
 * The actual LLM invocation is handled by the caller (skill or dashboard with API key).
 * This module provides the prompt templates and response parsers.
 */

export interface LLMFileAnalysis {
  fileSummary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  functionSummaries: Record<string, string>;
  classSummaries: Record<string, string>;
  languageNotes?: string;
}

export interface LLMProjectSummary {
  description: string;
  frameworks: string[];
  layers: Array<{
    name: string;
    description: string;
    filePatterns: string[];
  }>;
}

/**
 * Generates the prompt for analyzing a single file.
 */
export function buildFileAnalysisPrompt(
  filePath: string,
  content: string,
  projectContext: string,
): string {
  return `You are analyzing a source code file as part of a codebase understanding tool.

Project context: ${projectContext}

File: ${filePath}

\`\`\`
${content}
\`\`\`

Analyze this file and respond with ONLY valid JSON (no markdown, no explanation):

{
  "fileSummary": "One-sentence plain-English description of what this file does",
  "tags": ["tag1", "tag2"],
  "complexity": "simple|moderate|complex",
  "functionSummaries": {
    "functionName": "What this function does in plain English"
  },
  "classSummaries": {
    "className": "What this class does in plain English"
  },
  "languageNotes": "Optional: any language-specific patterns worth noting for someone unfamiliar with this language"
}`;
}

/**
 * Generates the prompt for a project-level summary.
 */
export function buildProjectSummaryPrompt(
  fileList: string[],
  sampleFiles: Array<{ path: string; content: string }>,
): string {
  const fileListStr = fileList.map((f) => `  - ${f}`).join("\n");
  const sampleStr = sampleFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 500)}\n\`\`\``)
    .join("\n\n");

  return `You are analyzing a software project to generate a high-level understanding.

File list:
${fileListStr}

Sample files:
${sampleStr}

Analyze this project and respond with ONLY valid JSON:

{
  "description": "2-3 sentence description of what this project does",
  "frameworks": ["framework1", "library1"],
  "layers": [
    {
      "name": "Layer Name",
      "description": "What this layer handles",
      "filePatterns": ["src/api/**", "src/routes/**"]
    }
  ]
}`;
}

/**
 * Parses the LLM response for file analysis. Handles common LLM output issues.
 */
export function parseFileAnalysisResponse(
  response: string,
): LLMFileAnalysis | null {
  try {
    // Strip markdown code fences if present
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(cleaned);

    return {
      fileSummary: parsed.fileSummary || "No summary available",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      complexity: ["simple", "moderate", "complex"].includes(parsed.complexity)
        ? parsed.complexity
        : "moderate",
      functionSummaries: parsed.functionSummaries || {},
      classSummaries: parsed.classSummaries || {},
      languageNotes: parsed.languageNotes,
    };
  } catch {
    return null;
  }
}

/**
 * Parses the LLM response for project summary.
 */
export function parseProjectSummaryResponse(
  response: string,
): LLMProjectSummary | null {
  try {
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(cleaned);

    return {
      description: parsed.description || "",
      frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks : [],
      layers: Array.isArray(parsed.layers) ? parsed.layers : [],
    };
  } catch {
    return null;
  }
}
```

**Step 6: Write tests for LLM analyzer**

Create: `packages/core/src/analyzer/llm-analyzer.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  buildFileAnalysisPrompt,
  parseFileAnalysisResponse,
  buildProjectSummaryPrompt,
  parseProjectSummaryResponse,
} from "./llm-analyzer.js";

describe("LLM Analyzer", () => {
  describe("buildFileAnalysisPrompt", () => {
    it("includes file path and content", () => {
      const prompt = buildFileAnalysisPrompt(
        "src/auth.ts",
        "function login() {}",
        "A web app",
      );
      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("function login() {}");
      expect(prompt).toContain("A web app");
    });
  });

  describe("parseFileAnalysisResponse", () => {
    it("parses valid JSON response", () => {
      const response = JSON.stringify({
        fileSummary: "Handles authentication",
        tags: ["auth", "login"],
        complexity: "moderate",
        functionSummaries: { login: "Logs user in" },
        classSummaries: {},
      });

      const result = parseFileAnalysisResponse(response);
      expect(result).not.toBeNull();
      expect(result!.fileSummary).toBe("Handles authentication");
      expect(result!.tags).toContain("auth");
    });

    it("handles markdown-wrapped JSON", () => {
      const response = '```json\n{"fileSummary": "Test", "tags": [], "complexity": "simple", "functionSummaries": {}, "classSummaries": {}}\n```';

      const result = parseFileAnalysisResponse(response);
      expect(result).not.toBeNull();
      expect(result!.fileSummary).toBe("Test");
    });

    it("returns null for invalid JSON", () => {
      const result = parseFileAnalysisResponse("not json at all");
      expect(result).toBeNull();
    });

    it("defaults complexity to moderate for unknown values", () => {
      const response = JSON.stringify({
        fileSummary: "Test",
        tags: [],
        complexity: "unknown",
        functionSummaries: {},
        classSummaries: {},
      });

      const result = parseFileAnalysisResponse(response);
      expect(result!.complexity).toBe("moderate");
    });
  });

  describe("buildProjectSummaryPrompt", () => {
    it("includes file list", () => {
      const prompt = buildProjectSummaryPrompt(
        ["src/index.ts", "src/auth.ts"],
        [{ path: "src/index.ts", content: "console.log('hi')" }],
      );
      expect(prompt).toContain("src/index.ts");
      expect(prompt).toContain("src/auth.ts");
    });
  });

  describe("parseProjectSummaryResponse", () => {
    it("parses valid response", () => {
      const response = JSON.stringify({
        description: "A REST API",
        frameworks: ["express"],
        layers: [{ name: "API", description: "HTTP layer", filePatterns: ["src/routes/**"] }],
      });

      const result = parseProjectSummaryResponse(response);
      expect(result).not.toBeNull();
      expect(result!.frameworks).toContain("express");
      expect(result!.layers).toHaveLength(1);
    });
  });
});
```

**Step 7: Update packages/core/src/index.ts**

```typescript
export * from "./types.js";
export * from "./persistence/index.js";
export { TreeSitterPlugin } from "./plugins/tree-sitter-plugin.js";
export { GraphBuilder } from "./analyzer/graph-builder.js";
export {
  buildFileAnalysisPrompt,
  buildProjectSummaryPrompt,
  parseFileAnalysisResponse,
  parseProjectSummaryResponse,
} from "./analyzer/llm-analyzer.js";
export type {
  LLMFileAnalysis,
  LLMProjectSummary,
} from "./analyzer/llm-analyzer.js";
```

**Step 8: Run all tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All tests PASS

**Step 9: Commit**

```bash
git add packages/core/src/analyzer/ packages/core/src/index.ts
git commit -m "feat(core): add graph builder and LLM analysis prompt system"
```

---

## Task 6: Dashboard Package — Scaffolding with Vite + React

**Files:**
- Create: `packages/dashboard/` (via Vite scaffold, then customize)

**Step 1: Scaffold React app with Vite**

Run: `cd packages && pnpm create vite dashboard --template react-ts`
Then: Remove boilerplate (App.css, etc.), keep structure.

**Step 2: Install dashboard dependencies**

Run: `cd packages/dashboard && pnpm add @xyflow/react @monaco-editor/react zustand && pnpm add -D tailwindcss @tailwindcss/vite`

**Step 3: Configure TailwindCSS**

Update `packages/dashboard/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Replace `packages/dashboard/src/index.css`:

```css
@import "tailwindcss";
```

**Step 4: Add workspace dependency on core**

Add to `packages/dashboard/package.json` dependencies:

```json
"@understand-anything/core": "workspace:*"
```

Run: `pnpm install`

**Step 5: Create the Zustand store**

Create: `packages/dashboard/src/store.ts`

```typescript
import { create } from "zustand";
import type { KnowledgeGraph, GraphNode } from "@understand-anything/core";

interface DashboardStore {
  graph: KnowledgeGraph | null;
  selectedNodeId: string | null;
  searchQuery: string;
  searchResults: string[]; // node IDs

  setGraph: (graph: KnowledgeGraph) => void;
  selectNode: (nodeId: string | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  selectedNodeId: null,
  searchQuery: "",
  searchResults: [],

  setGraph: (graph) => set({ graph }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setSearchQuery: (query) => {
    const graph = get().graph;
    if (!graph || !query.trim()) {
      set({ searchQuery: query, searchResults: [] });
      return;
    }

    const lower = query.toLowerCase();
    const results = graph.nodes
      .filter(
        (node) =>
          node.name.toLowerCase().includes(lower) ||
          node.summary.toLowerCase().includes(lower) ||
          node.tags.some((tag) => tag.toLowerCase().includes(lower)),
      )
      .map((n) => n.id);

    set({ searchQuery: query, searchResults: results });
  },
}));
```

**Step 6: Commit**

```bash
git add packages/dashboard/
git commit -m "feat(dashboard): scaffold React + Vite app with Tailwind, Zustand, and core dependency"
```

---

## Task 7: Dashboard — Graph View Panel with React Flow

**Files:**
- Create: `packages/dashboard/src/components/GraphView.tsx`
- Create: `packages/dashboard/src/components/CustomNode.tsx`

**Step 1: Create the custom node component**

Create: `packages/dashboard/src/components/CustomNode.tsx`

```tsx
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

interface CustomNodeData {
  label: string;
  nodeType: "file" | "function" | "class" | "module" | "concept";
  summary: string;
  complexity: "simple" | "moderate" | "complex";
  isHighlighted: boolean;
  isSelected: boolean;
  [key: string]: unknown;
}

const typeColors: Record<string, string> = {
  file: "bg-blue-900 border-blue-500",
  function: "bg-green-900 border-green-500",
  class: "bg-purple-900 border-purple-500",
  module: "bg-orange-900 border-orange-500",
  concept: "bg-pink-900 border-pink-500",
};

const complexityBadge: Record<string, string> = {
  simple: "bg-green-700 text-green-100",
  moderate: "bg-yellow-700 text-yellow-100",
  complex: "bg-red-700 text-red-100",
};

export function CustomNode({ data }: NodeProps<CustomNodeData>) {
  const colorClass = typeColors[data.nodeType] || "bg-gray-900 border-gray-500";
  const highlightClass = data.isHighlighted
    ? "ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/20"
    : "";
  const selectedClass = data.isSelected
    ? "ring-2 ring-white shadow-lg"
    : "";

  return (
    <div
      className={`rounded-lg border px-3 py-2 min-w-[140px] max-w-[220px] ${colorClass} ${highlightClass} ${selectedClass}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">
          {data.nodeType}
        </span>
        <span
          className={`text-[9px] px-1 rounded ${complexityBadge[data.complexity]}`}
        >
          {data.complexity}
        </span>
      </div>

      <div className="text-sm font-medium text-white truncate">
        {data.label}
      </div>

      <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">
        {data.summary}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-gray-400"
      />
    </div>
  );
}
```

**Step 2: Create the GraphView component**

Create: `packages/dashboard/src/components/GraphView.tsx`

```tsx
import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Node, Edge, NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDashboardStore } from "../store";
import { CustomNode } from "./CustomNode";
import type { KnowledgeGraph } from "@understand-anything/core";

const nodeTypes = { custom: CustomNode };

function graphToReactFlow(
  graph: KnowledgeGraph,
  searchResults: string[],
  selectedNodeId: string | null,
) {
  const nodes: Node[] = graph.nodes.map((node, index) => ({
    id: node.id,
    type: "custom",
    position: {
      x: (index % 5) * 280,
      y: Math.floor(index / 5) * 160,
    },
    data: {
      label: node.name,
      nodeType: node.type,
      summary: node.summary,
      complexity: node.complexity,
      isHighlighted: searchResults.includes(node.id),
      isSelected: node.id === selectedNodeId,
    },
  }));

  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `e-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    animated: edge.type === "calls",
    style: { stroke: searchResults.length > 0 ? "#555" : "#888" },
  }));

  return { nodes, edges };
}

export function GraphView() {
  const graph = useDashboardStore((s) => s.graph);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!graph) return { initialNodes: [], initialEdges: [] };
    const { nodes, edges } = graphToReactFlow(
      graph,
      searchResults,
      selectedNodeId,
    );
    return { initialNodes: nodes, initialEdges: edges };
  }, [graph, searchResults, selectedNodeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No knowledge graph loaded. Run /understand first.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
```

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/
git commit -m "feat(dashboard): add graph view with React Flow and custom nodes"
```

---

## Task 8: Dashboard — Code Viewer Panel with Monaco Editor

**Files:**
- Create: `packages/dashboard/src/components/CodeViewer.tsx`

**Step 1: Create the CodeViewer component**

Create: `packages/dashboard/src/components/CodeViewer.tsx`

```tsx
import Editor from "@monaco-editor/react";
import { useDashboardStore } from "../store";

const extToLanguage: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop() || "";
  return extToLanguage[ext] || "plaintext";
}

export function CodeViewer() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode || !selectedNode.filePath) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Select a node to view its source code.
      </div>
    );
  }

  // In MVP, we show a placeholder message directing to file path
  // Full implementation will load file content via API or embedded data
  const placeholder = `// File: ${selectedNode.filePath}
// Lines: ${selectedNode.lineRange ? `${selectedNode.lineRange[0]}-${selectedNode.lineRange[1]}` : "all"}
//
// ${selectedNode.summary}
//
// To view the actual source code, the dashboard needs access to the project files.
// This will be connected in the next phase via a local API server.`;

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-sm text-gray-300 flex items-center gap-2">
        <span className="text-gray-500">
          {selectedNode.type.toUpperCase()}
        </span>
        <span className="font-medium">{selectedNode.name}</span>
        <span className="text-gray-500 ml-auto">
          {selectedNode.filePath}
        </span>
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language={detectLanguage(selectedNode.filePath)}
          value={placeholder}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "on",
          }}
        />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/dashboard/src/components/CodeViewer.tsx
git commit -m "feat(dashboard): add code viewer panel with Monaco Editor"
```

---

## Task 9: Dashboard — Search Bar and Main Layout

**Files:**
- Create: `packages/dashboard/src/components/SearchBar.tsx`
- Create: `packages/dashboard/src/components/NodeInfo.tsx`
- Modify: `packages/dashboard/src/App.tsx`

**Step 1: Create SearchBar component**

Create: `packages/dashboard/src/components/SearchBar.tsx`

```tsx
import { useDashboardStore } from "../store";

export function SearchBar() {
  const searchQuery = useDashboardStore((s) => s.searchQuery);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const setSearchQuery = useDashboardStore((s) => s.setSearchQuery);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700">
      <svg
        className="w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder='Search: "authentication", "api layer", "database"...'
        className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
      />
      {searchQuery && (
        <span className="text-xs text-gray-400">
          {searchResults.length} results
        </span>
      )}
    </div>
  );
}
```

**Step 2: Create NodeInfo panel (placeholder for chat + learn panels)**

Create: `packages/dashboard/src/components/NodeInfo.tsx`

```tsx
import { useDashboardStore } from "../store";

export function NodeInfo() {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);

  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 p-4 text-sm">
        Select a node to see details. Chat and Learn panels coming in Phase 2.
      </div>
    );
  }

  // Find connected nodes
  const connectedEdges = graph?.edges.filter(
    (e) => e.source === selectedNodeId || e.target === selectedNodeId,
  ) || [];

  return (
    <div className="h-full overflow-y-auto p-4 text-sm">
      <h3 className="text-lg font-semibold text-white mb-1">
        {selectedNode.name}
      </h3>
      <div className="flex gap-2 mb-3">
        <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
          {selectedNode.type}
        </span>
        <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
          {selectedNode.complexity}
        </span>
      </div>

      <p className="text-gray-300 mb-3">{selectedNode.summary}</p>

      {selectedNode.languageNotes && (
        <div className="mb-3 p-2 bg-blue-900/30 border border-blue-800 rounded">
          <div className="text-xs text-blue-400 mb-1">Language Note</div>
          <p className="text-gray-300 text-xs">{selectedNode.languageNotes}</p>
        </div>
      )}

      {selectedNode.tags.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">Tags</div>
          <div className="flex flex-wrap gap-1">
            {selectedNode.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {connectedEdges.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">
            Connections ({connectedEdges.length})
          </div>
          <div className="space-y-1">
            {connectedEdges.map((edge, i) => {
              const otherId =
                edge.source === selectedNodeId ? edge.target : edge.source;
              const otherNode = graph?.nodes.find((n) => n.id === otherId);
              const direction =
                edge.source === selectedNodeId ? "\u2192" : "\u2190";
              return (
                <div key={i} className="text-xs text-gray-400">
                  {direction} {edge.type}: {otherNode?.name || otherId}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create the main App layout**

Replace: `packages/dashboard/src/App.tsx`

```tsx
import { useEffect } from "react";
import { SearchBar } from "./components/SearchBar";
import { GraphView } from "./components/GraphView";
import { CodeViewer } from "./components/CodeViewer";
import { NodeInfo } from "./components/NodeInfo";
import { useDashboardStore } from "./store";
import type { KnowledgeGraph } from "@understand-anything/core";

// Load graph from a JSON file served at /knowledge-graph.json
// In production, this comes from .understand-anything/knowledge-graph.json
async function loadGraphData(): Promise<KnowledgeGraph | null> {
  try {
    const response = await fetch("/knowledge-graph.json");
    if (!response.ok) return null;
    return (await response.json()) as KnowledgeGraph;
  } catch {
    return null;
  }
}

function App() {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const graph = useDashboardStore((s) => s.graph);

  useEffect(() => {
    loadGraphData().then((g) => {
      if (g) setGraph(g);
    });
  }, [setGraph]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-950 border-b border-gray-800">
        <h1 className="text-sm font-bold tracking-wider">
          UNDERSTAND ANYTHING
        </h1>
        {graph && (
          <span className="text-xs text-gray-500">
            {graph.project.name} &middot; {graph.nodes.length} nodes &middot;{" "}
            {graph.edges.length} edges
          </span>
        )}
      </div>

      {/* Search */}
      <SearchBar />

      {/* Main workspace: 2x2 grid */}
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-px bg-gray-700 overflow-hidden">
        {/* Top-left: Graph View */}
        <div className="bg-gray-900">
          <GraphView />
        </div>

        {/* Top-right: Code Viewer */}
        <div className="bg-gray-900">
          <CodeViewer />
        </div>

        {/* Bottom-left: Chat Panel (placeholder) */}
        <div className="bg-gray-900 flex items-center justify-center text-gray-600 text-sm">
          Chat panel — coming in Phase 2
        </div>

        {/* Bottom-right: Node Info / Learn Panel */}
        <div className="bg-gray-900">
          <NodeInfo />
        </div>
      </div>
    </div>
  );
}

export default App;
```

**Step 4: Run the dashboard**

Run: `pnpm --filter @understand-anything/dashboard dev`
Expected: Vite dev server starts at localhost:5173. Dashboard renders with "No knowledge graph loaded" message.

**Step 5: Test with sample data**

Create `packages/dashboard/public/knowledge-graph.json` with a sample graph for testing:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "sample-project",
    "languages": ["typescript"],
    "frameworks": ["express"],
    "description": "A sample Express API",
    "analyzedAt": "2026-03-14T00:00:00.000Z",
    "gitCommitHash": "abc123"
  },
  "nodes": [
    {
      "id": "file:src/index.ts",
      "type": "file",
      "name": "index.ts",
      "filePath": "src/index.ts",
      "summary": "Application entry point, starts the Express server",
      "tags": ["entry", "server"],
      "complexity": "simple"
    },
    {
      "id": "file:src/auth/login.ts",
      "type": "file",
      "name": "login.ts",
      "filePath": "src/auth/login.ts",
      "summary": "Handles user authentication and login flow",
      "tags": ["auth", "login"],
      "complexity": "moderate"
    },
    {
      "id": "func:src/auth/login.ts:handleLogin",
      "type": "function",
      "name": "handleLogin",
      "filePath": "src/auth/login.ts",
      "lineRange": [10, 35],
      "summary": "Validates credentials and returns a JWT token",
      "tags": ["auth", "jwt"],
      "complexity": "moderate"
    },
    {
      "id": "func:src/auth/login.ts:validateEmail",
      "type": "function",
      "name": "validateEmail",
      "filePath": "src/auth/login.ts",
      "lineRange": [37, 42],
      "summary": "Checks if an email address is valid using regex",
      "tags": ["validation", "email"],
      "complexity": "simple"
    },
    {
      "id": "file:src/db/connection.ts",
      "type": "file",
      "name": "connection.ts",
      "filePath": "src/db/connection.ts",
      "summary": "Database connection pool using PostgreSQL",
      "tags": ["database", "postgres"],
      "complexity": "moderate"
    }
  ],
  "edges": [
    {
      "source": "file:src/index.ts",
      "target": "file:src/auth/login.ts",
      "type": "imports",
      "direction": "forward",
      "weight": 0.7
    },
    {
      "source": "file:src/auth/login.ts",
      "target": "func:src/auth/login.ts:handleLogin",
      "type": "contains",
      "direction": "forward",
      "weight": 1.0
    },
    {
      "source": "file:src/auth/login.ts",
      "target": "func:src/auth/login.ts:validateEmail",
      "type": "contains",
      "direction": "forward",
      "weight": 1.0
    },
    {
      "source": "func:src/auth/login.ts:handleLogin",
      "target": "func:src/auth/login.ts:validateEmail",
      "type": "calls",
      "direction": "forward",
      "description": "handleLogin calls validateEmail to check the email format",
      "weight": 0.8
    },
    {
      "source": "file:src/auth/login.ts",
      "target": "file:src/db/connection.ts",
      "type": "imports",
      "direction": "forward",
      "weight": 0.7
    }
  ],
  "layers": [],
  "tour": []
}
```

**Step 6: Verify in browser**

Open: `http://localhost:5173`
Expected: Dashboard loads, graph renders 5 nodes with edges, clicking a node shows details in the info panel and placeholder in code viewer. Search works.

**Step 7: Commit**

```bash
git add packages/dashboard/
git commit -m "feat(dashboard): add main layout with search bar, graph view, code viewer, and node info panels"
```

---

## Task 10: Integration — Wire Everything Together + README

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

**Step 1: Create README.md**

```markdown
# Understand Anything

An open-source tool that combines LLM intelligence with static analysis to help anyone understand any codebase — from junior developers to product managers.

## Features

- **Knowledge Graph** — Automatically maps your codebase into an interactive graph of files, functions, classes, and their relationships
- **Multi-Panel Dashboard** — Graph view, code viewer, chat, and learn panels in a workspace layout
- **Natural Language Search** — Search your codebase with plain English: "which parts handle authentication?"
- **Tree-sitter Analysis** — Accurate structural analysis for TypeScript, JavaScript (more languages coming)
- **LLM-Powered Summaries** — Every node gets a plain-English description of what it does and why

## Quick Start

```bash
# Install dependencies
pnpm install

# Build the core package
pnpm --filter @understand-anything/core build

# Start the dashboard dev server
pnpm dev:dashboard
```

## Project Structure

```
packages/
  core/        — Analysis engine: types, persistence, tree-sitter, LLM prompts
  dashboard/   — React + TypeScript web dashboard
  skill/       — Claude Code skill (coming soon)
```

## Tech Stack

- TypeScript, pnpm workspaces
- React 18, Vite, TailwindCSS
- React Flow (graph visualization)
- Monaco Editor (code viewer)
- Zustand (state management)
- tree-sitter (static analysis)

## License

MIT
```

**Step 2: Create CLAUDE.md**

```markdown
# Understand Anything

## Project Overview
An open-source tool combining LLM intelligence + static analysis to produce interactive dashboards for understanding codebases.

## Architecture
- **Monorepo** with pnpm workspaces
- **packages/core** — Shared analysis engine (types, persistence, tree-sitter plugin, LLM prompt templates)
- **packages/dashboard** — React + TypeScript web dashboard (React Flow, Monaco Editor, Zustand, TailwindCSS)
- **packages/skill** — Claude Code skill (not yet implemented)

## Key Commands
- `pnpm install` — Install all dependencies
- `pnpm --filter @understand-anything/core build` — Build the core package
- `pnpm --filter @understand-anything/core test` — Run core tests
- `pnpm dev:dashboard` — Start dashboard dev server

## Conventions
- TypeScript strict mode everywhere
- Vitest for testing
- ESM modules (`"type": "module"`)
- Knowledge graph JSON lives in `.understand-anything/` directory of analyzed projects
```

**Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add README and CLAUDE.md with project overview and conventions"
```

---

## Verification Checklist

After completing all 10 tasks:

1. **`pnpm install`** — No errors
2. **`pnpm --filter @understand-anything/core build`** — Compiles clean
3. **`pnpm --filter @understand-anything/core test`** — All tests pass (types, persistence, tree-sitter, graph builder, LLM analyzer)
4. **`pnpm dev:dashboard`** — Dashboard starts at localhost:5173
5. **Dashboard with sample data** — Loads `knowledge-graph.json`, graph renders, nodes clickable, search works, code viewer shows node info
6. **Git log** — Clean history with 10 logical commits

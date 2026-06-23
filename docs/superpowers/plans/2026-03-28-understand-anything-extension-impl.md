# Universal File Type Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend Understand Anything to analyze 26+ non-code file types (Markdown, Dockerfile, YAML, SQL, Terraform, etc.) with new graph node/edge types, custom parsers, updated agent prompts, and dashboard visualization.

**Architecture:** Extend the existing LanguageConfig + AnalyzerPlugin pipeline. Add 8 new node types and 8 new edge types to the schema. Build 12 lightweight regex/parser-based analyzers for structured formats, LLM-only for unstructured. Update all 5 agent prompts to handle non-code files. Add new node colors and sidebar rendering to the dashboard.

**Tech Stack:** TypeScript, Zod, Vitest, React, React Flow, Zustand, TailwindCSS v4, `yaml` npm package, `@iarna/toml`, `jsonc-parser`

**Design doc:** `docs/plans/2026-03-28-understand-anything-extension-design.md`

---

## Task 1: Extend Core Types — Node & Edge Types

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts:1-116`
- Test: `understand-anything-plugin/packages/core/src/types.test.ts`

**Step 1: Write the failing test**

In `types.test.ts`, add a test that imports and verifies the new node types exist on GraphNode and edge types exist on EdgeType:

```typescript
import { describe, it, expect } from "vitest";
import type { GraphNode, GraphEdge, EdgeType, StructuralAnalysis } from "../types.js";

describe("Extended types", () => {
  it("accepts all 13 node types", () => {
    const nodeTypes: GraphNode["type"][] = [
      "file", "function", "class", "module", "concept",
      "config", "document", "service", "table", "endpoint",
      "pipeline", "schema", "resource",
    ];
    expect(nodeTypes).toHaveLength(13);
  });

  it("accepts all 26 edge types", () => {
    const edgeTypes: EdgeType[] = [
      "imports", "exports", "contains", "inherits", "implements",
      "calls", "subscribes", "publishes", "middleware",
      "reads_from", "writes_to", "transforms", "validates",
      "depends_on", "tested_by", "configures",
      "related", "similar_to",
      "deploys", "serves", "migrates", "documents",
      "provisions", "routes", "defines_schema", "triggers",
    ];
    expect(edgeTypes).toHaveLength(26);
  });

  it("StructuralAnalysis has optional non-code fields", () => {
    const analysis: StructuralAnalysis = {
      functions: [], classes: [], imports: [], exports: [],
      sections: [{ name: "Introduction", level: 1, lineRange: [1, 10] }],
      definitions: [{ name: "users", kind: "table", lineRange: [1, 20], fields: ["id", "name"] }],
      services: [{ name: "web", image: "node:22", ports: [3000] }],
      endpoints: [{ method: "GET", path: "/api/users", lineRange: [5, 15] }],
      steps: [{ name: "build", lineRange: [1, 5] }],
      resources: [{ name: "aws_s3_bucket.main", kind: "aws_s3_bucket", lineRange: [1, 10] }],
    };
    expect(analysis.sections).toHaveLength(1);
    expect(analysis.definitions).toHaveLength(1);
    expect(analysis.services).toHaveLength(1);
    expect(analysis.endpoints).toHaveLength(1);
    expect(analysis.steps).toHaveLength(1);
    expect(analysis.resources).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run types.test`
Expected: FAIL — TypeScript compilation errors for new types that don't exist yet

**Step 3: Implement the type extensions**

In `types.ts`, update the `GraphNode.type` union (line 12):

```typescript
type: "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource";
```

Update the `EdgeType` type (lines 1-7) to add 8 new edge types:

```typescript
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "migrates" | "documents"                 // Infrastructure
  | "provisions" | "routes" | "defines_schema" | "triggers";        // Infrastructure
```

Extend `StructuralAnalysis` (after line 95) with new optional fields:

```typescript
export interface SectionInfo {
  name: string;
  level: number;
  lineRange: [number, number];
}

export interface DefinitionInfo {
  name: string;
  kind: string; // "table", "message", "type", "schema"
  lineRange: [number, number];
  fields: string[];
}

export interface ServiceInfo {
  name: string;
  image?: string;
  ports: number[];
}

export interface EndpointInfo {
  method?: string;
  path: string;
  lineRange: [number, number];
}

export interface StepInfo {
  name: string;
  lineRange: [number, number];
}

export interface ResourceInfo {
  name: string;
  kind: string;
  lineRange: [number, number];
}

export interface ReferenceResolution {
  source: string;
  target: string;
  referenceType: string; // "file", "image", "schema", "service"
  line?: number;
}

export interface StructuralAnalysis {
  functions: Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }>;
  classes: Array<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[] }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
  exports: Array<{ name: string; lineNumber: number }>;
  // Non-code structural data (all optional for backward compat)
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
}
```

Update `AnalyzerPlugin` interface (lines 109-115) — make `resolveImports` optional, add `extractReferences`:

```typescript
export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run types.test`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts understand-anything-plugin/packages/core/src/types.test.ts
git commit -m "feat(core): extend GraphNode/EdgeType/StructuralAnalysis for non-code file types"
```

---

## Task 2: Extend Schema Validation — Zod Schemas & Aliases

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/schema.ts:1-554`
- Test: `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts`

**Step 1: Write the failing tests**

Add to `schema.test.ts`:

```typescript
describe("Extended node/edge types", () => {
  it("validates nodes with new types: config, document, service, table, endpoint, pipeline, schema, resource", () => {
    const newTypes = ["config", "document", "service", "table", "endpoint", "pipeline", "schema", "resource"];
    for (const type of newTypes) {
      const graph = structuredClone(validGraph);
      graph.nodes[0].type = type;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.nodes[0].type).toBe(type);
    }
  });

  it("validates edges with new types: deploys, serves, migrates, documents, provisions, routes, defines_schema, triggers", () => {
    const newTypes = ["deploys", "serves", "migrates", "documents", "provisions", "routes", "defines_schema", "triggers"];
    for (const type of newTypes) {
      const graph = structuredClone(validGraph);
      graph.edges[0].type = type;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges[0].type).toBe(type);
    }
  });

  it("auto-fixes new node type aliases: container→service, doc→document, workflow→pipeline, etc.", () => {
    const aliases = { container: "service", doc: "document", workflow: "pipeline", route: "endpoint", setting: "config", infra: "resource", migration: "table" };
    for (const [alias, canonical] of Object.entries(aliases)) {
      const graph = structuredClone(validGraph);
      (graph.nodes[0] as any).type = alias;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.nodes[0].type).toBe(canonical);
    }
  });

  it("auto-fixes new edge type aliases: describes→documents, creates→provisions, exposes→serves", () => {
    const aliases = { describes: "documents", creates: "provisions", exposes: "serves" };
    for (const [alias, canonical] of Object.entries(aliases)) {
      const graph = structuredClone(validGraph);
      (graph.edges[0] as any).type = alias;
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges[0].type).toBe(canonical);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run schema.test`
Expected: FAIL — Zod enum rejects new types

**Step 3: Implement schema extensions**

In `schema.ts`:

1. Update `EdgeTypeSchema` (line 4-10) — add 8 new edge types:
```typescript
export const EdgeTypeSchema = z.enum([
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "subscribes", "publishes", "middleware",
  "reads_from", "writes_to", "transforms", "validates",
  "depends_on", "tested_by", "configures",
  "related", "similar_to",
  "deploys", "serves", "migrates", "documents",
  "provisions", "routes", "defines_schema", "triggers",
]);
```

2. Update `NODE_TYPE_ALIASES` (line 13-22) — add new aliases:
```typescript
export const NODE_TYPE_ALIASES: Record<string, string> = {
  func: "function", fn: "function", method: "function",
  interface: "class", struct: "class",
  mod: "module", pkg: "module", package: "module",
  // New non-code aliases
  container: "service", deployment: "service", pod: "service",
  doc: "document", readme: "document", docs: "document",
  workflow: "pipeline", job: "pipeline", ci: "pipeline", action: "pipeline",
  route: "endpoint", api: "endpoint", query: "endpoint", mutation: "endpoint",
  setting: "config", env: "config", configuration: "config",
  infra: "resource", infrastructure: "resource", terraform: "resource",
  migration: "table", database: "table", db: "table", view: "table",
  proto: "schema", protobuf: "schema", definition: "schema", typedef: "schema",
};
```

3. Update `EDGE_TYPE_ALIASES` (line 25-39) — add new aliases:
```typescript
// Add these entries:
  describes: "documents",
  documented_by: "documents",
  creates: "provisions",
  exposes: "serves",
  listens: "serves",
  deploys_to: "deploys",
  migrates_to: "migrates",
  routes_to: "routes",
  triggers_on: "triggers",
  fires: "triggers",
  defines: "defines_schema",
```

4. Update `GraphNodeSchema` (line 267-277) — extend type enum:
```typescript
export const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource",
  ]),
  name: z.string(),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  summary: z.string(),
  tags: z.array(z.string()),
  complexity: z.enum(["simple", "moderate", "complex"]),
  languageNotes: z.string().optional(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run schema.test`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/schema.ts understand-anything-plugin/packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): extend Zod schemas and aliases for 8 new node/edge types"
```

---

## Task 3: Update PluginRegistry — Optional resolveImports

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/plugins/registry.ts:1-76`
- Test: `understand-anything-plugin/packages/core/src/__tests__/plugin-registry.test.ts`

**Step 1: Write the failing test**

Add to `plugin-registry.test.ts`:

```typescript
it("handles plugins with optional resolveImports (non-code plugins)", () => {
  const markdownPlugin: AnalyzerPlugin = {
    name: "markdown",
    languages: ["markdown"],
    analyzeFile: () => ({ functions: [], classes: [], imports: [], exports: [] }),
    // No resolveImports — optional
  };
  registry.register(markdownPlugin);
  const result = registry.resolveImports("README.md", "# Hello");
  expect(result).toBeNull(); // Returns null for plugins without resolveImports
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run plugin-registry.test`
Expected: FAIL — current registry calls `plugin.resolveImports(...)` unconditionally

**Step 3: Update PluginRegistry**

In `registry.ts`, update `resolveImports` (line 62-66):

```typescript
resolveImports(filePath: string, content: string): ImportResolution[] | null {
  const plugin = this.getPluginForFile(filePath);
  if (!plugin || !plugin.resolveImports) return null;
  return plugin.resolveImports(filePath, content);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run plugin-registry.test`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/registry.ts understand-anything-plugin/packages/core/src/__tests__/plugin-registry.test.ts
git commit -m "feat(core): make resolveImports optional on AnalyzerPlugin"
```

---

## Task 4: Add Non-Code Language Configs (26 configs)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/languages/configs/markdown.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/yaml.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/json-config.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/toml.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/env.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/xml.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/dockerfile.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/sql.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/graphql.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/protobuf.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/terraform.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/github-actions.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/makefile.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/shell.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/html.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/css.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/openapi.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/kubernetes.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/docker-compose.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/json-schema.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/csv.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/restructuredtext.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/powershell.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/batch.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/jenkinsfile.ts`
- Create: `understand-anything-plugin/packages/core/src/languages/configs/plaintext.ts`
- Modify: `understand-anything-plugin/packages/core/src/languages/configs/index.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/language-registry.test.ts`

**Step 1: Write the failing test**

Add to `language-registry.test.ts`:

```typescript
describe("Non-code language configs", () => {
  it("detects all non-code file types via extension", () => {
    const registry = LanguageRegistry.createDefault();
    const expectations: [string, string][] = [
      ["README.md", "markdown"],
      ["config.yaml", "yaml"],
      ["package.json", "json"],
      ["config.toml", "toml"],
      [".env", "env"],
      ["pom.xml", "xml"],
      ["Dockerfile", "dockerfile"],
      ["schema.sql", "sql"],
      ["schema.graphql", "graphql"],
      ["types.proto", "protobuf"],
      ["main.tf", "terraform"],
      ["Makefile", "makefile"],
      ["deploy.sh", "shell"],
      ["index.html", "html"],
      ["styles.css", "css"],
      ["data.csv", "csv"],
      ["deploy.ps1", "powershell"],
    ];
    for (const [file, expectedId] of expectations) {
      const config = registry.getForFile(file);
      expect(config?.id, `${file} should be detected as ${expectedId}`).toBe(expectedId);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run language-registry.test`
Expected: FAIL — no configs registered for non-code extensions

**Step 3: Create all config files**

Each config follows the same pattern as `typescript.ts`. Example for markdown:

```typescript
// markdown.ts
import type { LanguageConfig } from "../types.js";

export const markdownConfig = {
  id: "markdown",
  displayName: "Markdown",
  extensions: [".md", ".mdx"],
  concepts: ["headings", "links", "code blocks", "front matter", "lists", "tables", "images"],
  filePatterns: {
    entryPoints: ["README.md"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
```

Create similar configs for all 26 types. Key extension mappings:
- yaml: `.yaml`, `.yml`
- json: `.json`, `.jsonc`
- toml: `.toml`
- env: `.env` (Note: LanguageRegistry needs filename match, not just extension)
- xml: `.xml`
- dockerfile: `Dockerfile` (filename-based detection — needs special handling)
- sql: `.sql`
- graphql: `.graphql`, `.gql`
- protobuf: `.proto`
- terraform: `.tf`, `.tfvars`
- github-actions: (detected by path `.github/workflows/*.yml` — defer to scanner)
- makefile: `Makefile` (filename-based — needs special handling)
- shell: `.sh`, `.bash`, `.zsh`
- html: `.html`, `.htm`
- css: `.css`, `.scss`, `.less`
- csv: `.csv`, `.tsv`
- powershell: `.ps1`, `.psm1`
- batch: `.bat`, `.cmd`
- plaintext: `.txt`
- restructuredtext: `.rst`
- jenkinsfile: (filename-based — `Jenkinsfile`)

**Important:** For filename-based detection (Dockerfile, Makefile, Jenkinsfile), extend LanguageRegistry to support `filenames` array in addition to `extensions`. Add a `filenames?: string[]` field to `LanguageConfig` and update `getForFile()` to check basename against filenames when extension lookup fails.

Update `configs/index.ts` to import and register all new configs in `builtinLanguageConfigs`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run language-registry.test`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/languages/
git commit -m "feat(core): add 26 non-code language configs with filename-based detection"
```

---

## Task 5: Build Custom Parsers (12 parsers)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/markdown-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/yaml-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/json-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/toml-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/env-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/dockerfile-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/sql-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/graphql-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/protobuf-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/terraform-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/makefile-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/shell-parser.ts`
- Create: `understand-anything-plugin/packages/core/src/plugins/parsers/index.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/parsers.test.ts`

Each parser implements `AnalyzerPlugin`. Build them TDD-style, one at a time.

**Step 1: Write failing tests for all 12 parsers**

Create `parsers.test.ts` with test suites for each parser. Example for MarkdownParser:

```typescript
import { describe, it, expect } from "vitest";
import { MarkdownParser } from "../plugins/parsers/markdown-parser.js";

describe("MarkdownParser", () => {
  const parser = new MarkdownParser();

  it("extracts heading sections", () => {
    const content = "# Title\n\nIntro\n\n## Section A\n\nContent A\n\n### Subsection\n\nContent B";
    const result = parser.analyzeFile("README.md", content);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toMatchObject({ name: "Title", level: 1 });
    expect(result.sections![1]).toMatchObject({ name: "Section A", level: 2 });
    expect(result.sections![2]).toMatchObject({ name: "Subsection", level: 3 });
  });

  it("extracts YAML front matter as imports", () => {
    const content = "---\ntitle: Test\ntags: [a, b]\n---\n# Content";
    const result = parser.analyzeFile("post.md", content);
    expect(result.imports).toHaveLength(0); // Front matter is metadata, not imports
  });

  it("extracts file references", () => {
    const parser2 = new MarkdownParser();
    const content = "See [guide](./docs/guide.md) and ![img](./assets/logo.png)";
    const refs = parser2.extractReferences!("README.md", content);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ target: "./docs/guide.md", referenceType: "file" });
    expect(refs[1]).toMatchObject({ target: "./assets/logo.png", referenceType: "image" });
  });
});
```

Similar test suites for:
- **DockerfileParser**: Extract FROM stages, EXPOSE ports, COPY sources
- **SQLParser**: Extract CREATE TABLE, columns, foreign keys
- **YAMLParser**: Extract top-level key hierarchy
- **JSONParser**: Extract key structure, `$ref`/`$defs`
- **TerraformParser**: Extract resource/module/variable blocks
- **GraphQLParser**: Extract type/query/mutation/subscription definitions
- **ProtobufParser**: Extract message/service/enum definitions
- **MakefileParser**: Extract targets and dependencies
- **ShellParser**: Extract function definitions and source commands
- **TOMLParser**: Extract section structure
- **EnvParser**: Extract variable names

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run parsers.test`
Expected: FAIL — parser modules don't exist

**Step 3: Implement all 12 parsers**

Each parser follows this pattern:

```typescript
import type { AnalyzerPlugin, StructuralAnalysis, ReferenceResolution } from "../../types.js";

export class MarkdownParser implements AnalyzerPlugin {
  name = "markdown-parser";
  languages = ["markdown"];

  analyzeFile(filePath: string, content: string): StructuralAnalysis {
    const sections = this.extractSections(content);
    return {
      functions: [], classes: [], imports: [], exports: [],
      sections,
    };
  }

  extractReferences(filePath: string, content: string): ReferenceResolution[] {
    const refs: ReferenceResolution[] = [];
    // Match [text](path) and ![alt](path)
    const linkRegex = /!?\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const target = match[2];
      if (target.startsWith("http")) continue; // Skip external URLs
      const line = content.slice(0, match.index).split("\n").length;
      refs.push({
        source: filePath,
        target,
        referenceType: match[0].startsWith("!") ? "image" : "file",
        line,
      });
    }
    return refs;
  }

  private extractSections(content: string): SectionInfo[] {
    const sections: SectionInfo[] = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        sections.push({
          name: match[2].trim(),
          level: match[1].length,
          lineRange: [i + 1, i + 1],
        });
      }
    }
    // Fix lineRange end for each section (extends to next heading or EOF)
    for (let i = 0; i < sections.length; i++) {
      const next = sections[i + 1];
      sections[i].lineRange[1] = next ? next.lineRange[0] - 1 : lines.length;
    }
    return sections;
  }
}
```

Create `parsers/index.ts` that exports all parsers and a `registerAllParsers(registry: PluginRegistry)` helper.

**Install new dependencies:**
```bash
cd understand-anything-plugin/packages/core
pnpm add yaml @iarna/toml jsonc-parser
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run parsers.test`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/plugins/parsers/ understand-anything-plugin/packages/core/src/__tests__/parsers.test.ts understand-anything-plugin/packages/core/package.json understand-anything-plugin/packages/core/pnpm-lock.yaml
git commit -m "feat(core): add 12 custom parsers for non-code file types"
```

---

## Task 6: Update GraphBuilder — Support New Node Types

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/analyzer/graph-builder.ts:1-207`
- Test: `understand-anything-plugin/packages/core/src/analyzer/graph-builder.test.ts`

**Step 1: Write the failing test**

Add to `graph-builder.test.ts`:

```typescript
describe("Non-code file support", () => {
  it("adds non-code file nodes with correct types", () => {
    const builder = new GraphBuilder("test", "abc123");
    builder.addNonCodeFile("README.md", {
      nodeType: "document",
      summary: "Project documentation",
      tags: ["documentation"],
      complexity: "simple",
    });
    const graph = builder.build();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].type).toBe("document");
    expect(graph.nodes[0].id).toBe("file:README.md");
  });

  it("adds non-code child nodes (sections, definitions, services)", () => {
    const builder = new GraphBuilder("test", "abc123");
    builder.addNonCodeFileWithAnalysis("schema.sql", {
      nodeType: "file",
      summary: "Database schema",
      tags: ["database"],
      complexity: "moderate",
      definitions: [{ name: "users", kind: "table", lineRange: [1, 20] as [number, number], fields: ["id", "name", "email"] }],
    });
    const graph = builder.build();
    // File node + table child node
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1].type).toBe("table");
    expect(graph.nodes[1].name).toBe("users");
    // Contains edge
    expect(graph.edges.some(e => e.type === "contains" && e.target.includes("users"))).toBe(true);
  });

  it("detects non-code languages from EXTENSION_LANGUAGE map", () => {
    const builder = new GraphBuilder("test", "abc123");
    builder.addFile("config.yaml", { summary: "Config", tags: [], complexity: "simple" });
    const graph = builder.build();
    expect(graph.project.languages).toContain("yaml");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @understand-anything/core test -- --run graph-builder.test`
Expected: FAIL — `addNonCodeFile` and `addNonCodeFileWithAnalysis` methods don't exist

**Step 3: Implement GraphBuilder extensions**

Add new methods to GraphBuilder:

```typescript
interface NonCodeFileMeta extends FileMeta {
  nodeType: GraphNode["type"];
}

interface NonCodeFileAnalysisMeta extends NonCodeFileMeta {
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
  sections?: SectionInfo[];
}

addNonCodeFile(filePath: string, meta: NonCodeFileMeta): void {
  const lang = detectLanguage(filePath);
  if (lang !== "unknown") this.languages.add(lang);
  const name = filePath.split("/").pop() ?? filePath;
  this.nodes.push({
    id: `file:${filePath}`,
    type: meta.nodeType,
    name,
    filePath,
    summary: meta.summary,
    tags: meta.tags,
    complexity: meta.complexity,
  });
}

addNonCodeFileWithAnalysis(filePath: string, meta: NonCodeFileAnalysisMeta): void {
  this.addNonCodeFile(filePath, meta);
  const fileId = `file:${filePath}`;

  // Create child nodes for definitions (tables, schemas, etc.)
  for (const def of meta.definitions ?? []) {
    const childId = `${def.kind}:${filePath}:${def.name}`;
    this.nodes.push({
      id: childId,
      type: this.mapKindToNodeType(def.kind),
      name: def.name,
      filePath,
      lineRange: def.lineRange,
      summary: `${def.kind}: ${def.name} (${def.fields.length} fields)`,
      tags: [],
      complexity: meta.complexity,
    });
    this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
  }

  // Create child nodes for services
  for (const svc of meta.services ?? []) {
    const childId = `service:${filePath}:${svc.name}`;
    this.nodes.push({
      id: childId, type: "service", name: svc.name, filePath,
      summary: `Service ${svc.name}${svc.image ? ` (image: ${svc.image})` : ""}`,
      tags: [], complexity: meta.complexity,
    });
    this.edges.push({ source: fileId, target: childId, type: "contains", direction: "forward", weight: 1 });
  }

  // Similar for endpoints, steps, resources
}

private mapKindToNodeType(kind: string): GraphNode["type"] {
  const mapping: Record<string, GraphNode["type"]> = {
    table: "table", view: "table", index: "table",
    message: "schema", type: "schema", enum: "schema",
    resource: "resource", module: "resource",
    service: "service", deployment: "service",
    job: "pipeline", stage: "pipeline", target: "pipeline",
    route: "endpoint", query: "endpoint", mutation: "endpoint",
  };
  return mapping[kind] ?? "concept";
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @understand-anything/core test -- --run graph-builder.test`
Expected: PASS

**Step 5: Commit**

```bash
git add understand-anything-plugin/packages/core/src/analyzer/graph-builder.ts understand-anything-plugin/packages/core/src/analyzer/graph-builder.test.ts
git commit -m "feat(core): add non-code file support to GraphBuilder"
```

---

## Task 7: Update Core Exports

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/index.ts`

**Step 1: Update exports to include new types and parsers**

Add to `index.ts`:

```typescript
// New structural analysis types
export type {
  SectionInfo,
  DefinitionInfo,
  ServiceInfo,
  EndpointInfo,
  StepInfo,
  ResourceInfo,
  ReferenceResolution,
} from "./types.js";

// Non-code parsers
export {
  MarkdownParser,
  DockerfileParser,
  SQLParser,
  YAMLConfigParser,
  JSONConfigParser,
  TOMLParser,
  EnvParser,
  GraphQLParser,
  ProtobufParser,
  TerraformParser,
  MakefileParser,
  ShellParser,
  registerAllParsers,
} from "./plugins/parsers/index.js";
```

**Step 2: Build to verify exports work**

Run: `pnpm --filter @understand-anything/core build`
Expected: Success, no errors

**Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/src/index.ts
git commit -m "feat(core): export new types and parsers from core"
```

---

## Task 8: Update Agent Prompts — Project Scanner

**Files:**
- Modify: `understand-anything-plugin/skills/understand/project-scanner-prompt.md`

**Step 1: Update the scanner to discover ALL file types**

Key changes to the prompt:
1. Remove the code-only file filter — scan `.md`, `.yaml`, `.json`, `.sql`, `.tf`, `Dockerfile`, etc.
2. Add a `fileCategory` field to each discovered file: `"code" | "config" | "docs" | "infra" | "data" | "script" | "markup"`
3. Update the exclusion list — still exclude `node_modules/`, `.git/`, binaries, but include non-code files
4. Add category detection logic in the discovery script:
   - `.md`, `.rst`, `.txt` → `"docs"`
   - `.yaml`, `.yml`, `.json`, `.toml`, `.env`, `.xml` → `"config"`
   - `Dockerfile`, `docker-compose.*`, `.tf`, `.github/workflows/*`, `Makefile`, `Jenkinsfile` → `"infra"`
   - `.sql`, `.graphql`, `.proto`, `.schema.json`, `.csv` → `"data"`
   - `.sh`, `.bash`, `.ps1`, `.bat` → `"script"`
   - `.html`, `.css`, `.scss` → `"markup"`
   - Everything else → `"code"`
5. Update output schema to include `fileCategory` per file

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/project-scanner-prompt.md
git commit -m "feat(agents): update project-scanner to discover all file types"
```

---

## Task 9: Update Agent Prompts — File Analyzer

**Files:**
- Modify: `understand-anything-plugin/skills/understand/file-analyzer-prompt.md`

**Step 1: Add type-aware analysis prompts**

Key changes:
1. Add a section at the top explaining file categories and how to analyze each:
   - **Code files** (current behavior): Extract functions, classes, imports, call graph
   - **Config files**: Extract key settings, what they configure, which code they affect
   - **Documentation files**: Extract sections/headings, key concepts, referenced code components
   - **Infrastructure files**: Extract services, ports, volumes, deployments, which code they deploy
   - **Data/Schema files**: Extract tables, columns, types, relationships, consuming code
   - **Pipeline files**: Extract jobs, steps, triggers, deployed targets

2. Update the output JSON schema to include new fields:
   - `sections` (for docs)
   - `definitions` (for data/schema)
   - `services` (for infra)
   - `endpoints` (for API schemas)
   - `steps` (for pipelines)
   - `resources` (for IaC)

3. Add `nodeType` field to output: what GraphNode type each file should become (file, config, document, service, etc.)

4. Update edge generation guidance:
   - Config files: generate `configures` edges to code files they affect
   - Doc files: generate `documents` edges to described code
   - Dockerfiles: generate `deploys` edges to code directories
   - SQL migrations: generate `migrates` edges to tables
   - CI configs: generate `triggers` edges to pipelines
   - API schemas: generate `defines_schema` edges to endpoints

5. Update tagging guidance with new tags: `documentation`, `configuration`, `infrastructure`, `database`, `api-schema`, `ci-cd`, `deployment`, `migration`

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/file-analyzer-prompt.md
git commit -m "feat(agents): add type-aware analysis prompts for non-code files"
```

---

## Task 10: Update Agent Prompts — Architecture Analyzer

**Files:**
- Modify: `understand-anything-plugin/skills/understand/architecture-analyzer-prompt.md`

**Step 1: Add non-code pattern detection**

Key changes:
1. Add new architectural patterns to detect:
   - **Deployment topology**: Dockerfile → docker-compose → K8s manifests
   - **Data pipeline**: Schema definition → migration → API endpoint → client code
   - **Documentation coverage**: Which modules have corresponding docs
   - **Configuration graph**: Which config files affect which code paths
2. Update layer hints to include non-code layers:
   - `"infrastructure"` layer for Dockerfiles, K8s, Terraform
   - `"documentation"` layer for docs
   - `"data"` layer for SQL, schemas
   - `"ci-cd"` layer for GitHub Actions, Jenkinsfiles
3. Update script to compute cross-category dependency analysis (code→infra, code→config, etc.)

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/architecture-analyzer-prompt.md
git commit -m "feat(agents): add non-code pattern detection to architecture analyzer"
```

---

## Task 11: Update Agent Prompts — Tour Builder

**Files:**
- Modify: `understand-anything-plugin/skills/understand/tour-builder-prompt.md`

**Step 1: Add non-code tour stops**

Key changes:
1. Update tour step guidance to include non-code files:
   - Step 1 could be README.md (project overview)
   - Infrastructure stops: "How the app gets containerized"
   - Data stops: "The database schema"
   - CI/CD stops: "How code gets deployed"
2. Update `languageLesson` to also cover non-code concepts:
   - Dockerfile: multi-stage builds, layer caching
   - SQL: normalization, foreign keys
   - YAML: anchors, merge keys
   - Terraform: state management, modules

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/tour-builder-prompt.md
git commit -m "feat(agents): extend tour builder for non-code file stops"
```

---

## Task 12: Update Agent Prompts — Graph Reviewer

**Files:**
- Modify: `understand-anything-plugin/skills/understand/graph-reviewer-prompt.md`

**Step 1: Update validation for new node/edge types**

Key changes:
1. Add new node types to the valid type list in the validation script
2. Add new edge types to the valid type list
3. Add quality checks for non-code nodes:
   - Config nodes should have `configures` edges
   - Document nodes should have `documents` edges
   - Service nodes should have `deploys` edges
   - Table nodes should reference columns

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/graph-reviewer-prompt.md
git commit -m "feat(agents): update graph reviewer for new node/edge types"
```

---

## Task 13: Add Language Context Snippets

**Files:**
- Create: `understand-anything-plugin/skills/understand/languages/markdown.md`
- Create: `understand-anything-plugin/skills/understand/languages/yaml.md`
- Create: `understand-anything-plugin/skills/understand/languages/json.md`
- Create: `understand-anything-plugin/skills/understand/languages/sql.md`
- Create: `understand-anything-plugin/skills/understand/languages/dockerfile.md`
- Create: `understand-anything-plugin/skills/understand/languages/terraform.md`
- Create: `understand-anything-plugin/skills/understand/languages/graphql.md`
- Create: `understand-anything-plugin/skills/understand/languages/protobuf.md`
- Create: `understand-anything-plugin/skills/understand/languages/shell.md`
- Create: `understand-anything-plugin/skills/understand/languages/html.md`
- Create: `understand-anything-plugin/skills/understand/languages/css.md`

Each snippet follows the pattern of existing `typescript.md` / `python.md`:

```markdown
# Markdown

## Key Concepts
- Heading hierarchy (# through ######)
- Front matter (YAML metadata between --- delimiters)
- Code blocks (fenced with ``` or indented)
- Reference-style links
- Tables (pipe-delimited)

## Notable File Patterns
- `README.md` — Project overview (high-value entry point)
- `CONTRIBUTING.md` — Contribution guidelines
- `CHANGELOG.md` — Version history
- `docs/**/*.md` — Documentation directory

## Edge Patterns
- Markdown files `documents` the code components they describe
- Links to other .md files create `related` edges
- Code block references may imply `depends_on` edges

## Summary Style
> "Comprehensive guide document with N sections covering [topics]"
```

**Step 1: Create all 11 language snippets**

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/languages/
git commit -m "feat(agents): add language context snippets for 11 non-code file types"
```

---

## Task 14: Update SKILL.md — Main Pipeline

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

**Step 1: Update the pipeline to handle non-code files**

Key changes:
1. **Phase 1 (SCAN)**: Update file batching to include non-code files. Add `fileCategory` to batch metadata.
2. **Phase 2 (ANALYZE)**: Update batch construction to group related non-code files together (e.g., Dockerfile + docker-compose.yml). Pass `fileCategory` to file-analyzer prompt.
3. **Phase 4 (ARCHITECTURE)**: Inject non-code language snippets for detected non-code languages.
4. **Phase 5 (TOUR)**: Include non-code nodes in tour candidate pool.
5. **Phase 7 (SAVE)**: No changes needed (schema handles new types).
6. **Node/Edge reference table**: Add the 8 new node types and 8 new edge types.

**Step 2: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(pipeline): update main skill pipeline for non-code file analysis"
```

---

## Task 15: Dashboard — Add Node Type Colors to Theme Presets

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/themes/presets.ts:1-143`

**Step 1: Add 8 new node type colors to all 5 presets**

Add these color entries to each preset's `colors` object:

For dark presets:
```typescript
"node-config": "#5eead4",    // Teal
"node-document": "#7dd3fc",  // Sky blue
"node-service": "#a78bfa",   // Violet
"node-table": "#6ee7b7",     // Emerald
"node-endpoint": "#fdba74",  // Orange
"node-pipeline": "#fda4af",  // Rose
"node-schema": "#fcd34d",    // Amber
"node-resource": "#a5b4fc",  // Indigo
```

For light preset, use slightly darker versions:
```typescript
"node-config": "#14b8a6",
"node-document": "#38bdf8",
"node-service": "#8b5cf6",
"node-table": "#34d399",
"node-endpoint": "#fb923c",
"node-pipeline": "#fb7185",
"node-schema": "#facc15",
"node-resource": "#818cf8",
```

**Step 2: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/themes/presets.ts
git commit -m "feat(dashboard): add 8 new node type colors to all theme presets"
```

---

## Task 16: Dashboard — Update CustomNode Component

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx:1-137`

**Step 1: Add new entries to typeColors and typeTextColors maps**

```typescript
const typeColors: Record<string, string> = {
  file: "var(--color-node-file)",
  function: "var(--color-node-function)",
  class: "var(--color-node-class)",
  module: "var(--color-node-module)",
  concept: "var(--color-node-concept)",
  config: "var(--color-node-config)",
  document: "var(--color-node-document)",
  service: "var(--color-node-service)",
  table: "var(--color-node-table)",
  endpoint: "var(--color-node-endpoint)",
  pipeline: "var(--color-node-pipeline)",
  schema: "var(--color-node-schema)",
  resource: "var(--color-node-resource)",
};

const typeTextColors: Record<string, string> = {
  file: "text-node-file",
  function: "text-node-function",
  class: "text-node-class",
  module: "text-node-module",
  concept: "text-node-concept",
  config: "text-node-config",
  document: "text-node-document",
  service: "text-node-service",
  table: "text-node-table",
  endpoint: "text-node-endpoint",
  pipeline: "text-node-pipeline",
  schema: "text-node-schema",
  resource: "text-node-resource",
};
```

**Step 2: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/CustomNode.tsx
git commit -m "feat(dashboard): add new node type colors to CustomNode"
```

---

## Task 17: Dashboard — Update NodeInfo Sidebar

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx:1-312`

**Step 1: Add badge colors for new node types**

Add to `typeBadgeColors`:
```typescript
config: "text-node-config border border-node-config/30 bg-node-config/10",
document: "text-node-document border border-node-document/30 bg-node-document/10",
service: "text-node-service border border-node-service/30 bg-node-service/10",
table: "text-node-table border border-node-table/30 bg-node-table/10",
endpoint: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
pipeline: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
schema: "text-node-schema border border-node-schema/30 bg-node-schema/10",
resource: "text-node-resource border border-node-resource/30 bg-node-resource/10",
```

**Step 2: Add directional labels for new edge types**

Add to `getDirectionalLabel()`:
```typescript
case "deploys":
  return isSource ? "deploys" : "deployed by";
case "serves":
  return isSource ? "serves" : "served by";
case "migrates":
  return isSource ? "migrates" : "migrated by";
case "documents":
  return isSource ? "documents" : "documented by";
case "provisions":
  return isSource ? "provisions" : "provisioned by";
case "routes":
  return isSource ? "routes to" : "routed from";
case "defines_schema":
  return isSource ? "defines schema for" : "schema defined by";
case "triggers":
  return isSource ? "triggers" : "triggered by";
```

**Step 3: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx
git commit -m "feat(dashboard): add new node/edge type support to NodeInfo sidebar"
```

---

## Task 18: Dashboard — Update ProjectOverview with File Type Breakdown

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx`

**Step 1: Add file type distribution**

Add a "File Types" section after the stats grid that shows count per node type category:
- Code: file + function + class
- Config: config
- Docs: document
- Infra: service + resource + pipeline
- Data: table + endpoint + schema

Use colored dots matching the node type colors.

**Step 2: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/ProjectOverview.tsx
git commit -m "feat(dashboard): add file type breakdown to ProjectOverview"
```

---

## Task 19: Dashboard — Add Filter Controls

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/store.ts`
- Modify: `understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx`
- Modify: `understand-anything-plugin/packages/dashboard/src/App.tsx`

**Step 1: Add filter state to store**

Add to the Zustand store:
```typescript
nodeTypeFilters: Record<string, boolean>; // { code: true, config: true, docs: true, infra: true, data: true }
toggleNodeTypeFilter: (category: string) => void;
```

Default all categories to `true` (visible).

**Step 2: Apply filters in GraphView topology computation**

In `useLayerDetailTopology`, filter nodes based on `nodeTypeFilters` before layout.

**Step 3: Add filter checkboxes to App.tsx header**

Add small checkbox toggles next to the layer legend for each category.

**Step 4: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/store.ts understand-anything-plugin/packages/dashboard/src/components/GraphView.tsx understand-anything-plugin/packages/dashboard/src/App.tsx
git commit -m "feat(dashboard): add node type category filter controls"
```

---

## Task 20: Dashboard Build Verification

**Step 1: Build the dashboard**

Run: `pnpm --filter @understand-anything/dashboard build`
Expected: Success, no TypeScript errors

**Step 2: Build the core package**

Run: `pnpm --filter @understand-anything/core build`
Expected: Success

**Step 3: Run all core tests**

Run: `pnpm --filter @understand-anything/core test`
Expected: All tests pass

**Step 4: Run lint**

Run: `pnpm lint`
Expected: No errors

**Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "fix: lint and build fixes for universal file type support"
```

---

## Task 21: Integration Test — End-to-End Verification

**Step 1: Dev server smoke test**

Run: `pnpm dev:dashboard`
- Load a knowledge graph that includes non-code nodes
- Verify new node types render with correct colors
- Verify NodeInfo sidebar shows new edge labels
- Verify filter controls work

**Step 2: Generate test graph with non-code nodes**

Update `scripts/generate-large-graph.mjs` to include non-code node types in the random generation, then generate a test graph and load it in the dashboard.

**Step 3: Commit**

```bash
git add scripts/generate-large-graph.mjs
git commit -m "feat(scripts): include non-code node types in test graph generator"
```

---

## Task 22: Version Bump & Final Commit

**Files:**
- Modify: `understand-anything-plugin/package.json` → bump version
- Modify: `.claude-plugin/marketplace.json` → bump version
- Modify: `.claude-plugin/plugin.json` → bump version
- Modify: `.cursor-plugin/plugin.json` → bump version

**Step 1: Bump version in all 4 files** (e.g., 1.3.0 → 1.4.0)

**Step 2: Final commit**

```bash
git add understand-anything-plugin/package.json .claude-plugin/marketplace.json .claude-plugin/plugin.json .cursor-plugin/plugin.json
git commit -m "chore: bump version to 1.4.0 for universal file type support"
```

---

## Summary of All Tasks

| # | Task | Files | Depends On |
|---|------|-------|------------|
| 1 | Extend core types | types.ts | — |
| 2 | Extend schema validation | schema.ts | 1 |
| 3 | Update PluginRegistry | registry.ts | 1 |
| 4 | Add 26 language configs | languages/configs/ | 1 |
| 5 | Build 12 custom parsers | plugins/parsers/ | 1, 3 |
| 6 | Update GraphBuilder | graph-builder.ts | 1 |
| 7 | Update core exports | index.ts | 1-6 |
| 8 | Update project-scanner prompt | project-scanner-prompt.md | — |
| 9 | Update file-analyzer prompt | file-analyzer-prompt.md | — |
| 10 | Update architecture-analyzer prompt | architecture-analyzer-prompt.md | — |
| 11 | Update tour-builder prompt | tour-builder-prompt.md | — |
| 12 | Update graph-reviewer prompt | graph-reviewer-prompt.md | — |
| 13 | Add language context snippets | languages/*.md | — |
| 14 | Update SKILL.md pipeline | SKILL.md | 8-13 |
| 15 | Dashboard theme colors | presets.ts | — |
| 16 | Dashboard CustomNode | CustomNode.tsx | 15 |
| 17 | Dashboard NodeInfo | NodeInfo.tsx | 15 |
| 18 | Dashboard ProjectOverview | ProjectOverview.tsx | 15 |
| 19 | Dashboard filter controls | store.ts, GraphView.tsx, App.tsx | 15-18 |
| 20 | Build verification | — | 1-19 |
| 21 | Integration test | — | 20 |
| 22 | Version bump | package.json × 4 | 21 |

**Parallelizable groups:**
- Tasks 1-7 (core) are sequential
- Tasks 8-14 (agent prompts) can run in parallel with each other, and in parallel with Tasks 15-19 (dashboard)
- Tasks 20-22 are sequential and depend on all prior tasks

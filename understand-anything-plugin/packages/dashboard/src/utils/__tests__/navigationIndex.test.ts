import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import {
  buildNavigationIndex,
  importTargetForSpecifier,
  isImportSpecifierToken,
  sourceFileIdForNode,
  type NavigationToken,
} from "../navigationIndex";

const graph = {
  version: "1", project: { name: "x", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" }, layers: [], tour: [],
  nodes: [
    { id: "file:a", type: "file", name: "a", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" },
    { id: "file:b", type: "file", name: "b", filePath: "src/lib/b.ts", summary: "", tags: [], complexity: "simple" },
    { id: "function:b:run", type: "function", name: "run", filePath: "src/lib/b.ts", summary: "", tags: [], complexity: "simple" },
    { id: "function:a:run", type: "function", name: "run", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" },
  ], edges: [
    { source: "file:a", target: "file:b", type: "imports", direction: "forward", weight: 1 },
    { source: "file:b", target: "function:b:run", type: "contains", direction: "forward", weight: 1 },
  ],
} as unknown as KnowledgeGraph;

describe("navigation index", () => {
  it("resolves symbols to file nodes and retains duplicate choices", () => {
    const index = buildNavigationIndex(graph);
    expect(index.symbols.get("run")).toEqual(["file:b", "file:a"]);
  });
  it("resolves only an evidenced relative import target", () => {
    const index = buildNavigationIndex(graph);
    expect(importTargetForSpecifier(index, "file:a", "'./lib/b'")).toBe("file:b");
    expect(importTargetForSpecifier(index, "file:a", "'react'")).toBeNull();
  });

  it("resolves extension and index variants only through file import evidence", () => {
    const fixture = {
      ...graph,
      nodes: [
        { id: "file:entry", type: "file", name: "entry", filePath: "packages/app/src/entry.ts", summary: "", tags: [], complexity: "simple" },
        { id: "file:index", type: "file", name: "index", filePath: "packages/app/src/feature/index.ts", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [{ source: "file:entry", target: "file:index", type: "imports", direction: "forward", weight: 1 }],
    } as unknown as KnowledgeGraph;
    const index = buildNavigationIndex(fixture);

    expect(importTargetForSpecifier(index, "file:entry", "'./feature'")).toBe("file:index");
    expect(importTargetForSpecifier(index, "file:entry", "'./feature/index.ts'")).toBe("file:index");
    expect(importTargetForSpecifier(index, "file:entry", "'@/feature/index'")).toBe("file:index");
  });

  it("resolves @/ aliases from graph paths without assuming a src root", () => {
    const fixture = {
      ...graph,
      nodes: [
        { id: "file:entry", type: "file", name: "entry", filePath: "apps/web/entry.ts", summary: "", tags: [], complexity: "simple" },
        { id: "file:target", type: "file", name: "target", filePath: "apps/web/lib/target.ts", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [{ source: "file:entry", target: "file:target", type: "imports", direction: "forward", weight: 1 }],
    } as unknown as KnowledgeGraph;
    const index = buildNavigationIndex(fixture);

    expect(importTargetForSpecifier(index, "file:entry", "\"@/lib/target\"")).toBe("file:target");
    expect(importTargetForSpecifier(index, "file:entry", "\"~/lib/target.ts\"")).toBe("file:target");
    expect(importTargetForSpecifier(index, "file:entry", "\"@scope/target\"")).toBeNull();
  });

  it("does not choose an ambiguous alias or relative target", () => {
    const fixture = {
      ...graph,
      nodes: [
        { id: "file:entry", type: "file", name: "entry", filePath: "app/entry.ts", summary: "", tags: [], complexity: "simple" },
        { id: "file:one", type: "file", name: "one", filePath: "app/lib/target.ts", summary: "", tags: [], complexity: "simple" },
        { id: "file:two", type: "file", name: "two", filePath: "vendor/lib/target.ts", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [
        { source: "file:entry", target: "file:one", type: "imports", direction: "forward", weight: 1 },
        { source: "file:entry", target: "file:two", type: "imports", direction: "forward", weight: 1 },
      ],
    } as unknown as KnowledgeGraph;
    const index = buildNavigationIndex(fixture);

    expect(importTargetForSpecifier(index, "file:entry", "'@/lib/target'")).toBeNull();
    expect(importTargetForSpecifier(index, "file:entry", "'./lib/target'")).toBe("file:one");
  });

  it("uses contains or an unambiguous filePath fallback and deduplicates candidates", () => {
    const fixture = {
      ...graph,
      nodes: [
        { id: "file:owner", type: "file", name: "owner", filePath: "src/owner.ts", summary: "", tags: [], complexity: "simple" },
        { id: "function:contained", type: "function", name: "contained", filePath: "src/owner.ts", summary: "", tags: [], complexity: "simple" },
        { id: "function:fallback", type: "function", name: "fallback", filePath: "src/owner.ts", summary: "", tags: [], complexity: "simple" },
        { id: "function:missing", type: "function", name: "missing", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [{ source: "file:owner", target: "function:contained", type: "contains", direction: "forward", weight: 1 }],
    } as unknown as KnowledgeGraph;
    const index = buildNavigationIndex(fixture);

    expect(sourceFileIdForNode(index, "function:contained")).toBe("file:owner");
    expect(sourceFileIdForNode(index, "function:fallback")).toBe("file:owner");
    expect(index.symbols.get("contained")).toEqual(["file:owner"]);
    expect(index.symbols.get("fallback")).toEqual(["file:owner"]);
    expect(sourceFileIdForNode(index, "function:missing")).toBeNull();
  });

  it("rejects a filePath fallback when duplicate file nodes make it ambiguous", () => {
    const fixture = {
      ...graph,
      nodes: [
        { id: "file:one", type: "file", name: "one", filePath: "src/same.ts", summary: "", tags: [], complexity: "simple" },
        { id: "file:two", type: "file", name: "two", filePath: "src/same.ts", summary: "", tags: [], complexity: "simple" },
        { id: "function:same", type: "function", name: "same", filePath: "src/same.ts", summary: "", tags: [], complexity: "simple" },
      ], edges: [],
    } as unknown as KnowledgeGraph;
    const index = buildNavigationIndex(fixture);
    expect(sourceFileIdForNode(index, "function:same")).toBeNull();
    expect(index.symbols.has("same")).toBe(false);
  });
});

function token(content: string, ...types: string[]): NavigationToken {
  return { content, types };
}

function importContext(...parts: NavigationToken[]): readonly (readonly NavigationToken[])[] {
  return [parts];
}

describe("import token context", () => {
  it.each([
    ["side-effect import", importContext(token("import"), token(" "), token("\"./target\"", "string"))],
    ["from import", importContext(token("import x from "), token("\"./target\"", "string"))],
    ["export from", importContext(token("export { x } from "), token("\"./target\"", "string"))],
    ["require call", importContext(token("require("), token("\"./target\"", "string"))],
    ["dynamic import", importContext(token("import("), token("\"./target\"", "string"))],
    ["multiline import", [[token("import")], [token(" "), token("\"./target\"", "string")]]],
  ])("accepts %s", (_name, context) => {
    const lines = context as readonly (readonly NavigationToken[])[];
    const lineIndex = lines.length - 1;
    const tokenIndex = lines[lineIndex].length - 1;
    expect(isImportSpecifierToken(lines, lineIndex, tokenIndex)).toBe(true);
  });

  it.each([
    ["ordinary string", importContext(token("const path = "), token("\"./target\"", "string"))],
    ["comment", importContext(token("// import \"./target\"", "comment"), token("\"./target\"", "string"))],
    ["block comment", importContext(token("/* import from \"./target\" */", "comment"), token("\"./target\"", "string"))],
    ["template literal", importContext(token("const path = `./target`", "template-string"))],
    ["property require", importContext(token("loader.require("), token("\"./target\"", "string"))],
    ["property import", importContext(token("loader.import("), token("\"./target\"", "string"))],
  ])("rejects %s", (_name, context) => {
    const lines = context as readonly (readonly NavigationToken[])[];
    expect(isImportSpecifierToken(lines, lines.length - 1, lines[lines.length - 1].length - 1)).toBe(false);
  });
});

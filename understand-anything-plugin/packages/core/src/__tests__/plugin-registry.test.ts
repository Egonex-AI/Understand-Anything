import { describe, it, expect } from "vitest";
import { PluginRegistry } from "../plugins/registry.js";
import { registerAllParsers } from "../plugins/parsers/index.js";
import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution } from "../types.js";

const emptyAnalysis: StructuralAnalysis = {
  functions: [],
  classes: [],
  imports: [],
  exports: [],
};

function createMockPlugin(name: string, languages: string[]): AnalyzerPlugin {
  return {
    name,
    languages,
    analyzeFile: () => ({ ...emptyAnalysis }),
    resolveImports: () => [],
  };
}

describe("PluginRegistry", () => {
  it("registers a plugin", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("test", ["typescript"]);
    registry.register(plugin);
    expect(registry.getPlugins()).toHaveLength(1);
  });

  it("finds plugin by language", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript", "javascript"]);
    registry.register(plugin);
    expect(registry.getPluginForLanguage("typescript")).toBe(plugin);
    expect(registry.getPluginForLanguage("javascript")).toBe(plugin);
  });

  it("returns null for unsupported language", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));
    expect(registry.getPluginForLanguage("python")).toBeNull();
  });

  it("finds plugin by file extension", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript"]);
    registry.register(plugin);
    expect(registry.getPluginForFile("src/index.ts")).toBe(plugin);
    expect(registry.getPluginForFile("src/app.tsx")).toBe(plugin);
  });

  it("maps common extensions to languages", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("multi", ["python", "go", "rust"]);
    registry.register(plugin);
    expect(registry.getPluginForFile("main.py")).toBe(plugin);
    expect(registry.getPluginForFile("main.go")).toBe(plugin);
    expect(registry.getPluginForFile("main.rs")).toBe(plugin);
  });

  it("lists all registered plugins", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("a", ["typescript"]));
    registry.register(createMockPlugin("b", ["python"]));
    expect(registry.getPlugins()).toHaveLength(2);
  });

  it("lists supported languages", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("a", ["typescript", "javascript"]));
    registry.register(createMockPlugin("b", ["python"]));
    const langs = registry.getSupportedLanguages();
    expect(langs).toContain("typescript");
    expect(langs).toContain("python");
  });

  it("unregisters a plugin by name", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("removable", ["typescript"]));
    expect(registry.getPlugins()).toHaveLength(1);
    registry.unregister("removable");
    expect(registry.getPlugins()).toHaveLength(0);
  });

  it("later registration takes priority for same language", () => {
    const registry = new PluginRegistry();
    const first = createMockPlugin("first", ["typescript"]);
    const second = createMockPlugin("second", ["typescript"]);
    registry.register(first);
    registry.register(second);
    expect(registry.getPluginForLanguage("typescript")?.name).toBe("second");
  });

  it("analyzeFile delegates to correct plugin", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript"]);
    plugin.analyzeFile = () => ({
      ...emptyAnalysis,
      functions: [{ name: "hello", lineRange: [1, 5], params: [] }],
    });
    registry.register(plugin);

    const result = registry.analyzeFile("src/test.ts", "const x = 1;");
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
  });

  it("analyzeFile returns null for unsupported files", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));
    const result = registry.analyzeFile("main.py", "print('hello')");
    expect(result).toBeNull();
  });

  it("unregister rebuilds language map correctly", () => {
    const registry = new PluginRegistry();
    const plugin1 = createMockPlugin("plugin1", ["typescript", "javascript"]);
    const plugin2 = createMockPlugin("plugin2", ["python"]);

    registry.register(plugin1);
    registry.register(plugin2);

    expect(registry.getPluginForLanguage("typescript")).toBe(plugin1);
    expect(registry.getPluginForLanguage("python")).toBe(plugin2);

    registry.unregister("plugin1");

    expect(registry.getPluginForLanguage("typescript")).toBeNull();
    expect(registry.getPluginForLanguage("python")).toBe(plugin2);
  });

  it("unregister does nothing for non-existent plugin", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("existing", ["typescript"]);
    registry.register(plugin);

    registry.unregister("non-existent");

    expect(registry.getPlugins()).toHaveLength(1);
    expect(registry.getPluginForLanguage("typescript")).toBe(plugin);
  });

  it("getLanguageForFile returns correct language id", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));

    expect(registry.getLanguageForFile("src/index.ts")).toBe("typescript");
    expect(registry.getLanguageForFile("src/component.tsx")).toBe("typescript");
  });

  it("getLanguageForFile returns null for unsupported extensions", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));

    expect(registry.getLanguageForFile("unknown.xyz")).toBeNull();
  });

  it("resolveImports delegates to correct plugin", () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin("ts-plugin", ["typescript"]);
    const mockImports: ImportResolution[] = [
      {
        source: "./utils",
        resolvedPath: "./utils.ts",
        specifiers: [],
      },
    ];
    plugin.resolveImports = () => mockImports;
    registry.register(plugin);

    const result = registry.resolveImports("src/index.ts", "import './utils'");
    expect(result).toEqual(mockImports);
  });

  it("resolveImports returns null for unsupported files", () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin("ts-plugin", ["typescript"]));

    const result = registry.resolveImports("main.py", "import os");
    expect(result).toBeNull();
  });

  it("handles plugins with optional resolveImports (non-code plugins)", () => {
    const markdownPlugin: AnalyzerPlugin = {
      name: "markdown",
      languages: ["markdown"],
      analyzeFile: () => ({ functions: [], classes: [], imports: [], exports: [] }),
      // No resolveImports — optional for non-code plugins
    };
    const registry = new PluginRegistry();
    registry.register(markdownPlugin);
    const result = registry.resolveImports("README.md", "# Hello");
    expect(result).toBeNull();
  });
});

describe("registerAllParsers smoke test", () => {
  it("all registered parsers return valid StructuralAnalysis for minimal content", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);

    // Map of file extension -> minimal content for each parser
    const testCases: [string, string][] = [
      ["README.md", "# Hello"],
      ["config.yaml", "key: value"],
      ["config.json", '{"key": "value"}'],
      ["config.toml", 'key = "value"'],
      [".env", "KEY=value"],
      ["Dockerfile", "FROM node:22"],
      ["schema.sql", "CREATE TABLE t (id INT);"],
      ["schema.graphql", "type Query { hello: String }"],
      ["types.proto", 'syntax = "proto3";'],
      ["main.tf", 'resource "null" "r" {}'],
      ["Makefile", "build:\n\techo build"],
      ["script.sh", "#!/bin/bash\necho hello"],
    ];

    for (const [filePath, content] of testCases) {
      const result = registry.analyzeFile(filePath, content);
      expect(result, `analyzeFile should return a result for ${filePath}`).not.toBeNull();
      // Verify basic structural analysis shape
      expect(result).toHaveProperty("functions");
      expect(result).toHaveProperty("classes");
      expect(result).toHaveProperty("imports");
      expect(result).toHaveProperty("exports");
    }
  });
});

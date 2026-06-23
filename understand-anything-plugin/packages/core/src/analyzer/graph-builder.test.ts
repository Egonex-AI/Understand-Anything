import { describe, it, expect, vi } from "vitest";
import { GraphBuilder } from "./graph-builder.js";
import type { StructuralAnalysis } from "../types.js";

describe("GraphBuilder", () => {
  it("should create file nodes from file list", () => {
    const builder = new GraphBuilder("test-project", "abc123");

    builder.addFile("src/index.ts", {
      summary: "Entry point",
      tags: ["entry"],
      complexity: "simple",
    });
    builder.addFile("src/utils.ts", {
      summary: "Utility functions",
      tags: ["utility"],
      complexity: "moderate",
    });

    const graph = builder.build();

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({
      id: "file:src/index.ts",
      type: "file",
      name: "index.ts",
      filePath: "src/index.ts",
      summary: "Entry point",
      tags: ["entry"],
      complexity: "simple",
    });
    expect(graph.nodes[1]).toMatchObject({
      id: "file:src/utils.ts",
      type: "file",
      name: "utils.ts",
      filePath: "src/utils.ts",
      summary: "Utility functions",
    });
  });

  it("should create function and class nodes from structural analysis", () => {
    const builder = new GraphBuilder("test-project", "abc123");
    const analysis: StructuralAnalysis = {
      functions: [
        { name: "processData", lineRange: [10, 25], params: ["input"], returnType: "string" },
        { name: "validate", lineRange: [30, 40], params: ["data"] },
      ],
      classes: [
        { name: "DataStore", lineRange: [50, 100], methods: ["get", "set"], properties: ["data"] },
      ],
      imports: [],
      exports: [],
    };

    builder.addFileWithAnalysis("src/service.ts", analysis, {
      summary: "Service module",
      tags: ["service"],
      complexity: "complex",
      fileSummary: "Handles data processing",
      summaries: {
        processData: "Processes raw input data",
        validate: "Validates data format",
        DataStore: "Manages stored data",
      },
    });

    const graph = builder.build();

    // 1 file + 2 functions + 1 class = 4 nodes
    expect(graph.nodes).toHaveLength(4);

    const fileNode = graph.nodes.find((n) => n.id === "file:src/service.ts");
    expect(fileNode).toBeDefined();
    expect(fileNode!.type).toBe("file");
    expect(fileNode!.summary).toBe("Handles data processing");

    const funcNode = graph.nodes.find((n) => n.id === "function:src/service.ts:processData");
    expect(funcNode).toBeDefined();
    expect(funcNode!.type).toBe("function");
    expect(funcNode!.name).toBe("processData");
    expect(funcNode!.lineRange).toEqual([10, 25]);
    expect(funcNode!.summary).toBe("Processes raw input data");

    const validateNode = graph.nodes.find((n) => n.id === "function:src/service.ts:validate");
    expect(validateNode).toBeDefined();
    expect(validateNode!.summary).toBe("Validates data format");

    const classNode = graph.nodes.find((n) => n.id === "class:src/service.ts:DataStore");
    expect(classNode).toBeDefined();
    expect(classNode!.type).toBe("class");
    expect(classNode!.name).toBe("DataStore");
    expect(classNode!.summary).toBe("Manages stored data");
  });

  it("should create contains edges between files and their functions/classes", () => {
    const builder = new GraphBuilder("test-project", "abc123");
    const analysis: StructuralAnalysis = {
      functions: [
        { name: "helper", lineRange: [5, 15], params: [] },
      ],
      classes: [
        { name: "Widget", lineRange: [20, 50], methods: [], properties: [] },
      ],
      imports: [],
      exports: [],
    };

    builder.addFileWithAnalysis("src/widget.ts", analysis, {
      summary: "Widget module",
      tags: [],
      complexity: "moderate",
      fileSummary: "Widget component",
      summaries: { helper: "Helper function", Widget: "Widget class" },
    });

    const graph = builder.build();

    const containsEdges = graph.edges.filter((e) => e.type === "contains");
    expect(containsEdges).toHaveLength(2);

    expect(containsEdges[0]).toMatchObject({
      source: "file:src/widget.ts",
      target: "function:src/widget.ts:helper",
      type: "contains",
      direction: "forward",
      weight: 1,
    });
    expect(containsEdges[1]).toMatchObject({
      source: "file:src/widget.ts",
      target: "class:src/widget.ts:Widget",
      type: "contains",
      direction: "forward",
      weight: 1,
    });
  });

  it("should create import edges between files", () => {
    const builder = new GraphBuilder("test-project", "abc123");

    builder.addFile("src/index.ts", {
      summary: "Entry",
      tags: [],
      complexity: "simple",
    });
    builder.addFile("src/utils.ts", {
      summary: "Utils",
      tags: [],
      complexity: "simple",
    });

    builder.addImportEdge("src/index.ts", "src/utils.ts");

    const graph = builder.build();
    const importEdges = graph.edges.filter((e) => e.type === "imports");
    expect(importEdges).toHaveLength(1);
    expect(importEdges[0]).toMatchObject({
      source: "file:src/index.ts",
      target: "file:src/utils.ts",
      type: "imports",
      direction: "forward",
    });
  });

  it("should create call edges between functions", () => {
    const builder = new GraphBuilder("test-project", "abc123");

    builder.addCallEdge("src/index.ts", "main", "src/utils.ts", "helper");

    const graph = builder.build();
    const callEdges = graph.edges.filter((e) => e.type === "calls");
    expect(callEdges).toHaveLength(1);
    expect(callEdges[0]).toMatchObject({
      source: "function:src/index.ts:main",
      target: "function:src/utils.ts:helper",
      type: "calls",
      direction: "forward",
    });
  });

  it("should set project metadata correctly", () => {
    const builder = new GraphBuilder("my-awesome-project", "deadbeef");

    builder.addFile("src/app.ts", {
      summary: "App",
      tags: [],
      complexity: "simple",
    });
    builder.addFile("src/script.py", {
      summary: "Script",
      tags: [],
      complexity: "simple",
    });

    const graph = builder.build();

    expect(graph.version).toBe("1.0.0");
    expect(graph.project.name).toBe("my-awesome-project");
    expect(graph.project.gitCommitHash).toBe("deadbeef");
    expect(graph.project.languages).toEqual(["python", "typescript"]);
    expect(graph.project.analyzedAt).toBeTruthy();
    expect(graph.layers).toEqual([]);
    expect(graph.tour).toEqual([]);
  });

  it("should detect languages from file extensions", () => {
    const builder = new GraphBuilder("polyglot", "hash123");

    builder.addFile("main.go", { summary: "", tags: [], complexity: "simple" });
    builder.addFile("lib.rs", { summary: "", tags: [], complexity: "simple" });
    builder.addFile("app.js", { summary: "", tags: [], complexity: "simple" });

    const graph = builder.build();
    expect(graph.project.languages).toEqual(["go", "javascript", "rust"]);
  });

  describe("Non-code file support", () => {
    it("adds non-code file nodes with correct types and nodeType-prefixed ID", () => {
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
      expect(graph.nodes[0].id).toBe("document:README.md");
    });

    it("adds non-code child nodes (definitions)", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("schema.sql", {
        nodeType: "file",
        summary: "Database schema",
        tags: ["database"],
        complexity: "moderate",
        definitions: [
          { name: "users", kind: "table", lineRange: [1, 20] as [number, number], fields: ["id", "name", "email"] },
        ],
      });
      const graph = builder.build();
      // File node + table child node
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes[1].type).toBe("table");
      expect(graph.nodes[1].name).toBe("users");
      // Contains edge
      expect(graph.edges.some(e => e.type === "contains" && e.target.includes("users"))).toBe(true);
    });

    it("adds service child nodes", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("docker-compose.yml", {
        nodeType: "config",
        summary: "Docker compose config",
        tags: ["infra"],
        complexity: "moderate",
        services: [
          { name: "web", image: "node:22", ports: [3000] },
          { name: "db", image: "postgres:15", ports: [5432] },
        ],
      });
      const graph = builder.build();
      // File node + 2 service child nodes
      expect(graph.nodes).toHaveLength(3);
      expect(graph.nodes[1].type).toBe("service");
      expect(graph.nodes[1].name).toBe("web");
      expect(graph.nodes[2].type).toBe("service");
      expect(graph.nodes[2].name).toBe("db");
    });

    it("adds endpoint child nodes", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("schema.graphql", {
        nodeType: "schema",
        summary: "GraphQL schema",
        tags: ["api"],
        complexity: "moderate",
        endpoints: [
          { method: "Query", path: "users", lineRange: [5, 5] as [number, number] },
        ],
      });
      const graph = builder.build();
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes[1].type).toBe("endpoint");
    });

    it("adds resource child nodes", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("main.tf", {
        nodeType: "resource",
        summary: "Terraform config",
        tags: ["infra"],
        complexity: "moderate",
        resources: [
          { name: "aws_s3_bucket.main", kind: "aws_s3_bucket", lineRange: [1, 10] as [number, number] },
        ],
      });
      const graph = builder.build();
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes[1].type).toBe("resource");
      expect(graph.nodes[1].name).toBe("aws_s3_bucket.main");
    });

    it("adds step child nodes", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("Makefile", {
        nodeType: "pipeline",
        summary: "Build targets",
        tags: ["build"],
        complexity: "simple",
        steps: [
          { name: "build", lineRange: [1, 3] as [number, number] },
          { name: "test", lineRange: [5, 7] as [number, number] },
        ],
      });
      const graph = builder.build();
      expect(graph.nodes).toHaveLength(3);
      expect(graph.nodes[1].type).toBe("pipeline");
      expect(graph.nodes[1].name).toBe("build");
    });

    it("detects non-code languages from EXTENSION_LANGUAGE map", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addFile("config.yaml", { summary: "Config", tags: [], complexity: "simple" });
      const graph = builder.build();
      expect(graph.project.languages).toContain("yaml");
    });

    it("detects new non-code extensions", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addFile("schema.graphql", { summary: "Schema", tags: [], complexity: "simple" });
      builder.addFile("main.tf", { summary: "Terraform", tags: [], complexity: "simple" });
      builder.addFile("types.proto", { summary: "Protobuf", tags: [], complexity: "simple" });
      const graph = builder.build();
      expect(graph.project.languages).toContain("graphql");
      expect(graph.project.languages).toContain("terraform");
      expect(graph.project.languages).toContain("protobuf");
    });

    it("mapKindToNodeType falls back to concept for unknown kinds and warns", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("schema.sql", {
        nodeType: "file",
        summary: "Schema",
        tags: [],
        complexity: "simple",
        definitions: [
          { name: "doStuff", kind: "procedure", lineRange: [1, 10] as [number, number], fields: [] },
        ],
      });
      const graph = builder.build();
      const childNode = graph.nodes.find(n => n.name === "doStuff");
      expect(childNode).toBeDefined();
      expect(childNode!.type).toBe("concept");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown definition kind "procedure"'),
      );
      warnSpy.mockRestore();
    });

    it("skips duplicate node IDs in addNonCodeFileWithAnalysis and warns", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("schema.sql", {
        nodeType: "file",
        summary: "Schema",
        tags: [],
        complexity: "simple",
        definitions: [
          { name: "users", kind: "table", lineRange: [1, 10] as [number, number], fields: ["id"] },
          { name: "users", kind: "table", lineRange: [12, 20] as [number, number], fields: ["id", "name"] },
        ],
      });
      const graph = builder.build();
      // Only the file node + one table node (duplicate skipped)
      const tableNodes = graph.nodes.filter(n => n.name === "users");
      expect(tableNodes).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate node ID "table:schema.sql:users"'),
      );
      warnSpy.mockRestore();
    });

    it("uses nodeType in fileId for contains edges", () => {
      const builder = new GraphBuilder("test", "abc123");
      builder.addNonCodeFileWithAnalysis("docker-compose.yml", {
        nodeType: "config",
        summary: "Docker compose config",
        tags: [],
        complexity: "simple",
        services: [
          { name: "web", ports: [3000] },
        ],
      });
      const graph = builder.build();
      const containsEdge = graph.edges.find(e => e.type === "contains");
      expect(containsEdge).toBeDefined();
      expect(containsEdge!.source).toBe("config:docker-compose.yml");
      expect(containsEdge!.target).toBe("service:docker-compose.yml:web");
    });
  });
});

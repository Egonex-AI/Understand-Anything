import { describe, it, expect } from "vitest";
import { LanguageRegistry } from "../languages/language-registry.js";
import { StrictLanguageConfigSchema } from "../languages/types.js";
import { typescriptConfig } from "../languages/configs/typescript.js";
import { pythonConfig } from "../languages/configs/python.js";

describe("LanguageRegistry", () => {
  it("registers and retrieves a language config by id", () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptConfig);
    expect(registry.getById("typescript")).toEqual(typescriptConfig);
  });

  it("retrieves config by file extension", () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptConfig);
    expect(registry.getByExtension(".ts")?.id).toBe("typescript");
    expect(registry.getByExtension(".tsx")?.id).toBe("typescript");
  });

  it("retrieves config for a file path", () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptConfig);
    registry.register(pythonConfig);
    expect(registry.getForFile("src/index.ts")?.id).toBe("typescript");
    expect(registry.getForFile("app/models.py")?.id).toBe("python");
  });

  it("returns null for unknown extensions", () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptConfig);
    expect(registry.getByExtension(".xyz")).toBeNull();
    expect(registry.getForFile("file.unknown")).toBeNull();
  });

  it("registers extension aliases for existing languages", () => {
    const registry = LanguageRegistry.createDefault();
    registry.registerExtensionAlias(".customts", "typescript");
    expect(registry.getForFile("src/component.customts")?.id).toBe("typescript");
  });

  it("throws when aliasing an unknown language id", () => {
    const registry = LanguageRegistry.createDefault();
    expect(() => registry.registerExtensionAlias(".custom", "not-a-language")).toThrow(
      'unknown language "not-a-language"',
    );
  });

  it("returns null for files without extensions and no filename match", () => {
    const registry = new LanguageRegistry();
    expect(registry.getForFile("SOMEFILE")).toBeNull();
  });

  it("lists all registered languages", () => {
    const registry = new LanguageRegistry();
    registry.register(typescriptConfig);
    registry.register(pythonConfig);
    const all = registry.getAllLanguages();
    expect(all).toHaveLength(2);
    expect(all.map(c => c.id)).toContain("typescript");
    expect(all.map(c => c.id)).toContain("python");
  });

  describe("createDefault", () => {
    it("registers all 42 built-in language configs", () => {
      const registry = LanguageRegistry.createDefault();
      const all = registry.getAllLanguages();
      expect(all.length).toBe(42);
    });

    it("maps all expected extensions", () => {
      const registry = LanguageRegistry.createDefault();
      expect(registry.getByExtension(".ts")?.id).toBe("typescript");
      expect(registry.getByExtension(".py")?.id).toBe("python");
      expect(registry.getByExtension(".go")?.id).toBe("go");
      expect(registry.getByExtension(".rs")?.id).toBe("rust");
      expect(registry.getByExtension(".java")?.id).toBe("java");
      expect(registry.getByExtension(".rb")?.id).toBe("ruby");
      expect(registry.getByExtension(".php")?.id).toBe("php");
      expect(registry.getByExtension(".swift")?.id).toBe("swift");
      expect(registry.getByExtension(".kt")?.id).toBe("kotlin");
      expect(registry.getByExtension(".scala")?.id).toBe("scala");
      expect(registry.getByExtension(".cs")?.id).toBe("csharp");
      expect(registry.getByExtension(".cpp")?.id).toBe("cpp");
      expect(registry.getByExtension(".c")?.id).toBe("c");
      expect(registry.getByExtension(".h")?.id).toBe("c");
      expect(registry.getByExtension(".lua")?.id).toBe("lua");
      expect(registry.getByExtension(".js")?.id).toBe("javascript");
    });

    it("registers Swift with tree-sitter grammar metadata", () => {
      const registry = LanguageRegistry.createDefault();
      expect(registry.getById("swift")?.treeSitter).toEqual({
        wasmPackage: "@understand-anything/tree-sitter-swift-wasm",
        wasmFile: "tree-sitter-swift.wasm",
      });
    });

    it("has no duplicate extension mappings across configs", () => {
      const registry = LanguageRegistry.createDefault();
      const all = registry.getAllLanguages();
      const allExtensions: string[] = [];
      for (const config of all) {
        allExtensions.push(...config.extensions);
      }
      const unique = new Set(allExtensions);
      expect(unique.size).toBe(allExtensions.length);
    });

    it("every config has at least one concept", () => {
      const registry = LanguageRegistry.createDefault();
      for (const config of registry.getAllLanguages()) {
        expect(config.concepts.length).toBeGreaterThan(0);
      }
    });
  });

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

    it("detects filename-based configs (Dockerfile, Makefile, Jenkinsfile)", () => {
      const registry = LanguageRegistry.createDefault();
      expect(registry.getForFile("Dockerfile")?.id).toBe("dockerfile");
      expect(registry.getForFile("Makefile")?.id).toBe("makefile");
      expect(registry.getForFile("Jenkinsfile")?.id).toBe("jenkinsfile");
      expect(registry.getForFile("src/Dockerfile")?.id).toBe("dockerfile");
      expect(registry.getForFile("build/Makefile")?.id).toBe("makefile");
    });

    it("detects filename-based configs for docker-compose", () => {
      const registry = LanguageRegistry.createDefault();
      expect(registry.getForFile("docker-compose.yml")?.id).toBe("docker-compose");
      expect(registry.getForFile("docker-compose.yaml")?.id).toBe("docker-compose");
      expect(registry.getForFile("compose.yml")?.id).toBe("docker-compose");
    });

    it("detects .env file variants", () => {
      const registry = LanguageRegistry.createDefault();
      expect(registry.getForFile(".env")?.id).toBe("env");
      expect(registry.getForFile(".env.local")?.id).toBe("env");
      expect(registry.getForFile(".env.production")?.id).toBe("env");
    });
  });

  describe("StrictLanguageConfigSchema refinement", () => {
    it("rejects configs with empty extensions AND no filenames", () => {
      const result = StrictLanguageConfigSchema.safeParse({
        id: "empty-lang",
        displayName: "Empty",
        extensions: [],
        concepts: ["nothing"],
        filePatterns: { entryPoints: [], barrels: [], tests: [], config: [] },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least one extension or filename");
      }
    });

    it("rejects configs with empty extensions AND empty filenames", () => {
      const result = StrictLanguageConfigSchema.safeParse({
        id: "empty-lang",
        displayName: "Empty",
        extensions: [],
        filenames: [],
        concepts: ["nothing"],
        filePatterns: { entryPoints: [], barrels: [], tests: [], config: [] },
      });
      expect(result.success).toBe(false);
    });

    it("accepts configs with extensions but no filenames", () => {
      const result = StrictLanguageConfigSchema.safeParse({
        id: "ext-lang",
        displayName: "ExtLang",
        extensions: [".ext"],
        concepts: ["something"],
        filePatterns: { entryPoints: [], barrels: [], tests: [], config: [] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts configs with filenames but empty extensions", () => {
      const result = StrictLanguageConfigSchema.safeParse({
        id: "filename-lang",
        displayName: "FilenameLang",
        extensions: [],
        filenames: ["Specialfile"],
        concepts: ["something"],
        filePatterns: { entryPoints: [], barrels: [], tests: [], config: [] },
      });
      expect(result.success).toBe(true);
    });
  });
});

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  TreeSitterConfigSchema,
  FilePatternConfigSchema,
  LanguageConfigSchema,
  StrictLanguageConfigSchema,
  FrameworkConfigSchema,
} from "../languages/types.js";
import { builtinLanguageConfigs } from "../languages/configs/index.js";
import { builtinFrameworkConfigs } from "../languages/frameworks/index.js";

/** Count config modules (one config per file, index.ts excluded) in a directory. */
function countConfigModules(relativeDir: string): number {
  const dir = fileURLToPath(new URL(relativeDir, import.meta.url));
  return readdirSync(dir).filter(
    (file) => file.endsWith(".ts") && file !== "index.ts"
  ).length;
}

// =============================================================================
// Schema type-level tests
// =============================================================================

describe("TreeSitterConfigSchema", () => {
  it("accepts a valid tree-sitter config", () => {
    const result = TreeSitterConfigSchema.safeParse({
      wasmPackage: "tree-sitter-python",
      wasmFile: "tree-sitter-python.wasm",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when wasmPackage is missing", () => {
    const result = TreeSitterConfigSchema.safeParse({
      wasmFile: "tree-sitter-python.wasm",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when wasmFile is missing", () => {
    const result = TreeSitterConfigSchema.safeParse({
      wasmPackage: "tree-sitter-python",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string values", () => {
    const result = TreeSitterConfigSchema.safeParse({
      wasmPackage: 123,
      wasmFile: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("FilePatternConfigSchema", () => {
  it("accepts a valid file pattern config", () => {
    const result = FilePatternConfigSchema.safeParse({
      entryPoints: ["main.py", "app.py"],
      barrels: ["__init__.py"],
      tests: ["test_*.py"],
      config: ["pyproject.toml"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays (no file patterns needed)", () => {
    const result = FilePatternConfigSchema.safeParse({
      entryPoints: [],
      barrels: [],
      tests: [],
      config: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const result = FilePatternConfigSchema.safeParse({
      entryPoints: [],
      barrels: [],
      tests: [],
      // config is missing
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-array values", () => {
    const result = FilePatternConfigSchema.safeParse({
      entryPoints: "main.py",
      barrels: [],
      tests: [],
      config: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("LanguageConfigSchema (base, no refinement)", () => {
  const validConfig = {
    id: "testlang",
    displayName: "Test Language",
    extensions: [".test"],
    concepts: ["testing", "assertions"],
    filePatterns: {
      entryPoints: [],
      barrels: [],
      tests: ["*.test.ts"],
      config: [],
    },
  };

  it("accepts a complete valid config", () => {
    const result = LanguageConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts config with no extensions and no filenames (content-detected languages)", () => {
    const result = LanguageConfigSchema.safeParse({
      ...validConfig,
      extensions: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with optional treeSitter", () => {
    const result = LanguageConfigSchema.safeParse({
      ...validConfig,
      treeSitter: {
        wasmPackage: "tree-sitter-test",
        wasmFile: "tree-sitter-test.wasm",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with optional filenames", () => {
    const result = LanguageConfigSchema.safeParse({
      ...validConfig,
      filenames: ["SpecialFile"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects config missing id", () => {
    const { id: _id, ...withoutId } = validConfig;
    const result = LanguageConfigSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it("rejects config with empty id", () => {
    const result = LanguageConfigSchema.safeParse({ ...validConfig, id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects config missing displayName", () => {
    const { displayName: _displayName, ...withoutName } = validConfig;
    const result = LanguageConfigSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  it("rejects config missing filePatterns", () => {
    const { filePatterns: _filePatterns, ...withoutPatterns } = validConfig;
    const result = LanguageConfigSchema.safeParse(withoutPatterns);
    expect(result.success).toBe(false);
  });

  it("rejects config with non-array concepts", () => {
    const result = LanguageConfigSchema.safeParse({
      ...validConfig,
      concepts: "not-an-array",
    });
    expect(result.success).toBe(false);
  });
});

describe("StrictLanguageConfigSchema", () => {
  const base = {
    id: "testlang",
    displayName: "Test",
    concepts: ["testing"],
    filePatterns: {
      entryPoints: [],
      barrels: [],
      tests: [],
      config: [],
    },
  };

  it("accepts config with at least one extension", () => {
    const result = StrictLanguageConfigSchema.safeParse({
      ...base,
      extensions: [".test"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with at least one filename (no extensions)", () => {
    const result = StrictLanguageConfigSchema.safeParse({
      ...base,
      extensions: [],
      filenames: ["SpecialFile"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with both extensions and filenames", () => {
    const result = StrictLanguageConfigSchema.safeParse({
      ...base,
      extensions: [".test"],
      filenames: ["SpecialFile"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects config with empty extensions and no filenames field", () => {
    const result = StrictLanguageConfigSchema.safeParse({
      ...base,
      extensions: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "at least one extension or filename"
      );
    }
  });

  it("rejects config with empty extensions and empty filenames", () => {
    const result = StrictLanguageConfigSchema.safeParse({
      ...base,
      extensions: [],
      filenames: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("FrameworkConfigSchema", () => {
  const validFramework = {
    id: "testfw",
    displayName: "Test Framework",
    languages: ["typescript"],
    detectionKeywords: ["test-framework"],
    manifestFiles: ["package.json"],
    promptSnippetPath: "./frameworks/test.md",
  };

  it("accepts a valid framework config with required fields only", () => {
    const result = FrameworkConfigSchema.safeParse(validFramework);
    expect(result.success).toBe(true);
  });

  it("accepts config with optional entryPoints", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      entryPoints: ["src/index.ts"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with optional layerHints", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      layerHints: { routes: "api", models: "data" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects config with empty languages array", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      languages: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects config with empty detectionKeywords array", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      detectionKeywords: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects config with empty manifestFiles array", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      manifestFiles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects config with empty promptSnippetPath", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      promptSnippetPath: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects config with empty language id string in languages array", () => {
    const result = FrameworkConfigSchema.safeParse({
      ...validFramework,
      languages: [""],
    });
    expect(result.success).toBe(false);
  });

  it("rejects config missing required fields", () => {
    const result = FrameworkConfigSchema.safeParse({
      id: "incomplete",
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Batch validation: all built-in language configs
// =============================================================================

describe("Built-in Language Configs", () => {
  // These configs intentionally lack both extensions and filenames because they
  // rely on future content-based detection (e.g. YAML with apiVersion/kind for
  // Kubernetes, files with $schema key for JSON Schema, .github/workflows/*.yml
  // for GitHub Actions). They are valid base LanguageConfigs but intentionally
  // fail StrictLanguageConfigSchema.
  const CONTENT_DETECTED_IDS = new Set([
    "kubernetes",
    "github-actions",
    "json-schema",
  ]);

  it("registers every config module in the configs directory", () => {
    expect(builtinLanguageConfigs).toHaveLength(
      countConfigModules("../languages/configs/")
    );
  });

  it("every config passes base LanguageConfigSchema validation", () => {
    for (const config of builtinLanguageConfigs) {
      const result = LanguageConfigSchema.safeParse(config);
      expect(
        result.success,
        `"${config.id}" should pass base LanguageConfigSchema: ${result.success ? "" : result.error.issues.map((i) => i.message).join(", ")}`
      ).toBe(true);
    }
  });

  it("content-detected configs intentionally fail StrictLanguageConfigSchema", () => {
    for (const config of builtinLanguageConfigs) {
      if (!CONTENT_DETECTED_IDS.has(config.id)) continue;
      const result = StrictLanguageConfigSchema.safeParse(config);
      expect(
        result.success,
        `"${config.id}" is content-detected (no extensions/filenames) and should fail strict validation by design`
      ).toBe(false);
    }
  });

  it("all non-content-detected configs pass StrictLanguageConfigSchema", () => {
    for (const config of builtinLanguageConfigs) {
      if (CONTENT_DETECTED_IDS.has(config.id)) continue;
      const result = StrictLanguageConfigSchema.safeParse(config);
      expect(
        result.success,
        `"${config.id}" should pass StrictLanguageConfigSchema: ${result.success ? "" : JSON.stringify(result.error.issues)}`
      ).toBe(true);
    }
  });

  it("every config has a non-empty id", () => {
    for (const config of builtinLanguageConfigs) {
      expect(config.id.length).toBeGreaterThan(0);
    }
  });

  it("every config has a non-empty displayName", () => {
    for (const config of builtinLanguageConfigs) {
      expect(config.displayName.length).toBeGreaterThan(0);
    }
  });

  it("every config has at least one concept", () => {
    for (const config of builtinLanguageConfigs) {
      expect(
        config.concepts.length,
        `"${config.id}" should have at least one concept`
      ).toBeGreaterThan(0);
    }
  });

  it("all config ids are unique", () => {
    const ids = builtinLanguageConfigs.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("no extension is mapped by more than one config", () => {
    const allExtensions: string[] = [];
    for (const config of builtinLanguageConfigs) {
      allExtensions.push(...config.extensions);
    }
    const unique = new Set(allExtensions);
    expect(unique.size).toBe(allExtensions.length);
  });

  it("configs with treeSitter have valid wasmPackage and wasmFile", () => {
    for (const config of builtinLanguageConfigs) {
      if (!config.treeSitter) continue;
      const tsResult = TreeSitterConfigSchema.safeParse(config.treeSitter);
      expect(
        tsResult.success,
        `"${config.id}" treeSitter should be valid: ${tsResult.success ? "" : JSON.stringify(tsResult.error.issues)}`
      ).toBe(true);
    }
  });

  it("configs with filenames have at least one entry", () => {
    for (const config of builtinLanguageConfigs) {
      if (!config.filenames) continue;
      expect(
        config.filenames.length,
        `"${config.id}" has filenames field but it is empty`
      ).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Batch validation: all built-in framework configs
// =============================================================================

describe("Built-in Framework Configs", () => {
  it("registers every framework module in the frameworks directory", () => {
    expect(builtinFrameworkConfigs).toHaveLength(
      countConfigModules("../languages/frameworks/")
    );
  });

  it("every framework config passes FrameworkConfigSchema validation", () => {
    for (const fw of builtinFrameworkConfigs) {
      const result = FrameworkConfigSchema.safeParse(fw);
      expect(
        result.success,
        `"${fw.id}" should pass FrameworkConfigSchema: ${result.success ? "" : result.error.issues.map((i) => i.message).join(", ")}`
      ).toBe(true);
    }
  });

  it("every framework has a non-empty id", () => {
    for (const fw of builtinFrameworkConfigs) {
      expect(fw.id.length).toBeGreaterThan(0);
    }
  });

  it("every framework has a non-empty displayName", () => {
    for (const fw of builtinFrameworkConfigs) {
      expect(fw.displayName.length).toBeGreaterThan(0);
    }
  });

  it("all framework ids are unique", () => {
    const ids = builtinFrameworkConfigs.map((fw) => fw.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every framework's languages array references known language ids", () => {
    const knownLanguageIds = new Set(builtinLanguageConfigs.map((c) => c.id));
    for (const fw of builtinFrameworkConfigs) {
      for (const langId of fw.languages) {
        expect(
          knownLanguageIds.has(langId),
          `"${fw.id}" references unknown language "${langId}"`
        ).toBe(true);
      }
    }
  });

  it("every framework has at least one detectionKeyword and manifestFile", () => {
    for (const fw of builtinFrameworkConfigs) {
      expect(
        fw.detectionKeywords.length,
        `"${fw.id}" should have at least one detection keyword`
      ).toBeGreaterThan(0);
      expect(
        fw.manifestFiles.length,
        `"${fw.id}" should have at least one manifest file`
      ).toBeGreaterThan(0);
    }
  });

  it("every framework has a non-empty promptSnippetPath", () => {
    for (const fw of builtinFrameworkConfigs) {
      expect(
        fw.promptSnippetPath.length,
        `"${fw.id}" should have a non-empty promptSnippetPath`
      ).toBeGreaterThan(0);
    }
  });

  it("frameworks with layerHints have valid string key-value pairs", () => {
    for (const fw of builtinFrameworkConfigs) {
      if (!fw.layerHints) continue;
      const entries = Object.entries(fw.layerHints);
      expect(
        entries.length,
        `"${fw.id}" layerHints should have at least one entry`
      ).toBeGreaterThan(0);
      for (const [dir, layer] of entries) {
        expect(dir.length).toBeGreaterThan(0);
        expect(layer.length).toBeGreaterThan(0);
      }
    }
  });
});

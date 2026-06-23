import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StructuralAnalysis } from "../types.js";
import {
  contentHash,
  extractFileFingerprint,
  compareFingerprints,
  analyzeChanges,
  type FileFingerprint,
  type FingerprintStore,
} from "../fingerprint.js";

// Mock fs and path for analyzeChanges
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { readFileSync, existsSync } from "node:fs";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contentHash", () => {
  it("produces consistent SHA-256 hashes", () => {
    const hash1 = contentHash("hello world");
    const hash2 = contentHash("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different content", () => {
    expect(contentHash("hello")).not.toBe(contentHash("world"));
  });
});

describe("extractFileFingerprint", () => {
  it("extracts function fingerprints from analysis", () => {
    const analysis: StructuralAnalysis = {
      functions: [
        { name: "main", lineRange: [1, 20], params: ["config", "options"], returnType: "void" },
        { name: "helper", lineRange: [22, 30], params: [], returnType: "string" },
      ],
      classes: [],
      imports: [],
      exports: [{ name: "main", lineNumber: 1 }],
    };

    const fp = extractFileFingerprint("src/index.ts", "const x = 1;\n".repeat(30), analysis);

    expect(fp.filePath).toBe("src/index.ts");
    expect(fp.functions).toHaveLength(2);
    expect(fp.functions[0]).toEqual({
      name: "main",
      params: ["config", "options"],
      returnType: "void",
      exported: true,
      lineCount: 20,
    });
    expect(fp.functions[1]).toEqual({
      name: "helper",
      params: [],
      returnType: "string",
      exported: false,
      lineCount: 9,
    });
  });

  it("extracts class fingerprints", () => {
    const analysis: StructuralAnalysis = {
      functions: [],
      classes: [
        { name: "MyClass", lineRange: [1, 50], methods: ["doStuff", "init"], properties: ["name"] },
      ],
      imports: [],
      exports: [{ name: "MyClass", lineNumber: 1 }],
    };

    const fp = extractFileFingerprint("src/my-class.ts", "x\n".repeat(50), analysis);

    expect(fp.classes).toHaveLength(1);
    expect(fp.classes[0]).toEqual({
      name: "MyClass",
      methods: ["doStuff", "init"],
      properties: ["name"],
      exported: true,
      lineCount: 50,
    });
  });

  it("extracts import and export fingerprints", () => {
    const analysis: StructuralAnalysis = {
      functions: [],
      classes: [],
      imports: [
        { source: "./utils", specifiers: ["format", "parse"], lineNumber: 1 },
        { source: "node:fs", specifiers: ["readFileSync"], lineNumber: 2 },
      ],
      exports: [{ name: "main", lineNumber: 5 }, { name: "default", lineNumber: 10 }],
    };

    const fp = extractFileFingerprint("src/index.ts", "x\n", analysis);

    expect(fp.imports).toHaveLength(2);
    expect(fp.imports[0]).toEqual({ source: "./utils", specifiers: ["format", "parse"] });
    expect(fp.exports).toEqual(["main", "default"]);
  });

  it("computes content hash and total lines", () => {
    const content = "line1\nline2\nline3\n";
    const analysis: StructuralAnalysis = {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    };

    const fp = extractFileFingerprint("src/empty.ts", content, analysis);

    expect(fp.contentHash).toBe(contentHash(content));
    expect(fp.totalLines).toBe(4); // 3 lines + trailing newline = 4 elements
  });
});

describe("compareFingerprints", () => {
  const baseFp: FileFingerprint = {
    filePath: "src/index.ts",
    contentHash: "abc123",
    functions: [
      { name: "main", params: ["config"], returnType: "void", exported: true, lineCount: 20 },
    ],
    classes: [],
    imports: [{ source: "./utils", specifiers: ["format"] }],
    exports: ["main"],
    totalLines: 30,
    hasStructuralAnalysis: true,
  };

  it("returns NONE when content hash is identical", () => {
    const result = compareFingerprints(baseFp, { ...baseFp });
    expect(result.changeLevel).toBe("NONE");
    expect(result.details).toHaveLength(0);
  });

  it("returns COSMETIC when content changed but structure is identical", () => {
    const newFp = { ...baseFp, contentHash: "different_hash" };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("COSMETIC");
    expect(result.details).toContain("internal logic changed (no structural impact)");
  });

  it("detects new functions", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      functions: [
        ...baseFp.functions,
        { name: "newFunc", params: [], exported: false, lineCount: 10 },
      ],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("new function: newFunc");
  });

  it("detects removed functions", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      functions: [],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("removed function: main");
  });

  it("detects parameter changes", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      functions: [
        { name: "main", params: ["config", "options"], returnType: "void", exported: true, lineCount: 20 },
      ],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("params changed: main");
  });

  it("detects export status changes", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      functions: [
        { name: "main", params: ["config"], returnType: "void", exported: false, lineCount: 20 },
      ],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("export status changed: main");
  });

  it("detects significant size changes (>50%)", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      functions: [
        { name: "main", params: ["config"], returnType: "void", exported: true, lineCount: 60 },
      ],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details.some((d) => d.includes("significant size change"))).toBe(true);
  });

  it("detects import changes", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      imports: [{ source: "./helpers", specifiers: ["doStuff"] }],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("imports changed");
  });

  it("detects export list changes", () => {
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      exports: ["main", "helper"],
    };
    const result = compareFingerprints(baseFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("exports changed");
  });

  it("detects new and removed classes", () => {
    const withClass: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      classes: [{ name: "MyClass", methods: ["init"], properties: [], exported: true, lineCount: 30 }],
      hasStructuralAnalysis: true,
    };
    const result = compareFingerprints(baseFp, withClass);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("new class: MyClass");
  });

  it("detects class method changes", () => {
    const oldFp: FileFingerprint = {
      ...baseFp,
      classes: [{ name: "Foo", methods: ["a", "b"], properties: [], exported: true, lineCount: 30 }],
      hasStructuralAnalysis: true,
    };
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      classes: [{ name: "Foo", methods: ["a", "c"], properties: [], exported: true, lineCount: 30 }],
      hasStructuralAnalysis: true,
    };
    const result = compareFingerprints(oldFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("methods changed: Foo");
  });

  it("does NOT mutate input arrays (sort must use spread-copy)", () => {
    const oldFp: FileFingerprint = {
      ...baseFp,
      classes: [{ name: "Foo", methods: ["b", "a"], properties: ["y", "x"], exported: true, lineCount: 30 }],
      imports: [{ source: "./utils", specifiers: ["z", "a"] }],
      hasStructuralAnalysis: true,
    };
    const newFp: FileFingerprint = {
      ...baseFp,
      contentHash: "different",
      classes: [{ name: "Foo", methods: ["b", "a"], properties: ["y", "x"], exported: true, lineCount: 30 }],
      imports: [{ source: "./utils", specifiers: ["z", "a"] }],
      hasStructuralAnalysis: true,
    };

    // Snapshot original order before comparison
    const oldMethodsBefore = [...oldFp.classes[0].methods];
    const oldPropertiesBefore = [...oldFp.classes[0].properties];
    const oldSpecifiersBefore = [...oldFp.imports[0].specifiers];
    const newMethodsBefore = [...newFp.classes[0].methods];
    const newPropertiesBefore = [...newFp.classes[0].properties];
    const newSpecifiersBefore = [...newFp.imports[0].specifiers];

    compareFingerprints(oldFp, newFp);

    // Arrays must remain in their original order (not sorted in-place)
    expect(oldFp.classes[0].methods).toEqual(oldMethodsBefore);
    expect(oldFp.classes[0].properties).toEqual(oldPropertiesBefore);
    expect(oldFp.imports[0].specifiers).toEqual(oldSpecifiersBefore);
    expect(newFp.classes[0].methods).toEqual(newMethodsBefore);
    expect(newFp.classes[0].properties).toEqual(newPropertiesBefore);
    expect(newFp.imports[0].specifiers).toEqual(newSpecifiersBefore);
  });

  it("classifies as STRUCTURAL when hasStructuralAnalysis is false (no tree-sitter)", () => {
    const oldFp: FileFingerprint = {
      filePath: "config.yaml",
      contentHash: "hash_old",
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      totalLines: 10,
      hasStructuralAnalysis: false,
    };
    const newFp: FileFingerprint = {
      filePath: "config.yaml",
      contentHash: "hash_new",
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      totalLines: 12,
      hasStructuralAnalysis: false,
    };

    const result = compareFingerprints(oldFp, newFp);
    expect(result.changeLevel).toBe("STRUCTURAL");
    expect(result.details).toContain("no structural analysis available — conservative classification");
  });
});

describe("analyzeChanges", () => {
  const mockRegistry = {
    analyzeFile: vi.fn(),
  } as any;

  const existingStore: FingerprintStore = {
    version: "1.0.0",
    gitCommitHash: "abc123",
    generatedAt: "2026-01-01T00:00:00.000Z",
    files: {
      "src/index.ts": {
        filePath: "src/index.ts",
        contentHash: "hash_a",
        functions: [{ name: "main", params: [], exported: true, lineCount: 20 }],
        classes: [],
        imports: [],
        exports: ["main"],
        totalLines: 30,
        hasStructuralAnalysis: true,
      },
      "src/utils.ts": {
        filePath: "src/utils.ts",
        contentHash: "hash_b",
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: 10,
        hasStructuralAnalysis: true,
      },
    },
  };

  it("classifies new files as STRUCTURAL", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("new content");
    mockRegistry.analyzeFile.mockReturnValue({
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    });

    const result = analyzeChanges("/project", ["src/new-file.ts"], existingStore, mockRegistry);

    expect(result.newFiles).toContain("src/new-file.ts");
    expect(result.fileChanges[0].changeLevel).toBe("STRUCTURAL");
  });

  it("classifies deleted files as STRUCTURAL", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = analyzeChanges("/project", ["src/utils.ts"], existingStore, mockRegistry);

    expect(result.deletedFiles).toContain("src/utils.ts");
    expect(result.fileChanges[0].changeLevel).toBe("STRUCTURAL");
  });

  it("classifies unchanged content as NONE", () => {
    mockedExistsSync.mockReturnValue(true);
    // Return content that produces the same hash
    const content = "test content";
    const hash = contentHash(content);

    const store: FingerprintStore = {
      ...existingStore,
      files: {
        "src/index.ts": {
          ...existingStore.files["src/index.ts"],
          contentHash: hash,
        },
      },
    };

    mockedReadFileSync.mockReturnValue(content);
    mockRegistry.analyzeFile.mockReturnValue({
      functions: [{ name: "main", lineRange: [1, 20], params: [] }],
      classes: [],
      imports: [],
      exports: [{ name: "main", lineNumber: 1 }],
    });

    const result = analyzeChanges("/project", ["src/index.ts"], store, mockRegistry);

    expect(result.unchangedFiles).toContain("src/index.ts");
  });

  it("ignores deleted files not in the store", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = analyzeChanges("/project", ["src/unknown.ts"], existingStore, mockRegistry);

    expect(result.deletedFiles).toHaveLength(0);
    expect(result.fileChanges).toHaveLength(0);
  });
});

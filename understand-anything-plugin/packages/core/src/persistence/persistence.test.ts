import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { saveGraph, loadGraph, saveMeta, loadMeta, saveFingerprints, loadFingerprints, saveConfig, loadConfig, resolveUaDirName } from "./index.js";
import { mkdirSync } from "node:fs";
import type { KnowledgeGraph, AnalysisMeta } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ua-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const sampleGraph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: "test-project",
      languages: ["typescript"],
      frameworks: ["vitest"],
      description: "A test project",
      analyzedAt: "2026-03-14T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "node-1",
        type: "file",
        name: "index.ts",
        filePath: "src/index.ts",
        lineRange: [1, 50],
        summary: "Entry point",
        tags: ["entry"],
        complexity: "simple",
      },
    ],
    edges: [
      {
        source: "node-1",
        target: "node-1",
        type: "imports",
        direction: "forward",
        weight: 0.8,
      },
    ],
    layers: [
      {
        id: "layer-1",
        name: "Core",
        description: "Core layer",
        nodeIds: ["node-1"],
      },
    ],
    tour: [
      {
        order: 1,
        title: "Start here",
        description: "Begin with the entry point",
        nodeIds: ["node-1"],
      },
    ],
  };

  const sampleMeta: AnalysisMeta = {
    lastAnalyzedAt: "2026-03-14T00:00:00.000Z",
    gitCommitHash: "abc123",
    version: "1.0.0",
    analyzedFiles: 42,
  };

  describe("saveGraph / loadGraph", () => {
    it("should write knowledge-graph.json to .ua/", () => {
      saveGraph(tempDir, sampleGraph);

      const filePath = join(tempDir, ".ua", "knowledge-graph.json");
      expect(existsSync(filePath)).toBe(true);
    });

    it("should read back the saved graph correctly", () => {
      saveGraph(tempDir, sampleGraph);
      const loaded = loadGraph(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(sampleGraph);
    });

    it("should return null when no graph exists", () => {
      const loaded = loadGraph(tempDir);
      expect(loaded).toBeNull();
    });

    it("should throw error when loading a fatally invalid graph", () => {
      const invalidGraph = { ...sampleGraph, project: null };
      saveGraph(tempDir, invalidGraph as unknown as KnowledgeGraph);

      expect(() => {
        loadGraph(tempDir);
      }).toThrow(/Invalid knowledge graph/);
    });

    it("should skip validation when validate option is false", () => {
      const invalidGraph = { ...sampleGraph, version: 123 };
      saveGraph(tempDir, invalidGraph as unknown as KnowledgeGraph);

      const loaded = loadGraph(tempDir, { validate: false });
      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(123);
    });

    it("does not leak a sibling directory that shares the root's name prefix", () => {
      // A path beside the project root (e.g. a backup or git worktree) must be
      // reduced to its basename, not rewritten to a `../<root>-backup/...`
      // traversal that both leaks the directory layout and escapes the root
      // (graph filePaths later seed the dashboard's path allowlist).
      const sibling = `${tempDir}-backup/src/auth.ts`;
      const graph: KnowledgeGraph = {
        ...sampleGraph,
        nodes: [{ ...sampleGraph.nodes[0], id: "sibling-node", filePath: sibling }],
      };
      saveGraph(tempDir, graph);

      const loaded = loadGraph(tempDir);
      expect(loaded?.nodes[0].filePath).toBe("auth.ts");
    });
  });

  describe("saveMeta / loadMeta", () => {
    it("should write meta.json to .ua/", () => {
      saveMeta(tempDir, sampleMeta);

      const filePath = join(tempDir, ".ua", "meta.json");
      expect(existsSync(filePath)).toBe(true);
    });

    it("should read back the saved meta correctly", () => {
      saveMeta(tempDir, sampleMeta);
      const loaded = loadMeta(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(sampleMeta);
    });

    it("should return null when no meta exists", () => {
      const loaded = loadMeta(tempDir);
      expect(loaded).toBeNull();
    });
  });

  describe("saveFingerprints / loadFingerprints", () => {
    const sampleFingerprints: FingerprintStore = {
      version: "1.0.0",
      gitCommitHash: "abc123",
      generatedAt: "2026-03-14T00:00:00.000Z",
      files: {
        "src/index.ts": {
          filePath: "src/index.ts",
          contentHash: "deadbeef",
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          totalLines: 10,
          hasStructuralAnalysis: false,
        },
      },
    };

    it("should round-trip fingerprints correctly", () => {
      saveFingerprints(tempDir, sampleFingerprints);
      const loaded = loadFingerprints(tempDir);

      expect(loaded).toEqual(sampleFingerprints);
    });

    it("should return null when no fingerprints file exists", () => {
      const loaded = loadFingerprints(tempDir);
      expect(loaded).toBeNull();
    });

    it("should return null when fingerprints.json is corrupted", () => {
      const dir = join(tempDir, ".ua");
      // Ensure the directory exists by saving first, then overwrite with garbage
      saveFingerprints(tempDir, sampleFingerprints);
      writeFileSync(join(dir, "fingerprints.json"), "{{not valid json!!", "utf-8");

      const loaded = loadFingerprints(tempDir);
      expect(loaded).toBeNull();
    });
  });

  describe("saveConfig / loadConfig", () => {
    it("should round-trip config correctly", () => {
      saveConfig(tempDir, { autoUpdate: true });
      const loaded = loadConfig(tempDir);

      expect(loaded).toEqual({ autoUpdate: true });
    });

    it("should return default config when no file exists", () => {
      const loaded = loadConfig(tempDir);

      expect(loaded).toEqual({ autoUpdate: false, outputLanguage: "en" });
    });

    it("should return default config when config.json is corrupted", () => {
      saveConfig(tempDir, { autoUpdate: true });
      const dir = join(tempDir, ".ua");
      writeFileSync(join(dir, "config.json"), "not json!!", "utf-8");

      const loaded = loadConfig(tempDir);
      expect(loaded).toEqual({ autoUpdate: false, outputLanguage: "en" });
    });
  });
});

describe("legacy .understand-anything compatibility", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ua-legacy-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves to .ua for fresh projects", () => {
    expect(resolveUaDirName(tempDir)).toBe(".ua");
  });

  it("keeps using an existing .understand-anything/ for reads and writes", () => {
    mkdirSync(join(tempDir, ".understand-anything"));
    expect(resolveUaDirName(tempDir)).toBe(".understand-anything");

    saveMeta(tempDir, { analyzedAt: "t", gitCommitHash: "abc", fileCount: 1 } as never);
    expect(existsSync(join(tempDir, ".understand-anything", "meta.json"))).toBe(true);
    expect(existsSync(join(tempDir, ".ua"))).toBe(false);
    expect(loadMeta(tempDir)?.gitCommitHash).toBe("abc");
  });

  it("reads a graph saved under the legacy directory", () => {
    mkdirSync(join(tempDir, ".understand-anything"));
    const graph = {
      version: "1.0.0",
      project: { name: "p", languages: [], frameworks: [], description: "d", analyzedAt: "t", gitCommitHash: "" },
      nodes: [{ id: "file:a.ts", type: "file", name: "a.ts", summary: "s", tags: [], complexity: "simple" }],
      edges: [],
      layers: [],
      tour: [],
    } as never;
    saveGraph(tempDir, graph);
    expect(existsSync(join(tempDir, ".understand-anything", "knowledge-graph.json"))).toBe(true);
    expect(loadGraph(tempDir)?.nodes).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveDomainGraph, loadDomainGraph } from "../persistence/index.js";
import type { KnowledgeGraph } from "../types.js";

const testRoot = join(tmpdir(), "ua-domain-persist-test");

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test",
    languages: ["typescript"],
    frameworks: [],
    description: "test",
    analyzedAt: "2026-04-01T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "domain:orders",
      type: "domain",
      name: "Orders",
      summary: "Order management",
      tags: [],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("domain graph persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads domain graph", () => {
    saveDomainGraph(testRoot, domainGraph);
    const loaded = loadDomainGraph(testRoot);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes[0].id).toBe("domain:orders");
  });

  it("returns null when no domain graph exists", () => {
    const loaded = loadDomainGraph(testRoot);
    expect(loaded).toBeNull();
  });

  it("saves to domain-graph.json, not knowledge-graph.json", () => {
    saveDomainGraph(testRoot, domainGraph);
    const domainPath = join(testRoot, ".understand-anything", "domain-graph.json");
    const structuralPath = join(testRoot, ".understand-anything", "knowledge-graph.json");
    expect(existsSync(domainPath)).toBe(true);
    expect(existsSync(structuralPath)).toBe(false);
  });
});

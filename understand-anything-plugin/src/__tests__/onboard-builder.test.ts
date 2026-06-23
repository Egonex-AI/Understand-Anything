import { describe, it, expect } from "vitest";
import { buildOnboardingGuide } from "../onboard-builder.js";
import type { KnowledgeGraph } from "@understand-anything/core";

const sampleGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript", "python"],
    frameworks: ["express", "prisma"],
    description: "A test REST API",
    analyzedAt: "2026-03-14T00:00:00Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    { id: "file:src/index.ts", type: "file", name: "index.ts", filePath: "src/index.ts", summary: "Entry point", tags: ["entry"], complexity: "simple" },
    { id: "file:src/service.ts", type: "file", name: "service.ts", filePath: "src/service.ts", summary: "Core service", tags: ["service"], complexity: "complex" },
    { id: "concept:auth", type: "concept", name: "Auth Flow", summary: "JWT-based authentication", tags: ["concept", "auth"], complexity: "complex" },
  ],
  edges: [
    { source: "file:src/index.ts", target: "file:src/service.ts", type: "imports", direction: "forward", weight: 0.8 },
  ],
  layers: [
    { id: "layer:api", name: "API Layer", description: "Routes and handlers", nodeIds: ["file:src/index.ts"] },
    { id: "layer:service", name: "Service Layer", description: "Business logic", nodeIds: ["file:src/service.ts"] },
  ],
  tour: [
    { order: 1, title: "Start Here", description: "Begin with index.ts", nodeIds: ["file:src/index.ts"] },
    { order: 2, title: "Core Logic", description: "Service layer", nodeIds: ["file:src/service.ts"] },
  ],
};

describe("onboard-builder", () => {
  it("includes project overview section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("# test-project");
    expect(guide).toContain("A test REST API");
  });

  it("lists languages and frameworks", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("typescript");
    expect(guide).toContain("express");
  });

  it("includes architecture layers section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Architecture");
    expect(guide).toContain("API Layer");
    expect(guide).toContain("Service Layer");
  });

  it("includes key concepts section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Key Concepts");
    expect(guide).toContain("Auth Flow");
  });

  it("includes getting started / tour section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Getting Started");
    expect(guide).toContain("Start Here");
  });

  it("includes complexity hotspots", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## Complexity Hotspots");
    expect(guide).toContain("service.ts");
  });

  it("includes file map section", () => {
    const guide = buildOnboardingGuide(sampleGraph);
    expect(guide).toContain("## File Map");
  });

  it("handles graph with no layers gracefully", () => {
    const noLayers = { ...sampleGraph, layers: [] };
    const guide = buildOnboardingGuide(noLayers);
    expect(guide).toContain("# test-project");
  });

  it("handles graph with no tour gracefully", () => {
    const noTour = { ...sampleGraph, tour: [] };
    const guide = buildOnboardingGuide(noTour);
    expect(guide).toContain("# test-project");
  });
});

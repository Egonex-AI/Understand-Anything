import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core";
import { buildChatContext } from "../context-builder.js";

const graph: KnowledgeGraph = {
  version: "1.0.0",
  project: { name: "shop", languages: ["typescript"], frameworks: [], description: "demo", analyzedAt: "2026-01-01", gitCommitHash: "x" },
  nodes: [
    { id: "fn:token", type: "function", name: "issueSessionToken", filePath: "src/auth/session.ts", summary: "Creates a signed JWT for the authenticated user.", tags: [], complexity: "simple" },
    { id: "fn:chart", type: "function", name: "renderBarChart", filePath: "src/ui/chart.tsx", summary: "Draws a bar chart with axis labels.", tags: [], complexity: "simple" },
    { id: "fn:mail", type: "function", name: "sendWelcomeEmail", filePath: "src/notify/mail.ts", summary: "Sends the onboarding email to a new customer.", tags: [], complexity: "simple" },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("buildChatContext (semantic retrieval)", () => {
  it("retrieves the right node for a question that shares no words with it", () => {
    const ctx = buildChatContext(graph, "where is login handled?", 3);
    expect(ctx.relevantNodes.map((n) => n.id)).toContain("fn:token");
    expect(ctx.relevantNodes.map((n) => n.id)).not.toContain("fn:chart");
  });
});

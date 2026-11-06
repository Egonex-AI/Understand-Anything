import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveGraph, type KnowledgeGraph } from "@understand-anything/core";
import { askAboutProject } from "../ask.js";
import type { LlmCaller } from "../llm.js";

const dirsToClean: string[] = [];

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ua-ask-"));
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length) rmSync(dirsToClean.pop()!, { recursive: true, force: true });
});

function makeGraph(root: string): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "test-project",
      languages: ["typescript"],
      frameworks: ["Node.js"],
      description: "A test project for ask.ts coverage.",
      analyzedAt: new Date(0).toISOString(),
      gitCommitHash: "deadbeef",
    },
    nodes: [
      {
        id: "file:src/auth.ts",
        type: "file",
        name: "auth.ts",
        filePath: "src/auth.ts",
        summary: "Handles user authentication and session tokens.",
        tags: ["auth", "security"],
        complexity: "moderate",
      },
      {
        id: "file:src/util.ts",
        type: "file",
        name: "util.ts",
        filePath: "src/util.ts",
        summary: "Miscellaneous string/date helpers.",
        tags: ["utility"],
        complexity: "simple",
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

describe("askAboutProject", () => {
  it("reports the project hasn't been analyzed yet when there's no graph", async () => {
    const root = makeTmpProject();
    const calls: string[] = [];
    const stubLlm: LlmCaller = async (_sys, _user) => {
      calls.push("called");
      return "should not be called";
    };

    const result = await askAboutProject(root, "how does auth work?", stubLlm);

    expect(result.answer).toMatch(/hasn't been analyzed/i);
    expect(result.citedNodes).toEqual([]);
    expect(calls).toEqual([]); // never calls the LLM without a graph
  });

  it("grounds the prompt in matched nodes and returns their ids as citations", async () => {
    const root = makeTmpProject();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "auth.ts"), "export function login() {}\n");
    saveGraph(root, makeGraph(root));

    let capturedPrompt = "";
    const stubLlm: LlmCaller = async (_sys, userContent) => {
      capturedPrompt = userContent;
      return "Auth is handled in src/auth.ts.";
    };

    const result = await askAboutProject(root, "how does authentication work?", stubLlm);

    expect(result.answer).toBe("Auth is handled in src/auth.ts.");
    expect(result.citedNodes.map((n) => n.id)).toContain("file:src/auth.ts");
    // The auth-relevant node's summary should have made it into the grounding prompt.
    expect(capturedPrompt).toContain("Handles user authentication");
    expect(capturedPrompt).toContain("how does authentication work?");
  });

  it("includes a source snippet for a strongly matched file when readable", async () => {
    const root = makeTmpProject();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "auth.ts"), "export function login(user: string) { return user; }\n");
    saveGraph(root, makeGraph(root));

    let capturedPrompt = "";
    const stubLlm: LlmCaller = async (_sys, userContent) => {
      capturedPrompt = userContent;
      return "ok";
    };

    await askAboutProject(root, "authentication login", stubLlm);

    expect(capturedPrompt).toContain("export function login");
  });

  it("grounds the prompt in a selected node even when the question text doesn't match it", async () => {
    const root = makeTmpProject();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "util.ts"), "export function pad(s: string) { return s; }\n");
    saveGraph(root, makeGraph(root));

    let capturedPrompt = "";
    const stubLlm: LlmCaller = async (_sys, userContent) => {
      capturedPrompt = userContent;
      return "ok";
    };

    const result = await askAboutProject(root, "what does this do?", stubLlm, ["file:src/util.ts"]);

    expect(capturedPrompt).toContain("currently has these node(s) selected/focused");
    expect(capturedPrompt).toContain("Miscellaneous string/date helpers");
    expect(capturedPrompt).toContain("export function pad");
    expect(result.citedNodes.map((n) => n.id)).toContain("file:src/util.ts");
  });

  it("doesn't duplicate a node that's both selected and search-matched", async () => {
    const root = makeTmpProject();
    saveGraph(root, makeGraph(root));

    const stubLlm: LlmCaller = async () => "ok";
    const result = await askAboutProject(root, "authentication", stubLlm, ["file:src/auth.ts"]);

    expect(result.citedNodes.filter((n) => n.id === "file:src/auth.ts")).toHaveLength(1);
  });

  it("ignores a selected node id that isn't in the graph", async () => {
    const root = makeTmpProject();
    saveGraph(root, makeGraph(root));

    const stubLlm: LlmCaller = async () => "ok";
    const result = await askAboutProject(root, "how does auth work?", stubLlm, ["file:does-not-exist.ts"]);

    expect(result.citedNodes.map((n) => n.id)).not.toContain("file:does-not-exist.ts");
  });
});

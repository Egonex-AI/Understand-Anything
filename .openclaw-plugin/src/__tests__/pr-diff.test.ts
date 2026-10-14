import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core";
import { getChangedFiles, generatePrWalkthrough } from "../pr-diff.js";
import type { LlmCaller } from "../llm.js";

const dirsToClean: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ua-pr-diff-"));
  dirsToClean.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length) rmSync(dirsToClean.pop()!, { recursive: true, force: true });
});

describe("getChangedFiles", () => {
  it("diffs a feature branch against the base branch", async () => {
    const repo = makeGitRepo();
    git(repo, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "add b"]);

    const result = await getChangedFiles(repo, { baseBranch: "main" });
    expect(result.changedFiles).toEqual(["b.ts"]);
    expect(result.baseBranch).toBe("main");
  });

  it("falls back to uncommitted working-tree changes when there's nothing committed against the base", async () => {
    const repo = makeGitRepo();
    writeFileSync(join(repo, "a.ts"), "export const a = 999;\n"); // uncommitted edit
    const result = await getChangedFiles(repo, { baseBranch: "main" });
    expect(result.changedFiles).toEqual(["a.ts"]);
    expect(result.baseBranch).toBe("working tree");
  });

  it("returns no changed files when nothing changed at all", async () => {
    const repo = makeGitRepo();
    const result = await getChangedFiles(repo, { baseBranch: "main" });
    expect(result.changedFiles).toEqual([]);
  });
});

function makeGraph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: { name: "p", languages: ["typescript"], frameworks: [], description: "d", analyzedAt: "2026-01-01T00:00:00.000Z", gitCommitHash: "x" },
    nodes: [
      { id: "file:a.ts", type: "file", name: "a.ts", filePath: "a.ts", summary: "File a.", tags: [], complexity: "simple" },
      { id: "file:b.ts", type: "file", name: "b.ts", filePath: "b.ts", summary: "Imports a.", tags: [], complexity: "simple" },
    ],
    edges: [{ source: "file:b.ts", target: "file:a.ts", type: "imports", direction: "forward", weight: 0.7 }],
    layers: [],
    tour: [],
  };
}

describe("generatePrWalkthrough", () => {
  it("reports an error without calling the LLM when no changed file matches the graph", async () => {
    const stubLlm: LlmCaller = async () => {
      throw new Error("should not be called");
    };
    const result = await generatePrWalkthrough(makeGraph(), ["does-not-exist.ts"], "main", stubLlm);
    expect(result.steps).toEqual([]);
    expect(result.error).toMatch(/none of the changed files matched/i);
    expect(result.overlay.changedNodeIds).toEqual([]);
  });

  it("grounds the prompt in changed + affected nodes and returns parsed steps", async () => {
    let capturedPrompt = "";
    const stubLlm: LlmCaller = async (_sys, userContent) => {
      capturedPrompt = userContent;
      return JSON.stringify({
        steps: [{ order: 1, title: "a.ts changed", description: "b.ts depends on it.", nodeIds: ["file:a.ts", "file:b.ts"] }],
      });
    };

    const result = await generatePrWalkthrough(makeGraph(), ["a.ts"], "main", stubLlm);

    expect(capturedPrompt).toContain("file:a.ts");
    expect(capturedPrompt).toContain("file:b.ts"); // affected node should be in the prompt too
    expect(result.error).toBeUndefined();
    expect(result.overlay.changedNodeIds).toEqual(["file:a.ts"]);
    expect(result.overlay.affectedNodeIds).toEqual(["file:b.ts"]);
    expect(result.steps).toHaveLength(1);
  });
});

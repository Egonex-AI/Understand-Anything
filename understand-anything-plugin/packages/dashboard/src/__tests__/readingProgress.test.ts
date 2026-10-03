import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { graphFilePaths, readingKey, useReadingProgress } from "../readingProgress";
import { useDashboardStore } from "../store";

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  useReadingProgress.setState({ projectKey: null, read: new Set() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readingProgress", () => {
  it("normalises paths like the Files tab", () => {
    expect(readingKey("./src/a.ts")).toBe("src/a.ts");
    expect(readingKey("src\\b.ts")).toBe("src/b.ts");
    expect(readingKey("/src/c.ts")).toBe("src/c.ts");
  });

  it("collects distinct graph file paths", () => {
    const graph = {
      nodes: [
        { id: "a", filePath: "src/a.ts" },
        { id: "a2", filePath: "./src/a.ts" },
        { id: "b", filePath: "src/b.ts" },
        { id: "c" },
      ],
    } as unknown as KnowledgeGraph;
    expect([...graphFilePaths(graph)].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("persists per project and resets", () => {
    const store = useReadingProgress.getState();
    store.load("proj");
    store.markRead("./src/a.ts");
    store.markRead("src/a.ts");
    expect([...useReadingProgress.getState().read]).toEqual(["src/a.ts"]);
    expect(JSON.parse(storage.get("ua-reading-progress:proj")!)).toEqual({ version: 1, files: ["src/a.ts"] });

    useReadingProgress.getState().load("other");
    expect(useReadingProgress.getState().read.size).toBe(0);
    useReadingProgress.getState().load("proj");
    expect(useReadingProgress.getState().read.has("src/a.ts")).toBe(true);

    useReadingProgress.getState().reset();
    expect(useReadingProgress.getState().read.size).toBe(0);
    expect(storage.has("ua-reading-progress:proj")).toBe(false);
  });

  it("survives blocked storage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    useReadingProgress.getState().load("proj");
    useReadingProgress.getState().markRead("src/a.ts");
    expect(useReadingProgress.getState().read.has("src/a.ts")).toBe(true);
  });

  it("follows the loaded project", () => {
    storage.set("ua-reading-progress:demo", JSON.stringify({ version: 1, files: ["x.ts"] }));
    useDashboardStore.setState({ graph: { project: { name: "demo" }, nodes: [], edges: [] } as unknown as KnowledgeGraph });
    expect(useReadingProgress.getState().projectKey).toBe("demo");
    expect(useReadingProgress.getState().read.has("x.ts")).toBe(true);
  });
});

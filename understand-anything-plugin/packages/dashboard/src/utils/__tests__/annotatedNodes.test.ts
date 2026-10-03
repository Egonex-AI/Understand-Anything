import { describe, it, expect } from "vitest";
import { annotatedLinks, collectTags, containingFile, hasContent, lineNotes, orderAnnotatedNodes } from "../annotatedNodes";
import { notesAnnotations, notesGraph } from "./notesFixture";

describe("lineNotes", () => {
  it("sorts numerically and drops blank or non-numeric entries", () => {
    expect(lineNotes(notesAnnotations()["fn:src/api.ts:handler"])).toEqual([
      { line: 12, note: "auth check" },
      { line: 15, note: "validate input\nhere" },
    ]);
  });
  it("tolerates a missing lines field", () => {
    expect(lineNotes({ tags: [], note: "x", updatedAt: "" })).toEqual([]);
    expect(lineNotes(undefined)).toEqual([]);
  });
});

describe("hasContent", () => {
  it("counts tags, notes and line notes", () => {
    expect(hasContent({ tags: [], note: "  ", updatedAt: "" })).toBe(false);
    expect(hasContent({ tags: ["a"], note: "", updatedAt: "" })).toBe(true);
    expect(hasContent({ tags: [], note: "", updatedAt: "", lines: { "3": "hi" } })).toBe(true);
  });
});

describe("collectTags", () => {
  it("de-duplicates case-insensitively and sorts", () => {
    expect(collectTags(notesAnnotations())).toEqual(["entry point", "helpers", "stale"]);
  });
});

describe("orderAnnotatedNodes", () => {
  const graph = notesGraph();
  const annotations = notesAnnotations();

  it("graph order: layer order, then dependencies and parents first; skips missing nodes", () => {
    expect(orderAnnotatedNodes(graph, annotations)).toEqual([
      "file:src/util.ts",
      "file:src/api.ts",
      "fn:src/api.ts:handler",
      "fn:src/other.ts:handler",
      "file:src/db.ts",
    ]);
  });

  it("orders by update time", () => {
    expect(orderAnnotatedNodes(graph, annotations, { order: "recent" })[0]).toBe("fn:src/other.ts:handler");
    expect(orderAnnotatedNodes(graph, annotations, { order: "oldest" })).toEqual([
      "file:src/api.ts",
      "file:src/db.ts",
      "file:src/util.ts",
      "fn:src/api.ts:handler",
      "fn:src/other.ts:handler",
    ]);
  });

  it("filters by tag case-insensitively", () => {
    expect(orderAnnotatedNodes(graph, annotations, { tag: "ENTRY POINT" })).toEqual([
      "file:src/api.ts",
      "fn:src/api.ts:handler",
    ]);
  });

  it("survives dependency cycles", () => {
    const g = notesGraph();
    g.edges.push({ source: "file:src/util.ts", target: "file:src/api.ts", type: "imports", direction: "forward", weight: 1 });
    const ids = orderAnnotatedNodes(g, annotations);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("containingFile", () => {
  it("finds the parent file by contains edge or file path", () => {
    const g = notesGraph();
    const handler = g.nodes.find((n) => n.id === "fn:src/api.ts:handler")!;
    expect(containingFile(g, handler)?.id).toBe("file:src/api.ts");
    g.edges = g.edges.filter((e) => e.type !== "contains");
    expect(containingFile(g, handler)?.id).toBe("file:src/api.ts");
    expect(containingFile(g, g.nodes[0])).toBeUndefined();
  });
});

describe("annotatedLinks", () => {
  it("links annotated nodes in both directions only", () => {
    const links = annotatedLinks(notesGraph(), ["file:src/api.ts", "file:src/db.ts"]);
    expect(links.get("file:src/api.ts")).toEqual([{ id: "file:src/db.ts", type: "imports", dir: "out" }]);
    expect(links.get("file:src/db.ts")).toEqual([{ id: "file:src/api.ts", type: "imports", dir: "in" }]);
  });
});

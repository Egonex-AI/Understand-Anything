import { describe, expect, it } from "vitest";
import type { GraphNode } from "@understand-anything/core/types";
import { buildFileNodeIndex, fileNodeForPath, nodeForFileLine } from "../fileNodes";

const node = (id: string, type: GraphNode["type"], filePath: string, lineRange?: [number, number]): GraphNode => ({
  id, type, name: id, filePath, lineRange, summary: "", tags: [], complexity: "simple",
});

const index = buildFileNodeIndex([
  node("fn:inner", "function", "src/a.ts", [12, 14]),
  node("class:A", "class", "src/a.ts", [10, 40]),
  node("file:a", "file", "./src/a.ts"),
  node("file:b", "file", "src\\b.ts"),
]);

describe("fileNodes", () => {
  it("finds the file node regardless of path spelling", () => {
    expect(fileNodeForPath(index, "src/a.ts")?.id).toBe("file:a");
    expect(fileNodeForPath(index, "src/b.ts")?.id).toBe("file:b");
    expect(fileNodeForPath(index, "src/missing.ts")).toBeNull();
  });

  it("picks the innermost node containing a line", () => {
    expect(nodeForFileLine(index, "src/a.ts", 13)?.id).toBe("fn:inner");
    expect(nodeForFileLine(index, "src/a.ts", 20)?.id).toBe("class:A");
    expect(nodeForFileLine(index, "src/a.ts", 2)?.id).toBe("file:a");
  });
});

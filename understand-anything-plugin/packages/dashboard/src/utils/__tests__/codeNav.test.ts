import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import {
  buildCodeNavIndex,
  buildOutline,
  buildRangeLanes,
  identifierKeys,
  isIdentifierToken,
  resolveIdentifier,
} from "../codeNav";

const node = (
  id: string,
  type: GraphNode["type"],
  name: string,
  filePath?: string,
  lineRange?: [number, number],
): GraphNode => ({ id, type, name, filePath, lineRange, summary: "", tags: [], complexity: "simple" });

const edge = (source: string, target: string, type: GraphEdge["type"]): GraphEdge => ({
  source, target, type, direction: "forward", weight: 1,
});

function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph {
  return { nodes, edges, layers: [], tour: [] } as unknown as KnowledgeGraph;
}

const nodes = [
  node("file:a", "file", "a.ts", "src/a.ts"),
  node("file:b", "file", "b.ts", "./src/b.ts"),
  node("file:c", "file", "c.ts", "src/c.ts"),
  node("file:Widget", "file", "Widget.tsx", "src/Widget.tsx"),
  node("fn:a:helper", "function", "helper", "src/a.ts", [3, 5]),
  node("fn:b:helper", "function", "helper()", "src/b.ts", [10, 20]),
  node("fn:c:helper", "function", "helper", "src/c.ts", [1, 2]),
  node("fn:b:parse", "function", "Parser.parse", "src/b.ts", [30, 40]),
  node("class:b:Parser", "class", "Parser", "src/b.ts", [25, 60]),
  node("concept:x", "concept", "helper"),
];
const index = buildCodeNavIndex(
  graphOf(nodes, [
    edge("file:a", "file:b", "imports"),
    edge("file:a", "file:Widget", "imports"),
    edge("file:c", "fn:c:helper", "contains"),
  ]),
);

describe("identifierKeys", () => {
  it("strips parens, splits qualified names and uses file stems", () => {
    expect(identifierKeys(nodes[5])).toEqual(["helper"]);
    expect(identifierKeys(nodes[7])).toEqual(["parse"]);
    expect(identifierKeys(nodes[3])).toEqual(["Widget"]);
    expect(identifierKeys(node("f", "file", "my-file.ts", "my-file.ts"))).toEqual([]);
  });
});

describe("resolveIdentifier", () => {
  it("prefers the same file, then imported files, then anything", () => {
    expect(resolveIdentifier(index, "helper", "src/a.ts")?.id).toBe("fn:a:helper");
    expect(resolveIdentifier(index, "parse", "src/a.ts")?.id).toBe("fn:b:parse");
    expect(resolveIdentifier(index, "Widget", "src/a.ts")?.id).toBe("file:Widget");
    expect(resolveIdentifier(index, "nothing", "src/a.ts")).toBeNull();
  });

  it("prefers an imported definition over an unrelated one", () => {
    const idx = buildCodeNavIndex(graphOf(nodes.filter((n) => n.id !== "fn:a:helper"), [edge("file:a", "file:b", "imports")]));
    expect(resolveIdentifier(idx, "helper", "src/a.ts")?.id).toBe("fn:b:helper");
  });

  it("never resolves to the file being viewed and ignores non-code nodes", () => {
    expect(resolveIdentifier(index, "Widget", "src/Widget.tsx")).toBeNull();
    expect(index.byName.get("helper")?.some((n) => n.id === "concept:x")).toBe(false);
  });
});

describe("childrenByFile", () => {
  it("collects ranged nodes per file sorted by start, outer first", () => {
    expect(index.childrenByFile.get("src/b.ts")?.map((n) => n.id)).toEqual([
      "fn:b:helper",
      "class:b:Parser",
      "fn:b:parse",
    ]);
    expect(index.childrenByFile.get("src/c.ts")?.map((n) => n.id)).toEqual(["fn:c:helper"]);
  });
});

describe("buildOutline", () => {
  it("nests ranges inside enclosing ranges", () => {
    const outline = buildOutline(index.childrenByFile.get("src/b.ts")!);
    expect(outline.map((e) => [e.node.id, e.depth])).toEqual([
      ["fn:b:helper", 0],
      ["class:b:Parser", 0],
      ["fn:b:parse", 1],
    ]);
  });
});

describe("buildRangeLanes", () => {
  it("packs nested ranges into separate lanes", () => {
    const { laneCount, lanes } = buildRangeLanes(index.childrenByFile.get("src/b.ts")!, 70);
    expect(laneCount).toBe(2);
    expect(lanes[14].map((n) => n?.id ?? null)).toEqual(["fn:b:helper", null]);
    expect(lanes[34].map((n) => n?.id ?? null)).toEqual(["class:b:Parser", "fn:b:parse"]);
    expect(lanes[64].map((n) => n?.id ?? null)).toEqual([null, null]);
  });

  it("returns no lanes when there are no children", () => {
    expect(buildRangeLanes([], 10)).toEqual({ laneCount: 0, lanes: [] });
  });
});

describe("isIdentifierToken", () => {
  it("accepts function, class-name and plain tokens only", () => {
    expect(isIdentifierToken(["function"])).toBe(true);
    expect(isIdentifierToken(["tag", "class-name"])).toBe(true);
    expect(isIdentifierToken(["plain"])).toBe(true);
    expect(isIdentifierToken(["keyword"])).toBe(false);
    expect(isIdentifierToken(["string"])).toBe(false);
  });
});

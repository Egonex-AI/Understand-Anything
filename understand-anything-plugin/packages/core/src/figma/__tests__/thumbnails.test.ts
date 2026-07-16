import { describe, it, expect } from "vitest";
import { applyScreenThumbnails } from "../thumbnails";
import type { GraphNode } from "../../types";

function node(id: string, type: GraphNode["type"], nodeId: string): GraphNode {
  return {
    id, type, name: id, summary: id, tags: [type], complexity: "simple",
    figmaMeta: { fileKey: "ABC", nodeId },
  };
}

describe("applyScreenThumbnails", () => {
  it("sets thumbnailUrl only on screen nodes present in the images map", () => {
    const nodes: GraphNode[] = [
      node("screen:10:0", "screen", "10:0"),
      node("component:2:1", "component", "2:1"), // non-screen → ignored even if in map
      node("screen:11:0", "screen", "11:0"),     // screen but not in map → untouched
    ];
    const updated = applyScreenThumbnails(nodes, {
      "10:0": "https://figma/a.png",
      "2:1": "https://figma/c.png",
    });
    expect(updated).toBe(1);
    expect(nodes[0].figmaMeta?.thumbnailUrl).toBe("https://figma/a.png");
    expect(nodes[1].figmaMeta?.thumbnailUrl).toBeUndefined();
    expect(nodes[2].figmaMeta?.thumbnailUrl).toBeUndefined();
  });

  it("returns 0 and mutates nothing when no screens match", () => {
    const nodes: GraphNode[] = [node("screen:9:9", "screen", "9:9")];
    const updated = applyScreenThumbnails(nodes, {});
    expect(updated).toBe(0);
    expect(nodes[0].figmaMeta?.thumbnailUrl).toBeUndefined();
  });
});

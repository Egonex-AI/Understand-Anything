import { describe, it, expect } from "vitest";
import { extractTokens } from "../parse/tokens";
import type { FigmaDocument, FigmaStyles } from "../source/types";
import type { GraphNode } from "../../types";

// Mirrors the real API shape: node.styles values are file-local style ids
// ("100:1") that resolve through the document's top-level styles map to the
// published key ("S_KEY") that /files/:key/styles reports.
const doc: FigmaDocument = {
  name: "MyApp",
  document: {
    id: "0:0", name: "Document", type: "DOCUMENT", children: [
      { id: "1:9", name: "Components", type: "CANVAS", children: [
        { id: "2:1", name: "Primary", type: "COMPONENT", styles: { fill: "100:1" }, children: [] },
      ] },
    ],
  },
  styles: { "100:1": { key: "S_KEY", name: "color/brand-500", styleType: "FILL" } },
};
const styles: FigmaStyles = { meta: { styles: [{ key: "S_KEY", name: "color/brand-500", style_type: "FILL" }] } };
const structural: GraphNode[] = [
  { id: "component:2:1", type: "component", name: "Primary", summary: "Primary", tags: ["component"], complexity: "simple", figmaMeta: { fileKey: "ABC", nodeId: "2:1" } },
];

describe("extractTokens", () => {
  const { nodes, edges } = extractTokens(doc, styles, structural, "ABC");
  it("creates a token node per published style with tokenKind", () => {
    const token = nodes.find((n) => n.type === "token");
    expect(token).toBeTruthy();
    expect(token!.figmaMeta?.tokenKind).toBe("color");
    expect(token!.name).toBe("color/brand-500");
  });
  it("links consumers to tokens by bridging local style ids to published keys", () => {
    const token = nodes.find((n) => n.type === "token")!;
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "component:2:1", target: token.id, type: "uses_token" }),
    ]));
  });
});

describe("extractTokens — nested styled layers", () => {
  // The common real-world case: a screen's visible styling lives on a nested
  // TEXT/RECTANGLE leaf, so the style reference is on 11:0 — NOT on the screen
  // frame (10:0) that is the structural node.
  const nestedDoc: FigmaDocument = {
    name: "MyApp",
    document: {
      id: "0:0", name: "Document", type: "DOCUMENT", children: [
        { id: "1:0", name: "Home", type: "CANVAS", children: [
          { id: "10:0", name: "Home Screen", type: "FRAME", children: [
            { id: "11:0", name: "Title", type: "TEXT", styles: { text: "200:1" }, children: [] },
          ] },
        ] },
      ],
    },
    styles: { "200:1": { key: "T_KEY", name: "type/heading", styleType: "TEXT" } },
  };
  const nestedStyles: FigmaStyles = { meta: { styles: [{ key: "T_KEY", name: "type/heading", style_type: "TEXT" }] } };
  const nestedStructural: GraphNode[] = [
    { id: "screen:10:0", type: "screen", name: "Home Screen", summary: "Home Screen", tags: ["screen"], complexity: "simple", figmaMeta: { fileKey: "ABC", nodeId: "10:0" } },
  ];

  it("attributes nested-layer token usage to the nearest structural ancestor (screen)", () => {
    const { nodes, edges } = extractTokens(nestedDoc, nestedStyles, nestedStructural, "ABC");
    const token = nodes.find((n) => n.type === "token");
    expect(token).toBeTruthy();
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "screen:10:0", target: token!.id, type: "uses_token" }),
    ]));
  });
});

describe("extractTokens — sources without a top-level styles map", () => {
  // Offline/local sources may put published keys directly in node.styles;
  // without doc.styles the value falls back to a direct key match.
  const bareDoc: FigmaDocument = {
    name: "MyApp",
    document: {
      id: "0:0", name: "Document", type: "DOCUMENT", children: [
        { id: "1:9", name: "Components", type: "CANVAS", children: [
          { id: "2:1", name: "Primary", type: "COMPONENT", styles: { fill: "S_KEY" }, children: [] },
        ] },
      ],
    },
  };

  it("falls back to matching node style values directly against published keys", () => {
    const { nodes, edges } = extractTokens(bareDoc, styles, structural, "ABC");
    const token = nodes.find((n) => n.type === "token")!;
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "component:2:1", target: token.id, type: "uses_token" }),
    ]));
  });
});

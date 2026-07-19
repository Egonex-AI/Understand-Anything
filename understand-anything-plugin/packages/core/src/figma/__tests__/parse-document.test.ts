import { describe, it, expect } from "vitest";
import { parseDocument } from "../parse/parse-document";
import type { FigmaDocument } from "../source/types";

const doc: FigmaDocument = {
  name: "MyApp",
  document: {
    id: "0:0", name: "Document", type: "DOCUMENT", children: [
      { id: "1:0", name: "Onboarding", type: "CANVAS", children: [
        { id: "1:1", name: "Login", type: "FRAME", absoluteBoundingBox: { width: 375, height: 812 }, children: [
          { id: "1:2", name: "SignInBtn", type: "INSTANCE", componentId: "2:1", children: [] },
        ] },
      ] },
      { id: "1:9", name: "Components", type: "CANVAS", children: [
        { id: "2:0", name: "Button", type: "COMPONENT_SET", children: [
          { id: "2:1", name: "Primary", type: "COMPONENT", children: [] },
          { id: "2:2", name: "Secondary", type: "COMPONENT", children: [] },
        ] },
      ] },
    ],
  },
  components: { "2:1": { key: "COMP_KEY_GUID", name: "Primary", componentSetId: "2:0" } },
};

describe("parseDocument", () => {
  const { nodes, edges } = parseDocument(doc, "ABC123");
  const ids = nodes.map((n) => n.id);
  const has = (s: string, t: string, ty: string) =>
    edges.some((e) => e.source === s && e.target === t && e.type === ty);

  it("creates page/screen/instance/componentSet/component nodes", () => {
    expect(ids).toEqual(expect.arrayContaining([
      "page:1:0", "screen:1:1", "instance:1:2", "page:1:9", "componentSet:2:0", "component:2:1", "component:2:2",
    ]));
  });
  it("links containment, instance_of, and variant_of", () => {
    expect(has("page:1:0", "screen:1:1", "contains")).toBe(true);
    expect(has("screen:1:1", "instance:1:2", "contains")).toBe(true);
    expect(has("instance:1:2", "component:2:1", "instance_of")).toBe(true);
    expect(has("component:2:1", "componentSet:2:0", "variant_of")).toBe(true);
    expect(has("component:2:2", "componentSet:2:0", "variant_of")).toBe(true);
  });
  it("captures screen dimensions and fileKey in figmaMeta", () => {
    const screen = nodes.find((n) => n.id === "screen:1:1")!;
    expect(screen.figmaMeta?.dimensions?.width).toBe(375);
    expect(screen.figmaMeta?.fileKey).toBe("ABC123");
  });
  it("records the published component key (not the local node id) on instances", () => {
    const inst = nodes.find((n) => n.id === "instance:1:2")!;
    expect(inst.figmaMeta?.componentKey).toBe("COMP_KEY_GUID");
  });
  it("omits componentKey when the components map has no entry", () => {
    const bare: FigmaDocument = { ...doc, components: {} };
    const inst = parseDocument(bare, "ABC123").nodes.find((n) => n.id === "instance:1:2")!;
    expect(inst.figmaMeta?.componentKey).toBeUndefined();
  });
  it("emits validateGraph-ready nodes (summary/tags/complexity present)", () => {
    expect(nodes.every((n) => n.summary && n.tags.length > 0 && n.complexity)).toBe(true);
  });
});

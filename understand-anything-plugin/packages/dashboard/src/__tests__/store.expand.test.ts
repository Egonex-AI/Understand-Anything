import { it, expect, beforeEach } from "vitest";
import { useDashboardStore, ancestorContainerIds } from "../store";

beforeEach(() => useDashboardStore.setState({ expandedContainers: new Set(), selectedNodeId: null }));

it("toggleContainer adds then removes", () => {
  useDashboardStore.getState().toggleContainer("container:a/b");
  expect(useDashboardStore.getState().expandedContainers.has("container:a/b")).toBe(true);
  useDashboardStore.getState().toggleContainer("container:a/b");
  expect(useDashboardStore.getState().expandedContainers.has("container:a/b")).toBe(false);
});

it("ancestorContainerIds folds transparent segments", () => {
  expect(ancestorContainerIds("savo_pricing_ui/src/pages/New.tsx")).toEqual([
    "container:savo_pricing_ui",
    "container:savo_pricing_ui/src/pages",
  ]);
});

it("revealNode expands the path and selects (function → also its file)", () => {
  useDashboardStore.setState({
    nodesById: new Map([
      ["fn", { id: "fn", type: "function", filePath: "savo_pricing_ui/src/pages/New.tsx" } as any],
    ]),
  });
  useDashboardStore.getState().revealNode("fn");
  const st = useDashboardStore.getState();
  expect(st.selectedNodeId).toBe("fn");
  expect(st.expandedContainers.has("container:savo_pricing_ui")).toBe(true);
  expect(st.expandedContainers.has("container:savo_pricing_ui/src/pages")).toBe(true);
  expect(st.expandedContainers.has("file:savo_pricing_ui/src/pages/New.tsx")).toBe(true);
});

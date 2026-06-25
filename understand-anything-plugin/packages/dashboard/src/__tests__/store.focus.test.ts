// src/__tests__/store.focus.test.ts  (create)
import { it, expect, beforeEach } from "vitest";
import { useDashboardStore } from "../store";
beforeEach(() => useDashboardStore.getState().clearFocus?.());
it("focusContainer sets id and focusBreadcrumb derives crumbs", () => {
  useDashboardStore.getState().focusContainer("container:Pricing/UI/pages");
  expect(useDashboardStore.getState().focusedContainerId).toBe("container:Pricing/UI/pages");
  const crumbs = useDashboardStore.getState().focusBreadcrumb();
  expect(crumbs.map((c) => c.name)).toEqual(["Pricing", "UI", "pages"]);
});
it("clearFocus resets", () => {
  useDashboardStore.getState().focusContainer("container:X/Y");
  useDashboardStore.getState().clearFocus();
  expect(useDashboardStore.getState().focusedContainerId).toBeNull();
  expect(useDashboardStore.getState().focusBreadcrumb()).toEqual([]);
});

it("focusBreadcrumb folds transparent segments (src/app/lib) into the next crumb", () => {
  useDashboardStore.getState().focusContainer("container:savo_pricing_ui/src/pages");
  const crumbs = useDashboardStore.getState().focusBreadcrumb();
  // `src` is transparent — it must NOT become its own crumb, but the deeper
  // crumb id must still carry the full path so refocus/scoping works.
  expect(crumbs.map((c) => c.name)).toEqual(["savo_pricing_ui", "pages"]);
  expect(crumbs.map((c) => c.id)).toEqual([
    "container:savo_pricing_ui",
    "container:savo_pricing_ui/src/pages",
  ]);
});

it("focusBreadcrumb shows a single crumb for community cluster ids", () => {
  useDashboardStore.getState().focusContainer("container:cluster-3");
  const crumbs = useDashboardStore.getState().focusBreadcrumb();
  expect(crumbs).toEqual([{ id: "container:cluster-3", name: "cluster-3" }]);
});

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

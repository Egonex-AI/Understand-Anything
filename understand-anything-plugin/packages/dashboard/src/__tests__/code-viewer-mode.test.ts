import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "../store";

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
});

describe("code viewer mode", () => {
  it("starts in code-only mode and persists the desktop split choice", () => {
    expect(useDashboardStore.getState().codeViewerMode).toBe("code");

    useDashboardStore.getState().setCodeViewerMode("split");

    expect(useDashboardStore.getState().codeViewerMode).toBe("split");
  });

  it("allows returning to code-only mode", () => {
    useDashboardStore.getState().setCodeViewerMode("split");
    useDashboardStore.getState().setCodeViewerMode("code");

    expect(useDashboardStore.getState().codeViewerMode).toBe("code");
  });
});

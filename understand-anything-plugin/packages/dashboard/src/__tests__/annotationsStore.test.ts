import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnnotationsStore } from "../annotationsStore";

beforeEach(() => {
  // Saves are debounced; fake timers keep them from firing (no fetch in tests).
  vi.useFakeTimers();
  useAnnotationsStore.setState({ annotations: {}, storage: "local", loaded: true });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("setLineNote", () => {
  it("adds, updates and deletes line notes", () => {
    const { setLineNote } = useAnnotationsStore.getState();
    setLineNote("file:a.ts", 12, "check this");
    setLineNote("file:a.ts", 3, "entry");
    expect(useAnnotationsStore.getState().annotations["file:a.ts"].lines).toEqual({ "12": "check this", "3": "entry" });
    setLineNote("file:a.ts", 12, "updated");
    expect(useAnnotationsStore.getState().annotations["file:a.ts"].lines?.["12"]).toBe("updated");
    setLineNote("file:a.ts", 12, "   ");
    expect(useAnnotationsStore.getState().annotations["file:a.ts"].lines).toEqual({ "3": "entry" });
  });

  it("drops the entry once tags, note and lines are all empty", () => {
    const { setLineNote, setTags } = useAnnotationsStore.getState();
    setTags("n", ["x"]);
    setLineNote("n", 1, "note");
    setTags("n", []);
    expect(useAnnotationsStore.getState().annotations.n).toBeDefined();
    setLineNote("n", 1, "");
    expect(useAnnotationsStore.getState().annotations.n).toBeUndefined();
  });

  it("removes the `lines` field when the last line note goes but keeps tags", () => {
    const { setLineNote, setTags } = useAnnotationsStore.getState();
    setTags("n", ["x"]);
    setLineNote("n", 5, "note");
    setLineNote("n", 5, "");
    expect(useAnnotationsStore.getState().annotations.n).not.toHaveProperty("lines");
    expect(useAnnotationsStore.getState().annotations.n.tags).toEqual(["x"]);
  });

  it("ignores invalid line numbers and no-op deletes", () => {
    const { setLineNote } = useAnnotationsStore.getState();
    setLineNote("n", 0, "x");
    setLineNote("n", 1.5, "x");
    setLineNote("n", 4, "");
    expect(useAnnotationsStore.getState().annotations).toEqual({});
  });
});

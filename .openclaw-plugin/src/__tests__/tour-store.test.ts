import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTours, upsertTour, makeTourId, type StoredTour } from "../tour-store.js";

const dirsToClean: string[] = [];

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ua-tours-"));
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length) rmSync(dirsToClean.pop()!, { recursive: true, force: true });
});

function makeTour(kind: StoredTour["kind"], title: string): StoredTour {
  return { id: makeTourId(kind), kind, title, description: "d", createdAt: new Date(0).toISOString(), steps: [] };
}

describe("tour-store", () => {
  it("returns an empty list when no tours.json exists yet", () => {
    const root = makeTmpProject();
    expect(loadTours(root)).toEqual([]);
  });

  it("persists a tour and reloads it", () => {
    const root = makeTmpProject();
    const tour = makeTour("module", "Module walkthrough");
    upsertTour(root, tour);
    expect(loadTours(root)).toEqual([tour]);
  });

  it("replaces the existing tour of the same singleton kind (module/codeReview)", () => {
    const root = makeTmpProject();
    upsertTour(root, makeTour("module", "First"));
    const second = makeTour("module", "Second");
    upsertTour(root, second);

    const stored = loadTours(root);
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe("Second");
  });

  it("accumulates custom tours instead of replacing them", () => {
    const root = makeTmpProject();
    upsertTour(root, makeTour("custom", "Custom A"));
    upsertTour(root, makeTour("custom", "Custom B"));

    const stored = loadTours(root);
    expect(stored).toHaveLength(2);
    expect(stored.map((t) => t.title)).toEqual(["Custom A", "Custom B"]);
  });

  it("keeps module and codeReview tours independent of each other", () => {
    const root = makeTmpProject();
    upsertTour(root, makeTour("module", "Module"));
    upsertTour(root, makeTour("codeReview", "Review"));

    const stored = loadTours(root);
    expect(stored).toHaveLength(2);
    expect(stored.map((t) => t.kind).sort()).toEqual(["codeReview", "module"]);
  });
});

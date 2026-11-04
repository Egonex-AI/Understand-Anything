import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCodeLessons } from "../codeLessons";

function validSection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Setup",
    lineRange: [1, 4],
    explanation: "Wires up the module.",
    ...overrides,
  };
}

function validFileEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { overview: "A small module.", sections: [validSection()], ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeCodeLessons", () => {
  it("returns null for non-object payloads", () => {
    expect(normalizeCodeLessons(null)).toBeNull();
    expect(normalizeCodeLessons("text")).toBeNull();
    expect(normalizeCodeLessons(42)).toBeNull();
    expect(normalizeCodeLessons([1, 2])).toBeNull();
  });

  it("returns null when the files envelope is missing or not an object", () => {
    expect(normalizeCodeLessons({})).toBeNull();
    expect(normalizeCodeLessons({ files: "nope" })).toBeNull();
    expect(normalizeCodeLessons({ files: ["a"] })).toBeNull();
  });

  it("keeps valid entries untouched", () => {
    const result = normalizeCodeLessons({
      version: 1,
      generatedAt: "2026-11-04T00:00:00.000Z",
      files: { "src/a.ts": validFileEntry() },
    });
    expect(result).not.toBeNull();
    expect(result?.files["src/a.ts"]).toEqual({
      overview: "A small module.",
      sections: [{ title: "Setup", lineRange: [1, 4], explanation: "Wires up the module." }],
    });
  });

  it("coerces entries without sections to overview-only and keeps siblings (review #1 crash shape)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = normalizeCodeLessons({
      files: {
        "src/a.ts": { overview: "Broken — no sections field" },
        "src/b.ts": validFileEntry(),
      },
    });
    expect(result).not.toBeNull();
    // The crash came from `lesson.sections.length` on a missing field — the
    // normalized shape guarantees an array, so the overview stays usable.
    expect(result?.files["src/a.ts"]).toEqual({
      overview: "Broken — no sections field",
      sections: [],
    });
    expect(result?.files["src/b.ts"]).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"src/a.ts": sections missing or not an array'),
    );
  });

  it("drops entries whose overview is not a string", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = normalizeCodeLessons({
      files: { "src/a.ts": { overview: 42, sections: [] } },
    });
    expect(result?.files).toEqual({});
  });

  it("drops invalid sections while keeping valid siblings", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = normalizeCodeLessons({
      files: {
        "src/a.ts": {
          overview: "ok",
          sections: [
            validSection({ lineRange: [0, 4] }), // start < 1
            validSection({ lineRange: [5, 2] }), // start > end
            validSection({ lineRange: [1] }), // wrong length
            validSection({ lineRange: ["1", 4] }), // not integers
            validSection({ title: "" }), // empty title
            validSection({ title: 7 }), // non-string title
            validSection({ explanation: null }), // non-string explanation
            validSection({ tourOrder: "x" }), // non-integer tourOrder
            validSection(),
          ],
        },
      },
    });
    const sections = result?.files["src/a.ts"]?.sections ?? [];
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe("Setup");
  });

  it("preserves a valid integer tourOrder and omits undefined", () => {
    const result = normalizeCodeLessons({
      files: {
        "src/a.ts": validFileEntry({ sections: [validSection({ tourOrder: 2 })] }),
        "src/b.ts": validFileEntry(),
      },
    });
    expect(result?.files["src/a.ts"]?.sections[0]?.tourOrder).toBe(2);
    expect(result?.files["src/b.ts"]?.sections[0]?.tourOrder).toBeUndefined();
  });

  it("caps sections at 10 per file", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sections = Array.from({ length: 14 }, (_, i) => validSection({ title: `S${i}` }));
    const result = normalizeCodeLessons({ files: { "src/a.ts": { overview: "ok", sections } } });
    expect(result?.files["src/a.ts"]?.sections).toHaveLength(10);
  });

  it("treats a non-array sections field as empty and accepts an empty overview string", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = normalizeCodeLessons({
      files: {
        "src/a.ts": { overview: "", sections: "nope" },
        "src/b.ts": { overview: "", sections: [] },
      },
    });
    expect(result?.files["src/a.ts"]?.sections).toEqual([]);
    expect(result?.files["src/b.ts"]).toEqual({ overview: "", sections: [] });
  });

  it("stamps defaults for missing version/generatedAt", () => {
    const result = normalizeCodeLessons({ files: {} });
    expect(result?.version).toBe(1);
    expect(result?.generatedAt).toBe("");
  });
});

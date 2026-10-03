import { describe, it, expect } from "vitest";
import { DEFAULT_NOTES_LABELS, buildNotesMarkdown, buildObsidianVault, safeFileName, tagSlug, uniqueNoteNames } from "../notesExport";
import { notesAnnotations, notesGraph } from "./notesFixture";

const date = new Date("2026-10-03T12:00:00Z");

describe("tagSlug / safeFileName", () => {
  it("makes Obsidian-friendly tags", () => {
    expect(tagSlug("entry point")).toBe("entry-point");
    expect(tagSlug("a.b!c")).toBe("a-b-c");
    expect(tagSlug("2026")).toBe("tag-2026");
    expect(tagSlug("待办")).toBe("待办");
  });
  it("strips characters Obsidian and filesystems reject", () => {
    expect(safeFileName("a/b:c*d?[x]#y|z")).toBe("a-b-c-d--x--y-z");
    expect(safeFileName("...hidden")).toBe("hidden");
    expect(safeFileName("   ")).toBe("untitled");
  });
});

describe("uniqueNoteNames", () => {
  it("disambiguates duplicate names with the file name, then a counter", () => {
    const g = notesGraph();
    const nodes = g.nodes.filter((n) => n.name === "handler");
    const names = uniqueNoteNames(nodes);
    expect(names.get("fn:src/api.ts:handler")).toBe("handler (api.ts)");
    expect(names.get("fn:src/other.ts:handler")).toBe("handler (other.ts)");
    const reserved = uniqueNoteNames([g.nodes[0]], ["api.ts"]);
    expect(reserved.get("file:src/api.ts")).toBe("api.ts 2");
  });
});

describe("buildNotesMarkdown", () => {
  const md = buildNotesMarkdown(notesGraph(), notesAnnotations(), { date });

  it("has a title, export line and contents in graph order", () => {
    expect(md.startsWith("# Demo — notes\n\n> Exported 2026-10-03 · 5 annotated nodes")).toBe(true);
    expect(md).toContain("1. [util.ts](#ua-note-1) — `src/util.ts`");
    expect(md).toContain("5. [db.ts](#ua-note-5) — `src/db.ts`");
    expect(md).not.toContain("gone.ts");
  });

  it("includes metadata, summary, note, line notes and related links", () => {
    expect(md).toContain('<a id="ua-note-3"></a>\n\n## handler');
    expect(md).toContain("- **File:** `src/api.ts` (lines 10-20)");
    expect(md).toContain("- **Layer:** API");
    expect(md).toContain("- **Tags:** #entry-point");
    expect(md).toContain("### Summary\n\napi.ts summary.");
    expect(md).toContain("### Note\n\nStarts **here**.");
    expect(md).toContain("### Line notes\n\n- `src/api.ts:12` — auth check\n- `src/api.ts:15` — validate input here");
    expect(md).toContain("- imports → [db.ts](#ua-note-5)");
    expect(md).toContain("- ← imports [api.ts](#ua-note-2)");
    expect(md).toContain("- contains → [handler](#ua-note-3)");
  });

  it("uses custom labels", () => {
    const out = buildNotesMarkdown(notesGraph(), {}, {
      date,
      labels: { ...DEFAULT_NOTES_LABELS, title: "{project} 笔记", exported: "{date} 导出 · {count}" },
    });
    expect(out).toBe("# Demo 笔记\n\n> 2026-10-03 导出 · 0\n");
  });
});

describe("buildObsidianVault", () => {
  const files = buildObsidianVault(notesGraph(), notesAnnotations(), { date });
  const byPath = new Map(files.map((f) => [f.path, f.data as string]));

  it("writes an index plus one note per annotated node", () => {
    expect(files.map((f) => f.path)).toEqual([
      "Demo notes/Index.md",
      "Demo notes/notes/util.ts.md",
      "Demo notes/notes/api.ts.md",
      "Demo notes/notes/handler (api.ts).md",
      "Demo notes/notes/handler (other.ts).md",
      "Demo notes/notes/db.ts.md",
    ]);
  });

  it("adds YAML frontmatter with type, file, lines and tags", () => {
    const note = byPath.get("Demo notes/notes/handler (api.ts).md")!;
    expect(note.startsWith([
      "---",
      'type: "function"',
      'file: "src/api.ts"',
      'lines: "10-20"',
      'layer: "API"',
      'node_id: "fn:src/api.ts:handler"',
      "tags:",
      '  - "Entry-Point"',
      'updated: "2026-03-04T00:00:00Z"',
      "aliases:",
      '  - "handler"',
      "---",
      "",
      "# handler",
    ].join("\n"))).toBe(true);
    expect(note).toContain("## Line notes\n\n- `src/api.ts:12` — auth check");
    expect(note).toContain("- ← contains [[api.ts]]");
    expect(note.trimEnd().endsWith("Back to [[Index]]")).toBe(true);
    expect(byPath.get("Demo notes/notes/db.ts.md")).toContain("tags: []");
  });

  it("links related annotated nodes with wikilinks", () => {
    const api = byPath.get("Demo notes/notes/api.ts.md")!;
    expect(api).toContain("- imports → [[db.ts]]");
    expect(api).toContain("- contains → [[handler (api.ts)|handler]]");
  });

  it("groups the index by layer and by tag", () => {
    const index = byPath.get("Demo notes/Index.md")!;
    expect(index).toContain('type: "index"');
    expect(index).toContain("# Demo — notes");
    expect(index).toContain("A demo project.");
    expect(index).toContain("### API\n\n- [[util.ts]] — util.ts summary.");
    expect(index).toContain("### Data\n\n- [[db.ts]] — db.ts summary.");
    expect(index).toContain("- #entry-point: [[api.ts]], [[handler (api.ts)|handler]]");
    expect(index).toContain("- #helpers: [[util.ts]]");
    expect(index).not.toContain("stale");
  });

  it("reserves the index name", () => {
    const g = notesGraph();
    g.nodes[0].name = "Index";
    const out = buildObsidianVault(g, notesAnnotations(), { date });
    expect(out.map((f) => f.path)).toContain("Demo notes/notes/Index 2.md");
  });
});

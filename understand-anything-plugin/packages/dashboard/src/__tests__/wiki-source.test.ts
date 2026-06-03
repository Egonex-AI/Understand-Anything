import { describe, expect, it } from "vitest";
import {
  MAX_WIKI_SOURCE_LINES,
  parseWikiSourceLineRange,
  sliceSourceLines,
} from "../../wiki-source";

describe("parseWikiSourceLineRange", () => {
  it("defaults to the first max-preview window when params are missing", () => {
    expect(parseWikiSourceLineRange(null, null)).toEqual({
      startLine: 1,
      endLine: MAX_WIKI_SOURCE_LINES,
    });
  });

  it("uses start as end when end is omitted", () => {
    expect(parseWikiSourceLineRange("10", null)).toEqual({ startLine: 10, endLine: 10 });
  });

  it("rejects invalid line numbers", () => {
    expect(parseWikiSourceLineRange("0", "5")).toEqual({ error: "Invalid line range" });
    expect(parseWikiSourceLineRange("foo", "5")).toEqual({ error: "Invalid line range" });
    expect(parseWikiSourceLineRange("5", "3")).toEqual({ error: "Invalid line range" });
  });

  it("rejects ranges wider than the maximum", () => {
    const wide = parseWikiSourceLineRange("1", String(MAX_WIKI_SOURCE_LINES + 1));
    expect(wide).toEqual({ error: `Line range exceeds maximum of ${MAX_WIKI_SOURCE_LINES} lines` });
  });
});

describe("sliceSourceLines", () => {
  const content = "line1\nline2\nline3\nline4\n";

  it("returns the requested inclusive slice", () => {
    expect(sliceSourceLines(content, 2, 3)).toEqual({
      content: "line2\nline3",
      startLine: 2,
      endLine: 3,
    });
  });

  it("clamps end to file length", () => {
    expect(sliceSourceLines(content, 3, 99)).toEqual({
      content: "line3\nline4",
      startLine: 3,
      endLine: 4,
    });
  });
});

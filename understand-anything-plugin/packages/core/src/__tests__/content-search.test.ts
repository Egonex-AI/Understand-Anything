import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ContentSearchQueryError,
  parseContentSearchParams,
  searchProjectContent,
} from "../content-search.js";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ua-content-search-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.ts"), "const token = 1;\nexport function getToken() {\n  return token;\n}\n");
  fs.writeFileSync(path.join(root, "src/b.py"), "TOKEN = 'x'\nprint(TOKEN)\n");
  fs.writeFileSync(path.join(root, "src/bin.dat"), Buffer.from([0x74, 0x6f, 0x6b, 0x00, 0x65, 0x6e]));
  fs.writeFileSync(path.join(root, "src/long.txt"), `${"x".repeat(500)}needle${"y".repeat(500)}`);
  fs.writeFileSync(path.join(root, "secret.env"), "token=hunter2\n");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const files = ["src/a.ts", "src/b.py", "src/bin.dat", "src/long.txt"];

describe("searchProjectContent", () => {
  it("finds case-insensitive matches with line and column", () => {
    const result = searchProjectContent(root, files, "token");
    expect(result.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.py"]);
    const a = result.files[0];
    expect(a.matchCount).toBe(3);
    expect(a.matches[0]).toMatchObject({ line: 1, column: 6, length: 5, preview: "const token = 1;" });
    expect(a.matches[1]).toMatchObject({ line: 2, column: 19 });
    expect(result.totalMatches).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it("only searches allowlisted files and skips binary files", () => {
    const result = searchProjectContent(root, files, "hunter2");
    expect(result.totalMatches).toBe(0);
    expect(searchProjectContent(root, files, "tok").files.map((f) => f.path)).not.toContain("src/bin.dat");
  });

  it("supports case-sensitive, whole-word and regex options", () => {
    expect(searchProjectContent(root, files, "TOKEN", { caseSensitive: true }).totalMatches).toBe(2);
    expect(searchProjectContent(root, files, "token", { wholeWord: true }).totalMatches).toBe(4);
    expect(searchProjectContent(root, files, "get\\w+\\(", { regex: true }).files[0].matches[0].column).toBe(16);
  });

  it("rejects invalid regular expressions", () => {
    expect(() => searchProjectContent(root, files, "(", { regex: true })).toThrow(ContentSearchQueryError);
  });

  it("trims long lines around the match", () => {
    const m = searchProjectContent(root, files, "needle").files[0].matches[0];
    expect(m.column).toBe(500);
    expect(m.preview.length).toBeLessThan(260);
    expect(m.preview.slice(m.previewColumn, m.previewColumn + 6)).toBe("needle");
  });

  it("stops at maxMatches and reports truncation", () => {
    const result = searchProjectContent(root, files, "token", { maxMatches: 2 });
    expect(result.totalMatches).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("handles zero-width regex matches without looping", () => {
    const result = searchProjectContent(root, ["src/a.ts"], "^", { regex: true });
    expect(result.totalMatches).toBe(5);
  });
});

describe("parseContentSearchParams", () => {
  it("reads query and flags", () => {
    const parsed = parseContentSearchParams(new URLSearchParams("q=foo&case=1&regex=true"));
    expect(parsed).toEqual({ query: "foo", options: { caseSensitive: true, regex: true, wholeWord: false } });
  });
});

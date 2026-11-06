import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAnyPattern } from "../glob-match.js";

describe("globToRegExp", () => {
  it("matches ** across path segments", () => {
    expect(globToRegExp("src/api/**").test("src/api/v1/users.ts")).toBe(true);
    expect(globToRegExp("src/api/**").test("src/web/users.ts")).toBe(false);
  });

  it("keeps * within a single segment", () => {
    expect(globToRegExp("src/*.ts").test("src/main.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/nested/main.ts")).toBe(false);
  });

  it("matches ? as exactly one non-separator character", () => {
    expect(globToRegExp("file?.ts").test("file1.ts")).toBe(true);
    expect(globToRegExp("file?.ts").test("file12.ts")).toBe(false);
    expect(globToRegExp("file?.ts").test("file/.ts")).toBe(false);
  });

  it("escapes regex metacharacters in literal parts", () => {
    expect(globToRegExp("src/a+b.ts").test("src/a+b.ts")).toBe(true);
    expect(globToRegExp("src/a+b.ts").test("src/aab.ts")).toBe(false);
    expect(globToRegExp("*.test.ts").test("foo.test.ts")).toBe(true);
    expect(globToRegExp("*.test.ts").test("foo.testxts")).toBe(false);
  });
});

describe("matchesAnyPattern", () => {
  it("returns true when any pattern matches", () => {
    expect(matchesAnyPattern("src/api/users.ts", ["docs/**", "src/api/**"])).toBe(true);
  });
  it("returns false when no pattern matches", () => {
    expect(matchesAnyPattern("src/web/index.ts", ["docs/**", "src/api/**"])).toBe(false);
  });
});

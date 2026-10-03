import { describe, expect, it } from "vitest";
import { navigationKey, parseUrlState, serializeUrlState } from "../urlState";

describe("urlState", () => {
  it("round-trips state through the hash", () => {
    const state = {
      view: "domain" as const,
      layer: "layer:api",
      node: "function:src/a b.ts:run",
      code: "file:src/a b.ts",
      line: 42,
      q: "auth & token",
      mode: "content" as const,
    };
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("omits defaults and dependent fields", () => {
    expect(serializeUrlState({ view: "structural", mode: "content" })).toBe("");
    expect(serializeUrlState({ line: 3 })).toBe("");
  });

  it("ignores junk", () => {
    expect(parseUrlState("#view=bogus&mode=nope&line=-2&node=")).toEqual({});
  });

  it("navigation key ignores search typing", () => {
    expect(navigationKey({ node: "a", q: "x" })).toBe(navigationKey({ node: "a", q: "xy" }));
    expect(navigationKey({ node: "a" })).not.toBe(navigationKey({ node: "b" }));
  });
});

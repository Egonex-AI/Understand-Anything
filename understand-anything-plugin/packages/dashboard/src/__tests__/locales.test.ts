import { describe, expect, it } from "vitest";
import { resolveLocaleKey, resolvePreferredLocaleKey } from "../locales";

describe("resolveLocaleKey", () => {
  it("resolves Japanese locale variants to the Japanese UI", () => {
    expect(resolveLocaleKey("ja")).toBe("ja");
    expect(resolveLocaleKey("ja-JP")).toBe("ja");
    expect(resolveLocaleKey("ja_JP")).toBe("ja");
    expect(resolveLocaleKey("japanese")).toBe("ja");
  });

  it("keeps the existing English fallback for unknown or missing languages", () => {
    expect(resolveLocaleKey(undefined)).toBe("en");
    expect(resolveLocaleKey("en-US")).toBe("en");
    expect(resolveLocaleKey("fr")).toBe("en");
  });

  it("uses browser language only when config does not specify a language", () => {
    expect(resolvePreferredLocaleKey(undefined, "ja-JP")).toBe("ja");
    expect(resolvePreferredLocaleKey("en", "ja-JP")).toBe("en");
  });
});

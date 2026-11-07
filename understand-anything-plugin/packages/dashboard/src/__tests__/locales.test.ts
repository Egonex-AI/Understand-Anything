import { describe, expect, it } from "vitest";
import { getLocale, locales, resolveLocaleKey } from "../locales";

function keyShape(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyShape(item).map((key) => `${index}.${key}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => keyShape((value as Record<string, unknown>)[key]).map((child) => `${key}.${child}`));
  }
  // Leaves contribute their own path plus their kind, so a missing key or a
  // string-vs-function mismatch (interpolated messages) changes the shape.
  return [typeof value];
}

describe("resolveLocaleKey", () => {
  it("resolves Vietnamese codes and friendly names", () => {
    expect(resolveLocaleKey("vi")).toBe("vi");
    expect(resolveLocaleKey("vi-VN")).toBe("vi");
    expect(resolveLocaleKey("vi_vn")).toBe("vi");
    expect(resolveLocaleKey("vietnamese")).toBe("vi");
    expect(resolveLocaleKey("Vietnamese")).toBe("vi");
  });

  it("resolves Brazilian Portuguese codes and friendly names", () => {
    expect(resolveLocaleKey("pt-BR")).toBe("pt-BR");
    expect(resolveLocaleKey("pt_br")).toBe("pt-BR");
    expect(resolveLocaleKey("pt")).toBe("pt-BR");
    expect(resolveLocaleKey("portuguese")).toBe("pt-BR");
    expect(resolveLocaleKey("Portuguese")).toBe("pt-BR");
  });

  it("retries browser language tags with their base language", () => {
    expect(resolveLocaleKey("ja-JP")).toBe("ja");
    expect(resolveLocaleKey("ko-KR")).toBe("ko");
    expect(resolveLocaleKey("en-US")).toBe("en");
  });

  it("falls back to English for unknown languages", () => {
    expect(resolveLocaleKey("xx")).toBe("en");
    expect(resolveLocaleKey(undefined)).toBe("en");
  });
});

describe("locales", () => {
  it("exposes a Vietnamese locale with the English key shape", () => {
    expect(keyShape(locales.vi)).toEqual(keyShape(locales.en));
    expect(locales.vi.onboarding.steps).toHaveLength(locales.en.onboarding.steps.length);
  });

  it("exposes a Brazilian Portuguese locale with the English key shape", () => {
    expect(keyShape(locales["pt-BR"])).toEqual(keyShape(locales.en));
    expect(locales["pt-BR"].onboarding.steps).toHaveLength(locales.en.onboarding.steps.length);
  });

  it("gives every locale the English key shape", () => {
    for (const [key, locale] of Object.entries(locales)) {
      expect(keyShape(locale), key).toEqual(keyShape(locales.en));
    }
  });

  it("lists every locale in the record", () => {
    expect(Object.keys(locales).sort()).toEqual(["en", "ja", "ko", "pt-BR", "ru", "vi", "zh", "zh-TW"]);
  });

  it("returns the Vietnamese locale via getLocale", () => {
    expect(getLocale("vi")).toBe(locales.vi);
  });
});

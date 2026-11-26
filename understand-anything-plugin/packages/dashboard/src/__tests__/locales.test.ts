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
  return [];
}

describe("resolveLocaleKey", () => {
  it("resolves Vietnamese codes and friendly names", () => {
    expect(resolveLocaleKey("vi")).toBe("vi");
    expect(resolveLocaleKey("vi-VN")).toBe("vi");
    expect(resolveLocaleKey("vi_vn")).toBe("vi");
    expect(resolveLocaleKey("vietnamese")).toBe("vi");
    expect(resolveLocaleKey("Vietnamese")).toBe("vi");
  });

  it("resolves Turkish codes and friendly names", () => {
    expect(resolveLocaleKey("tr")).toBe("tr");
    expect(resolveLocaleKey("TR")).toBe("tr");
    expect(resolveLocaleKey("tr-TR")).toBe("tr");
    expect(resolveLocaleKey("tr_tr")).toBe("tr");
    expect(resolveLocaleKey("turkish")).toBe("tr");
    expect(resolveLocaleKey("Turkish")).toBe("tr");
    expect(resolveLocaleKey("Türkçe")).toBe("tr");
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

  it("exposes a Turkish locale with the English key shape", () => {
    expect(keyShape(locales.tr)).toEqual(keyShape(locales.en));
    expect(locales.tr.onboarding.steps).toHaveLength(locales.en.onboarding.steps.length);
  });

  it("lists every locale in the record", () => {
    expect(Object.keys(locales).sort()).toEqual(["en", "ja", "ko", "ru", "tr", "vi", "zh", "zh-TW"]);
  });

  it("returns the Vietnamese locale via getLocale", () => {
    expect(getLocale("vi")).toBe(locales.vi);
  });

  it("returns the Turkish locale via getLocale", () => {
    expect(getLocale("tr")).toBe(locales.tr);
  });
});

import { describe, expect, it } from "vitest";
import { getLocale, locales, resolveLocaleKey } from "../index";

describe("locale registry", () => {
  it("registers Portuguese locale strings", () => {
    expect(locales.pt).toBeDefined();
    expect(getLocale("pt")).toBe(locales.pt);
  });

  it("resolves Portuguese language variants to the shared locale", () => {
    expect(resolveLocaleKey("pt")).toBe("pt");
    expect(resolveLocaleKey("pt-BR")).toBe("pt");
    expect(resolveLocaleKey("portuguese")).toBe("pt");
  });
});

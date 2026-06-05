import { describe, it, expect } from "vitest";
import { flowFragmentFromId, isSameWikiPage, isSameWikiTarget } from "../utils/wikiFlowNav";

describe("flowFragmentFromId", () => {
  it("converts wiki:flow:xxx to flow:xxx", () => {
    expect(flowFragmentFromId("wiki:flow:sayhi-and-payment")).toBe("flow:sayhi-and-payment");
  });

  it("converts flow:xxx to flow:xxx (no double prefix)", () => {
    expect(flowFragmentFromId("flow:sayhi-and-payment")).toBe("flow:sayhi-and-payment");
  });

  it("converts bare id to flow:xxx", () => {
    expect(flowFragmentFromId("sayhi-and-payment")).toBe("flow:sayhi-and-payment");
  });

  it("handles empty string", () => {
    expect(flowFragmentFromId("")).toBe("flow:");
  });
});

describe("isSameWikiPage", () => {
  const base = { type: "domain" as const, id: "domain:order", service: "order-svc" };

  it("returns true when type, id, and service match (ignores fragment)", () => {
    expect(isSameWikiPage(
      { ...base, fragment: "flow:a" },
      { ...base, fragment: "flow:b" },
    )).toBe(true);
  });

  it("returns true when neither has fragment", () => {
    expect(isSameWikiPage(base, base)).toBe(true);
  });

  it("returns false when id differs", () => {
    expect(isSameWikiPage(base, { ...base, id: "domain:payment" })).toBe(false);
  });

  it("returns false when service differs", () => {
    expect(isSameWikiPage(base, { ...base, service: "payment-svc" })).toBe(false);
  });

  it("returns false when type differs", () => {
    expect(isSameWikiPage(base, { ...base, type: "service" })).toBe(false);
  });
});

describe("isSameWikiTarget", () => {
  const base = { type: "domain" as const, id: "domain:order", service: "order-svc" };

  it("returns true when type, id, service, and fragment all match", () => {
    expect(isSameWikiTarget(
      { ...base, fragment: "flow:a" },
      { ...base, fragment: "flow:a" },
    )).toBe(true);
  });

  it("returns false when fragment differs", () => {
    expect(isSameWikiTarget(
      { ...base, fragment: "flow:a" },
      { ...base, fragment: "flow:b" },
    )).toBe(false);
  });

  it("returns false when one has fragment and other does not", () => {
    expect(isSameWikiTarget(
      { ...base, fragment: "flow:a" },
      { ...base },
    )).toBe(false);
  });

  it("returns true when neither has fragment", () => {
    expect(isSameWikiTarget(
      { ...base },
      { ...base },
    )).toBe(true);
  });

  it("returns false when id differs", () => {
    expect(isSameWikiTarget(
      { ...base, fragment: "flow:a" },
      { ...base, id: "domain:payment", fragment: "flow:a" },
    )).toBe(false);
  });

  it("returns false when service differs", () => {
    expect(isSameWikiTarget(
      { ...base },
      { ...base, service: "payment-svc" },
    )).toBe(false);
  });
});

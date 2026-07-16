import { describe, it, expect, vi, afterEach } from "vitest";
import { parseFileKey, FigmaApiSource } from "../source/api-source";

afterEach(() => { vi.restoreAllMocks(); delete process.env.FIGMA_TOKEN; });

describe("parseFileKey", () => {
  it("extracts key from a /file/ URL", () => {
    expect(parseFileKey("https://www.figma.com/file/ABC123/My-App")).toBe("ABC123");
  });
  it("extracts key from a /design/ URL with query", () => {
    expect(parseFileKey("https://www.figma.com/design/XYZ789/App?node-id=1-2")).toBe("XYZ789");
  });
  it("accepts a bare key", () => {
    expect(parseFileKey("ABC123")).toBe("ABC123");
  });
  it("throws on unparseable input", () => {
    expect(() => parseFileKey("not a key!!")).toThrow();
  });
});

describe("FigmaApiSource", () => {
  it("throws a friendly error when FIGMA_TOKEN is missing", () => {
    delete process.env.FIGMA_TOKEN;
    expect(() => new FigmaApiSource("ABC123")).toThrow(/FIGMA_TOKEN/);
  });
  it("fetches the document and sends the token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Doc", document: { id: "0:0", type: "DOCUMENT", name: "Doc", children: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const src = new FigmaApiSource("ABC123", "tok_secret");
    const doc = await src.fetchDocument();
    expect(doc.name).toBe("Doc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/files/ABC123");
    expect((init.headers as Record<string, string>)["X-Figma-Token"]).toBe("tok_secret");
  });
  it("never leaks the token in error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" }));
    const src = new FigmaApiSource("ABC123", "tok_secret");
    await expect(src.fetchDocument()).rejects.toThrow(/403/);
    await expect(src.fetchDocument()).rejects.not.toThrow(/tok_secret/);
  });
});

import { describe, it, expect } from "vitest";
import { crc32, createZip } from "../zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Read entries back by walking the central directory — a tiny independent unzip. */
function readZip(zip: Uint8Array): Array<{ path: string; text: string; crc: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const localOffset = view.getUint32(p + 42, true);
    const path = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 8, true)).toBe(0); // STORE
    const localNameLen = view.getUint16(localOffset + 26, true);
    const extraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + extraLen;
    const text = dec.decode(zip.subarray(start, start + size));
    out.push({ path, text, crc });
    p += 46 + nameLen;
  }
  return out;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });
  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("createZip", () => {
  it("round-trips files including UTF-8 names and content", () => {
    const zip = createZip(
      [
        { path: "vault/Index.md", data: "# Index\n" },
        { path: "vault/notes/笔记.md", data: "héllo — 世界" },
        { path: "/leading.txt", data: enc.encode("bytes") },
      ],
      new Date(2026, 9, 3, 12, 30, 10),
    );
    const files = readZip(zip);
    expect(files.map((f) => f.path)).toEqual(["vault/Index.md", "vault/notes/笔记.md", "leading.txt"]);
    expect(files[1].text).toBe("héllo — 世界");
    for (const f of files) expect(f.crc).toBe(crc32(enc.encode(f.text)));
  });

  it("writes DOS timestamps and the UTF-8 flag", () => {
    const zip = createZip([{ path: "a.txt", data: "a" }], new Date(2026, 9, 3, 12, 30, 10));
    const view = new DataView(zip.buffer);
    expect(view.getUint16(6, true)).toBe(0x0800);
    expect(view.getUint16(10, true)).toBe((12 << 11) | (30 << 5) | 5);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 3);
  });

  it("produces a valid empty archive", () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
});

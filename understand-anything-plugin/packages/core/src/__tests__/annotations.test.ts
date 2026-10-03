import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  AnnotationsError,
  handleAnnotationsRequest,
  normalizeAnnotations,
  readAnnotations,
} from "../annotations.js";

function request(method: string, body?: unknown, contentType = "application/json"): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, { method, headers: { "content-type": contentType } }) as unknown as IncomingMessage;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ua-annotations-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("normalizeAnnotations", () => {
  it("cleans tags, drops empty entries and keeps notes", () => {
    const doc = normalizeAnnotations({
      nodes: {
        a: { tags: [" auth ", "Auth", "", 3, "todo"], note: "check this", updatedAt: "2026-01-01T00:00:00Z" },
        b: { tags: [], note: "   " },
        c: "nope",
      },
    });
    expect(doc).toEqual({
      version: 1,
      nodes: { a: { tags: ["auth", "todo"], note: "check this", updatedAt: "2026-01-01T00:00:00Z" } },
    });
  });

  it("keeps sanitized per-line notes and omits `lines` when there are none", () => {
    const doc = normalizeAnnotations({
      nodes: {
        a: {
          tags: [],
          note: "",
          lines: { "3": "why this?", "012": "x", "0": "x", "-1": "x", "1.5": "x", abc: "x", "7": "  ", "9": 42, "12": "y".repeat(6000) },
          updatedAt: "2026-01-01T00:00:00Z",
        },
        b: { tags: ["t"], note: "", lines: ["not", "an", "object"] },
        c: { tags: [], note: "", lines: { "0": "invalid only" } },
      },
    });
    expect(Object.keys(doc.nodes).sort()).toEqual(["a", "b"]);
    expect(doc.nodes.a.lines).toEqual({ "3": "why this?", "12": "y".repeat(5000) });
    expect(doc.nodes.b).not.toHaveProperty("lines");
  });

  it("caps the number of line notes per node", () => {
    const lines: Record<string, string> = {};
    for (let i = 1; i <= 600; i += 1) lines[String(i)] = `note ${i}`;
    const doc = normalizeAnnotations({ nodes: { a: { lines } } });
    expect(Object.keys(doc.nodes.a.lines ?? {})).toHaveLength(500);
  });

  it("still loads version-1 documents written before line notes existed", () => {
    const doc = normalizeAnnotations({ version: 1, nodes: { a: { tags: ["x"], note: "n", updatedAt: "t" } } });
    expect(doc).toEqual({ version: 1, nodes: { a: { tags: ["x"], note: "n", updatedAt: "t" } } });
  });

  it("rejects a wrong top-level shape", () => {
    expect(() => normalizeAnnotations([])).toThrow(AnnotationsError);
    expect(() => normalizeAnnotations({ nodes: [] })).toThrow(AnnotationsError);
  });
});

describe("handleAnnotationsRequest", () => {
  it("returns an empty document when no file exists", async () => {
    const res = await handleAnnotationsRequest(request("GET"), dir, { writable: true });
    expect(res).toEqual({ statusCode: 200, payload: { version: 1, nodes: {}, writable: true } });
  });

  it("writes on PUT and reads it back", async () => {
    const body = { version: 1, nodes: { "file:a.ts": { tags: ["core"], note: "entry point" } } };
    const put = await handleAnnotationsRequest(request("PUT", body), dir, { writable: true });
    expect(put.statusCode).toBe(200);
    expect(readAnnotations(dir).nodes["file:a.ts"]).toMatchObject({ tags: ["core"], note: "entry point" });
    expect(fs.readdirSync(dir)).toEqual(["annotations.json"]);
  });

  it("round-trips line notes through PUT and GET", async () => {
    const body = { version: 1, nodes: { "file:a.ts": { tags: [], note: "", lines: { "10": "hot path" } } } };
    await handleAnnotationsRequest(request("PUT", body), dir, { writable: true });
    const res = await handleAnnotationsRequest(request("GET"), dir, { writable: true });
    expect((res.payload as { nodes: Record<string, { lines?: Record<string, string> }> }).nodes["file:a.ts"].lines).toEqual({
      "10": "hot path",
    });
  });

  it("refuses writes on read-only servers and non-JSON bodies", async () => {
    expect((await handleAnnotationsRequest(request("PUT", {}), dir, { writable: false })).statusCode).toBe(405);
    expect((await handleAnnotationsRequest(request("PUT", {}, "text/plain"), dir, { writable: true })).statusCode).toBe(415);
    expect((await handleAnnotationsRequest(request("PUT", []), dir, { writable: true })).statusCode).toBe(400);
  });

  it("does not report a corrupt file as empty", async () => {
    fs.writeFileSync(path.join(dir, "annotations.json"), "{oops");
    const res = await handleAnnotationsRequest(request("GET"), dir, { writable: true });
    expect(res.statusCode).toBe(500);
  });
});

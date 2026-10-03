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

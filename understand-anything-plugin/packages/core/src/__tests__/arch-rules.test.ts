import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  ArchRulesError,
  handleArchRulesRequest,
  normalizeArchRules,
  readArchRules,
} from "../arch-rules.js";

function request(method: string, body?: unknown, contentType = "application/json"): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, { method, headers: { "content-type": contentType } }) as unknown as IncomingMessage;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ua-arch-rules-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("normalizeArchRules", () => {
  it("trims selectors, drops incomplete rules and dedupes ids", () => {
    const doc = normalizeArchRules({
      rules: [
        { id: "a", from: " src/ui/** ", to: "src/db/**", description: "no db in ui" },
        { id: "a", from: "layer:ui", to: "layer:data", enabled: false },
        { from: "", to: "x" },
        "nope",
      ],
    });
    expect(doc).toEqual({
      version: 1,
      rules: [
        { id: "a", from: "src/ui/**", to: "src/db/**", description: "no db in ui", enabled: true },
        { id: "rule-2", from: "layer:ui", to: "layer:data", description: "", enabled: false },
      ],
    });
  });

  it("rejects a wrong top-level shape", () => {
    expect(() => normalizeArchRules([])).toThrow(ArchRulesError);
    expect(() => normalizeArchRules({ rules: {} })).toThrow(ArchRulesError);
  });
});

describe("handleArchRulesRequest", () => {
  it("returns an empty document when no file exists", async () => {
    const res = await handleArchRulesRequest(request("GET"), dir, { writable: true });
    expect(res).toEqual({ statusCode: 200, payload: { version: 1, rules: [], writable: true } });
  });

  it("writes on PUT and reads back", async () => {
    const put = await handleArchRulesRequest(
      request("PUT", { rules: [{ from: "src/ui/**", to: "src/db/**" }] }),
      dir,
      { writable: true },
    );
    expect(put.statusCode).toBe(200);
    expect(readArchRules(dir).rules).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual(["arch-rules.json"]);
  });

  it("refuses writes when read-only, non-JSON bodies and corrupt files", async () => {
    expect((await handleArchRulesRequest(request("PUT", { rules: [] }), dir, { writable: false })).statusCode).toBe(405);
    expect((await handleArchRulesRequest(request("PUT", { rules: [] }, "text/plain"), dir, { writable: true })).statusCode).toBe(415);
    fs.writeFileSync(path.join(dir, "arch-rules.json"), "{oops");
    expect((await handleArchRulesRequest(request("GET"), dir, { writable: true })).statusCode).toBe(500);
    expect((await handleArchRulesRequest(request("DELETE"), dir, { writable: true })).statusCode).toBe(405);
  });
});

import { describe, it, expect } from "vitest";
import { fetchAndValidateGraph } from "../fetchAndValidateGraph";

/**
 * Regression coverage for issue #288: the knowledge-graph.json fetch did not
 * guard on `res.ok` before parsing, so a 404 error body was handed to
 * `validateGraph`, surfacing the misleading "Missing or invalid project
 * metadata" instead of a clear HTTP error.
 *
 * Diagnosis credited to collaborator ZebangCheng.
 */

/** Build a minimal mock `fetch` returning the given Response-like object. */
function mockFetch(response: Partial<Response> & { json: () => Promise<unknown> }) {
  return (async () => response as unknown as Response) as typeof fetch;
}

/** A valid knowledge-graph document (passes validateGraph). */
const VALID_GRAPH = {
  kind: "knowledge",
  project: {
    name: "demo",
    languages: ["typescript"],
    frameworks: ["vitest"],
    description: "A demo project",
    analyzedAt: "2026-06-09T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "n1",
      type: "article",
      name: "Intro",
      summary: "An article node.",
      tags: [],
      complexity: "simple",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("fetchAndValidateGraph", () => {
  it("surfaces a 404 as an HTTP error, NOT a graph-validation error (issue #288)", async () => {
    // The server returns a 404 whose body is an error object — exactly the
    // shape that previously slipped past the missing res.ok guard.
    const fetchImpl = mockFetch({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => Promise.resolve({ error: "knowledge-graph.json not found" }),
    });

    const result = await fetchAndValidateGraph("/knowledge-graph.json", fetchImpl);

    expect(result.status).toBe("http-error");
    expect(result.status === "http-error" && result.error).toContain("404");
    // The pre-fix bug surfaced this misleading message; it must NOT appear.
    if (result.status !== "loaded") {
      expect(result.error).not.toContain("Missing or invalid project metadata");
    }
  });

  it("surfaces a 401 as an HTTP error", async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.resolve({ error: "invalid token" }),
    });

    const result = await fetchAndValidateGraph("/knowledge-graph.json", fetchImpl);

    expect(result.status).toBe("http-error");
    expect(result.status === "http-error" && result.error).toContain("401");
  });

  it("still surfaces a schema error for a 200 with an invalid graph body", async () => {
    // A 200 response whose body is well-formed JSON but not a valid graph must
    // still produce a validation error — the fix must not break this path.
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ not: "a graph" }),
    });

    const result = await fetchAndValidateGraph("/knowledge-graph.json", fetchImpl);

    expect(result.status).toBe("validation-error");
  });

  it("labels a 200 body that fails to parse as a parse-error, not a network error", async () => {
    // A 200 whose body is not valid JSON is a body-parse failure, distinct
    // from a transport/network failure — so it gets its own status.
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    });

    const result = await fetchAndValidateGraph("/knowledge-graph.json", fetchImpl);

    expect(result.status).toBe("parse-error");
    expect(result.status === "parse-error" && result.error).toContain("Unexpected token");
  });

  it("loads a valid knowledge graph on a 200 response", async () => {
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(VALID_GRAPH),
    });

    const result = await fetchAndValidateGraph("/knowledge-graph.json", fetchImpl);

    expect(result.status).toBe("loaded");
    expect(result.status === "loaded" && result.isKnowledge).toBe(true);
  });
});

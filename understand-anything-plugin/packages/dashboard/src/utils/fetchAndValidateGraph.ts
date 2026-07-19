import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue, ValidationResult } from "@understand-anything/core/schema";

type Graph = NonNullable<ValidationResult["data"]>;

/**
 * Result of fetching + validating a knowledge-graph JSON document.
 *
 * Mirrors the sibling fetches in `App.tsx` (meta.json, config.json,
 * diff-overlay.json, domain-graph.json), all of which guard on `res.ok`
 * before parsing. Previously the knowledge-graph fetch skipped that guard,
 * so a 404 error body was handed to `validateGraph`, surfacing a misleading
 * "Missing or invalid project metadata" instead of a clear HTTP error.
 */
export type FetchGraphResult =
  | { status: "loaded"; graph: Graph; issues: GraphIssue[]; isKnowledge: boolean }
  | { status: "http-error"; error: string }
  | { status: "validation-error"; error: string }
  | { status: "parse-error"; error: string }
  | { status: "network-error"; error: string };

/**
 * Fetch a knowledge-graph JSON document, guard on the HTTP status, then
 * validate the payload. Pure with respect to the injected `fetch`, so it can
 * be unit-tested with a mocked fetch implementation.
 */
export async function fetchAndValidateGraph(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchGraphResult> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return {
      status: "network-error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Mirror the sibling fetches: surface a clear HTTP-status error instead of
  // parsing a 404/401 error body as if it were a graph document.
  if (!res.ok) {
    return {
      status: "http-error",
      error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    // A parse failure on a 2xx body is a body-parse error, not a transport
    // (network) failure — label it distinctly so the UI can message it precisely.
    return {
      status: "parse-error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const result = validateGraph(data);
  if (result.success && result.data) {
    const isKnowledge =
      typeof data === "object" &&
      data !== null &&
      (data as Record<string, unknown>).kind === "knowledge";
    return {
      status: "loaded",
      graph: result.data,
      issues: result.issues,
      isKnowledge,
    };
  }

  return {
    status: "validation-error",
    error: result.fatal ?? "unknown validation error",
  };
}

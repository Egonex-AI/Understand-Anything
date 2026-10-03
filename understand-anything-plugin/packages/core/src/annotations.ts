/**
 * User annotations (tags + notes) attached to graph nodes from the dashboard.
 *
 * Stored next to the knowledge graph as `annotations.json` in the project's
 * data directory (`.ua/` or legacy `.understand-anything/`), deliberately
 * separate from knowledge-graph.json so re-running /understand never
 * overwrites them. Keyed by node id; entries whose node disappeared from a
 * regenerated graph are kept, not pruned.
 *
 * Used by the dashboard dev server (vite.config.ts) and the standalone
 * viewer (which copies the compiled file), so this module must stay
 * self-contained: Node built-ins only, no other core imports.
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";

export const ANNOTATIONS_FILE_NAME = "annotations.json";
export const MAX_ANNOTATIONS_BYTES = 2 * 1024 * 1024;
const MAX_TAGS_PER_NODE = 50;
const MAX_TAG_LENGTH = 64;
const MAX_NOTE_LENGTH = 50_000;

export interface NodeAnnotation {
  tags: string[];
  note: string;
  updatedAt: string;
}

export interface AnnotationsDocument {
  version: 1;
  nodes: Record<string, NodeAnnotation>;
}

export class AnnotationsError extends Error {}

export function emptyAnnotations(): AnnotationsDocument {
  return { version: 1, nodes: {} };
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const tag = value.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= MAX_TAGS_PER_NODE) break;
  }
  return tags;
}

/**
 * Validate and clean an annotations payload. Throws AnnotationsError when
 * the top-level shape is wrong; silently drops malformed or empty entries.
 */
export function normalizeAnnotations(raw: unknown): AnnotationsDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AnnotationsError("Annotations must be a JSON object");
  }
  const nodesRaw = (raw as { nodes?: unknown }).nodes ?? {};
  if (!nodesRaw || typeof nodesRaw !== "object" || Array.isArray(nodesRaw)) {
    throw new AnnotationsError("Annotations `nodes` must be an object keyed by node id");
  }
  const doc = emptyAnnotations();
  for (const [nodeId, entry] of Object.entries(nodesRaw as Record<string, unknown>)) {
    if (!nodeId || !entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const tags = normalizeTags(e.tags);
    const note = typeof e.note === "string" ? e.note.slice(0, MAX_NOTE_LENGTH) : "";
    if (tags.length === 0 && !note.trim()) continue;
    doc.nodes[nodeId] = {
      tags,
      note,
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString(),
    };
  }
  return doc;
}

export function readAnnotations(dataDir: string): AnnotationsDocument {
  const file = path.join(dataDir, ANNOTATIONS_FILE_NAME);
  if (!fs.existsSync(file)) return emptyAnnotations();
  return normalizeAnnotations(JSON.parse(fs.readFileSync(file, "utf-8")));
}

/** Write atomically (temp file + rename) so a crash never leaves half a file. */
export function writeAnnotations(dataDir: string, doc: AnnotationsDocument): void {
  const file = path.join(dataDir, ANNOTATIONS_FILE_NAME);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

/** Read a request body as UTF-8, rejecting bodies over `limit` bytes. */
export function readRequestBody(req: IncomingMessage, limit = MAX_ANNOTATIONS_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AnnotationsError("Annotations payload is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export interface AnnotationsResponse {
  statusCode: number;
  payload: unknown;
}

/**
 * Shared GET/PUT handler for `/annotations.json`. The caller has already
 * checked the access token. Pass `writable: false` for read-only servers.
 */
export async function handleAnnotationsRequest(
  req: IncomingMessage,
  dataDir: string,
  { writable }: { writable: boolean },
): Promise<AnnotationsResponse> {
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      try {
        return { statusCode: 200, payload: { ...readAnnotations(dataDir), writable } };
      } catch {
        // Never report a corrupt file as empty: the client would then save
        // over it. A non-200 makes the client fall back to local storage.
        return {
          statusCode: 500,
          payload: { error: `${ANNOTATIONS_FILE_NAME} could not be parsed; fix or remove it` },
        };
      }
    }
    if (req.method === "PUT") {
      if (!writable) return { statusCode: 405, payload: { error: "This server is read-only" } };
      // Only accept JSON: blocks HTML-form style cross-site submissions.
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return { statusCode: 415, payload: { error: "Expected application/json" } };
      }
      const doc = normalizeAnnotations(JSON.parse(await readRequestBody(req)));
      writeAnnotations(dataDir, doc);
      return { statusCode: 200, payload: { ...doc, writable } };
    }
    return { statusCode: 405, payload: { error: "Method not allowed" } };
  } catch (err) {
    if (err instanceof AnnotationsError || err instanceof SyntaxError) {
      return { statusCode: 400, payload: { error: err.message } };
    }
    return { statusCode: 500, payload: { error: "Failed to read or write annotations" } };
  }
}

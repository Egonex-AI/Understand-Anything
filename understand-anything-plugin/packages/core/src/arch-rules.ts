/**
 * User-defined architecture rules ("A must not depend on B"), edited in the
 * dashboard and evaluated there against the graph's edges.
 *
 * Stored next to the knowledge graph as `arch-rules.json` in the project's
 * data directory (`.ua/` or legacy `.understand-anything/`), separate from
 * knowledge-graph.json so re-running /understand never overwrites them, and
 * meant to be committed with the project.
 *
 * Selector syntax (`from` / `to`): a path glob over file paths (`**` crosses
 * directories, `*` and `?` do not, `{a,b}` alternates; a plain path also
 * matches everything below it) or `layer:<layer id or name>`.
 *
 * Used by the dashboard dev server (vite.config.ts) and the standalone
 * viewer (which copies the compiled file), so this module must stay
 * self-contained: Node built-ins only, no other core imports.
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";

export const ARCH_RULES_FILE_NAME = "arch-rules.json";
export const MAX_ARCH_RULES_BYTES = 256 * 1024;
const MAX_RULES = 200;
const MAX_SELECTOR_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 1000;

export interface ArchRule {
  id: string;
  /** Selector for the depending side. */
  from: string;
  /** Selector for the side `from` must not depend on. */
  to: string;
  description: string;
  enabled: boolean;
}

export interface ArchRulesDocument {
  version: 1;
  rules: ArchRule[];
}

export class ArchRulesError extends Error {}

export function emptyArchRules(): ArchRulesDocument {
  return { version: 1, rules: [] };
}

/**
 * Validate and clean a rules payload. Throws ArchRulesError when the
 * top-level shape is wrong; silently drops rules without both selectors.
 */
export function normalizeArchRules(raw: unknown): ArchRulesDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ArchRulesError("Architecture rules must be a JSON object");
  }
  const rulesRaw = (raw as { rules?: unknown }).rules ?? [];
  if (!Array.isArray(rulesRaw)) {
    throw new ArchRulesError("Architecture rules `rules` must be an array");
  }
  const doc = emptyArchRules();
  const ids = new Set<string>();
  for (const entry of rulesRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const from = typeof e.from === "string" ? e.from.trim().slice(0, MAX_SELECTOR_LENGTH) : "";
    const to = typeof e.to === "string" ? e.to.trim().slice(0, MAX_SELECTOR_LENGTH) : "";
    if (!from || !to) continue;
    let id = typeof e.id === "string" && e.id.trim() ? e.id.trim().slice(0, 64) : "";
    if (!id || ids.has(id)) id = `rule-${doc.rules.length + 1}`;
    while (ids.has(id)) id = `${id}-x`;
    ids.add(id);
    doc.rules.push({
      id,
      from,
      to,
      description:
        typeof e.description === "string" ? e.description.slice(0, MAX_DESCRIPTION_LENGTH) : "",
      enabled: e.enabled !== false,
    });
    if (doc.rules.length >= MAX_RULES) break;
  }
  return doc;
}

export function readArchRules(dataDir: string): ArchRulesDocument {
  const file = path.join(dataDir, ARCH_RULES_FILE_NAME);
  if (!fs.existsSync(file)) return emptyArchRules();
  return normalizeArchRules(JSON.parse(fs.readFileSync(file, "utf-8")));
}

/** Write atomically (temp file + rename) so a crash never leaves half a file. */
export function writeArchRules(dataDir: string, doc: ArchRulesDocument): void {
  const file = path.join(dataDir, ARCH_RULES_FILE_NAME);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ArchRulesError("Architecture rules payload is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Shared GET/PUT handler for `/arch-rules.json`. The caller has already
 * checked the access token. Pass `writable: false` for read-only servers.
 */
export async function handleArchRulesRequest(
  req: IncomingMessage,
  dataDir: string,
  { writable }: { writable: boolean },
): Promise<{ statusCode: number; payload: unknown }> {
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      try {
        return { statusCode: 200, payload: { ...readArchRules(dataDir), writable } };
      } catch {
        // Never report a corrupt file as empty: the client would save over it.
        return {
          statusCode: 500,
          payload: { error: `${ARCH_RULES_FILE_NAME} could not be parsed; fix or remove it` },
        };
      }
    }
    if (req.method === "PUT") {
      if (!writable) return { statusCode: 405, payload: { error: "This server is read-only" } };
      // Only accept JSON: blocks HTML-form style cross-site submissions.
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return { statusCode: 415, payload: { error: "Expected application/json" } };
      }
      const doc = normalizeArchRules(JSON.parse(await readBody(req, MAX_ARCH_RULES_BYTES)));
      writeArchRules(dataDir, doc);
      return { statusCode: 200, payload: { ...doc, writable } };
    }
    return { statusCode: 405, payload: { error: "Method not allowed" } };
  } catch (err) {
    if (err instanceof ArchRulesError || err instanceof SyntaxError) {
      return { statusCode: 400, payload: { error: err.message } };
    }
    return { statusCode: 500, payload: { error: "Failed to read or write architecture rules" } };
  }
}

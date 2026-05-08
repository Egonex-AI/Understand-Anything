/**
 * Opt-in publish helpers for the looptech-ai/understand-quickly registry.
 *
 * The registry is a public catalogue of code-knowledge graphs. When a user
 * runs `/understand --publish`, this module:
 *
 *   1. Stamps the on-disk `knowledge-graph.json` with the metadata block
 *      that the registry's `understand-anything@1` schema expects
 *      (`metadata.tool`, `metadata.tool_version`, `metadata.generated_at`,
 *       `metadata.commit`). The schema's existing `project.gitCommitHash`
 *      stays as-is for backward compat — the new `metadata` block is
 *      additive.
 *
 *   2. Optionally fires a `repository_dispatch` event at the registry,
 *      gated on the `UNDERSTAND_QUICKLY_TOKEN` env var. If the token is
 *      missing, the function returns `{ status: "no-token" }` without any
 *      network call. If the dispatch fails, the function returns
 *      `{ status: "dispatch-failed", error }` — callers should never throw
 *      based on a publish failure; this is best-effort.
 *
 * No default plugin behaviour is changed by this module; nothing here
 * runs unless the user explicitly opts in.
 *
 * Protocol reference:
 * https://github.com/looptech-ai/understand-quickly/blob/main/docs/integrations/protocol.md
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_DISPATCH_URL =
  "https://api.github.com/repos/looptech-ai/understand-quickly/dispatches";
const TOOL_NAME = "understand-anything";
const UA_DIR = ".understand-anything";
const GRAPH_FILE = "knowledge-graph.json";

export interface ParsedRemote {
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into `{ owner, repo }`.
 *
 * Supports both common GitHub URL shapes:
 *   - HTTPS:  https://github.com/owner/repo(.git)?
 *   - SSH:    git@github.com:owner/repo(.git)?
 *
 * Returns `null` if the URL doesn't look like a GitHub remote.
 */
export function parseGitRemote(url: string): ParsedRemote | null {
  const trimmed = url.trim();
  // HTTPS form
  let match = trimmed.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match) return { owner: match[1], repo: match[2] };
  // SSH form
  match = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match) return { owner: match[1], repo: match[2] };
  // git:// form
  match = trimmed.match(/^git:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match) return { owner: match[1], repo: match[2] };
  return null;
}

/**
 * Resolve the GitHub `owner/repo` slug for a project root by reading its
 * `origin` remote. Returns `null` if the directory isn't a git repo, has
 * no `origin` remote, or the remote URL isn't a recognisable GitHub URL.
 */
export function resolveOriginSlug(projectRoot: string): string | null {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  const parsed = parseGitRemote(url);
  return parsed ? `${parsed.owner}/${parsed.repo}` : null;
}

/**
 * Read the current HEAD commit sha for `projectRoot`. Returns `null` if
 * the directory isn't a git repo or `HEAD` can't be resolved.
 */
export function resolveHeadCommit(projectRoot: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export interface MetadataStamp {
  tool: string;
  tool_version: string;
  generated_at: string;
  commit?: string;
}

/**
 * Stamp the on-disk knowledge graph with a registry-compatible
 * `metadata` block. Idempotent — re-running just refreshes the values.
 *
 * The block is additive: it does not replace any existing graph fields,
 * and unknown-property tolerance in the registry's schema means
 * downstream consumers ignore it if they don't care.
 *
 * Returns the metadata that was stamped, or `null` if the graph file
 * doesn't exist.
 */
export function stampMetadata(
  projectRoot: string,
  toolVersion: string,
): MetadataStamp | null {
  const filePath = join(projectRoot, UA_DIR, GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, "utf-8");
  let graph: Record<string, unknown>;
  try {
    graph = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const commit = resolveHeadCommit(projectRoot) ?? undefined;
  const stamp: MetadataStamp = {
    tool: TOOL_NAME,
    tool_version: toolVersion,
    generated_at: new Date().toISOString(),
  };
  if (commit) stamp.commit = commit;

  // Merge into any existing metadata block; preserve unknown user fields.
  const existing = (graph.metadata && typeof graph.metadata === "object")
    ? graph.metadata as Record<string, unknown>
    : {};
  graph.metadata = { ...existing, ...stamp };

  writeFileSync(filePath, JSON.stringify(graph, null, 2), "utf-8");
  return stamp;
}

export interface DispatchOptions {
  /** GitHub fine-grained PAT with `Repository dispatches: write` on the registry. */
  token: string;
  /** `owner/repo` of the user's repo (must match the registry entry id). */
  id: string;
  /**
   * Override the `fetch` implementation. Defaults to the global `fetch`
   * (Node ≥ 18 / 22). Tests inject a stub.
   */
  fetchImpl?: typeof fetch;
}

export interface DispatchResult {
  status: "ok" | "dispatch-failed";
  httpStatus?: number;
  error?: string;
}

/**
 * Fire the `sync-entry` `repository_dispatch` event at
 * `looptech-ai/understand-quickly`. Best-effort — never throws.
 */
export async function dispatchSync(opts: DispatchOptions): Promise<DispatchResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(REGISTRY_DISPATCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${opts.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "sync-entry",
        client_payload: { id: opts.id },
      }),
    });
    if (!res.ok) {
      return { status: "dispatch-failed", httpStatus: res.status };
    }
    return { status: "ok", httpStatus: res.status };
  } catch (err) {
    return { status: "dispatch-failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PublishOptions {
  projectRoot: string;
  toolVersion: string;
  /** Override env (tests). */
  env?: NodeJS.ProcessEnv;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override remote slug resolution (tests). */
  resolveSlug?: (projectRoot: string) => string | null;
}

export type PublishStatus =
  | "no-graph"
  | "no-remote"
  | "no-token"
  | "ok"
  | "dispatch-failed";

export interface PublishResult {
  status: PublishStatus;
  id?: string;
  metadata?: MetadataStamp;
  httpStatus?: number;
  error?: string;
}

/**
 * Top-level publish flow. Always best-effort; never throws.
 *
 *   1. Stamp `metadata.{tool, tool_version, generated_at, commit}` on the
 *      saved graph (when the graph exists).
 *   2. If `UNDERSTAND_QUICKLY_TOKEN` is unset, return `{ status: "no-token" }`.
 *   3. Resolve `owner/repo` from the `origin` git remote.
 *   4. Fire the `repository_dispatch`.
 */
export async function publish(opts: PublishOptions): Promise<PublishResult> {
  const env = opts.env ?? process.env;
  const metadata = stampMetadata(opts.projectRoot, opts.toolVersion) ?? undefined;
  if (!metadata) return { status: "no-graph" };

  const token = env.UNDERSTAND_QUICKLY_TOKEN;
  if (!token) return { status: "no-token", metadata };

  const resolveSlug = opts.resolveSlug ?? resolveOriginSlug;
  const id = resolveSlug(opts.projectRoot);
  if (!id) return { status: "no-remote", metadata };

  const dispatch = await dispatchSync({
    token,
    id,
    fetchImpl: opts.fetchImpl,
  });
  if (dispatch.status === "ok") {
    return { status: "ok", id, metadata, httpStatus: dispatch.httpStatus };
  }
  return {
    status: "dispatch-failed",
    id,
    metadata,
    httpStatus: dispatch.httpStatus,
    error: dispatch.error,
  };
}

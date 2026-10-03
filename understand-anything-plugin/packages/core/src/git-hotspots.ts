/**
 * Git churn ("hotspots") per file, for the dashboard's hotspot overlay.
 *
 * Runs `git log --name-only` in the analyzed project's root and aggregates,
 * per file, how many commits touched it within a time window, when it last
 * changed and how many distinct authors touched it. Paths are relative to
 * the project root (`--relative`), so a project that lives in a subdirectory
 * of a larger repository still lines up with the graph's file paths.
 *
 * Used by the dashboard dev server (vite.config.ts) and the standalone
 * viewer (which copies the compiled file), so this module must stay
 * self-contained: Node built-ins only, no other core imports.
 */
import { execFile } from "node:child_process";

export const DEFAULT_HOTSPOT_DAYS = 90;
export const MAX_HOTSPOT_DAYS = 3650;
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_COMMITS = 20_000;
const CACHE_TTL_MS = 60_000;

// Field/record separators that never appear in paths or ISO dates.
const RECORD = "\x1e";
const FIELD = "\x1f";

export interface FileChurn {
  /** Commits that touched the file inside the window. */
  commits: number;
  /** ISO date of the newest commit that touched it. */
  lastChanged: string;
  /** Distinct author e-mails (lower-cased) among those commits. */
  authors: number;
}

export type HotspotsUnavailableReason = "not-a-git-repo" | "git-missing" | "error";

export interface HotspotsReport {
  available: boolean;
  reason?: HotspotsUnavailableReason;
  days: number;
  /** Commits read from git log (after the MAX_COMMITS cap). */
  commitCount: number;
  /** True when git output was cut short (commit cap, buffer cap or timeout). */
  truncated: boolean;
  /** Highest `commits` value among the returned files (0 when empty). */
  maxCommits: number;
  files: Record<string, FileChurn>;
}

export function emptyHotspots(days: number, reason?: HotspotsUnavailableReason): HotspotsReport {
  return {
    available: reason === undefined,
    ...(reason ? { reason } : {}),
    days,
    commitCount: 0,
    truncated: false,
    maxCommits: 0,
    files: {},
  };
}

/** Clamp a `days` query value; falls back to the default for junk input. */
export function parseHotspotDays(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_HOTSPOT_DAYS;
  return Math.min(MAX_HOTSPOT_DAYS, Math.max(1, Math.round(n)));
}

/** The `--format` string `parseGitLog` expects. */
export const GIT_LOG_FORMAT = `${RECORD}%H${FIELD}%aI${FIELD}%ae`;

/**
 * Aggregate `git log --name-only --format=GIT_LOG_FORMAT` output. When
 * `allowed` is given, only those paths are kept (the graph's file list).
 */
export function parseGitLog(
  output: string,
  allowed?: Set<string>,
): { files: Record<string, FileChurn>; commitCount: number } {
  const stats = new Map<string, { commits: number; lastChanged: string; authors: Set<string> }>();
  let commitCount = 0;
  for (const record of output.split(RECORD)) {
    if (!record.trim()) continue;
    const lines = record.split(/\r?\n/);
    const [hash, date, email] = (lines[0] ?? "").split(FIELD);
    if (!hash || !date) continue;
    commitCount++;
    const author = (email ?? "").trim().toLowerCase();
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
      const file = line.trim();
      if (!file || seen.has(file)) continue;
      seen.add(file);
      if (allowed && !allowed.has(file)) continue;
      let entry = stats.get(file);
      if (!entry) {
        entry = { commits: 0, lastChanged: date, authors: new Set() };
        stats.set(file, entry);
      }
      entry.commits++;
      // ISO-8601 with offsets: compare as instants, not strings.
      if (Date.parse(date) > Date.parse(entry.lastChanged)) entry.lastChanged = date;
      if (author) entry.authors.add(author);
    }
  }
  const files: Record<string, FileChurn> = {};
  for (const [file, entry] of stats) {
    files[file] = { commits: entry.commits, lastChanged: entry.lastChanged, authors: entry.authors.size };
  }
  return { files, commitCount };
}

interface GitResult {
  stdout: string;
  truncated: boolean;
  reason?: HotspotsUnavailableReason;
}

function runGitLog(projectRoot: string, days: number): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      [
        "log",
        `--since=${days} days ago`,
        "--no-merges",
        `--max-count=${MAX_COMMITS}`,
        "--relative",
        "--name-only",
        `--format=${GIT_LOG_FORMAT}`,
        "--",
        ".",
      ],
      { cwd: projectRoot, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ stdout, truncated: false });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        if (e.code === "ENOENT") {
          resolve({ stdout: "", truncated: false, reason: "git-missing" });
          return;
        }
        // Buffer cap or timeout: keep whatever was read (the last record may
        // be partial; parseGitLog tolerates that).
        if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || e.killed) {
          resolve({ stdout: String(stdout ?? ""), truncated: true });
          return;
        }
        const message = `${String(stderr ?? "")} ${e.message}`.toLowerCase();
        if (message.includes("not a git repository")) {
          resolve({ stdout: "", truncated: false, reason: "not-a-git-repo" });
          return;
        }
        // An empty repository (no commits yet) is not an error for us.
        if (message.includes("does not have any commits")) {
          resolve({ stdout: "", truncated: false });
          return;
        }
        resolve({ stdout: "", truncated: false, reason: "error" });
      },
    );
  });
}

const cache = new Map<string, { at: number; report: Promise<HotspotsReport> }>();

/**
 * Churn per file in `projectRoot` over the last `days` days. Never throws:
 * a missing git binary or a non-repository yields `available: false`.
 * Results are cached briefly per (root, days, allowlist size).
 */
export function computeGitHotspots(
  projectRoot: string,
  days: number,
  allowed?: Set<string>,
): Promise<HotspotsReport> {
  const key = `${projectRoot}\0${days}\0${allowed?.size ?? -1}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.report;
  const report = runGitLog(projectRoot, days).then(({ stdout, truncated, reason }) => {
    if (reason) return emptyHotspots(days, reason);
    const { files, commitCount } = parseGitLog(stdout, allowed);
    let maxCommits = 0;
    for (const f of Object.values(files)) maxCommits = Math.max(maxCommits, f.commits);
    return {
      available: true,
      days,
      commitCount,
      truncated: truncated || commitCount >= MAX_COMMITS,
      maxCommits,
      files,
    } satisfies HotspotsReport;
  });
  cache.set(key, { at: Date.now(), report });
  return report;
}

/** Drop cached reports (tests, or after the user asks for a refresh). */
export function clearHotspotsCache(): void {
  cache.clear();
}

/**
 * Shared GET handler for `/git-hotspots.json?days=N`. The caller has already
 * checked the access token. Read-only, so the viewer can use it as is.
 */
export async function handleGitHotspotsRequest(
  url: URL,
  projectRoot: string,
  allowed?: Set<string>,
): Promise<{ statusCode: number; payload: HotspotsReport | { error: string } }> {
  const days = parseHotspotDays(url.searchParams.get("days"));
  if (url.searchParams.get("refresh") === "1") clearHotspotsCache();
  try {
    return { statusCode: 200, payload: await computeGitHotspots(projectRoot, days, allowed) };
  } catch {
    return { statusCode: 200, payload: emptyHotspots(days, "error") };
  }
}

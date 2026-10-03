/**
 * Full-text search over the source files of an analyzed project.
 *
 * Used by the dashboard dev server (vite.config.ts) and the standalone
 * viewer (packages/viewer, which copies the compiled file), so this module
 * must stay self-contained: Node built-ins only, no other core imports.
 *
 * Only files the caller allowlists are searched — the servers pass the
 * graph's file paths, the same set `/file-content.json` will serve — so a
 * hit can always be opened in the code viewer.
 */
import fs from "node:fs";
import path from "node:path";

export interface ContentSearchOptions {
  caseSensitive?: boolean;
  /** Treat the query as a JavaScript regular expression. */
  regex?: boolean;
  /** Only match whole words (\b boundaries). */
  wholeWord?: boolean;
  /** Stop after this many matches in total. Default 500. */
  maxMatches?: number;
  /** Keep at most this many matches per file. Default 50. */
  maxMatchesPerFile?: number;
  /** Skip files larger than this. Default 1 MB (the code viewer's limit). */
  maxFileBytes?: number;
}

export interface ContentSearchMatch {
  /** 1-based line number. */
  line: number;
  /** 0-based column of the match within the line. */
  column: number;
  /** Match length in characters. */
  length: number;
  /** The (possibly trimmed) line text. */
  preview: string;
  /** Column in `preview` where the match starts. */
  previewColumn: number;
}

export interface ContentSearchFileResult {
  path: string;
  matches: ContentSearchMatch[];
  /** Total matches in this file, including ones beyond maxMatchesPerFile. */
  matchCount: number;
}

export interface ContentSearchResult {
  files: ContentSearchFileResult[];
  totalMatches: number;
  searchedFiles: number;
  /** True when maxMatches cut the search short. */
  truncated: boolean;
}

export class ContentSearchQueryError extends Error {}

const PREVIEW_CONTEXT = 60;
const MAX_PREVIEW_LENGTH = 240;

interface CachedFile {
  mtimeMs: number;
  size: number;
  lines: string[] | null; // null = binary / unreadable / too large
}

const fileCache = new Map<string, CachedFile>();

function readLines(absolutePath: string, maxFileBytes: number): string[] | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    fileCache.delete(absolutePath);
    return null;
  }
  if (!stat.isFile()) return null;
  const cached = fileCache.get(absolutePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.lines;
  }
  let lines: string[] | null = null;
  if (stat.size <= maxFileBytes) {
    try {
      const buffer = fs.readFileSync(absolutePath);
      if (!buffer.includes(0)) lines = buffer.toString("utf8").split(/\r\n|\n|\r/);
    } catch {
      lines = null;
    }
  }
  fileCache.set(absolutePath, { mtimeMs: stat.mtimeMs, size: stat.size, lines });
  return lines;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildContentSearchRegExp(query: string, options: ContentSearchOptions = {}): RegExp {
  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, options.caseSensitive ? "g" : "gi");
  } catch (err) {
    // SyntaxError messages already read "Invalid regular expression: /…/: …".
    throw new ContentSearchQueryError(err instanceof Error ? err.message : String(err));
  }
}

function makePreview(line: string, column: number, length: number): { preview: string; previewColumn: number } {
  if (line.length <= MAX_PREVIEW_LENGTH) return { preview: line, previewColumn: column };
  const start = Math.max(0, column - PREVIEW_CONTEXT);
  const end = Math.min(line.length, Math.max(column + length + PREVIEW_CONTEXT, start + MAX_PREVIEW_LENGTH));
  const prefix = start > 0 ? "…" : "";
  const suffix = end < line.length ? "…" : "";
  return {
    preview: prefix + line.slice(start, end) + suffix,
    previewColumn: column - start + prefix.length,
  };
}

/**
 * Search `relativePaths` (relative to `projectRoot`) for `query`.
 * Throws ContentSearchQueryError for an invalid regex.
 */
export function searchProjectContent(
  projectRoot: string,
  relativePaths: Iterable<string>,
  query: string,
  options: ContentSearchOptions = {},
): ContentSearchResult {
  const maxMatches = options.maxMatches ?? 500;
  const maxPerFile = options.maxMatchesPerFile ?? 50;
  const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
  const result: ContentSearchResult = { files: [], totalMatches: 0, searchedFiles: 0, truncated: false };
  if (!query) return result;
  const pattern = buildContentSearchRegExp(query, options);

  const sorted = [...new Set(relativePaths)].sort();
  for (const relativePath of sorted) {
    if (result.truncated) break;
    const lines = readLines(path.resolve(projectRoot, relativePath), maxFileBytes);
    if (!lines) continue;
    result.searchedFiles++;

    let fileResult: ContentSearchFileResult | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        if (m[0].length === 0) {
          // Zero-width regex match (e.g. `^`) — count it once per line and move on.
          pattern.lastIndex = line.length + 1;
        }
        if (!fileResult) {
          fileResult = { path: relativePath, matches: [], matchCount: 0 };
          result.files.push(fileResult);
        }
        fileResult.matchCount++;
        result.totalMatches++;
        if (fileResult.matches.length < maxPerFile) {
          fileResult.matches.push({
            line: i + 1,
            column: m.index,
            length: m[0].length,
            ...makePreview(line, m.index, m[0].length),
          });
        }
        if (result.totalMatches >= maxMatches) {
          result.truncated = true;
          break;
        }
      }
      if (result.truncated) break;
    }
  }
  return result;
}

/** Parse the shared `/search-content.json` query string. */
export function parseContentSearchParams(params: URLSearchParams): {
  query: string;
  options: ContentSearchOptions;
} {
  const flag = (name: string) => params.get(name) === "1" || params.get(name) === "true";
  return {
    query: params.get("q") ?? "",
    options: {
      caseSensitive: flag("case"),
      regex: flag("regex"),
      wholeWord: flag("word"),
    },
  };
}

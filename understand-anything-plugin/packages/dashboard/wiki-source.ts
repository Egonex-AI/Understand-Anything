import fs from "fs";
import path from "path";
import {
  sanitizeFilePath,
  resolvePathWithinRoot,
} from "./src/utils/sanitize";

export const MAX_WIKI_SOURCE_LINES = 200;
export const MAX_WIKI_SOURCE_FILE_BYTES = 1024 * 1024;

export function parseWikiSourceLineRange(
  startParam: string | null,
  endParam: string | null,
): { startLine: number; endLine: number } | { error: string } {
  const hasStart = startParam !== null && startParam !== "";
  const hasEnd = endParam !== null && endParam !== "";
  const startLine = hasStart ? parseInt(startParam!, 10) : 1;
  const endLine = hasEnd
    ? parseInt(endParam!, 10)
    : hasStart
      ? startLine
      : MAX_WIKI_SOURCE_LINES;

  if (
    Number.isNaN(startLine) ||
    Number.isNaN(endLine) ||
    startLine < 1 ||
    endLine < 1 ||
    endLine < startLine
  ) {
    return { error: "Invalid line range" };
  }

  if (endLine - startLine + 1 > MAX_WIKI_SOURCE_LINES) {
    return {
      error: `Line range exceeds maximum of ${MAX_WIKI_SOURCE_LINES} lines`,
    };
  }

  return { startLine, endLine };
}

export function sliceSourceLines(
  fullContent: string,
  startLine: number,
  endLine: number,
): { content: string; startLine: number; endLine: number } {
  const lines =
    fullContent.length === 0 ? [] : fullContent.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const clampedEnd = Math.min(endLine, Math.max(lines.length, 1));
  const clampedStart = Math.min(startLine, clampedEnd);
  const slice = lines.slice(clampedStart - 1, clampedEnd);
  return {
    content: slice.join("\n"),
    startLine: clampedStart,
    endLine: clampedEnd,
  };
}

export function detectWikiSourceLanguage(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const byExt: Record<string, string> = {
    bash: "bash",
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "c",
    hpp: "cpp",
    html: "markup",
    java: "java",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    txt: "text",
    yaml: "yaml",
    yml: "yaml",
  };
  return byExt[ext] ?? "text";
}

export type WikiSourceReadResult =
  | { statusCode: number; payload: Record<string, unknown> };

export function readWikiSourceFile(
  projectRoot: string,
  filePath: string,
  startParam: string | null,
  endParam: string | null,
): WikiSourceReadResult {
  const safeRelative = sanitizeFilePath(filePath);
  if (!safeRelative) {
    return { statusCode: 400, payload: { error: "Invalid file path" } };
  }

  const lineRange = parseWikiSourceLineRange(startParam, endParam);
  if ("error" in lineRange) {
    return { statusCode: 400, payload: { error: lineRange.error } };
  }

  const absoluteFile = resolvePathWithinRoot(projectRoot, filePath);
  if (!absoluteFile) {
    return { statusCode: 400, payload: { error: "Path must stay inside the project" } };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absoluteFile);
  } catch {
    return { statusCode: 404, payload: { error: "File not found" } };
  }

  if (!stat.isFile()) {
    return { statusCode: 400, payload: { error: "Path is not a file" } };
  }
  if (stat.size > MAX_WIKI_SOURCE_FILE_BYTES) {
    return { statusCode: 413, payload: { error: "File is too large to preview" } };
  }

  const buffer = fs.readFileSync(absoluteFile);
  if (buffer.includes(0)) {
    return { statusCode: 415, payload: { error: "Binary files cannot be previewed" } };
  }

  const fullContent = buffer.toString("utf8");
  const sliced = sliceSourceLines(
    fullContent,
    lineRange.startLine,
    lineRange.endLine,
  );

  return {
    statusCode: 200,
    payload: {
      file: safeRelative,
      content: sliced.content,
      startLine: sliced.startLine,
      endLine: sliced.endLine,
      language: detectWikiSourceLanguage(safeRelative),
    },
  };
}

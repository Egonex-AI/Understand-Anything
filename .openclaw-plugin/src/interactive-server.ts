#!/usr/bin/env node
/**
 * Interactive dashboard server — a superset of understand-anything-viewer
 * (same static dashboard build, same read-only JSON API, same token/security
 * model) that additionally serves a floating "Ask" chat widget backed by a
 * live LLM. Spawned as its own subprocess by dashboard-route.ts, exactly like
 * the plain viewer, but only when the plugin has an Anthropic API key
 * configured — with no key, dashboard-route.ts falls back to the upstream
 * zero-LLM viewer instead.
 *
 * Deliberately NOT a fork of understand-anything-viewer: that package's whole
 * reason to exist is staying LLM-free for team-sharing without an API key.
 * This is a distinct, additive server that happens to reuse its static
 * assets and API surface.
 *
 * Usage: node interactive-server.js <project-dir> --port <n>
 * Env:   UNDERSTAND_ANTHROPIC_API_KEY, UNDERSTAND_MODEL (never passed as CLI
 *        args — those would be visible in `ps aux`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph, saveDiffOverlay } from "@understand-anything/core";
import { askAboutProject } from "./ask.js";
import { createLlmCaller } from "./llm.js";
import { generateCustomTour } from "./custom-tour.js";
import { getChangedFiles, generatePrWalkthrough } from "./pr-diff.js";
import { loadTours, upsertTour, makeTourId } from "./tour-store.js";

const require = createRequire(import.meta.url);
const viewerPkgJson = require.resolve("understand-anything-viewer/package.json");
const DIST_DIR = path.join(path.dirname(viewerPkgJson), "dist");
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;
const UA_DIR_CANDIDATES = [".understand-anything", ".ua"];
const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let projectRoot = process.cwd();
let port = 0;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port") {
    port = Number(args[++i]);
  } else if (!a.startsWith("-")) {
    projectRoot = path.resolve(a);
  }
}

const apiKey = process.env.UNDERSTAND_ANTHROPIC_API_KEY;
const model = process.env.UNDERSTAND_MODEL || "claude-sonnet-5";
if (!apiKey) {
  console.error("Error: UNDERSTAND_ANTHROPIC_API_KEY env var is required for the interactive server.");
  process.exit(1);
}
const llmCall = createLlmCaller(apiKey, model);

if (!fs.existsSync(DIST_DIR)) {
  console.error(
    "Error: embedded dashboard build not found. Run `pnpm --filter understand-anything-viewer build` first.",
  );
  process.exit(1);
}

const graphDir = UA_DIR_CANDIDATES
  .map((d) => path.join(projectRoot, d))
  .find((d) => fs.existsSync(path.join(d, "knowledge-graph.json")));

if (!graphDir) {
  console.error(`Error: no knowledge graph found under ${projectRoot}. Run understand_analyze_project first.`);
  process.exit(1);
}

const ACCESS_TOKEN = crypto.randomBytes(16).toString("hex");

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function normalizeGraphPath(filePath: string): string | null {
  const rawPath = path.isAbsolute(filePath)
    ? filePath.startsWith(projectRoot)
      ? path.relative(projectRoot, filePath)
      : null
    : filePath;
  if (rawPath === null) return null;
  const normalized = path.normalize(rawPath);
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("\0") ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized.split(path.sep).join("/");
}

function graphFilePathSet(): Set<string> {
  const allowed = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(graphDir!, "knowledge-graph.json"), "utf-8"));
    for (const node of raw.nodes ?? []) {
      if (typeof node.filePath !== "string") continue;
      const normalized = normalizeGraphPath(node.filePath);
      if (normalized) allowed.add(normalized);
    }
  } catch {
    return allowed;
  }
  return allowed;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  bash: "bash", c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css",
  go: "go", h: "c", hpp: "cpp", html: "markup", java: "java",
  js: "javascript", jsx: "jsx", json: "json", md: "markdown",
  mjs: "javascript", py: "python", rb: "ruby", rs: "rust", sh: "bash",
  ts: "typescript", tsx: "tsx", txt: "text", yaml: "yaml", yml: "yaml",
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "text";
}

function readSourceFile(url: URL): { statusCode: number; payload: unknown } {
  const reject = (message: string, statusCode = 400) => ({ statusCode, payload: { error: message } });
  const requestedPath = url.searchParams.get("path") ?? "";
  if (!requestedPath) return reject("Missing path");
  if (requestedPath.includes("\0")) return reject("Invalid path");
  if (path.isAbsolute(requestedPath)) return reject("Absolute paths are not allowed");

  const normalizedPath = path.normalize(requestedPath);
  if (normalizedPath === "." || normalizedPath.startsWith(`..${path.sep}`) || normalizedPath === "..") {
    return reject("Path must stay inside the project");
  }

  const absoluteFile = path.resolve(projectRoot, normalizedPath);
  const relativeToRoot = path.relative(projectRoot, absoluteFile);
  if (!relativeToRoot || relativeToRoot.startsWith(`..${path.sep}`) || relativeToRoot === "..") {
    return reject("Path must stay inside the project");
  }
  const safeRelativePath = relativeToRoot.split(path.sep).join("/");
  if (!graphFilePathSet().has(safeRelativePath)) {
    return reject("File is not in the knowledge graph", 404);
  }

  let stat;
  try {
    stat = fs.statSync(absoluteFile);
  } catch {
    return reject("File not found", 404);
  }
  if (!stat.isFile()) return reject("Path is not a file");
  if (stat.size > MAX_SOURCE_FILE_BYTES) return reject("File is too large to preview", 413);

  const buffer = fs.readFileSync(absoluteFile);
  if (buffer.includes(0)) return reject("Binary files cannot be previewed", 415);

  const content = buffer.toString("utf8");
  return {
    statusCode: 200,
    payload: {
      path: safeRelativePath,
      language: detectLanguage(relativeToRoot),
      content,
      sizeBytes: buffer.byteLength,
      lineCount: content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length,
    },
  };
}

function serveGraphJson(res: ServerResponse, fileName: string): void {
  const candidate = path.join(graphDir!, fileName);
  if (fs.existsSync(candidate)) {
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      if (Array.isArray(raw.nodes)) {
        raw.nodes = raw.nodes.map((node: { filePath?: unknown; [k: string]: unknown }) => {
          if (typeof node.filePath !== "string") return node;
          const abs = node.filePath;
          const rel = abs.startsWith(projectRoot)
            ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
            : path.isAbsolute(abs)
              ? path.basename(abs)
              : abs;
          return { ...node, filePath: rel };
        });
      }
      sendJson(res, 200, raw);
    } catch {
      sendJson(res, 500, { error: "Failed to read graph file" });
    }
    return;
  }
  if (fileName === "knowledge-graph.json") {
    sendJson(res, 404, { error: "No knowledge graph found. Run understand_analyze_project first." });
  } else {
    res.statusCode = 404;
    res.end();
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css", ".html": "text/html", ".ico": "image/x-icon",
  ".js": "text/javascript", ".json": "application/json", ".map": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2",
};

const WIDGET_SCRIPT_TAGS = `<script src="/ask-widget.js" defer></script><script src="/tours-widget.js" defer></script>`;

function serveIndexHtmlWithWidget(res: ServerResponse): void {
  const absolute = path.join(DIST_DIR, "index.html");
  let html = fs.readFileSync(absolute, "utf8");
  html = html.includes("</body>") ? html.replace("</body>", `${WIDGET_SCRIPT_TAGS}</body>`) : html + WIDGET_SCRIPT_TAGS;
  res.setHeader("Content-Type", "text/html");
  res.end(html);
}

function serveLocalScript(res: ServerResponse, filename: string): void {
  const absolute = path.join(HERE, filename);
  res.setHeader("Content-Type", "text/javascript");
  res.end(fs.readFileSync(absolute, "utf8"));
}

function serveStatic(res: ServerResponse, pathname: string): void {
  if (pathname === "/ask-widget.js") return serveLocalScript(res, "ask-widget.js");
  if (pathname === "/tours-widget.js") return serveLocalScript(res, "tours-widget.js");

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const absolute = path.resolve(DIST_DIR, relative);
  if (absolute !== DIST_DIR && !absolute.startsWith(DIST_DIR + path.sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  if (relative === "index.html") return serveIndexHtmlWithWidget(res);
  res.setHeader("Content-Type", CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream");
  res.end(fs.readFileSync(absolute));
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const TOKEN_VIA_HEADER = new Set(["/ask.json", "/generate-tour.json", "/generate-pr-tour.json"]);
const PROTECTED = new Set([
  "/knowledge-graph.json",
  "/domain-graph.json",
  "/diff-overlay.json",
  "/meta.json",
  "/config.json",
  "/file-content.json",
  "/ask.json",
  "/tours.json",
  "/generate-tour.json",
  "/generate-pr-tour.json",
]);

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (!PROTECTED.has(pathname)) {
      serveStatic(res, pathname);
      return;
    }

    const token = TOKEN_VIA_HEADER.has(pathname) ? req.headers["x-ask-token"] : url.searchParams.get("token");
    if (token !== ACCESS_TOKEN) {
      sendJson(res, 403, { error: "Forbidden: missing or invalid token" });
      return;
    }

    if (pathname === "/ask.json") {
      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendJson(res, 405, { error: "POST required" });
        return;
      }
      try {
        const body = await readBody(req, 8192);
        const parsed = JSON.parse(body || "{}") as { question?: unknown };
        const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
        if (!question) {
          sendJson(res, 400, { error: "Missing question" });
          return;
        }
        const result = await askAboutProject(projectRoot, question, llmCall);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (pathname === "/tours.json") {
      sendJson(res, 200, { tours: loadTours(projectRoot) });
      return;
    }

    if (pathname === "/generate-tour.json") {
      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendJson(res, 405, { error: "POST required" });
        return;
      }
      try {
        const body = await readBody(req, 16384);
        const parsed = JSON.parse(body || "{}") as { nodeIds?: unknown; prompt?: unknown };
        const nodeIds = Array.isArray(parsed.nodeIds) ? parsed.nodeIds.filter((n): n is string => typeof n === "string") : [];
        const userPrompt = typeof parsed.prompt === "string" ? parsed.prompt : "";

        const graph = loadGraph(projectRoot, { validate: false });
        if (!graph) {
          sendJson(res, 404, { error: "No knowledge graph found for this project." });
          return;
        }

        const result = await generateCustomTour(graph, nodeIds, userPrompt, llmCall);
        if (result.error) {
          sendJson(res, 400, { error: result.error });
          return;
        }

        const tour = {
          id: makeTourId("custom" as const),
          kind: "custom" as const,
          title: userPrompt.slice(0, 80),
          description: userPrompt,
          createdAt: new Date().toISOString(),
          steps: result.steps,
          prompt: userPrompt,
        };
        upsertTour(projectRoot, tour);
        sendJson(res, 200, { tour });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (pathname === "/generate-pr-tour.json") {
      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendJson(res, 405, { error: "POST required" });
        return;
      }
      try {
        const body = await readBody(req, 4096);
        const parsed = JSON.parse(body || "{}") as { prNumber?: unknown; baseBranch?: unknown };
        const prNumber = typeof parsed.prNumber === "number" ? parsed.prNumber : undefined;
        const baseBranch = typeof parsed.baseBranch === "string" && parsed.baseBranch.trim() ? parsed.baseBranch.trim() : undefined;

        const graph = loadGraph(projectRoot, { validate: false });
        if (!graph) {
          sendJson(res, 404, { error: "No knowledge graph found for this project." });
          return;
        }

        const { changedFiles, baseBranch: resolvedSource } = await getChangedFiles(projectRoot, { prNumber, baseBranch });
        if (changedFiles.length === 0) {
          sendJson(res, 400, { error: `No changed files found (source: ${resolvedSource}).` });
          return;
        }

        const result = await generatePrWalkthrough(graph, changedFiles, resolvedSource, llmCall);
        saveDiffOverlay(projectRoot, result.overlay);
        if (result.error) {
          sendJson(res, 400, { error: result.error, overlay: result.overlay });
          return;
        }

        const tour = {
          id: makeTourId("prWalkthrough" as const),
          kind: "prWalkthrough" as const,
          title: `PR walkthrough: ${resolvedSource}`,
          description: `Changed: ${changedFiles.slice(0, 5).join(", ")}${changedFiles.length > 5 ? "…" : ""}`,
          createdAt: new Date().toISOString(),
          steps: result.steps,
          diffSource: resolvedSource,
        };
        upsertTour(projectRoot, tour);
        sendJson(res, 200, { tour, overlay: result.overlay });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (pathname === "/file-content.json") {
      const result = readSourceFile(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (pathname === "/config.json") {
      const candidate = path.join(graphDir!, "config.json");
      if (fs.existsSync(candidate)) {
        try {
          sendJson(res, 200, JSON.parse(fs.readFileSync(candidate, "utf-8")));
        } catch {
          sendJson(res, 500, { error: "Failed to read config file" });
        }
        return;
      }
      sendJson(res, 200, { autoUpdate: false, outputLanguage: "en" });
      return;
    }

    serveGraphJson(res, pathname.slice(1));
  })();
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`Serving graph from ${graphDir}`);
  console.log(`Dashboard URL: http://127.0.0.1:${boundPort}/?token=${ACCESS_TOKEN}`);
  console.log(`Ask token: ${ACCESS_TOKEN}`);
});

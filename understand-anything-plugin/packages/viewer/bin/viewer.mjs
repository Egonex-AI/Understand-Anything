#!/usr/bin/env node
/**
 * understand-anything-viewer — serve a generated knowledge graph in the
 * dashboard UI with nothing but Node.js. Read-only, no Claude Code, no LLM.
 *
 * Usage:
 *     understand-anything-viewer [project-dir] [--port <n>] [--no-open] [--private]
 *
 * The project directory (default: cwd) must contain a data directory —
 * `.ua/` or legacy `.understand-anything/` — with a knowledge-graph.json
 * produced by /understand.
 *
 * Security model mirrors the dashboard dev server (vite.config.ts):
 *   - binds to 127.0.0.1 only
 *   - every data endpoint requires a session-specific Bearer token
 *   - graph JSON is served with node filePaths relativised to the project
 *   - /file-content.json only serves files listed in the graph, capped at
 *     1 MB, never binary
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGraphFreshnessBatch } from "./dist/staleness.js";

const DIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

const MAX_GRAPH_FILE_BYTES = 32 * 1024 * 1024;
const MAX_STATIC_FILE_BYTES = 32 * 1024 * 1024;

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);

  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function readBoundedFile(root, target, maxBytes) {
  const absolute = path.resolve(target);

  if (!isInsideRoot(root, absolute) || absolute === root) {
    throw new Error("Path outside authorized root");
  }

  const rootStat = fs.lstatSync(root);

  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Unsafe root directory");
  }

  let current = root;

  for (const component of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, component);

    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("Symbolic links are not allowed");
    }
  }

  const before = fs.lstatSync(absolute);

  if (!before.isFile() || before.nlink !== 1) {
    throw new Error("Unsafe file type");
  }

  if (before.size > maxBytes) {
    throw new Error("File exceeds size limit");
  }

  const fd = fs.openSync(
    absolute,
    fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW ?? 0) |
      (fs.constants.O_NONBLOCK ?? 0),
  );

  try {
    const stat = fs.fstatSync(fd);

    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino
    ) {
      throw new Error("File changed during validation");
    }

    if (stat.size > maxBytes) {
      throw new Error("File exceeds size limit");
    }

    if (!isInsideRoot(root, fs.realpathSync(absolute))) {
      throw new Error("Resolved file outside authorized root");
    }

    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;

    while (offset < buffer.length) {
      const count = fs.readSync(
        fd,
        buffer,
        offset,
        buffer.length - offset,
        null,
      );

      if (count === 0) break;
      offset += count;
    }

    if (offset > stat.size) {
      throw new Error("File changed during reading");
    }

    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(fd);
  }
}

function readDataJson(fileName) {
  const buffer = readBoundedFile(
    projectRoot,
    path.join(graphDir, fileName),
    MAX_GRAPH_FILE_BYTES,
  );

  return JSON.parse(buffer.toString("utf8"));
}

// Legacy directory first — projects analyzed before the `.ua` rename keep
// their existing `.understand-anything/` data.
const UA_DIR_CANDIDATES = [".understand-anything", ".ua"];

// ── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let projectRoot = process.cwd();
let port = 5173;
let portExplicit = false;
let openBrowser = true;
let privateMode = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port") {
    port = Number(args[++i]);
    portExplicit = true;
    // 0 asks the OS for any free port.
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error("Error: --port must be an integer between 0 and 65535");
      process.exit(1);
    }
  } else if (a === "--private") {
    privateMode = true;
  } else if (a === "--no-open") {
    openBrowser = false;
  } else if (a === "--help" || a === "-h") {
    console.log("Usage: understand-anything-viewer [project-dir] [--port <n>] [--no-open] [--private]");
    process.exit(0);
  } else if (!a.startsWith("-")) {
    projectRoot = path.resolve(a);
  } else {
    console.error(`Error: unknown option ${a}`);
    process.exit(1);
  }
}

if (privateMode && !openBrowser) {
  console.error("Error: --private requires browser opening.");
  process.exit(1);
}

projectRoot = fs.realpathSync(projectRoot);

if (!fs.existsSync(DIST_DIR)) {
  console.error(
    "Error: embedded dashboard build not found. This tarball was packed " +
    "without running the build — run `pnpm --filter understand-anything-viewer build` first.",
  );
  process.exit(1);
}

const graphDir = UA_DIR_CANDIDATES
  .map((d) => path.join(projectRoot, d))
  .find((d) => fs.existsSync(path.join(d, "knowledge-graph.json")));

if (!graphDir) {
  console.error(
    `Error: no knowledge graph found under ${projectRoot}\n` +
    "Expected .ua/knowledge-graph.json (or legacy .understand-anything/). " +
    "Generate one with /understand first, or pass the project directory as an argument.",
  );
  process.exit(1);
}

const ACCESS_TOKEN = crypto.randomBytes(32).toString("hex");

// ── Helpers (mirroring vite.config.ts) ────────────────────────────────────

function hasValidToken(authorization, expected) {
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return false;
  }

  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const required = Buffer.from(expected, "utf8");

  return (
    supplied.length === required.length &&
    crypto.timingSafeEqual(supplied, required)
  );
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function normalizeGraphPath(filePath) {
  const rawPath = path.isAbsolute(filePath)
    ? isInsideRoot(projectRoot, filePath)
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

function graphFilePathSet() {
  const allowed = new Set();
  try {
    const raw = readDataJson("knowledge-graph.json");
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

function detectLanguage(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const byExt = {
    bash: "bash", c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css",
    go: "go", h: "c", hpp: "cpp", html: "markup", java: "java",
    js: "javascript", jsx: "jsx", json: "json", md: "markdown",
    mjs: "javascript", py: "python", rb: "ruby", rs: "rust", sh: "bash",
    ts: "typescript", tsx: "tsx", txt: "text", yaml: "yaml", yml: "yaml",
  };
  return byExt[ext] ?? "text";
}

function readSourceFile(url) {
  const reject = (message, statusCode = 400) => ({ statusCode, payload: { error: message } });
  const requestedPath = url.searchParams.get("path") ?? "";
  if (!requestedPath) return reject("Missing path");
  if (requestedPath.includes("\0")) return reject("Invalid path");
  if (path.isAbsolute(requestedPath)) return reject("Absolute paths are not allowed");

  const normalizedPath = path.normalize(requestedPath);
  if (
    normalizedPath === "." ||
    normalizedPath.startsWith(`..${path.sep}`) ||
    normalizedPath === ".." ||
    path.isAbsolute(normalizedPath)
  ) {
    return reject("Path must stay inside the project");
  }

  const absoluteFile = path.resolve(projectRoot, normalizedPath);
  const relativeToRoot = path.relative(projectRoot, absoluteFile);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === ".." ||
    path.isAbsolute(relativeToRoot)
  ) {
    return reject("Path must stay inside the project");
  }
  const safeRelativePath = relativeToRoot.split(path.sep).join("/");
  if (!graphFilePathSet().has(safeRelativePath)) {
    return reject("File is not in the knowledge graph", 404);
  }

  let buffer;

  try {
    buffer = readBoundedFile(
      projectRoot,
      absoluteFile,
      MAX_SOURCE_FILE_BYTES,
    );
  } catch (error) {
    if (error.message === "File exceeds size limit") {
      return reject("File is too large to preview", 413);
    }

    return reject("File unavailable or unsafe", 404);
  }

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

function serveGraphJson(res, fileName) {
  const candidate = path.join(graphDir, fileName);
  if (fs.existsSync(candidate)) {
    try {
      const raw = readDataJson(fileName);
      // Sanitise absolute node filePaths so the developer's directory
      // layout is never sent to the browser.
      if (Array.isArray(raw.nodes)) {
        raw.nodes = raw.nodes.map((node) => {
          if (typeof node.filePath !== "string") return node;
          const rel = normalizeGraphPath(node.filePath);
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
    sendJson(res, 404, { error: "No knowledge graph found. Run /understand first." });
  } else {
    res.statusCode = 404;
    res.end();
  }
}

function readGraphMetadata(fileName) {
  const graph = readDataJson(fileName);
  return {
    graphCommitHash:
      typeof graph.project?.gitCommitHash === "string"
        ? graph.project.gitCommitHash
        : undefined,
    lastAnalyzedAt:
      typeof graph.project?.analyzedAt === "string"
        ? graph.project.analyzedAt
        : undefined,
  };
}

async function readGraphFreshness() {
  const knowledgeGraph = path.join(graphDir, "knowledge-graph.json");
  if (!fs.existsSync(knowledgeGraph)) {
    return {
      statusCode: 404,
      payload: { error: "No knowledge graph found. Run /understand first." },
    };
  }

  const domainGraph = path.join(graphDir, "domain-graph.json");
  let inputs;
  try {
    inputs = {
      knowledge: readGraphMetadata("knowledge-graph.json"),
      ...(fs.existsSync(domainGraph)
        ? { domain: readGraphMetadata("domain-graph.json") }
        : {}),
    };
  } catch {
    return {
      statusCode: 500,
      payload: { error: "Failed to read graph file" },
    };
  }

  return {
    statusCode: 200,
    payload: {
      graphs: await getGraphFreshnessBatch(projectRoot, inputs),
    },
  };
}

const CONTENT_TYPES = {
  ".css": "text/css", ".html": "text/html", ".ico": "image/x-icon",
  ".js": "text/javascript", ".json": "application/json", ".map": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2",
};

function serveStatic(res, pathname) {
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
  res.setHeader("Content-Type", CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream");
  try {
    res.end(readBoundedFile(
      DIST_DIR,
      absolute,
      MAX_STATIC_FILE_BYTES,
    ));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

// ── Server ────────────────────────────────────────────────────────────────

const PROTECTED = new Set([
  "/knowledge-graph.json",
  "/domain-graph.json",
  "/diff-overlay.json",
  "/meta.json",
  "/config.json",
  "/code-lessons.json",
  "/file-content.json",
  "/staleness.json",
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const server = createServer((req, res) => {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  const address = server.address();

  if (
    !address ||
    typeof address !== "object" ||
    req.headers.host !== `127.0.0.1:${address.port}`
  ) {
    sendJson(res, 403, { error: "Invalid Host header" });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const requestTarget = req.url ?? "/";

  if (
    !requestTarget.startsWith("/") ||
    requestTarget.startsWith("//") ||
    requestTarget.includes("\\\\")
  ) {
    sendJson(res, 400, { error: "Invalid request target" });
    return;
  }

  let url;

  try {
    url = new URL(requestTarget, "http://127.0.0.1");
  } catch {
    sendJson(res, 400, { error: "Invalid request URL" });
    return;
  }

  const pathname = url.pathname;

  if (pathname === "/staleness.json") {
    res.setHeader("Cache-Control", "no-store");
  }

  if (!PROTECTED.has(pathname)) {
    serveStatic(res, pathname);
    return;
  }

  if (!hasValidToken(req.headers.authorization, ACCESS_TOKEN)) {
    res.setHeader("X-UA-Auth-Status", "invalid-token");
    sendJson(res, 403, { error: "Forbidden: missing or invalid token" });
    return;
  }

  if (pathname === "/file-content.json") {
    const result = readSourceFile(url);
    sendJson(res, result.statusCode, result.payload);
    return;
  }

  if (pathname === "/staleness.json") {
    void readGraphFreshness()
      .then((result) => sendJson(res, result.statusCode, result.payload))
      .catch(() => {
        sendJson(res, 500, { error: "Failed to read graph freshness" });
      });
    return;
  }

  if (pathname === "/config.json") {
    const candidate = path.join(graphDir, "config.json");
    if (fs.existsSync(candidate)) {
      try {
        sendJson(res, 200, readDataJson(path.basename(candidate)));
      } catch {
        sendJson(res, 500, { error: "Failed to read config file" });
      }
      return;
    }
    sendJson(res, 200, { autoUpdate: false, outputLanguage: "en" });
    return;
  }

  if (pathname === "/code-lessons.json") {
    const candidate = path.join(graphDir, "code-lessons.json");
    if (fs.existsSync(candidate)) {
      try {
        sendJson(res, 200, readDataJson(path.basename(candidate)));
      } catch {
        sendJson(res, 500, { error: "Failed to read code lessons file" });
      }
      return;
    }
    // Code lessons are optional — absent file means the dashboard
    // renders the code viewer without the lesson panel.
    res.statusCode = 404;
    res.end();
    return;
  }

  try {
    serveGraphJson(res, pathname.slice(1));
  } catch {
    sendJson(res, 500, { error: "Failed to read graph" });
  }
});

function listen(attemptPort, attemptsLeft) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && !portExplicit && attemptsLeft > 0) {
      // server.listen(port, host, cb) registers cb with once("listening"), and a
      // failed bind leaves it attached. Drop it before retrying, or every failed
      // attempt's callback fires on the eventual successful bind (duplicate
      // banners, one browser tab per attempt).
      server.removeAllListeners("listening");
      listen(attemptPort + 1, attemptsLeft - 1);
    } else {
      console.error(`Error: could not bind 127.0.0.1:${attemptPort} — ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(attemptPort, "127.0.0.1", () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : attemptPort;
    const dashboardUrl = `http://127.0.0.1:${boundPort}/#token=${ACCESS_TOKEN}`;
    if (privateMode) {
      console.log(`Dashboard ready: http://127.0.0.1:${boundPort}/`);
    } else {
      console.log(`\n  Serving graph from ${graphDir}`);
      console.log(`  Dashboard URL: ${dashboardUrl}\n`);
    }

    if (openBrowser) {
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "rundll32.exe"
            : "xdg-open";

      const openerArgs =
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", dashboardUrl]
          : [dashboardUrl];

      const browser = spawn(opener, openerArgs, {
        shell: false,
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });

      browser.on("error", () => {
        console.error("Unable to launch the local browser.");
      });

      browser.on("exit", (code) => {
        if (code !== 0) {
          console.error("Browser launcher did not complete successfully.");
        }
      });

      browser.unref();
    }
  });
}

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.maxConnections = 32;

listen(port, 10);

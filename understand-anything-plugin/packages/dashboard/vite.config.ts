/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { WikiDataService } from "./wiki-api";
import { readWikiSourceFile } from "./wiki-source";

// Generate a one-time token when the server process starts.
// This token is printed to the terminal and must be in the URL
// to fetch knowledge-graph.json or diff-overlay.json.
const ACCESS_TOKEN = process.env.UNDERSTAND_ACCESS_TOKEN || crypto.randomBytes(16).toString("hex");
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

function graphFileCandidates(fileName: string): string[] {
  const graphDir = process.env.GRAPH_DIR;
  return [
    ...(graphDir
      ? [path.resolve(graphDir, `.understand-anything/${fileName}`)]
      : []),
    path.resolve(process.cwd(), `.understand-anything/${fileName}`),
    path.resolve(process.cwd(), `../../../.understand-anything/${fileName}`),
  ];
}

function findGraphFile(fileName: string): string | null {
  return graphFileCandidates(fileName).find((candidate) => fs.existsSync(candidate)) ?? null;
}

function projectRootFromGraphFile(candidate: string): string {
  return path.dirname(path.dirname(candidate));
}

function normalizeGraphPath(filePath: string, projectRoot: string): string | null {
  const rawPath = path.isAbsolute(filePath)
    ? filePath.startsWith(projectRoot)
      ? path.relative(projectRoot, filePath)
      : path.basename(filePath) // absolute but outside root — match graph-serving behavior
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

function graphFilePathSet(graphFile: string, projectRoot: string): Set<string> {
  const allowed = new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(graphFile, "utf-8")) as {
      nodes?: Array<Record<string, unknown>>;
    };
    for (const node of raw.nodes ?? []) {
      if (typeof node.filePath !== "string") continue;
      const normalized = normalizeGraphPath(node.filePath, projectRoot);
      if (normalized) allowed.add(normalized);
    }
  } catch {
    return allowed;
  }
  return allowed;
}

function detectLanguage(filePath: string): string {
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

function sendJson(res: import("http").ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function rejectFileRequest(message: string, statusCode = 400) {
  return { statusCode, payload: { error: message } };
}

function readSourceFile(url: URL) {
  const requestedPath = url.searchParams.get("path") ?? "";
  if (!requestedPath) return rejectFileRequest("Missing path");
  if (requestedPath.includes("\0")) return rejectFileRequest("Invalid path");
  if (path.isAbsolute(requestedPath)) return rejectFileRequest("Absolute paths are not allowed");

  const normalizedPath = path.normalize(requestedPath);
  if (
    normalizedPath === "." ||
    normalizedPath.startsWith(`..${path.sep}`) ||
    normalizedPath === ".." ||
    path.isAbsolute(normalizedPath)
  ) {
    return rejectFileRequest("Path must stay inside the project");
  }

  const graphFile = findGraphFile("knowledge-graph.json");
  if (!graphFile) {
    return rejectFileRequest("No knowledge graph found. Run /understand first.", 404);
  }

  const projectRoot = projectRootFromGraphFile(graphFile);
  const absoluteFile = path.resolve(projectRoot, normalizedPath);
  const relativeToRoot = path.relative(projectRoot, absoluteFile);
  if (
    !relativeToRoot ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    relativeToRoot === ".." ||
    path.isAbsolute(relativeToRoot)
  ) {
    return rejectFileRequest("Path must stay inside the project");
  }
  const safeRelativePath = relativeToRoot.split(path.sep).join("/");
  if (!graphFilePathSet(graphFile, projectRoot).has(safeRelativePath)) {
    return rejectFileRequest("File is not in the knowledge graph", 404);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absoluteFile);
  } catch {
    return rejectFileRequest("File not found", 404);
  }

  if (!stat.isFile()) return rejectFileRequest("Path is not a file");
  if (stat.size > MAX_SOURCE_FILE_BYTES) {
    return rejectFileRequest("File is too large to preview", 413);
  }

  const buffer = fs.readFileSync(absoluteFile);
  if (buffer.includes(0)) return rejectFileRequest("Binary files cannot be previewed", 415);

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

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/**/__tests__/**/*.test.tsx", "jsdom"],
    ],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup-dom.ts"],
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/src/schema.ts"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/src/search.ts"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/src/types.ts"),
      "@understand-anything/core/system-graph": path.resolve(__dirname, "../core/src/system-graph.ts"),
      "@understand-anything/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },

  server: {
    host: "0.0.0.0",
    port: 5173,
    open: `/?token=${ACCESS_TOKEN}`,
  },

  resolve: {
    alias: {
      "@understand-anything/core/schema": path.resolve(__dirname, "../core/dist/schema.js"),
      "@understand-anything/core/search": path.resolve(__dirname, "../core/dist/search.js"),
      "@understand-anything/core/types": path.resolve(__dirname, "../core/dist/types.js"),
      "@understand-anything/core/system-graph": path.resolve(__dirname, "../core/dist/system-graph.js"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          // ELK is ~1.6MB raw — split into its own chunk so it doesn't
          // bloat the main bundle. graphology is similarly large.
          if (id.includes("node_modules/elkjs/")) return "elk";
          if (id.includes("node_modules/graphology")) return "graphology";
          if (
            id.includes("node_modules/@dagrejs/") ||
            id.includes("node_modules/d3-force/")
          ) {
            return "graph-layout";
          }
          if (
            id.includes("node_modules/react-markdown/") ||
            id.includes("node_modules/hast-util-to-jsx-runtime/") ||
            /[\\/]node_modules[\\/](remark|rehype|mdast|hast|unist|micromark|decode-named-character-reference|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|devlop|bail|ccount|character-entities|is-plain-obj|trim-lines|trough|unified|vfile|zwitch)/.test(id)
          ) {
            return "markdown";
          }
        },
      },
    },
  },

  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-knowledge-graph",
      configureServer(server) {
        // Print the access URL once so the developer can open it.
        server.httpServer?.once("listening", () => {
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address ? address.port : 5173;
          console.log(
            `\n  🔑  Dashboard URL (local):   http://127.0.0.1:${port}/?token=${ACCESS_TOKEN}` +
            `\n  🔑  Dashboard URL (network): http://0.0.0.0:${port}/?token=${ACCESS_TOKEN}\n`
          );
        });

        // Wiki API service — lazily initialized on first request
        let wikiService: WikiDataService | null = null;
        function getWikiService(): WikiDataService {
          if (!wikiService) {
            const graphFile = findGraphFile("knowledge-graph.json");
            const projectRoot = graphFile
              ? projectRootFromGraphFile(graphFile)
              : process.env.GRAPH_DIR ?? process.cwd();
            wikiService = new WikiDataService(projectRoot);
          }
          return wikiService;
        }

        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1:5173");
          const pathname = url.pathname;
          const isProtectedEndpoint =
            pathname === "/knowledge-graph.json" ||
            pathname === "/domain-graph.json" ||
            pathname === "/system-graph.json" ||
            pathname === "/diff-overlay.json" ||
            pathname === "/meta.json" ||
            pathname === "/config.json" ||
            pathname === "/file-content.json" ||
            pathname === "/api/graph" ||
            pathname.startsWith("/wiki/") ||
            pathname.startsWith("/api/wiki");

          if (!isProtectedEndpoint) {
            next();
            return;
          }

          // FIX 3 — require the one-time token on all data endpoints.
          // Requests without a matching ?token= get a 403.
          if (url.searchParams.get("token") !== ACCESS_TOKEN) {
            sendJson(res, 403, { error: "Forbidden: missing or invalid token" });
            return;
          }

          // --- Agent Query API: /api/wiki/* ---
          if (pathname.startsWith("/api/wiki")) {
            const ws = getWikiService();
            const apiPath = pathname.slice("/api/wiki".length) || "/";

            if (apiPath === "/" || apiPath === "") {
              sendJson(res, 200, ws.getGlobalIndex());
              return;
            }
            if (apiPath === "/overview") {
              const data = ws.getOverview();
              if (!data) { sendJson(res, 404, { error: "No parent wiki overview found" }); return; }
              sendJson(res, 200, data);
              return;
            }
            if (apiPath === "/architecture") {
              const data = ws.getArchitecture();
              if (!data) { sendJson(res, 404, { error: "No parent wiki architecture found" }); return; }
              sendJson(res, 200, data);
              return;
            }
            if (apiPath === "/services") {
              sendJson(res, 200, ws.getServices());
              return;
            }
            if (apiPath === "/search") {
              const q = url.searchParams.get("q") ?? "";
              const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
              const limit = Math.min(100, Math.max(1, Number.isNaN(rawLimit) ? 20 : rawLimit));
              void ws.search(q, limit).then(
                (results) => sendJson(res, 200, results),
                (err: unknown) =>
                  sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }),
              );
              return;
            }
            if (apiPath === "/source") {
              const rawFile = url.searchParams.get("file") ?? "";
              const resolvedFile = ws.resolveSourcePath(rawFile);
              const result = readWikiSourceFile(
                ws.getProjectRoot(),
                resolvedFile,
                url.searchParams.get("start"),
                url.searchParams.get("end"),
              );
              sendJson(res, result.statusCode, result.payload);
              return;
            }

            // /api/wiki/service/:name/domain/:d
            const svcDomainMatch = apiPath.match(/^\/service\/([^/]+)\/domain\/([^/]+)$/);
            if (svcDomainMatch) {
              try {
                const svcName = decodeURIComponent(svcDomainMatch[1]);
                const domainId = decodeURIComponent(svcDomainMatch[2]);
                const data = ws.getServiceDomain(svcName, domainId);
                if (!data) { sendJson(res, 404, { error: "Service domain not found" }); return; }
                sendJson(res, 200, data);
              } catch { sendJson(res, 400, { error: "Invalid URL encoding" }); }
              return;
            }

            // /api/wiki/service/:name
            const svcMatch = apiPath.match(/^\/service\/([^/]+)$/);
            if (svcMatch) {
              try {
                const svcName = decodeURIComponent(svcMatch[1]);
                const data = ws.getServiceWiki(svcName);
                if (!data) { sendJson(res, 404, { error: "Service wiki not found" }); return; }
                sendJson(res, 200, data);
              } catch { sendJson(res, 400, { error: "Invalid URL encoding" }); }
              return;
            }

            // /api/wiki/domain/:name
            const domainMatch = apiPath.match(/^\/domain\/([^/]+)$/);
            if (domainMatch) {
              try {
                const domainName = decodeURIComponent(domainMatch[1]);
                const data = ws.getDomain(domainName);
                if (!data) { sendJson(res, 404, { error: "Cross-service domain not found" }); return; }
                sendJson(res, 200, data);
              } catch { sendJson(res, 400, { error: "Invalid URL encoding" }); }
              return;
            }

            // /api/wiki/:id/related
            const relatedMatch = apiPath.match(/^\/([^/]+)\/related$/);
            if (relatedMatch) {
              try {
                sendJson(res, 200, ws.getRelated(decodeURIComponent(relatedMatch[1])));
              } catch { sendJson(res, 400, { error: "Invalid URL encoding" }); }
              return;
            }

            sendJson(res, 404, { error: `Unknown wiki API endpoint: ${apiPath}` });
            return;
          }

          // --- Raw wiki file serving (legacy, for backward compat) ---
          if (pathname.startsWith("/wiki/")) {
            const wikiPath = pathname.slice("/wiki/".length);
            if (wikiPath.includes("..") || wikiPath.includes("~")) {
              sendJson(res, 400, { error: "Invalid wiki path" });
              return;
            }
            const candidates = graphFileCandidates(`wiki/${wikiPath}`);
            for (const candidate of candidates) {
              if (fs.existsSync(candidate)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
                  sendJson(res, 200, raw);
                  return;
                } catch {
                  sendJson(res, 500, { error: "Failed to read wiki file" });
                  return;
                }
              }
            }
            sendJson(res, 404, { error: `Wiki file not found: ${wikiPath}` });
            return;
          }

          if (pathname === "/file-content.json") {
            const result = readSourceFile(url);
            sendJson(res, result.statusCode, result.payload);
            return;
          }

          if (pathname === "/api/graph") {
            const serviceName = url.searchParams.get("service");
            const fileName = url.searchParams.get("file") || "knowledge-graph.json";

            if (!serviceName) {
              sendJson(res, 400, { error: "service parameter required" });
              return;
            }

            if (
              serviceName.includes("/") ||
              serviceName.includes("\\") ||
              serviceName.includes("..")
            ) {
              sendJson(res, 400, { error: "invalid service name" });
              return;
            }

            const allowedFiles = [
              "knowledge-graph.json",
              "domain-graph.json",
              "meta.json",
              "config.json",
            ];
            if (!allowedFiles.includes(fileName)) {
              sendJson(res, 400, { error: "file not allowed" });
              return;
            }

            const graphDir = process.env.GRAPH_DIR;
            const candidates = [
              ...(graphDir
                ? [
                    path.resolve(
                      graphDir,
                      serviceName,
                      ".understand-anything",
                      fileName,
                    ),
                  ]
                : []),
              path.resolve(
                process.cwd(),
                serviceName,
                ".understand-anything",
                fileName,
              ),
              path.resolve(
                process.cwd(),
                "../../..",
                serviceName,
                ".understand-anything",
                fileName,
              ),
            ];

            for (const candidate of candidates) {
              if (fs.existsSync(candidate)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
                  sendJson(res, 200, raw);
                  return;
                } catch {
                  sendJson(res, 500, { error: "Failed to read graph file" });
                  return;
                }
              }
            }

            sendJson(res, 404, {
              error: `${fileName} not found for service ${serviceName}`,
            });
            return;
          }

          if (pathname === "/system-graph.json") {
            const systemCandidates = graphFileCandidates("system-graph.json");
            for (const candidate of systemCandidates) {
              if (fs.existsSync(candidate)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
                  sendJson(res, 200, raw);
                  return;
                } catch {
                  sendJson(res, 500, { error: "Failed to read system graph file" });
                  return;
                }
              }
            }
            sendJson(res, 404, { error: "system-graph.json not found" });
            return;
          }

          if (pathname === "/config.json") {
            const configCandidates = graphFileCandidates("config.json");
            for (const candidate of configCandidates) {
              if (fs.existsSync(candidate)) {
                try {
                  const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
                  sendJson(res, 200, raw);
                  return;
                } catch {
                  sendJson(res, 500, { error: "Failed to read config file" });
                  return;
                }
              }
            }
            sendJson(res, 200, { autoUpdate: false, outputLanguage: "en" });
            return;
          }

          const fileName =
            pathname === "/diff-overlay.json"
              ? "diff-overlay.json"
              : pathname === "/meta.json"
              ? "meta.json"
              : pathname === "/domain-graph.json"
              ? "domain-graph.json"
              : "knowledge-graph.json";

          const candidates = graphFileCandidates(fileName);

          for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;

            // FIX 2 — sanitise absolute file paths before sending the JSON.
            // Nodes can contain filePath values like /Users/alice/company/src/auth.ts.
            // We convert those to relative paths (src/auth.ts) so the developer's
            // home directory and company directory layout are not leaked.
            try {
              const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
                nodes?: Array<Record<string, unknown>>;
                [key: string]: unknown;
              };

              // Derive the project root from the candidate path so we can
              // make file paths relative to it.
              const projectRoot = projectRootFromGraphFile(candidate);

              if (Array.isArray(raw.nodes)) {
                raw.nodes = raw.nodes.map((node) => {
                  if (typeof node.filePath !== "string") return node;
                  const abs = node.filePath;
                  // Only relativise paths that actually sit inside projectRoot.
                  // Leave external or already-relative paths untouched.
                  const rel = abs.startsWith(projectRoot)
                    ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
                    : path.isAbsolute(abs)
                    ? path.basename(abs) // absolute but outside root — use filename only
                    : abs;              // already relative — keep as-is
                  return { ...node, filePath: rel };
                });
              }

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(raw));
            } catch (err) {
              // If we cannot parse or sanitise the file, refuse to serve it
              // rather than accidentally leaking raw content.
              console.error("[understand-anything] Failed to sanitise graph file:", err);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Failed to read graph file" }));
            }
            return;
          }

          // No matching file found on disk.
          res.statusCode = 404;
          if (pathname === "/knowledge-graph.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "No knowledge graph found. Run /understand first." }));
          } else {
            res.end();
          }
        });
      },
    },
  ],
});

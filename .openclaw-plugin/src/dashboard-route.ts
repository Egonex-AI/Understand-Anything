import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

interface ViewerInstance {
  proc: ChildProcessByStdio<null, Readable, Readable>;
  port: number;
  token: string;
}

const DASHBOARD_URL_RE = /Dashboard URL: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([a-f0-9]+)/;
const START_TIMEOUT_MS = 15_000;

const viewers = new Map<string, ViewerInstance>();

function resolveViewerBinPath(): string {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("understand-anything-viewer/package.json");
  return join(dirname(pkgJsonPath), "bin", "viewer.mjs");
}

function hasGraph(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, ".ua", "knowledge-graph.json")) ||
    existsSync(join(projectRoot, ".understand-anything", "knowledge-graph.json"))
  );
}

function getOrStartViewer(projectRoot: string, log: Logger): Promise<ViewerInstance> {
  const existing = viewers.get(projectRoot);
  if (existing && existing.proc.exitCode === null) {
    return Promise.resolve(existing);
  }

  const viewerBin = resolveViewerBinPath();
  const viewerDist = join(dirname(viewerBin), "..", "dist");
  if (!existsSync(join(viewerDist, "index.html"))) {
    return Promise.reject(
      new Error(
        `understand-anything-viewer has not been built. Run: pnpm --filter understand-anything-viewer build (from the Understand-Anything repo root).`,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [viewerBin, projectRoot, "--port", "0", "--no-open"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(`Timed out waiting for understand-anything-viewer to start for ${projectRoot}`));
    }, START_TIMEOUT_MS);

    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(DASHBOARD_URL_RE);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        const instance: ViewerInstance = { proc, port: Number(match[1]), token: match[2] };
        viewers.set(projectRoot, instance);
        log.info(`[understand-anything] viewer started for ${projectRoot} on port ${instance.port}`);
        resolve(instance);
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      log.warn(`[understand-anything] viewer stderr (${projectRoot}): ${chunk.toString().trim()}`);
    });
    proc.on("exit", (code) => {
      viewers.delete(projectRoot);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`understand-anything-viewer exited (code ${code}) before starting for ${projectRoot}`));
      }
    });
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

function pickerHtml(projects: string[]): string {
  const items = projects
    .map((p, i) => {
      const analyzed = hasGraph(p);
      const label = analyzed ? p : `${p} (not analyzed yet — call understand_analyze_project)`;
      return analyzed
        ? `<li><a href="/understand-anything/open?project=${i}">${escapeHtml(label)}</a></li>`
        : `<li>${escapeHtml(label)}</li>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Understand Anything</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto;">
<h1>Understand Anything</h1>
<p>Configured projects:</p>
<ul>${items || "<li>No projects configured — set plugins.entries.understand-anything.config.projects</li>"}</ul>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pathFromUrl(url: string | undefined): { pathname: string; query: URLSearchParams } {
  const u = new URL(url ?? "/", "http://localhost");
  return { pathname: u.pathname, query: u.searchParams };
}

export function registerDashboardRoutes(
  registerHttpRoute: (params: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
    auth: "gateway" | "plugin";
    match?: "exact" | "prefix";
  }) => void,
  getProjects: () => string[],
  log: Logger,
): void {
  const servePicker = async (_req: IncomingMessage, res: ServerResponse) => {
    sendHtml(res, 200, pickerHtml(getProjects()));
  };

  registerHttpRoute({ path: "/understand-anything", auth: "plugin", match: "exact", handler: servePicker });
  registerHttpRoute({
    path: "/understand-anything/",
    auth: "plugin",
    match: "prefix",
    handler: async (req, res) => {
      const { pathname, query } = pathFromUrl(req.url);

      if (pathname === "/understand-anything/open") {
        const projects = getProjects();
        const idx = Number(query.get("project"));
        if (!Number.isInteger(idx) || idx < 0 || idx >= projects.length) {
          return sendHtml(res, 400, "<p>Unknown project index. <a href=\"/understand-anything\">Back</a></p>");
        }
        const projectRoot = projects[idx];
        if (!hasGraph(projectRoot)) {
          return sendHtml(
            res,
            404,
            `<p>No knowledge graph found for <code>${escapeHtml(projectRoot)}</code> yet. Call the <code>understand_analyze_project</code> tool first.</p>`,
          );
        }
        try {
          const viewer = await getOrStartViewer(projectRoot, log);
          res.writeHead(302, { Location: `http://127.0.0.1:${viewer.port}/?token=${viewer.token}` });
          res.end();
        } catch (err) {
          log.error(`[understand-anything] failed to start viewer for ${projectRoot}:`, err);
          sendHtml(res, 500, `<p>Failed to start dashboard viewer: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`);
        }
        return;
      }

      return servePicker(req, res);
    },
  });

  log.info("[understand-anything] dashboard routes registered: /understand-anything");
}

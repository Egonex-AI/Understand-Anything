// End-to-end tests for the standalone viewer (packages/viewer/bin/viewer.mjs).
// Spawns the real server against a fixture project and exercises the token
// gate, graph sanitisation, file-content allowlist, and .ua/legacy resolution.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
  existsSync, symlinkSync, linkSync, renameSync, unlinkSync,
  readFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VIEWER_BIN = join(
  REPO_ROOT,
  "understand-anything-plugin",
  "packages",
  "viewer",
  "bin",
  "viewer.mjs",
);
const VIEWER_DIST = join(REPO_ROOT, "understand-anything-plugin", "packages", "viewer", "dist");

function removeLinkIfPresent(target) {
  try {
    unlinkSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function fixtureGraph(gitCommitHash) {
  return {
    version: "1.0.0",
    project: {
      name: "fixture", languages: ["ts"], frameworks: [], description: "d",
      analyzedAt: "2026-07-17T00:00:00.000Z", gitCommitHash,
    },
    nodes: [
      {
        id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts",
        summary: "s", tags: [], complexity: "simple",
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

function git(projectRoot, ...args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();
}

function setupProject(dataDirName) {
  const root = mkdtempSync(join(tmpdir(), "ua-viewer-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "secret.txt"), "not in graph\n");
  git(root, "init");
  git(root, "config", "user.email", "viewer-tests@example.com");
  git(root, "config", "user.name", "Viewer Tests");
  git(root, "add", "--all");
  git(root, "commit", "-m", "baseline");

  const dataDir = join(root, dataDirName);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "knowledge-graph.json"),
    JSON.stringify(fixtureGraph(git(root, "rev-parse", "HEAD"))),
  );
  return root;
}

/** Start the viewer and wait for the printed URL. Returns { proc, url, token, port }. */
function startViewer(projectRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(
      process.execPath,
      [VIEWER_BIN, projectRoot, "--no-open", "--port", "0"],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    const timer = setTimeout(() => {
      proc.kill();
      rejectPromise(new Error(`viewer did not start.\n${out}`));
    }, 10_000);
    const onData = (chunk) => {
      out += String(chunk);
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/#token=([a-f0-9]{64})/);
      if (m) {
        clearTimeout(timer);
        resolvePromise({ proc, url: m[0], port: Number(m[1]), token: m[2] });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      rejectPromise(new Error(`viewer exited with ${code}.\n${out}`));
    });
  });
}

describe.skipIf(!existsSync(VIEWER_DIST))("understand-anything-viewer", () => {
  let root;
  let viewer;

  beforeAll(async () => {
    root = setupProject(".ua");
    viewer = await startViewer(root);
  }, 15_000);

  afterAll(() => {
    viewer?.proc.kill();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const base = () => `http://127.0.0.1:${viewer.port}`;

  it("serves the embedded dashboard index", async () => {
    const res = await fetch(`${base()}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<!doctype html>");
  });



  it("enforces a restrictive Content Security Policy", async () => {
    const res = await fetch(`${base()}/`);
    const csp = res.headers.get("content-security-policy");

    expect(res.status).toBe(200);
    expect(csp).not.toBeNull();

    const directives = Object.fromEntries(
      csp.split(";").map(directive => {
        const [name, ...values] = directive.trim().split(/ +/);
        return [name, values];
      }),
    );

    expect(directives).toEqual({
      "default-src": ["'none'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "font-src": ["'self'"],
      "connect-src": ["'self'"],
      "worker-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
    });

    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("preserves CSP on unauthorized responses", async () => {
    const res = await fetch(`${base()}/knowledge-graph.json`);

    expect(res.status).toBe(403);
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("rejects untrusted Host headers", async () => {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: viewer.port,
          path: "/",
          method: "GET",
          headers: {
            Host: "untrusted.example",
          },
          agent: false,
        },
        (res) => {
          let body = "";

          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("error", rejectPromise);
          res.on("end", () => {
            resolvePromise({
              status: res.statusCode,
              body,
            });
          });
        },
      );

      req.setTimeout(5000, () => {
        req.destroy(new Error("HTTP request timed out"));
      });

      req.on("error", rejectPromise);
      req.end();
    });

    expect(result.status).toBe(403);
    expect(JSON.parse(result.body)).toEqual({
      error: "Invalid Host header",
    });
  });

  it.each(["POST", "PUT", "DELETE", "OPTIONS", "HEAD"])(
    "rejects unsupported HTTP method %s",
    async (method) => {
      const res = await fetch(`${base()}/`, { method });

      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    },
  );

  it("sets defensive HTTP response headers", async () => {
    const res = await fetch(`${base()}/`);

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
  });


  it.each(["symlink", "hardlink"])(
    "rejects knowledge graphs redirected through %s",
    async (mode) => {
      const outside = mkdtempSync(join(tmpdir(), "ua-graph-outside-"));
      const external = join(outside, "graph.json");
      const graph = join(root, ".ua", "knowledge-graph.json");
      const backup = graph + ".backup";

      const payload = fixtureGraph(git(root, "rev-parse", "HEAD"));
      payload.project.description = "CONFIDENTIAL_EXTERNAL_GRAPH";

      writeFileSync(external, JSON.stringify(payload));
      renameSync(graph, backup);

      try {
        if (mode === "symlink") {
          symlinkSync(external, graph, "file");
        } else {
          linkSync(external, graph);
        }

        const res = await fetch(
          `${base()}/knowledge-graph.json`, { headers: { Authorization: `Bearer ${viewer.token}` } },
        );

        expect(res.status).toBe(500);
        expect(await res.text()).not.toContain(
          "CONFIDENTIAL_EXTERNAL_GRAPH",
        );

        const health = await fetch(`${base()}/`);
        expect(health.status).toBe(200);
      } finally {
        rmSync(graph, { force: true });
        renameSync(backup, graph);
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("rejects oversized knowledge graphs without crashing", async () => {
    const graph = join(root, ".ua", "knowledge-graph.json");
    const backup = graph + ".backup";

    renameSync(graph, backup);

    try {
      const payload = fixtureGraph(git(root, "rev-parse", "HEAD"));
      payload.project.description = "x".repeat(32 * 1024 * 1024);

      writeFileSync(graph, JSON.stringify(payload));

      const res = await fetch(
        `${base()}/knowledge-graph.json`, { headers: { Authorization: `Bearer ${viewer.token}` } },
      );

      expect(res.status).toBe(500);

      const health = await fetch(`${base()}/`);
      expect(health.status).toBe(200);
    } finally {
      rmSync(graph, { force: true });
      renameSync(backup, graph);
    }
  });


  it("rejects a redirected project data directory", async () => {
    const outside = mkdtempSync(join(tmpdir(), "ua-data-outside-"));
    const dataDir = join(root, ".ua");
    const backup = dataDir + ".backup";

    const payload = fixtureGraph(git(root, "rev-parse", "HEAD"));
    payload.project.description = "CONFIDENTIAL_EXTERNAL_DATA";

    writeFileSync(
      join(outside, "knowledge-graph.json"),
      JSON.stringify(payload),
    );

    renameSync(dataDir, backup);

    try {
      symlinkSync(
        outside,
        dataDir,
        process.platform === "win32" ? "junction" : "dir",
      );

      const res = await fetch(
        `${base()}/knowledge-graph.json`, { headers: { Authorization: `Bearer ${viewer.token}` } },
      );

      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain(
        "CONFIDENTIAL_EXTERNAL_DATA",
      );

      const health = await fetch(`${base()}/`);
      expect(health.status).toBe(200);
    } finally {
      removeLinkIfPresent(dataDir);
      renameSync(backup, dataDir);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("survives a malformed knowledge graph", async () => {
    const graph = join(root, ".ua", "knowledge-graph.json");
    const backup = graph + ".backup";

    renameSync(graph, backup);

    try {
      writeFileSync(graph, "{invalid-json");

      const res = await fetch(
        `${base()}/knowledge-graph.json`, { headers: { Authorization: `Bearer ${viewer.token}` } },
      );

      expect(res.status).toBe(500);

      const health = await fetch(`${base()}/`);
      expect(health.status).toBe(200);
    } finally {
      rmSync(graph, { force: true });
      renameSync(backup, graph);
    }
  });


  it("rejects valid tokens supplied through query parameters", async () => {
    const res = await fetch(
      `${base()}/knowledge-graph.json?token=${viewer.token}`,
    );

    expect(res.status).toBe(403);
  });

  it.each([
    "wrong-token",
    "a".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
  ])("rejects invalid Bearer credentials: %s", async (token) => {
    const res = await fetch(
      `${base()}/knowledge-graph.json`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status).toBe(403);
  });

  it("rejects unsupported authorization schemes", async () => {
    const res = await fetch(
      `${base()}/knowledge-graph.json`,
      { headers: { Authorization: `Basic ${viewer.token}` } },
    );

    expect(res.status).toBe(403);
  });

  it("generates a 256-bit hexadecimal access token", () => {
    expect(viewer.token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects data requests without the token", async () => {
    const res = await fetch(`${base()}/knowledge-graph.json`);
    expect(res.status).toBe(403);
  });

  it("serves the graph from .ua/ with a valid token", async () => {
    const res = await fetch(`${base()}/knowledge-graph.json`, { headers: { Authorization: `Bearer ${viewer.token}` } });
    expect(res.status).toBe(200);
    const graph = await res.json();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].filePath).toBe("src/a.ts");
  });

  it("serves a protected no-store freshness report", async () => {
    const denied = await fetch(`${base()}/staleness.json`);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");

    const res = await fetch(
      `${base()}/staleness.json`, { headers: { Authorization: `Bearer ${viewer.token}` } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      graphs: {
        knowledge: {
          status: "fresh",
          graphCommitHash: git(root, "rev-parse", "HEAD"),
          headCommitHash: git(root, "rev-parse", "HEAD"),
        },
      },
    });
  });

  it("serves file content only for files listed in the graph", async () => {
    const ok = await fetch(
      `${base()}/file-content.json?path=${encodeURIComponent("src/a.ts")}`, { headers: { Authorization: `Bearer ${viewer.token}` } },
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.content).toContain("export const a");
    expect(body.language).toBe("typescript");

    const denied = await fetch(
      `${base()}/file-content.json?path=secret.txt`, { headers: { Authorization: `Bearer ${viewer.token}` } },
    );
    expect(denied.status).toBe(404);
  });


  it.each(["symlink", "hardlink"])(
    "rejects graph-listed source files redirected through %s",
    async (mode) => {
      const outside = mkdtempSync(join(tmpdir(), "ua-outside-"));
      const secret = join(outside, "secret.ts");
      const source = join(root, "src", "a.ts");
      const backup = source + ".backup";

      writeFileSync(secret, "CONFIDENTIAL_EXTERNAL_DATA");
      renameSync(source, backup);

      try {
        if (mode === "symlink") {
          symlinkSync(secret, source, "file");
        } else {
          linkSync(secret, source);
        }

        const res = await fetch(
          `${base()}/file-content.json?path=src/a.ts`, { headers: { Authorization: `Bearer ${viewer.token}` } },
        );

        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain(
          "CONFIDENTIAL_EXTERNAL_DATA",
        );
      } finally {
        rmSync(source, { force: true });
        renameSync(backup, source);
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("rejects oversized source files", async () => {
    const source = join(root, "src", "a.ts");
    const backup = source + ".backup";

    renameSync(source, backup);

    try {
      writeFileSync(source, Buffer.alloc(1024 * 1024 + 1, 65));

      const res = await fetch(
        `${base()}/file-content.json?path=src/a.ts`, { headers: { Authorization: `Bearer ${viewer.token}` } },
      );

      expect(res.status).toBe(413);
    } finally {
      rmSync(source, { force: true });
      renameSync(backup, source);
    }
  });

  it("rejects path traversal in file-content", async () => {
    const res = await fetch(
      `${base()}/file-content.json?path=${encodeURIComponent("../outside.txt")}`, { headers: { Authorization: `Bearer ${viewer.token}` } },
    );
    expect(res.status).toBe(400);
  });


  it.each(["symlink", "hardlink"])(
    "rejects static files redirected through %s",
    async (mode) => {
      const outside = mkdtempSync(
        join(VIEWER_DIST, "../ua-static-security-"),
      );

      const secret = join(outside, "secret.txt");
      const filename = `${outside.split(/[/\\\\]/).at(-1)}.txt`;
      const target = join(VIEWER_DIST, filename);

      writeFileSync(secret, "CONFIDENTIAL_STATIC_DATA");

      try {
        if (mode === "symlink") {
          symlinkSync(secret, target, "file");
        } else {
          linkSync(secret, target);
        }

        const res = await fetch(`${base()}/${filename}`);

        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain(
          "CONFIDENTIAL_STATIC_DATA",
        );

        const health = await fetch(`${base()}/`);
        expect(health.status).toBe(200);
      } finally {
        removeLinkIfPresent(target);
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("blocks static requests escaping dist/", async () => {
    const res = await fetch(`${base()}/%2e%2e/package.json`);
    expect([403, 404]).toContain(res.status);
  });

  it("serves code lessons from the data directory", async () => {
    // Absent file → 404; the dashboard renders the viewer without lessons.
    const missing = await fetch(`${base()}/code-lessons.json`, { headers: { Authorization: `Bearer ${viewer.token}` } });
    expect(missing.status).toBe(404);

    const lessons = {
      version: 1,
      generatedAt: "2026-10-22T00:00:00.000Z",
      files: {
        "src/a.ts": {
          overview: "Entry fixture.",
          sections: [
            { title: "The export", lineRange: [1, 1], explanation: "Declares a.", tourOrder: 1 },
          ],
        },
      },
    };
    writeFileSync(join(root, ".ua", "code-lessons.json"), JSON.stringify(lessons));

    const denied = await fetch(`${base()}/code-lessons.json`);
    expect(denied.status).toBe(403);

    const res = await fetch(`${base()}/code-lessons.json`, { headers: { Authorization: `Bearer ${viewer.token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files["src/a.ts"].overview).toBe("Entry fixture.");
    expect(body.files["src/a.ts"].sections[0].lineRange).toEqual([1, 1]);

    rmSync(join(root, ".ua", "code-lessons.json"));
  });

  it("falls back to legacy .understand-anything/ projects", async () => {
    const legacyRoot = setupProject(".understand-anything");
    const legacyViewer = await startViewer(legacyRoot);
    try {
      const res = await fetch(
        `http://127.0.0.1:${legacyViewer.port}/knowledge-graph.json`, { headers: { Authorization: `Bearer ${legacyViewer.token}` } },
      );
      expect(res.status).toBe(200);
      expect((await res.json()).nodes).toHaveLength(1);
    } finally {
      legacyViewer.proc.kill();
      rmSync(legacyRoot, { recursive: true, force: true });
    }
  }, 15_000);
});

/** Hold a loopback port; resolves null if something else already holds it. */
function occupyPort(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(null));
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

describe.skipIf(!existsSync(VIEWER_DIST))("understand-anything-viewer port fallback", () => {
  it("announces the dashboard once after skipping busy ports", async () => {
    const root = setupProject(".ua");
    // Hold the default port and the next one so the viewer has to retry twice.
    const blockers = await Promise.all([5173, 5174].map(occupyPort));
    const proc = spawn(process.execPath, [VIEWER_BIN, root, "--no-open"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const out = await new Promise((resolvePromise, rejectPromise) => {
        let text = "";
        const timer = setTimeout(() => {
          rejectPromise(new Error(`viewer did not start.\n${text}`));
        }, 10_000);
        const onData = (chunk) => {
          text += String(chunk);
          if (text.includes("Dashboard URL")) {
            clearTimeout(timer);
            // Every 'listening' callback fires in the same tick; give the pipe a moment.
            setTimeout(() => resolvePromise(text), 500);
          }
        };
        proc.stdout.on("data", onData);
        proc.stderr.on("data", onData);
      });
      expect(out.match(/Dashboard URL/g)).toHaveLength(1);
      const ports = [...out.matchAll(/127\.0\.0\.1:(\d+)\//g)].map((m) => Number(m[1]));
      expect(ports).toHaveLength(1);
      expect(ports[0]).toBeGreaterThan(5174);
    } finally {
      proc.kill();
      for (const blocker of blockers) blocker?.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});


describe.skipIf(
  process.platform !== "linux" || !existsSync(VIEWER_DIST),
)("private viewer credential isolation", () => {
  it("delivers credentials to the browser without printing them", async () => {
    const root = setupProject(".ua");
    const fakeBin = join(root, "fake-bin");
    const capture = join(root, "browser-url.txt");

    mkdirSync(fakeBin);

    writeFileSync(
      join(fakeBin, "xdg-open"),
      '#!/bin/sh\nprintf "%s" "$1" > "$UA_TEST_CAPTURE"\n',
      { mode: 0o700 },
    );

    const proc = spawn(
      process.execPath,
      [VIEWER_BIN, root, "--private", "--port", "0"],
      {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          UA_TEST_CAPTURE: capture,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", chunk => {
      stdout += String(chunk);
    });

    proc.stderr.on("data", chunk => {
      stderr += String(chunk);
    });

    const closed = new Promise(resolve => {
      proc.once("close", resolve);
    });

    try {
      await expect.poll(
        () => existsSync(capture),
        { timeout: 5000 },
      ).toBe(true);

      const browserUrl = new URL(
        readFileSync(capture, "utf8"),
      );

      const token = new URLSearchParams(
        browserUrl.hash.slice(1),
      ).get("token");

      expect(token).toMatch(/^[a-f0-9]{64}$/);

      await expect.poll(
        () => stdout.includes("Dashboard ready:"),
      ).toBe(true);

      expect(stdout).not.toContain(token);
      expect(stderr).not.toContain(token);
      expect(stdout).not.toContain("#token=");

      expect(browserUrl.hostname).toBe("127.0.0.1");

      const endpoint =
        `${browserUrl.origin}/knowledge-graph.json`;

      const denied = await fetch(endpoint);
      expect(denied.status).toBe(403);

      const allowed = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(allowed.status).toBe(200);
    } finally {
      proc.kill();
      await closed;
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});

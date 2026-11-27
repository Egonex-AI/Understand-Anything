import {
  describe, it, expect, beforeAll, afterAll,
} from "vitest";

import {
  mkdtempSync, mkdirSync, rmSync,
  writeFileSync, readFileSync, existsSync,
} from "node:fs";

import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const MCP_ROOT = resolve(
  "understand-anything-plugin/packages/mcp",
);

const SERVER = join(
  MCP_ROOT,
  "bin/understand-anything-mcp.mjs",
);

const VIEWER_DIST = resolve(
  "understand-anything-plugin/packages/viewer/dist/index.html",
);

const require = createRequire(
  join(MCP_ROOT, "package.json"),
);

const { Client } = require(
  "@modelcontextprotocol/sdk/client/index.js",
);

const { StdioClientTransport } = require(
  "@modelcontextprotocol/sdk/client/stdio.js",
);

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

describe.skipIf(
  process.platform !== "linux" || !existsSync(VIEWER_DIST),
)("MCP dashboard security", () => {
  let sandbox;
  let client;
  let capture;
  let fakeBin;
  let closed = false;

  const urls = new Set();

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), "ua-mcp-dashboard-"));
    fakeBin = join(sandbox, "bin");
    capture = join(sandbox, "browser-urls.txt");

    mkdirSync(fakeBin);

    writeFileSync(
      join(fakeBin, "xdg-open"),
      '#!/bin/sh\nprintf "%s\\n" "$1" >> "$UA_TEST_CAPTURE"\n',
      { mode: 0o700 },
    );

    for (let i = 0; i < 5; i++) {
      const root = join(sandbox, `project-${i}`);
      mkdirSync(join(root, ".ua"), { recursive: true });

      writeFileSync(
        join(root, ".ua", "knowledge-graph.json"),
        JSON.stringify(fixtureGraph("a".repeat(40))),
      );
    }

    client = new Client({
      name: "dashboard-security-tests",
      version: "1.0.0",
    });

    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      cwd: sandbox,
      env: {
        ...process.env,
        UNDERSTAND_PROJECT_ROOT: sandbox,
        PATH: `${fakeBin}:${process.env.PATH}`,
        UA_TEST_CAPTURE: capture,
      },
      stderr: "pipe",
    }));
  }, 15000);

  afterAll(async () => {
    try {
      if (!closed) await client?.close();
    } finally {
      if (sandbox) {
        rmSync(sandbox, { recursive: true, force: true });
      }
    }
  });

  function launch(projectPath) {
    return client.callTool({
      name: "understand_dashboard",
      arguments: { projectPath },
    });
  }

  function extractUrl(result) {
    expect(
      result.isError,
      JSON.stringify(result.content),
    ).not.toBe(true);

    const output = result.content[0].text;
    const match = output.match(
      /Dashboard is running at (http\S+)/,
    );

    expect(match).not.toBeNull();

    const url = new URL(match[1]);

    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/");
    expect(url.hash).toBe("");
    expect(url.search).toBe("");

    urls.add(url.href);

    return url.href;
  }

  function capturedUrls() {
    if (!existsSync(capture)) return [];

    return readFileSync(capture, "utf8")
      .split("\n")
      .filter(Boolean);
  }

  it("deduplicates concurrent launches", async () => {
    const results = await Promise.all([
      launch("project-0"),
      launch("project-0"),
      launch("project-0"),
    ]);

    const addresses = results.map(extractUrl);

    expect(new Set(addresses).size).toBe(1);

    await expect.poll(
      () => capturedUrls().length,
    ).toBe(1);

    const browserUrl = new URL(capturedUrls()[0]);

    const token = new URLSearchParams(
      browserUrl.hash.slice(1),
    ).get("token");

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(browserUrl.origin + "/").toBe(addresses[0]);

    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(token);
    }
  }, 20000);

  it("reuses the existing viewer", async () => {
    const result = await launch("project-0");

    expect(extractUrl(result)).toBe([...urls][0]);
    expect(capturedUrls()).toHaveLength(1);
  });

  it("rejects sessions exceeding the resource limit", async () => {
    for (let i = 1; i < 4; i++) {
      extractUrl(await launch(`project-${i}`));
    }

    expect(urls.size).toBe(4);

    const denied = await launch("project-4");

    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain(
      "Dashboard session limit reached",
    );

    await expect.poll(
      () => capturedUrls().length,
    ).toBe(4);
  }, 60000);

  it("protects all running dashboard endpoints", async () => {
    expect(urls.size).toBe(4);
    for (const address of urls) {
      const response = await fetch(
        new URL("knowledge-graph.json", address),
      );

      expect(response.status).toBe(403);
    }
  });

  it("stops all viewers when MCP disconnects", async () => {
    expect(urls.size).toBe(4);
    await client.close();
    closed = true;

    await expect.poll(async () => {
      const running = await Promise.all(
        [...urls].map(async address => {
          try {
            await fetch(address, {
              signal: AbortSignal.timeout(1000),
            });

            return true;
          } catch {
            return false;
          }
        }),
      );

      return running.some(Boolean);
    }, { timeout: 10000 }).toBe(false);
  }, 15000);
});

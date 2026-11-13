// Regression test for Copilot review #753 finding #6:
// "Resolve lessons beside the selected graph" — /code-lessons.json must be
// served from the directory of the *selected* knowledge-graph.json (single
// candidate, matching the standalone viewer), never from the fallback roots
// (cwd, cwd/../../..) where another project's sidecar may live.
import fs from "node:fs";
import {
  createServer,
  request as httpRequest,
  type Server,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataEndpointsMiddleware } from "../../vite.config";

let servers: Server[] = [];
let originalGraphDir: string | undefined;
let originalCwd: string;
let projectA: string; // selected via GRAPH_DIR
let projectB: string; // fallback cwd root — carries rogue lessons

function writeProjectFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

async function startServer(accessToken: string): Promise<string> {
  const middleware = createDataEndpointsMiddleware(accessToken);
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function requestJson(
  baseUrl: string,
  requestPath: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}${requestPath}`, { agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.once("error", reject);
    request.end();
  });
}

beforeEach(() => {
  servers = [];
  originalGraphDir = process.env.GRAPH_DIR;
  originalCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ua-lessons-scope-"));
  projectA = path.join(tempRoot, "project-a");
  projectB = path.join(tempRoot, "project-b");
  fs.mkdirSync(projectB, { recursive: true });
  process.env.GRAPH_DIR = projectA;
  process.chdir(projectB);
});

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
  process.env.GRAPH_DIR = originalGraphDir;
  process.chdir(originalCwd);
});

describe("dashboard /code-lessons.json project scoping", () => {
  it("returns 404 when the selected project has no lessons (no cross-project leak)", async () => {
    // Project A: graph present, lessons absent. Project B (the cwd fallback
    // root) carries lessons with a rogue marker.
    writeProjectFile(
      projectA,
      ".ua/knowledge-graph.json",
      JSON.stringify({ project: { gitCommitHash: "a".repeat(40) }, nodes: [], edges: [] }),
    );
    writeProjectFile(
      projectB,
      ".ua/code-lessons.json",
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        files: { "other.ts": { overview: "ROGUE LESSONS FROM PROJECT B", sections: [] } },
      }),
    );

    const baseUrl = await startServer("test-token");
    const result = await requestJson(baseUrl, "/code-lessons.json?token=test-token");
    expect(result.status).toBe(404);
    expect(result.body).not.toContain("ROGUE");
  });

  it("serves lessons from beside the selected graph when present", async () => {
    writeProjectFile(
      projectA,
      ".ua/knowledge-graph.json",
      JSON.stringify({ project: { gitCommitHash: "a".repeat(40) }, nodes: [], edges: [] }),
    );
    writeProjectFile(
      projectA,
      ".ua/code-lessons.json",
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        files: { "a.ts": { overview: "PROJECT A LESSONS", sections: [] } },
      }),
    );
    writeProjectFile(
      projectB,
      ".ua/code-lessons.json",
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        files: { "b.ts": { overview: "ROGUE LESSONS FROM PROJECT B", sections: [] } },
      }),
    );

    const baseUrl = await startServer("test-token");
    const result = await requestJson(baseUrl, "/code-lessons.json?token=test-token");
    expect(result.status).toBe(200);
    expect(result.body).toContain("PROJECT A LESSONS");
    expect(result.body).not.toContain("ROGUE");
  });
});

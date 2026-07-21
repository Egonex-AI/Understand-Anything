import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  createServer,
  request as httpRequest,
  type Server,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardDataMiddleware } from "../../vite.config";
import { isDashboardFreshnessReport } from "../freshness";

interface HttpResult {
  status: number;
  body: unknown;
  cacheControl: string | null;
}

let originalGraphDir: string | undefined;
let tempProject: string;
let baselineCommit: string;
const servers: Server[] = [];

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: tempProject,
    encoding: "utf8",
  }).trim();
}

function writeProjectFile(relativePath: string, contents: string): void {
  const filePath = path.join(tempProject, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function commitAll(message: string): string {
  git("add", "--all");
  git("commit", "-m", message);
  return git("rev-parse", "HEAD");
}

function graphDirectory(dataDir = ".understand-anything"): string {
  const directory = path.join(tempProject, dataDir);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function writeGraph(
  fileName: "knowledge-graph.json" | "domain-graph.json",
  commitHash: string,
  dataDir = ".understand-anything",
): void {
  fs.writeFileSync(
    path.join(graphDirectory(dataDir), fileName),
    JSON.stringify({
      project: {
        gitCommitHash: commitHash,
        analyzedAt: "2026-07-10T00:00:00.000Z",
      },
      nodes: [],
      edges: [],
    }),
    "utf8",
  );
}

async function startDashboardServer(accessToken: string): Promise<string> {
  const middleware = createDashboardDataMiddleware(accessToken);
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
    throw new Error("Dashboard test server did not expose a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function requestJson(baseUrl: string, requestPath: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${baseUrl}${requestPath}`,
      { agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            body: text.length > 0 ? JSON.parse(text) : null,
            cacheControl: response.headers["cache-control"] ?? null,
          });
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

beforeEach(() => {
  originalGraphDir = process.env.GRAPH_DIR;
  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "ua-dashboard-"));
  process.env.GRAPH_DIR = tempProject;

  git("init");
  git("config", "user.email", "dashboard-tests@example.com");
  git("config", "user.name", "Dashboard Tests");
  writeProjectFile("src/index.ts", "export const value = 1;\n");
  baselineCommit = commitAll("baseline");
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (originalGraphDir === undefined) {
    delete process.env.GRAPH_DIR;
  } else {
    process.env.GRAPH_DIR = originalGraphDir;
  }
  fs.rmSync(tempProject, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});

describe(
  "dashboard graph freshness endpoint",
  { timeout: 15_000 },
  () => {
    it("rejects an unauthorized request before serving freshness data", async () => {
      writeGraph("knowledge-graph.json", baselineCommit);
      const baseUrl = await startDashboardServer("test-token");

      await expect(requestJson(baseUrl, "/staleness.json")).resolves.toEqual({
        status: 403,
        body: { error: "Forbidden: missing or invalid token" },
        cacheControl: "no-store",
      });
    });

    it.each([".understand-anything", ".ua"])(
      "serves a knowledge-only report from %s to an authorized request",
      async (dataDir) => {
        writeGraph("knowledge-graph.json", baselineCommit, dataDir);
        const baseUrl = await startDashboardServer("test-token");

        const response = await requestJson(
          baseUrl,
          "/staleness.json?token=test-token",
        );

        expect(response.status).toBe(200);
        expect(response.cacheControl).toBe("no-store");
        expect(isDashboardFreshnessReport(response.body)).toBe(true);
        expect(response.body).toMatchObject({
          graphs: {
            knowledge: {
              status: "fresh",
              graphCommitHash: baselineCommit,
              headCommitHash: baselineCommit,
            },
          },
        });
        expect(
          (response.body as { graphs: Record<string, unknown> }).graphs,
        ).not.toHaveProperty("domain");
      },
    );

    it("reports knowledge and domain graph freshness independently", async () => {
      writeProjectFile("src/index.ts", "export const value = 2;\n");
      const headCommit = commitAll("project change");
      writeGraph("knowledge-graph.json", headCommit);
      writeGraph("domain-graph.json", baselineCommit);
      const baseUrl = await startDashboardServer("test-token");

      const response = await requestJson(
        baseUrl,
        "/staleness.json?token=test-token",
      );
      expect(isDashboardFreshnessReport(response.body)).toBe(true);
      expect(response).toMatchObject({
        status: 200,
        body: {
          graphs: {
            knowledge: {
              status: "fresh",
              graphCommitHash: headCommit,
            },
            domain: {
              status: "stale",
              relation: "behind",
              graphCommitHash: baselineCommit,
              headCommitHash: headCommit,
              commitsBehind: 1,
              changedFiles: ["src/index.ts"],
            },
          },
        },
      });
    });

    it("returns 404 when the required knowledge graph is missing", async () => {
      const baseUrl = await startDashboardServer("test-token");

      await expect(
        requestJson(baseUrl, "/staleness.json?token=test-token"),
      ).resolves.toEqual({
        status: 404,
        body: { error: "No knowledge graph found. Run /understand first." },
        cacheControl: "no-store",
      });
    });

    it("returns a safe 500 response for invalid knowledge graph JSON", async () => {
      fs.writeFileSync(
        path.join(graphDirectory(), "knowledge-graph.json"),
        "{not-json",
        "utf8",
      );
      const baseUrl = await startDashboardServer("test-token");

      await expect(
        requestJson(baseUrl, "/staleness.json?token=test-token"),
      ).resolves.toEqual({
        status: 500,
        body: { error: "Failed to read graph file" },
        cacheControl: "no-store",
      });
    });

    it("returns a safe 500 response for invalid optional domain graph JSON", async () => {
      writeGraph("knowledge-graph.json", baselineCommit);
      fs.writeFileSync(
        path.join(graphDirectory(), "domain-graph.json"),
        "{not-json",
        "utf8",
      );
      const baseUrl = await startDashboardServer("test-token");

      await expect(
        requestJson(baseUrl, "/staleness.json?token=test-token"),
      ).resolves.toEqual({
        status: 500,
        body: { error: "Failed to read graph file" },
        cacheControl: "no-store",
      });
    });
  },
);

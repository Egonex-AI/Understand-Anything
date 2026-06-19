/**
 * Integration test for skills/understand-ollama/run-pipeline.mjs
 *
 * Boots a stub Ollama HTTP server (Node http.createServer), points the
 * driver at it via --ollama-url, runs the seven-phase pipeline against a
 * minimal fixture project, then asserts the produced knowledge graph
 * validates against the dashboard's Zod schema.
 *
 * No real Ollama required; this is the CI smoke test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "../../../understand-anything-plugin");
const SCRIPT = resolve(PLUGIN_ROOT, "skills/understand-ollama/run-pipeline.mjs");
const require = createRequire(import.meta.url);

function startStubOllama() {
  return new Promise((resolveServer) => {
    let count = 0;
    const server = http.createServer((req, res) => {
      count++;
      let body = "";
      req.on("data", (c) => (body += c.toString("utf-8")));
      req.on("end", () => {
        const url = req.url ?? "";
        if (url === "/api/version") {
          respond(res, 200, { version: "0.0.0-test" });
          return;
        }
        if (url === "/api/tags") {
          respond(res, 200, { models: [{ name: "stub-model" }] });
          return;
        }
        if (url === "/api/chat" && req.method === "POST") {
          const data = JSON.parse(body);
          const last = (data.messages && data.messages.length
            ? data.messages[data.messages.length - 1].content
            : "") ?? "";
          let payload;
          if (last.includes("File:") && last.includes("package.json")) {
            payload = {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  fileSummary: "package.json manifest",
                  tags: ["config"],
                  complexity: "simple",
                }),
              },
            };
          } else if (last.includes("File:") && last.includes("src/util.ts")) {
            payload = {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  fileSummary: "small utility module",
                  tags: ["utility"],
                  complexity: "simple",
                }),
              },
            };
          } else if (last.includes("architectural layers") || last.includes("layer")) {
            payload = {
              message: {
                role: "assistant",
                content: JSON.stringify([
                  { name: "lib", description: "library code", filePatterns: ["src/"] },
                ]),
              },
            };
          } else if (last.includes("guided tour")) {
            payload = {
              message: {
                role: "assistant",
                content: JSON.stringify([
                  { order: 1, title: "Entry", description: "Start here.", nodeIds: ["file:src/util.ts"] },
                ]),
              },
            };
          } else if (last.includes("project metadata")) {
            payload = {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  name: "stub-project",
                  description: "Test fixture.",
                  languages: ["TypeScript"],
                  frameworks: [],
                }),
              },
            };
          } else {
            payload = {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  fileSummary: "default",
                  tags: [],
                  complexity: "simple",
                }),
              },
            };
          }
          respond(res, 200, Object.assign(
            { model: "stub-model", done: true, prompt_eval_count: 10, eval_count: 5, total_duration: 1_000_000 },
            payload,
          ));
          return;
        }
        if (url === "/api/generate") {
          respond(res, 200, {
            model: "stub-model",
            response: JSON.stringify({ name: "stub-project", description: "Test" }),
            done: true,
          });
          return;
        }
        respond(res, 404, { error: "not found" });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("stub server failed to bind");
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolveServer({
        baseUrl,
        close: () => new Promise((res) => { server.close(() => res()); }),
        requestCount: () => count,
      });
    });
  });
}

function respond(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function setupFixture() {
  const root = mkdtempSync(join(tmpdir(), "ua-ollama-test-"));
  // git init so phase 6 can run git rev-parse
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["-C", root, "config", "user.email", "stub@test"]);
  spawnSync("git", ["-C", root, "config", "user.name", "stub"]);
  // Minimal TypeScript file
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/util.ts"),
    "export function add(a, b) { return a + b; }\n",
    "utf-8",
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "stub-project", version: "0.0.0", type: "module" }, null, 2),
    "utf-8",
  );
  // Build core dist if missing so the driver can import it
  const coreDist = join(PLUGIN_ROOT, "packages/core/dist/index.js");
  if (!existsSync(coreDist)) {
    spawnSync("pnpm", ["--filter", "@understand-anything/core", "build"], { cwd: PLUGIN_ROOT });
  }
  // Commit so git rev-parse HEAD returns a hash
  spawnSync("git", ["-C", root, "add", "-A"]);
  spawnSync("git", ["-C", root, "commit", "-q", "-m", "init"]);
  return root;
}

describe("run-pipeline.mjs end-to-end against stub Ollama", () => {
  let stub;
  let fixtureRoot;

  beforeAll(async () => {
    stub = await startStubOllama();
  });

  afterAll(async () => {
    if (stub) await stub.close();
  });

  beforeEach(() => {
    if (fixtureRoot && existsSync(fixtureRoot)) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
    fixtureRoot = setupFixture();
  });

  it("writes a schema-valid knowledge graph and meta.json", async () => {
    const proc = spawn("node", [
      SCRIPT,
      "--project-root", fixtureRoot,
      "--plugin-root", PLUGIN_ROOT,
      "--ollama-url", stub.baseUrl,
      "--model", "stub-model",
      "--language", "en",
    ], {
      cwd: PLUGIN_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString("utf-8")));
    const exitCode = await new Promise((res) => proc.on("exit", (c) => res(c ?? 0)));

    if (exitCode !== 0) {
      throw new Error(`pipeline exited non-zero. stderr:\n${stderr}`);
    }

    // knowledge graph exists
    const kgPath = join(fixtureRoot, ".understand-anything", "knowledge-graph.json");
    expect(existsSync(kgPath)).toBe(true);
    const kg = JSON.parse(readFileSync(kgPath, "utf-8"));

    // structural sanity
    expect(Array.isArray(kg.nodes)).toBe(true);
    expect(kg.nodes.length).toBeGreaterThan(0);
    expect(kg.project).toBeDefined();
    expect(kg.project.name).toBeTruthy();
    expect(kg.version).toBeTruthy();
    expect(kg.kind).toBeTruthy();

    // validate against the dashboard's Zod schema
    const core = require(`${PLUGIN_ROOT}/packages/core/dist/index.js`);
    const schema = core.knowledgeGraphSchema ?? core.KnowledgeGraphSchema;
    const result = schema.safeParse(kg);
    if (!result.success) {
      const issues = (result.error.issues ?? []).slice(0, 5);
      const lines = issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`schema validation failed:\n${lines}`);
    }

    // meta.json records the ollama model and url
    const metaPath = join(fixtureRoot, ".understand-anything", "meta.json");
    expect(existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.ollamaModel).toBe("stub-model");
    expect(meta.ollamaUrl).toBe(stub.baseUrl);
  }, 120_000);
});

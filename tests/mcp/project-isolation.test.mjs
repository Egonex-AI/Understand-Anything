import {
  describe, it, expect, beforeAll, afterAll,
} from "vitest";

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
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

const require = createRequire(
  join(MCP_ROOT, "package.json"),
);

const { Client } = require(
  "@modelcontextprotocol/sdk/client/index.js",
);

const { StdioClientTransport } = require(
  "@modelcontextprotocol/sdk/client/stdio.js",
);

describe("MCP project isolation", () => {
  let sandbox;
  let project;
  let outside;
  let client;

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), "ua-mcp-isolation-"));

    project = join(sandbox, "project");
    outside = join(sandbox, "project-secret");

    mkdirSync(project);
    mkdirSync(outside);
    mkdirSync(join(project, "internal"));

    writeFileSync(join(outside, "secret.txt"), "private");

    symlinkSync(
      outside,
      join(project, "redirect"),
      process.platform === "win32" ? "junction" : "dir",
    );

    client = new Client({
      name: "secure-isolation-tests",
      version: "1.0.0",
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      cwd: project,
      env: {
        ...process.env,
        UNDERSTAND_PROJECT_ROOT: project,
      },
      stderr: "pipe",
    });

    await client.connect(transport);
  }, 15_000);

  afterAll(async () => {
    try {
      await client?.close();
    } finally {
      if (sandbox) {
        rmSync(sandbox, { recursive: true, force: true });
      }
    }
  });

  async function status(projectPath) {
    return client.callTool({
      name: "understand_status",
      arguments:
        projectPath === undefined ? {} : { projectPath },
    });
  }

  it("preserves all six MCP tools", async () => {
    const result = await client.listTools();

    expect(result.tools.map(tool => tool.name).sort()).toEqual([
      "understand_dashboard",
      "understand_diff",
      "understand_explain",
      "understand_onboard",
      "understand_search",
      "understand_status",
    ]);
  });

  it("accepts the authorized default project", async () => {
    const result = await status();

    expect(JSON.stringify(result)).not.toContain(
      "Project path outside authorized root",
    );
  });

  it("accepts an internal subdirectory", async () => {
    const result = await status("internal");

    expect(JSON.stringify(result)).not.toContain(
      "Project path outside authorized root",
    );
  });

  it.each([
    "absolute",
    "traversal",
    "symlink",
  ])("rejects external access through %s", async (mode) => {
    const paths = {
      absolute: outside,
      traversal: "../project-secret",
      symlink: "redirect",
    };

    const result = await status(paths[mode]);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "Project path outside authorized root",
    );
  });

  const toolCases = [
    ["understand_status", {}],
    ["understand_search", { query: "authentication" }],
    ["understand_explain", { path: "source.ts" }],
    ["understand_diff", {}],
    ["understand_onboard", {}],
    ["understand_dashboard", {}],
  ];

  describe.each(toolCases)("%s isolation", (name, args) => {
    it.each([
      "absolute",
      "traversal",
      "symlink",
    ])("rejects external access through %s", async (mode) => {
      const paths = {
        absolute: outside,
        traversal: "../project-secret",
        symlink: "redirect",
      };

      const result = await client.callTool({
        name,
        arguments: {
          ...args,
          projectPath: paths[mode],
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Project path outside authorized root",
      );
    });
  });
});

#!/usr/bin/env node
/**
 * understand-anything-mcp — stdio MCP server exposing Understand Anything
 * knowledge graphs to any MCP-capable agent (Devin, Claude Code, Cursor…).
 *
 * Tools:
 *   understand_status     — graph presence, metadata, counts, freshness
 *   understand_search     — fuzzy search + 1-hop graph context (markdown)
 *   understand_explain    — deep-dive on a file or file:function (markdown)
 *   understand_diff       — impact analysis of current git changes (markdown)
 *   understand_onboard    — full onboarding guide (markdown)
 *   understand_dashboard  — launch the interactive dashboard, return the URL
 *
 * stdout is the JSON-RPC channel — diagnostics go to stderr only.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadGraph,
  loadConfig,
  resolveUaDir,
  getGraphFreshnessBatch,
} from "@understand-anything/core";
import {
  buildChatContext,
  formatContextForPrompt,
  buildDiffContext,
  formatDiffAnalysis,
  buildExplainContext,
  formatExplainPrompt,
  buildOnboardingGuide,
} from "@understand-anything/skill";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_BIN = path.resolve(__dirname, "../../viewer/bin/viewer.mjs");
const VIEWER_DIST = path.resolve(__dirname, "../../viewer/dist");
const VIEWER_STALENESS = path.resolve(
  __dirname,
  "../../viewer/bin/dist/staleness.js",
);
const DASHBOARD_TIMEOUT_MS = 15_000;
const { version: SERVER_VERSION } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
);

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveProjectRoot(projectPath) {
  const raw = projectPath ?? process.env.DEVIN_PROJECT_DIR ?? process.cwd();
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project directory not found: ${resolved}`);
  }
  // Canonicalise symlinks (e.g. macOS /tmp → /private/tmp) so paths line up
  // with git's physical --show-toplevel when stripping repo prefixes.
  return fs.realpathSync(resolved);
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(message) {
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}

/**
 * Load the project's knowledge graph or return an MCP error result for the
 * caller to pass through.
 */
function requireGraph(root) {
  let graph;
  try {
    graph = loadGraph(root);
  } catch (err) {
    return {
      error: errorResult(
        `Failed to load knowledge graph for ${root}: ${err.message}`,
      ),
    };
  }
  if (!graph) {
    return {
      error: errorResult(
        `No knowledge graph found at ${path.join(resolveUaDir(root), "knowledge-graph.json")}.\n` +
          "Run Understand Anything's /understand analysis on this project first, " +
          "then call this tool again.",
      ),
    };
  }
  return { graph };
}

async function freshnessSummary(root, graph) {
  try {
    const results = await getGraphFreshnessBatch(root, {
      knowledge: {
        graphCommitHash: graph.project.gitCommitHash,
        lastAnalyzedAt: graph.project.analyzedAt,
      },
    });
    const r = results.knowledge;
    if (r.status === "fresh") return "fresh";
    if (r.status === "dirty" || r.status === "stale") {
      const files = r.changedFiles.slice(0, 10);
      const more =
        r.changedFileCount > files.length
          ? ` (+${r.changedFileCount - files.length} more)`
          : "";
      const label =
        r.status === "dirty"
          ? "uncommitted change(s) since analysis"
          : "project file(s) changed since analysis";
      return (
        `${r.status} — ${r.changedFileCount} ${label}` +
        (files.length ? `: ${files.join(", ")}${more}` : "")
      );
    }
    return `unknown (${r.reason ?? "git metadata unavailable"})`;
  } catch {
    return "unknown (freshness check failed)";
  }
}

async function stalenessWarning(root, graph) {
  const summary = await freshnessSummary(root, graph);
  if (summary === "fresh") return "";
  return (
    `> **Graph freshness: ${summary}.** ` +
    "Graph-derived context may omit recent changes. " +
    "Re-run /understand to refresh.\n\n"
  );
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/**
 * Changed files relative to the project root (handles projects that live in
 * a subdirectory of a larger git worktree).
 */
function changedFiles(root, { staged, base }) {
  const gitRoot = git(root, ["rev-parse", "--show-toplevel"]);
  const prefix = path.relative(gitRoot, root); // "" when project is the repo root

  // Reject option-shaped refs: a leading "-" would make git parse the value
  // as a flag (e.g. --output=<file> writes the diff somewhere unexpected).
  // --end-of-options additionally stops revision parsing of flag-like input.
  if (base && (base.startsWith("-") || base.includes(".."))) {
    throw new Error(
      `Invalid base ref "${base}" — must be a plain ref like 'main' or 'HEAD~3' (no leading '-', and '...' is added by the tool).`,
    );
  }

  const diffArgs = base
    ? ["diff", "--name-only", "--end-of-options", `${base}...HEAD`]
    : staged
      ? ["diff", "--cached", "--name-only"]
      : ["diff", "HEAD", "--name-only"];

  let files = git(root, diffArgs).split("\n").filter(Boolean);
  if (!base && !staged) {
    const untracked = git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ])
      .split("\n")
      .filter(Boolean);
    files = [...files, ...untracked];
  }

  // Generated analysis artifacts are not project source drift (mirrors
  // core's PROJECT_PATHSPEC exclusions in staleness.ts).
  const isArtifact = (f) =>
    f === ".ua" ||
    f.startsWith(".ua/") ||
    f === ".understand-anything" ||
    f.startsWith(".understand-anything/");

  return [
    ...new Set(
      files
        .filter((f) => !prefix || f.startsWith(`${prefix}/`))
        .map((f) => (prefix ? f.slice(prefix.length + 1) : f))
        .filter((f) => !isArtifact(f)),
    ),
  ];
}

// ── Dashboard session management ──────────────────────────────────────────

/** @type {Map<string, { url: string, child: import("node:child_process").ChildProcess }>} */
const dashboards = new Map();

function startDashboard(root, port) {
  const key = `${root}::${port ?? "auto"}`;
  const existing = dashboards.get(key);
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return Promise.resolve(existing.url);
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [VIEWER_BIN, root, "--port", String(port ?? 0), "--no-open"],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectPromise(
        new Error(
          `Dashboard did not report a URL within ${DASHBOARD_TIMEOUT_MS / 1000}s.` +
            (stderr.trim() ? `\nViewer stderr:\n${stderr.trim()}` : ""),
        ),
      );
    }, DASHBOARD_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/Dashboard URL:\s*(\S+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        child.unref();
        dashboards.set(key, { url: match[1], child });
        resolvePromise(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("exit", (code) => {
      dashboards.delete(key);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(
        new Error(
          `Viewer exited (code ${code}) before reporting a URL.` +
            (stderr.trim() ? `\nViewer stderr:\n${stderr.trim()}` : "") +
            (stdout.trim() ? `\nViewer stdout:\n${stdout.trim()}` : ""),
        ),
      );
    });
  });
}

// ── MCP server ─────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "understand-anything", version: SERVER_VERSION },
  {
    instructions: [
      "Understand Anything tools answer questions about a codebase using its",
      "knowledge graph (.ua/knowledge-graph.json). Typical flow:",
      "1. understand_status — check a graph exists and whether it is fresh.",
      "2. understand_search / understand_explain / understand_diff /",
      "   understand_onboard — pull focused context for the task at hand.",
      "3. understand_dashboard — when the user wants the visual graph UI.",
      "If no graph exists, tell the user to run Understand Anything's",
      "/understand analysis first.",
    ].join(" "),
  },
);

const projectPathParam = z
  .string()
  .optional()
  .describe(
    "Project directory. Defaults to DEVIN_PROJECT_DIR or the server's working directory.",
  );

server.registerTool(
  "understand_status",
  {
    title: "Understand Anything: status",
    description:
      "Check whether a knowledge graph exists for a project, show its metadata " +
      "(name, description, languages, frameworks, analyzed commit), node/edge counts, " +
      "and whether it is stale relative to the current git state.",
    inputSchema: { projectPath: projectPathParam },
    annotations: { readOnlyHint: true },
  },
  async ({ projectPath }) => {
    try {
      const root = resolveProjectRoot(projectPath);
      const { graph, error } = requireGraph(root);
      if (error) return error;

      const config = loadConfig(root);
      const freshness = await freshnessSummary(root, graph);
      const counts = graph.nodes.reduce((acc, n) => {
        acc[n.type] = (acc[n.type] ?? 0) + 1;
        return acc;
      }, {});

      return textResult(
        [
          `# Understand Anything status: ${graph.project.name}`,
          "",
          `- **Project root:** ${root}`,
          `- **Graph:** ${path.join(resolveUaDir(root), "knowledge-graph.json")}`,
          `- **Description:** ${graph.project.description}`,
          `- **Languages:** ${graph.project.languages.join(", ") || "—"}`,
          `- **Frameworks:** ${graph.project.frameworks.join(", ") || "—"}`,
          `- **Analyzed at:** ${graph.project.analyzedAt} (commit ${graph.project.gitCommitHash ?? "?"})`,
          `- **Freshness:** ${freshness}`,
          `- **Size:** ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.layers.length} layers, ${graph.tour.length} tour steps`,
          `- **Node types:** ${Object.entries(counts).map(([t, c]) => `${t}: ${c}`).join(", ")}`,
          `- **Config:** autoUpdate=${config.autoUpdate}, outputLanguage=${config.outputLanguage}`,
        ].join("\n"),
      );
    } catch (err) {
      return errorResult(err.message);
    }
  },
);

server.registerTool(
  "understand_search",
  {
    title: "Understand Anything: search",
    description:
      "Search the project's knowledge graph for components relevant to a query " +
      "(names, summaries, tags), expanded to 1-hop neighbours with layers and " +
      "relationships. Returns markdown context for answering codebase questions.",
    inputSchema: {
      projectPath: projectPathParam,
      query: z
        .string()
        .min(1)
        .describe("What to look for, e.g. 'authentication flow' or 'database schema'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max seed nodes to match before 1-hop expansion (default 15)."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ projectPath, query, limit }) => {
    try {
      const root = resolveProjectRoot(projectPath);
      const { graph, error } = requireGraph(root);
      if (error) return error;

      const context = buildChatContext(graph, query, limit);
      const warning = await stalenessWarning(root, graph);
      return textResult(warning + formatContextForPrompt(context));
    } catch (err) {
      return errorResult(err.message);
    }
  },
);

server.registerTool(
  "understand_explain",
  {
    title: "Understand Anything: explain",
    description:
      "Deep-dive on one component: a file path ('src/auth.ts') or a specific " +
      "function ('src/auth.ts:login'). Returns its summary, complexity, layer, " +
      "children, connections, and relationships from the knowledge graph.",
    inputSchema: {
      projectPath: projectPathParam,
      path: z
        .string()
        .min(1)
        .describe("Project-relative file path, optionally suffixed with :functionName."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ projectPath, path: target }) => {
    try {
      const root = resolveProjectRoot(projectPath);
      const { graph, error } = requireGraph(root);
      if (error) return error;

      const context = buildExplainContext(graph, target);
      const warning = await stalenessWarning(root, graph);
      return textResult(warning + formatExplainPrompt(context));
    } catch (err) {
      return errorResult(err.message);
    }
  },
);

server.registerTool(
  "understand_diff",
  {
    title: "Understand Anything: diff impact",
    description:
      "Map the current git changes onto the knowledge graph: which components " +
      "changed, what they affect downstream, impacted layers, and a risk " +
      "assessment. Defaults to working tree + staged changes; pass staged=true " +
      "for the index only, or base='<ref>' to diff a ref against HEAD.",
    inputSchema: {
      projectPath: projectPathParam,
      staged: z
        .boolean()
        .optional()
        .describe("Analyze staged changes only (default: working tree + staged + untracked)."),
      base: z
        .string()
        .optional()
        .describe("Git ref to compare against HEAD, e.g. 'main' or 'HEAD~3'."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ projectPath, staged, base }) => {
    try {
      const root = resolveProjectRoot(projectPath);
      const { graph, error } = requireGraph(root);
      if (error) return error;

      let files;
      try {
        files = changedFiles(root, { staged, base });
      } catch (err) {
        return errorResult(
          `Could not compute git changes in ${root}: ${err.message}`,
        );
      }
      if (files.length === 0) {
        return textResult(
          "No changed files found. The working tree matches the compared revision.",
        );
      }

      const context = buildDiffContext(graph, files);
      const warning = await stalenessWarning(root, graph);
      return textResult(warning + formatDiffAnalysis(context));
    } catch (err) {
      return errorResult(err.message);
    }
  },
);

server.registerTool(
  "understand_onboard",
  {
    title: "Understand Anything: onboarding guide",
    description:
      "Generate a standalone markdown onboarding guide from the knowledge graph: " +
      "project overview, architectural layers, key concepts, guided tour, file map, " +
      "and complexity hotspots.",
    inputSchema: { projectPath: projectPathParam },
    annotations: { readOnlyHint: true },
  },
  async ({ projectPath }) => {
    try {
      const root = resolveProjectRoot(projectPath);
      const { graph, error } = requireGraph(root);
      if (error) return error;

      const warning = await stalenessWarning(root, graph);
      return textResult(warning + buildOnboardingGuide(graph));
    } catch (err) {
      return errorResult(err.message);
    }
  },
);

server.registerTool(
  "understand_dashboard",
  {
    title: "Understand Anything: dashboard",
    description:
      "Launch the interactive knowledge-graph dashboard for a project and return " +
      "its access-token URL. The server keeps running in the background; reuse it " +
      "for the rest of the session. Share the full URL (including ?token=) with the user.",
    inputSchema: {
      projectPath: projectPathParam,
      port: z
        .number()
        .int()
        .min(0)
        .max(65535)
        .optional()
        .describe("Port to bind on 127.0.0.1 (default: OS-assigned free port)."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ projectPath, port }) => {
    try {
      const root = resolveProjectRoot(projectPath);
      const { error } = requireGraph(root);
      if (error) return error;

      if (!fs.existsSync(path.join(VIEWER_DIST, "index.html")) || !fs.existsSync(VIEWER_STALENESS)) {
        return errorResult(
          "Dashboard build not found. Build it first:\n" +
            "  pnpm --filter understand-anything-viewer build\n" +
            `(from ${path.resolve(__dirname, "../../..")})`,
        );
      }

      const url = await startDashboard(root, port);
      return textResult(
        [
          `Dashboard is running at ${url}`,
          `Viewing: ${path.join(resolveUaDir(root), "knowledge-graph.json")}`,
          "",
          "Share the full URL including the ?token= parameter — without it the dashboard",
          "shows an access-token gate. The dashboard stays up for the rest of this session.",
        ].join("\n"),
      );
    } catch (err) {
      return errorResult(err.message);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error("[understand-anything-mcp] server ready on stdio");

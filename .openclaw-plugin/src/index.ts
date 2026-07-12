/**
 * Understand-Anything — native OpenClaw gateway plugin.
 *
 * Registers:
 *   - Agent tools: understand_list_projects, understand_analyze_project,
 *     understand_status, understand_search, understand_get_node
 *   - Gateway HTTP routes: /understand-anything (project picker + dashboard)
 *
 * The analysis pipeline (src/pipeline.ts) runs entirely inside the gateway
 * process: tree-sitter structural analysis + single-turn LLM enrichment via
 * @understand-anything/core, persisted to the analyzed project's `.ua/`
 * directory — the same on-disk contract the upstream skills, viewer, and
 * dashboard already speak. No Claude Code / Task-tool dispatch involved.
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import {
  SearchEngine,
  loadGraph,
  loadMeta,
  type KnowledgeGraph,
  type GraphNode,
} from "@understand-anything/core";
import { analyzeProject, type AnalyzeProjectResult } from "./pipeline.js";
import { createLlmCaller, resolveAnthropicApiKey, type LlmCaller } from "./llm.js";
import { registerDashboardRoutes, shutdownAllViewers } from "./dashboard-route.js";

interface PluginApi {
  registerTool(def: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (
      id: string,
      params: Record<string, unknown>,
    ) => Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
  registerHttpRoute(params: {
    path: string;
    handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<boolean | void> | boolean | void;
    auth: "gateway" | "plugin";
    match?: "exact" | "prefix";
  }): void;
  on?: (hookName: string, handler: (event: unknown, ctx: unknown) => unknown, opts?: { priority?: number }) => void;
  pluginConfig?: Record<string, unknown>;
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
}

interface UnderstandConfig {
  projects?: string[];
  anthropicApiKey?: string;
  model?: string;
  concurrency?: number;
  maxFiles?: number;
}

// ── Analysis job registry ───────────────────────────────────────────────────
// Analysis of a real project takes minutes (one LLM call per file). Tool calls
// must return promptly, so understand_analyze_project starts a background job
// inside the gateway process and understand_status polls it.

interface AnalysisJob {
  state: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  progress: string[];
  result?: AnalyzeProjectResult;
  error?: string;
}

const jobs = new Map<string, AnalysisJob>();

const MAX_PROGRESS_LINES = 50;

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function textResult(text: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value: unknown): { content: Array<{ type: string; text: string }> } {
  return textResult(JSON.stringify(value, null, 2));
}

// ── Graph cache (mtime-invalidated) ─────────────────────────────────────────

interface CachedGraph {
  graph: KnowledgeGraph;
  mtimeMs: number;
  search: SearchEngine;
}

const graphCache = new Map<string, CachedGraph>();

function graphFilePath(projectRoot: string): string | null {
  for (const dir of [".understand-anything", ".ua"]) {
    const p = join(projectRoot, dir, "knowledge-graph.json");
    if (existsSync(p)) return p;
  }
  return null;
}

function getGraph(projectRoot: string): CachedGraph | null {
  const file = graphFilePath(projectRoot);
  if (!file) {
    graphCache.delete(projectRoot);
    return null;
  }
  const mtimeMs = statSync(file).mtimeMs;
  const cached = graphCache.get(projectRoot);
  if (cached && cached.mtimeMs === mtimeMs) return cached;

  // validate:false — serve whatever is on disk; the pipeline validated at save
  // time and upstream tooling (viewer) is similarly tolerant on read.
  //
  // saveGraph (in @understand-anything/core) writes with a plain writeFileSync,
  // not a temp-file+rename, and a background analyzeProject() job can call it
  // at any moment while this route keeps serving reads. A read landing mid-write
  // sees truncated JSON and throws — fall back to the previous cached graph
  // (if any) rather than letting that propagate as an uncaught exception.
  let graph: KnowledgeGraph | null;
  try {
    graph = loadGraph(projectRoot, { validate: false });
  } catch {
    return cached ?? null;
  }
  if (!graph) return null;
  const entry: CachedGraph = { graph, mtimeMs, search: new SearchEngine(graph.nodes) };
  graphCache.set(projectRoot, entry);
  return entry;
}

// ── Node formatting helpers ─────────────────────────────────────────────────

// Graphs are loaded with { validate: false } (see getGraph), so a hand-edited
// or legacy-schema knowledge-graph.json could be missing/renaming any field —
// every access here is defensive rather than assuming the GraphNode shape.
function nodeBrief(n: GraphNode): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    name: n.name,
    ...(n.filePath ? { filePath: n.filePath } : {}),
    summary: n.summary,
    ...(Array.isArray(n.tags) && n.tags.length ? { tags: n.tags } : {}),
    complexity: n.complexity,
  };
}

function edgesFor(graph: KnowledgeGraph, nodeId: string) {
  const outgoing = graph.edges
    .filter((e) => e.source === nodeId)
    .map((e) => ({ type: e.type, target: e.target, ...(e.description ? { description: e.description } : {}) }));
  const incoming = graph.edges
    .filter((e) => e.target === nodeId)
    .map((e) => ({ type: e.type, source: e.source, ...(e.description ? { description: e.description } : {}) }));
  return { outgoing, incoming };
}

// ── Activation ──────────────────────────────────────────────────────────────

export function activate(api: PluginApi): void {
  const log = api.logger;
  const cfg = (api.pluginConfig ?? {}) as UnderstandConfig;

  const projects: string[] = [];
  for (const raw of cfg.projects ?? []) {
    const p = resolve(expandHome(raw));
    if (!isAbsolute(p) || !existsSync(p) || !statSync(p).isDirectory()) {
      log.warn(`[understand-anything] configured project is not an existing directory, skipping: ${raw}`);
      continue;
    }
    projects.push(p);
  }
  if (projects.length === 0) {
    log.warn(
      "[understand-anything] no valid projects configured (plugins.entries.understand-anything.config.projects) — tools will report an empty project list.",
    );
  }

  const model = cfg.model ?? "claude-sonnet-5";
  const defaultConcurrency = cfg.concurrency ?? 5;
  const defaultMaxFiles = cfg.maxFiles ?? 400;

  /** Resolve a `project` tool param (absolute path, or index into the configured list). */
  function resolveProject(param: unknown): { root: string } | { error: string } {
    if (projects.length === 0) return { error: "No projects configured for the understand-anything plugin." };
    if (param === undefined || param === null || param === "") {
      if (projects.length === 1) return { root: projects[0] };
      return { error: `Multiple projects configured — specify one of:\n${projects.map((p, i) => `${i}: ${p}`).join("\n")}` };
    }
    if (typeof param === "number" || /^\d+$/.test(String(param))) {
      const idx = Number(param);
      if (idx >= 0 && idx < projects.length) return { root: projects[idx] };
      return { error: `Project index ${idx} out of range (0..${projects.length - 1}).` };
    }
    const asPath = resolve(expandHome(String(param)));
    const match = projects.find((p) => p === asPath);
    if (match) return { root: match };
    return {
      error: `"${param}" is not a configured project. Configured projects:\n${projects.map((p, i) => `${i}: ${p}`).join("\n")}`,
    };
  }

  function makeLlmCaller(): LlmCaller | { error: string } {
    const key = resolveAnthropicApiKey(cfg.anthropicApiKey);
    if (!key) {
      return {
        error:
          "No Anthropic API key available. Set plugins.entries.understand-anything.config.anthropicApiKey or the ANTHROPIC_API_KEY environment variable on the gateway process.",
      };
    }
    return createLlmCaller(key, model);
  }

  // ── Tools ────────────────────────────────────────────────────────────────

  api.registerTool({
    name: "understand_list_projects",
    description:
      "List the projects configured for Understand-Anything, whether each has been analyzed (has a knowledge graph), and graph size if so.",
    parameters: Type.Object({}),
    async execute() {
      const rows = projects.map((root, index) => {
        const cached = graphFilePath(root) ? getGraph(root) : null;
        const meta = loadMeta(root);
        return {
          index,
          root,
          analyzed: cached !== null,
          ...(cached
            ? {
                nodes: cached.graph.nodes.length,
                edges: cached.graph.edges.length,
                ...(meta?.lastAnalyzedAt ? { lastAnalyzedAt: meta.lastAnalyzedAt } : {}),
              }
            : {}),
          ...(jobs.get(root) ? { analysisJob: jobs.get(root)!.state } : {}),
        };
      });
      return jsonResult({ projects: rows, dashboard: "/understand-anything" });
    },
  });

  api.registerTool({
    name: "understand_analyze_project",
    description:
      "Start (or restart) knowledge-graph analysis of a configured project. Runs in the background inside the gateway — tree-sitter structural analysis plus one LLM call per source file — and persists .ua/knowledge-graph.json when done. Poll progress with understand_status.",
    parameters: Type.Object({
      project: Type.Optional(
        Type.String({ description: "Configured project path or index. May be omitted when exactly one project is configured." }),
      ),
      maxFiles: Type.Optional(Type.Integer({ minimum: 1, description: `Cap on files analyzed (default ${defaultMaxFiles}).` })),
      concurrency: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, description: `Concurrent LLM calls (default ${defaultConcurrency}).` }),
      ),
    }),
    async execute(_id, params) {
      const resolved = resolveProject(params.project);
      if ("error" in resolved) return textResult(resolved.error);
      const root = resolved.root;

      const existing = jobs.get(root);
      if (existing?.state === "running") {
        return textResult(`Analysis already running for ${root} (started ${existing.startedAt}). Poll with understand_status.`);
      }

      const llm = makeLlmCaller();
      if (typeof llm !== "function") return textResult(llm.error);

      const job: AnalysisJob = { state: "running", startedAt: new Date().toISOString(), progress: [] };
      jobs.set(root, job);

      const pushProgress = (message: string) => {
        job.progress.push(`${new Date().toISOString()} ${message}`);
        if (job.progress.length > MAX_PROGRESS_LINES) job.progress.splice(0, job.progress.length - MAX_PROGRESS_LINES);
      };

      void analyzeProject(root, llm, {
        concurrency: (params.concurrency as number | undefined) ?? defaultConcurrency,
        maxFiles: (params.maxFiles as number | undefined) ?? defaultMaxFiles,
        onProgress: pushProgress,
      })
        .then((result) => {
          job.state = "done";
          job.finishedAt = new Date().toISOString();
          job.result = result;
          graphCache.delete(root); // force reload of the freshly-persisted graph
          log.info(
            `[understand-anything] analysis complete for ${root}: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges (${result.filesAnalyzed} files).`,
          );
        })
        .catch((err: unknown) => {
          job.state = "error";
          job.finishedAt = new Date().toISOString();
          job.error = err instanceof Error ? err.message : String(err);
          log.error(`[understand-anything] analysis failed for ${root}: ${job.error}`);
        });

      return textResult(
        `Analysis started for ${root} (model ${model}). This runs one LLM call per source file and may take a few minutes — poll with understand_status.`,
      );
    },
  });

  api.registerTool({
    name: "understand_status",
    description:
      "Status of a project's knowledge-graph analysis: running job progress, last completed result, or the persisted graph's metadata.",
    parameters: Type.Object({
      project: Type.Optional(Type.String({ description: "Configured project path or index." })),
    }),
    async execute(_id, params) {
      const resolved = resolveProject(params.project);
      if ("error" in resolved) return textResult(resolved.error);
      const root = resolved.root;

      const job = jobs.get(root);
      const cached = getGraph(root);
      const meta = loadMeta(root);
      return jsonResult({
        project: root,
        graphOnDisk: cached ? { nodes: cached.graph.nodes.length, edges: cached.graph.edges.length } : null,
        ...(meta ? { meta } : {}),
        job: job
          ? {
              state: job.state,
              startedAt: job.startedAt,
              ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
              ...(job.error ? { error: job.error } : {}),
              ...(job.result
                ? {
                    filesScanned: job.result.filesScanned,
                    filesAnalyzed: job.result.filesAnalyzed,
                    warnings: job.result.warnings,
                  }
                : {}),
              recentProgress: job.progress.slice(-10),
            }
          : null,
      });
    },
  });

  api.registerTool({
    name: "understand_search",
    description:
      "Fuzzy-search a project's knowledge graph (names, tags, summaries). Returns matching nodes ranked by relevance. Use understand_get_node for full detail on a hit.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — names, concepts, tags (e.g. 'auth', 'graph builder')." }),
      project: Type.Optional(Type.String({ description: "Configured project path or index." })),
      types: Type.Optional(
        Type.Array(Type.String(), { description: "Filter to node types, e.g. [\"file\", \"function\", \"class\"]." }),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Max results (default 10)." })),
    }),
    async execute(_id, params) {
      const resolved = resolveProject(params.project);
      if ("error" in resolved) return textResult(resolved.error);
      const cached = getGraph(resolved.root);
      if (!cached) return textResult(`No knowledge graph for ${resolved.root} yet — run understand_analyze_project first.`);

      const results = cached.search.search(String(params.query), {
        types: params.types as GraphNode["type"][] | undefined,
        limit: (params.limit as number | undefined) ?? 10,
      });
      const byId = new Map(cached.graph.nodes.map((n) => [n.id, n]));
      return jsonResult({
        query: params.query,
        results: results.map((r) => ({
          score: Number(r.score.toFixed(3)),
          ...nodeBrief(byId.get(r.nodeId)!),
        })),
      });
    },
  });

  api.registerTool({
    name: "understand_get_node",
    description:
      "Full detail for one knowledge-graph node: summary, tags, file/line range, language notes, and all incoming/outgoing edges with neighbor names.",
    parameters: Type.Object({
      nodeId: Type.String({ description: "Node id (from understand_search results), e.g. 'file:src/auth.ts'." }),
      project: Type.Optional(Type.String({ description: "Configured project path or index." })),
    }),
    async execute(_id, params) {
      const resolved = resolveProject(params.project);
      if ("error" in resolved) return textResult(resolved.error);
      const cached = getGraph(resolved.root);
      if (!cached) return textResult(`No knowledge graph for ${resolved.root} yet — run understand_analyze_project first.`);

      const node = cached.graph.nodes.find((n) => n.id === params.nodeId);
      if (!node) return textResult(`Node not found: ${params.nodeId}. Find ids with understand_search.`);

      const { outgoing, incoming } = edgesFor(cached.graph, node.id);
      const nameOf = (id: string) => cached.graph.nodes.find((n) => n.id === id)?.name ?? id;
      return jsonResult({
        ...node,
        edges: {
          outgoing: outgoing.map((e) => ({ ...e, targetName: nameOf(e.target as string) })),
          incoming: incoming.map((e) => ({ ...e, sourceName: nameOf(e.source as string) })),
        },
      });
    },
  });

  // ── Dashboard routes ─────────────────────────────────────────────────────

  registerDashboardRoutes(api.registerHttpRoute.bind(api), () => projects, log);

  // Spawned understand-anything-viewer child processes otherwise accumulate
  // forever and become fully orphaned (unreachable, un-killable from this
  // process) on the next plugin/gateway reload, since module state resets.
  api.on?.("gateway_stop", () => shutdownAllViewers(log));

  log.info(
    `[understand-anything] activated: ${projects.length} project(s), model ${model}, tools understand_list_projects/analyze_project/status/search/get_node, dashboard at /understand-anything.`,
  );
}

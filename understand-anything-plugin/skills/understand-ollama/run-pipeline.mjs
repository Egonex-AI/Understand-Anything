#!/usr/bin/env node
/**
 * run-pipeline.mjs — Seven-phase pipeline driver for the local Ollama backend.
 *
 * Mirrors skills/understand/SKILL.md but routes every LLM call to a local
 * Ollama server. Deterministic steps (scan, import-map, batching, structure
 * extraction) reuse the existing bundled scripts. Semantic steps (project
 * narrative, per-file enrichment, layer detection, tour) call OllamaClient
 * from @understand-anything/core.
 *
 * The local path is structurally identical to the cloud path: same
 * intermediate file layout, same `nodes[]`/`edges[]` shape, same
 * `merge-batch-graphs.py` assembler, same `KnowledgeGraphSchema` validation.
 *
 * Usage:
 *   node run-pipeline.mjs \
 *     --project-root <abs-path> \
 *     --plugin-root <abs-path> \
 *     [--ollama-url <url>] [--model <name>] [--language <l>] \
 *     [--concurrency N] [--review] [--full] [--resume] \
 *     [--out <path>]
 */

import { spawn, execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ---- Core import (workspace resolution) -----------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT_HINT = resolve(__dirname, "..", "..");

let core;
try {
  core = await import(
    pathToFileURL(require.resolve("@understand-anything/core")).href
  );
} catch {
  core = await import(
    pathToFileURL(
      resolve(PLUGIN_ROOT_HINT, "packages/core/dist/index.js"),
    ).href,
  );
}

const { OllamaClient, buildFileAnalysisPrompt, parseFileAnalysisResponse,
        buildLayerDetectionPrompt, parseLayerDetectionResponse,
        buildTourGenerationPrompt, parseTourGenerationResponse,
        applyLLMLayers, detectLayers, saveMeta } = core;

// ---- CLI parsing -----------------------------------------------------------

function parseArgs(argv) {
  const out = {
    projectRoot: null,
    pluginRoot: null,
    ollamaUrl: "http://127.0.0.1:11434",
    model: "qwen2.5-coder:1.5b",
    language: "en",
    concurrency: 2,
    review: false,
    full: false,
    resume: false,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--project-root": out.projectRoot = next(); break;
      case "--plugin-root":  out.pluginRoot  = next(); break;
      case "--ollama-url":   out.ollamaUrl   = next(); break;
      case "--model":        out.model       = next(); break;
      case "--language":     out.language    = next(); break;
      case "--concurrency":  out.concurrency = Number(next()); break;
      case "--review":       out.review      = true; break;
      case "--full":         out.full        = true; break;
      case "--resume":       out.resume      = true; break;
      case "--out":          out.out         = next(); break;
      case "--help":
        console.log("Usage: run-pipeline.mjs --project-root <abs> --plugin-root <abs> [--ollama-url <u>] [--model <m>] [--language <l>] [--concurrency N] [--review] [--full] [--resume] [--out <path>]");
        break;
      default: {
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
      }
    }
  }
  if (!out.projectRoot || !out.pluginRoot) {
    console.error("--project-root and --plugin-root are required");
    process.exit(2);
  }
  return out;
}

const args = parseArgs(process.argv);
const PROJECT_ROOT = resolve(args.projectRoot);
const PLUGIN_ROOT = resolve(args.pluginRoot);
const SKILL_DIR_UNDERSTAND = join(PLUGIN_ROOT, "skills", "understand");
const UNDERSTAND_DIR = join(PROJECT_ROOT, ".understand-anything");
const INTERMEDIATE = join(UNDERSTAND_DIR, "intermediate");
const TMP = join(UNDERSTAND_DIR, "tmp");
const KNOWLEDGE_GRAPH = args.out ?? join(UNDERSTAND_DIR, "knowledge-graph.json");

const log = (msg) => console.log(`[understand-ollama] ${msg}`);
const logPhase = (n, name) => console.log(`[Phase ${n}/7] ${name}...`);
const logWarn = (msg) => console.warn(`[understand-ollama] warn: ${msg}`);

function spawnOk(cmd, spawnArgs, cwd, env = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, spawnArgs, {
      cwd: cwd ?? PLUGIN_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, ...env },
    });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))));
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2), "utf8");
}

// ---- Phases ---------------------------------------------------------------

async function phase0Preflight(client) {
  logPhase(0, "Preflight");
  const health = await client.isHealthy();
  if (!health.ok) {
    log(`Ollama not reachable at ${args.ollamaUrl}: ${health.error}`);
    log(`Start it with: ollama serve  (then: ollama pull ${args.model})`);
    process.exit(1);
  }
  log(`Ollama ${health.version} reachable. Model: ${args.model}`);

  const models = await client.listModels();
  if (!models.includes(args.model)) {
    log(`Model ${args.model} not in local Ollama. Available: ${models.join(", ")}`);
    log(`Pull it with: ollama pull ${args.model}`);
    process.exit(1);
  }

  await mkdir(INTERMEDIATE, { recursive: true });
  await mkdir(TMP, { recursive: true });
}

async function phase1Scan() {
  logPhase(1, "Scanning project files");
  const scanInput = join(TMP, "ua-scan-files.json");
  const scanOutput = join(INTERMEDIATE, "scan-result.json");
  const importInput = join(TMP, "ua-import-map-input.json");
  const importOutput = join(TMP, "ua-import-map-output.json");

  await spawnOk("node", [
    join(SKILL_DIR_UNDERSTAND, "scan-project.mjs"),
    PROJECT_ROOT, scanInput,
  ]);
  const scanData = await readJson(scanInput);

  await writeJson(importInput, { projectRoot: PROJECT_ROOT, files: scanData.files });
  await spawnOk("node", [
    join(SKILL_DIR_UNDERSTAND, "extract-import-map.mjs"),
    importInput, importOutput,
  ]);
  const importData = await readJson(importOutput);

  const projectMeta = await buildProjectNarrative(scanData);

  const finalScan = {
    name: projectMeta.name,
    description: projectMeta.description,
    languages: projectMeta.languages,
    frameworks: projectMeta.frameworks,
    totalFiles: scanData.totalFiles,
    filteredByIgnore: scanData.filteredByIgnore ?? 0,
    estimatedComplexity: scanData.estimatedComplexity,
    files: scanData.files,
    importMap: importData.importMap,
    scannedAt: new Date().toISOString(),
  };
  await writeJson(scanOutput, finalScan);
  log(`Scanned ${finalScan.totalFiles} files (${finalScan.filteredByIgnore} ignored).`);
}

async function buildProjectNarrative(scanData) {
  const readmePath = join(PROJECT_ROOT, "README.md");
  const manifestPath = await findManifest();

  const readme = existsSync(readmePath) ? (await readFile(readmePath, "utf8")).slice(0, 3000) : "";
  const manifest = manifestPath ? (await readFile(manifestPath, "utf8")).slice(0, 2000) : "";

  const dirName = basename(PROJECT_ROOT);
  const fallback = {
    name: dirName,
    description: readme.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? `${dirName} project`,
    languages: [...new Set(scanData.files.map((f) => f.language).filter(Boolean))],
    frameworks: [],
  };

  if (!readme && !manifest) return fallback;

  const prompt = `You are a project metadata extractor. Read the README and manifest excerpts, then return JSON describing the project.

README (first 3000 chars):
\`\`\`
${readme}
\`\`\`

Manifest (first 2000 chars):
\`\`\`
${manifest}
\`\`\`

Return ONLY this JSON (no markdown, no prose):
{"name": "<project name>", "description": "<one-line description, <= 200 chars>", "frameworks": ["<framework>", ...], "languages": ["<lang>", ...]}`;

  try {
    const client = new OllamaClient({ baseUrl: args.ollamaUrl, model: args.model });
    const res = await client.chat({
      messages: [
        { role: "system", content: "You are a precise project metadata extractor. Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      format: "json",
    });
    const parsed = JSON.parse(res.content);
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : fallback.name,
      description: typeof parsed.description === "string" && parsed.description.trim() ? parsed.description : fallback.description,
      languages: Array.isArray(parsed.languages) ? parsed.languages : fallback.languages,
      frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks : fallback.frameworks,
    };
  } catch (err) {
    logWarn(`Project narrative via Ollama failed (${err.message}); using heuristic fallback.`);
    return fallback;
  }
}

async function findManifest() {
  const candidates = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml"];
  for (const c of candidates) {
    const p = join(PROJECT_ROOT, c);
    if (existsSync(p)) return p;
  }
  return null;
}

async function phase15Batch() {
  logPhase(1.5, "Computing semantic batches");
  await spawnOk("node", [join(SKILL_DIR_UNDERSTAND, "compute-batches.mjs"), PROJECT_ROOT]);
}

// Map fileCategory → canonical node type prefix
const CATEGORY_TO_TYPE = {
  code: "file",
  script: "file",
  markup: "file",
  config: "config",
  docs: "document",
  infra: "service", // overridden for pipeline / resource in transformer
  data: "schema",  // overridden for table / endpoint
};

function transformStructuralToGraph(structResults) {
  // Returns { nodes, edges } matching the cloud file-analyzer output shape.
  const nodes = [];
  const edges = [];
  const fileNodeByPath = new Map();

  for (const fr of structResults) {
    const filePath = fr.path;
    const fileName = basename(filePath);
    const fileId = `file:${filePath}`;
    const fileType = CATEGORY_TO_TYPE[fr.fileCategory] ?? "file";

    const fileNode = {
      id: fileId,
      type: fileType,
      name: fileName,
      filePath,
      summary: "",          // filled by Ollama
      tags: [],             // filled by Ollama
      complexity: "moderate", // filled by Ollama
    };
    // For infra files: dockerfile/k8s → service; CI → pipeline; terraform → resource
    if (fr.fileCategory === "infra") {
      if (/dockerfile|compose|k8s|helm/i.test(filePath) || fr.language === "dockerfile" || fr.language === "kubernetes") {
        fileNode.type = "service";
      } else if (/\.github\/workflows|\.gitlab-ci|Jenkinsfile|\.circleci/i.test(filePath)) {
        fileNode.type = "pipeline";
      } else if (/\.tf$|\.tfvars|cloudformation|vagrant/i.test(filePath)) {
        fileNode.type = "resource";
      }
    } else if (fr.fileCategory === "data") {
      if (fr.language === "sql" || /migration/i.test(filePath)) {
        fileNode.type = "table";
      } else if (/\.proto$|\.graphql$|\.prisma$|openapi|swagger/i.test(filePath)) {
        fileNode.type = "schema";
      } else if (/openapi|swagger/i.test(filePath)) {
        fileNode.type = "endpoint";
      }
    }
    nodes.push(fileNode);
    fileNodeByPath.set(filePath, fileId);

    // Function nodes + contains edges
    for (const fn of fr.functions ?? []) {
      const fnId = `function:${filePath}:${fn.name}`;
      nodes.push({
        id: fnId,
        type: "function",
        name: fn.name,
        filePath,
        lineRange: [fn.startLine, fn.endLine],
        summary: "",
        tags: [],
        complexity: "moderate",
      });
      edges.push({ source: fileId, target: fnId, type: "contains", direction: "forward", weight: 1.0 });
    }

    // Class nodes + contains edges
    for (const cls of fr.classes ?? []) {
      const clsId = `class:${filePath}:${cls.name}`;
      nodes.push({
        id: clsId,
        type: "class",
        name: cls.name,
        filePath,
        lineRange: [cls.startLine, cls.endLine],
        summary: "",
        tags: [],
        complexity: "moderate",
      });
      edges.push({ source: fileId, target: clsId, type: "contains", direction: "forward", weight: 1.0 });
    }

    // callGraph → calls edges
    for (const cg of fr.callGraph ?? []) {
      const callerId = `function:${filePath}:${cg.caller}`;
      const calleeName = String(cg.callee).replace(/\(.*\)$/, "").trim();
      // Heuristic: same-file callee resolution. Cross-file is not reliable here
      // without import-map stitching; merge-batch-graphs.py handles recovery.
      if (nodes.some((n) => n.id === `function:${filePath}:${calleeName}`)) {
        edges.push({
          source: callerId,
          target: `function:${filePath}:${calleeName}`,
          type: "calls",
          direction: "forward",
          weight: 0.7,
        });
      }
    }
  }

  return { nodes, edges };
}

async function phase2Analyze(client) {
  logPhase(2, "Analyzing files");
  const batches = await readJson(join(INTERMEDIATE, "batches.json"));
  const totalBatches = batches.batches.length;
  log(`Total batches: ${totalBatches}`);

  for (let i = 0; i < totalBatches; i++) {
    const batch = batches.batches[i];
    log(`Batch ${i + 1}/${totalBatches} (${batch.files.length} files)`);

    const structInput = join(TMP, `ua-struct-input-${i}.json`);
    const structOutput = join(TMP, `ua-struct-output-${i}.json`);
    await writeJson(structInput, {
      projectRoot: PROJECT_ROOT,
      batchFiles: batch.files,
      batchImportData: batches.importMap ?? {},
    });
    await spawnOk("node", [
      join(SKILL_DIR_UNDERSTAND, "extract-structure.mjs"),
      structInput, structOutput,
    ]);
    const structResult = await readJson(structOutput);
    const structResults = structResult.results ?? [];

    // Deterministic structural → { nodes, edges }
    const { nodes, edges } = transformStructuralToGraph(structResults);

    // Per-file semantic enrichment via Ollama (only on file nodes).
    const fileNodes = nodes.filter((n) => n.id.startsWith("file:"));
    const queue = [...fileNodes];
    const concurrency = Math.max(1, args.concurrency);
    const workers = Array.from({ length: concurrency }, () => ({
      next: async () => {
        while (queue.length) {
          const fn = queue.shift();
          const structEntry = structResults.find((s) => `file:${s.path}` === fn.id) ?? {};
          try {
            const enriched = await enrichFileNode(client, fn, structEntry);
            Object.assign(fn, enriched);
          } catch (err) {
            logWarn(`${fn.filePath}: ${err.message}; using structural fallback`);
            Object.assign(fn, fallbackFileNode(fn, structEntry));
          }
        }
      },
    }));
    await Promise.all(workers.map((w) => w.next()));

    await writeJson(join(INTERMEDIATE, `batch-${i}.json`), { nodes, edges });
    log(`  wrote batch-${i}.json (${nodes.length} nodes, ${edges.length} edges)`);
  }
}

async function enrichFileNode(client, fileNode, structEntry) {
  const content = await readFileSafe(join(PROJECT_ROOT, fileNode.filePath));
  const projectContext = `language=${structEntry.language ?? "unknown"} category=${structEntry.fileCategory ?? "code"} lines=${structEntry.totalLines ?? "?"}`;
  const prompt = buildFileAnalysisPrompt(fileNode.filePath, content, projectContext);
  const res = await client.chat({
    messages: [
      { role: "system", content: "You are a senior code analyst. Respond with valid JSON only — no prose, no markdown fences." },
      { role: "user", content: prompt },
    ],
    format: "json",
  });
  const parsed = parseFileAnalysisResponse(res.content);
  if (!parsed) throw new Error("parseFileAnalysisResponse returned null");
  return {
    summary: parsed.fileSummary ?? `Structural analysis of ${fileNode.name}`,
    tags: parsed.tags ?? [],
    complexity: parsed.complexity ?? "moderate",
    languageNotes: parsed.languageNotes,
  };
}

function fallbackFileNode(fileNode, structEntry) {
  return {
    summary: `${fileNode.type} file: ${fileNode.name} (${structEntry.totalLines ?? "?"} lines, structural-only)`,
    tags: [fileNode.type, (structEntry.language ?? "unknown")],
    complexity: structEntry.totalLines > 200 ? "complex" : structEntry.totalLines > 50 ? "moderate" : "simple",
  };
}

async function readFileSafe(absPath) {
  try { return await readFile(absPath, "utf8"); } catch { return ""; }
}

async function phase3Assemble() {
  logPhase(3, "Assembling batch graphs");
  await spawnOk("python3", [join(SKILL_DIR_UNDERSTAND, "merge-batch-graphs.py"), PROJECT_ROOT]);
}

async function injectGraphMetadata(graph) {
  const scan = await readJson(join(INTERMEDIATE, "scan-result.json"));
  const commit = (() => {
    try { return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim(); }
    catch { return ""; }
  })();
  graph.version = graph.version ?? "1.0.0";
  graph.kind = graph.kind ?? "codebase";
  graph.project = {
    name: scan.name ?? basename(PROJECT_ROOT),
    description: scan.description ?? "",
    languages: scan.languages ?? [],
    frameworks: scan.frameworks ?? [],
    analyzedAt: scan.scannedAt ?? new Date().toISOString(),
    gitCommitHash: commit,
  };
  if (!Array.isArray(graph.tour)) graph.tour = [];
  return graph;
}

async function phase4Layers(client) {
  logPhase(4, "Detecting layers");
  const assembledPath = join(INTERMEDIATE, "assembled-graph.json");
  const graph = await injectGraphMetadata(await readJson(assembledPath));

  let usedLlm = false;
  try {
    const prompt = buildLayerDetectionPrompt(graph);
    const res = await client.chat({
      messages: [
        { role: "system", content: "You are a software architect. Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      format: "json",
    });
    const parsed = parseLayerDetectionResponse(res.content);
    if (parsed && parsed.length > 0) {
      graph.layers = applyLLMLayers(graph, parsed);
      usedLlm = true;
    }
  } catch (err) {
    logWarn(`Layer LLM call failed (${err.message}); using heuristic.`);
  }
  if (!usedLlm) {
    graph.layers = detectLayers(graph);
  }
  await writeJson(assembledPath, graph);
  log(`Layers: ${graph.layers.length} (${usedLlm ? "LLM" : "heuristic"}).`);
}

async function phase5Tour(client) {
  logPhase(5, "Building guided tour");
  const assembledPath = join(INTERMEDIATE, "assembled-graph.json");
  const graph = await injectGraphMetadata(await readJson(assembledPath));

  try {
    const prompt = buildTourGenerationPrompt(graph);
    const res = await client.chat({
      messages: [
        { role: "system", content: "You are a software architecture educator. Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      format: "json",
    });
    const parsed = parseTourGenerationResponse(res.content);
    graph.tour = parsed ?? [];
  } catch (err) {
    logWarn(`Tour LLM call failed (${err.message}); leaving tour empty.`);
    graph.tour = [];
  }
  await writeJson(assembledPath, graph);
  log(`Tour steps: ${graph.tour.length}.`);
}

async function phase6Review() {
  logPhase(6, "Validating and finalizing");
  const assembledPath = join(INTERMEDIATE, "assembled-graph.json");
  const graph = await injectGraphMetadata(await readJson(assembledPath));

  const schema = core.knowledgeGraphSchema ?? core.KnowledgeGraphSchema;
  const result = schema?.safeParse?.(graph) ?? { success: true };
  if (!result.success) {
    logWarn(`Schema validation issues (${result.error?.issues?.length ?? "?"} total, showing first 5):`);
    for (const issue of (result.error?.issues ?? []).slice(0, 5)) {
      logWarn(`  ${issue.path?.join(".") ?? "<root>"}: ${issue.message}`);
    }
  }

  // Write final knowledge graph
  await writeJson(KNOWLEDGE_GRAPH, graph);

  // Fingerprints baseline
  try {
    const scan = await readJson(join(INTERMEDIATE, "scan-result.json"));
    const commit = (() => {
      try { return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim(); }
      catch { return ""; }
    })();
    const fpInput = join(TMP, "ua-fingerprint-input.json");
    await writeJson(fpInput, {
      projectRoot: PROJECT_ROOT,
      sourceFilePaths: (scan.files ?? []).map((f) => f.path).filter((p) => /\.[a-z0-9]+$/i.test(p)),
      gitCommitHash: commit,
    });
    await spawnOk("node", [
      join(SKILL_DIR_UNDERSTAND, "build-fingerprints.mjs"),
      fpInput,
    ]);
  } catch (err) {
    logWarn(`Fingerprint baseline failed (${err.message}); continuing.`);
  }

  // meta.json
  const commit = (() => {
    try { return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim(); }
    catch { return ""; }
  })();
  saveMeta(PROJECT_ROOT, {
    gitCommitHash: commit,
    analyzedAt: new Date().toISOString(),
    ollamaModel: args.model,
    ollamaUrl: args.ollamaUrl,
  });
  log(`Schema validation: ${result.success ? "passed" : "completed with warnings"}.`);
}

async function phase7Clean() {
  logPhase(7, "Done");
  log(`Wrote ${KNOWLEDGE_GRAPH}`);
  log(`Open the dashboard with: /understand-dashboard`);
}

// ---- Entry ---------------------------------------------------------------

async function main() {
  log(`Plugin root: ${PLUGIN_ROOT}`);
  log(`Project root: ${PROJECT_ROOT}`);
  const client = new OllamaClient({ baseUrl: args.ollamaUrl, model: args.model });
  await phase0Preflight(client);
  await phase1Scan();
  await phase15Batch();
  await phase2Analyze(client);
  await phase3Assemble();
  await phase4Layers(client);
  await phase5Tour(client);
  await phase6Review();
  await phase7Clean();
}

main().catch((err) => {
  console.error("[understand-ollama] fatal:", err.stack ?? err.message);
  process.exit(1);
});

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import {
  GraphBuilder,
  LanguageRegistry,
  TreeSitterPlugin,
  createIgnoreFilter,
  buildFileAnalysisPrompt,
  parseFileAnalysisResponse,
  buildProjectSummaryPrompt,
  parseProjectSummaryResponse,
  validateGraph,
  saveGraph,
  saveMeta,
  type KnowledgeGraph,
  type Layer,
  type StructuralAnalysis,
} from "@understand-anything/core";
import { walkProject } from "./walk.js";
import { matchesAnyPattern } from "./glob-match.js";
import { mapWithConcurrency, type LlmCaller } from "./llm.js";
import { generateModuleTour, generateCodeReviewTour } from "./tour-generation.js";
import { upsertTour, makeTourId } from "./tour-store.js";

const MAX_FILE_BYTES = 1024 * 1024; // skip anything over 1MB — matches the viewer's own cap
const MAX_SOURCE_CHARS_FOR_PROMPT = 12_000; // bound per-file prompt size/cost
const MAX_SAMPLE_FILES_FOR_SUMMARY = 8;
const RESOLVABLE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".java", ".rs"];
const INDEX_BASENAMES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.py"];

const FILE_ANALYSIS_SYSTEM_PROMPT =
  "You are a precise code analysis assistant embedded in an automated pipeline. Always respond with a single valid JSON object and nothing else.";

export interface AnalyzeProjectOptions {
  concurrency: number;
  maxFiles: number;
  onProgress?: (message: string) => void;
}

export interface AnalyzeProjectResult {
  graph: KnowledgeGraph;
  filesScanned: number;
  filesAnalyzed: number;
  filesSkipped: number;
  warnings: string[];
}

function resolveGitHash(projectRoot: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/** Resolves a relative/bare import specifier against the set of scanned files. Returns null if unresolvable. */
export function resolveImportTarget(fromFile: string, source: string, knownFiles: Set<string>): string | null {
  if (!source.startsWith("./") && !source.startsWith("../")) return null; // skip package imports

  const fromDir = dirname(fromFile);
  const rawTarget = join(fromDir, source);

  // TS ESM convention: `import "./util.js"` refers to util.ts/util.tsx on disk.
  // Try the specifier as written first, then with its JS extension swapped.
  const stems = [rawTarget];
  const jsExtMatch = rawTarget.match(/\.(js|mjs|cjs|jsx)$/);
  if (jsExtMatch) stems.push(rawTarget.slice(0, -jsExtMatch[0].length));

  for (const stem of stems) {
    for (const ext of RESOLVABLE_EXTENSIONS) {
      const candidate = (stem + ext).split("\\").join("/");
      if (knownFiles.has(candidate)) return candidate;
    }
  }
  for (const indexName of INDEX_BASENAMES) {
    const candidate = join(rawTarget, indexName).split("\\").join("/");
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

export async function analyzeProject(
  projectRoot: string,
  llmCall: LlmCaller,
  opts: AnalyzeProjectOptions,
): Promise<AnalyzeProjectResult> {
  const warnings: string[] = [];
  const log = opts.onProgress ?? (() => {});

  const gitHash = resolveGitHash(projectRoot);
  const ignoreFilter = createIgnoreFilter(projectRoot);
  const languageRegistry = LanguageRegistry.createDefault();

  log("Walking project tree...");
  const allRelFiles = walkProject(projectRoot, ignoreFilter);
  const codeFiles = allRelFiles.filter((f) => languageRegistry.getForFile(f) !== null);

  const filesToAnalyze = codeFiles.slice(0, opts.maxFiles);
  const filesSkipped = codeFiles.length - filesToAnalyze.length;
  if (filesSkipped > 0) {
    warnings.push(
      `Project has ${codeFiles.length} recognized source files; capped analysis at ${opts.maxFiles} (maxFiles config). ${filesSkipped} files were not analyzed.`,
    );
  }
  log(`Found ${allRelFiles.length} files total, ${codeFiles.length} recognized as source (analyzing ${filesToAnalyze.length}).`);

  const treeSitter = new TreeSitterPlugin(languageRegistry.getAllLanguages());
  await treeSitter.init();

  const knownFiles = new Set(filesToAnalyze);
  const projectName = basename(projectRoot);

  interface FileResult {
    rel: string;
    content: string;
    structure: StructuralAnalysis;
    fileSummary: string;
    tags: string[];
    complexity: "simple" | "moderate" | "complex";
    summaries: Record<string, string>;
    languageNotes?: string;
  }

  let completed = 0;
  const fileResults = await mapWithConcurrency(filesToAnalyze, opts.concurrency, async (rel): Promise<FileResult | null> => {
    const abs = join(projectRoot, rel);
    let content: string;
    try {
      const stat = statSync(abs);
      if (stat.size > MAX_FILE_BYTES) return null;
      content = readFileSync(abs, "utf-8");
      if (content.includes("\0")) return null; // binary
    } catch {
      return null;
    }

    const structure = treeSitter.analyzeFile(rel, content);

    const prompt = buildFileAnalysisPrompt(rel, content.slice(0, MAX_SOURCE_CHARS_FOR_PROMPT), projectName);
    let fileSummary = "";
    let tags: string[] = [];
    let complexity: "simple" | "moderate" | "complex" = "moderate";
    let summaries: Record<string, string> = {};
    let languageNotes: string | undefined;

    try {
      const response = await llmCall(FILE_ANALYSIS_SYSTEM_PROMPT, prompt, 1200);
      const parsed = parseFileAnalysisResponse(response);
      if (parsed) {
        fileSummary = parsed.fileSummary;
        tags = parsed.tags;
        complexity = parsed.complexity;
        summaries = { ...parsed.functionSummaries, ...parsed.classSummaries };
        languageNotes = parsed.languageNotes;
      } else {
        warnings.push(`Could not parse LLM analysis for ${rel}; kept structural facts only.`);
      }
    } catch (err) {
      warnings.push(`LLM analysis failed for ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }

    completed++;
    if (completed % 10 === 0 || completed === filesToAnalyze.length) {
      log(`Analyzed ${completed}/${filesToAnalyze.length} files...`);
    }

    return { rel, content, structure, fileSummary, tags, complexity, summaries, languageNotes };
  });

  const builder = new GraphBuilder(projectName, gitHash, languageRegistry);
  let filesAnalyzed = 0;

  for (const result of fileResults) {
    if (!result) continue;
    filesAnalyzed++;
    builder.addFileWithAnalysis(result.rel, result.structure, {
      summary: result.fileSummary,
      fileSummary: result.fileSummary,
      tags: result.tags,
      complexity: result.complexity,
      summaries: result.summaries,
    });

    for (const imp of result.structure.imports) {
      const target = resolveImportTarget(result.rel, imp.source, knownFiles);
      if (target && target !== result.rel) {
        builder.addImportEdge(result.rel, target);
      }
    }
  }

  log("Generating project summary...");
  const sampleFiles = fileResults
    .filter((r): r is FileResult => r !== null)
    .slice(0, MAX_SAMPLE_FILES_FOR_SUMMARY)
    .map((r) => ({ path: r.rel, content: r.content.slice(0, 2000) }));

  // Built once — GraphBuilder.build() is a pure, deterministic snapshot (stable
  // string node IDs, no internal counters), but nodes/edges can run into the
  // thousands, so building it twice was a needless double array-copy.
  const graph = builder.build();

  try {
    const summaryPrompt = buildProjectSummaryPrompt(filesToAnalyze, sampleFiles);
    const summaryResponse = await llmCall(FILE_ANALYSIS_SYSTEM_PROMPT, summaryPrompt, 1500);
    const parsedSummary = parseProjectSummaryResponse(summaryResponse);
    if (parsedSummary) {
      graph.project.description = parsedSummary.description;
      graph.project.frameworks = parsedSummary.frameworks;
      graph.layers = parsedSummary.layers.map((l, idx): Layer => ({
        id: `layer:${idx}:${l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: l.name,
        description: l.description,
        nodeIds: graph.nodes
          .filter((n) => n.filePath && matchesAnyPattern(n.filePath, l.filePatterns))
          .map((n) => n.id),
      }));
    } else {
      warnings.push("Could not parse LLM project summary response.");
    }
  } catch (err) {
    warnings.push(`Project summary generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Module walkthrough is free (no LLM) and goes straight into graph.tour —
  // the only tour field upstream's dashboard/Learn persona knows how to play,
  // so this keeps that working with zero changes. Populated before
  // validation so the schema check covers it too.
  graph.tour = generateModuleTour(graph);

  const validation = validateGraph(graph);
  if (!validation.success) {
    warnings.push(`Graph failed schema validation: ${validation.fatal ?? "unknown error"}`);
    throw new Error(`Generated knowledge graph failed validation: ${validation.fatal ?? "unknown error"}`);
  }
  const finalGraph = validation.data as KnowledgeGraph;

  log("Persisting knowledge graph...");
  saveGraph(projectRoot, finalGraph);
  saveMeta(projectRoot, {
    lastAnalyzedAt: new Date().toISOString(),
    gitCommitHash: gitHash,
    version: "0.1.0",
    analyzedFiles: filesAnalyzed,
  });

  upsertTour(projectRoot, {
    id: makeTourId("module"),
    kind: "module",
    title: "Module walkthrough",
    description: "Dependency-ordered tour through the codebase's modules, generated automatically at analysis time.",
    createdAt: new Date().toISOString(),
    steps: finalGraph.tour,
  });

  log("Generating code-review tour...");
  try {
    const reviewSteps = await generateCodeReviewTour(finalGraph, llmCall);
    if (reviewSteps.length > 0) {
      upsertTour(projectRoot, {
        id: makeTourId("codeReview"),
        kind: "codeReview",
        title: "Code review walkthrough",
        description: "Highest-risk files ranked by complexity and how central they are in the dependency graph.",
        createdAt: new Date().toISOString(),
        steps: reviewSteps,
      });
    } else {
      warnings.push("Code-review tour skipped: no code nodes to rank.");
    }
  } catch (err) {
    warnings.push(`Code-review tour generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    graph: finalGraph,
    filesScanned: allRelFiles.length,
    filesAnalyzed,
    filesSkipped,
    warnings,
  };
}

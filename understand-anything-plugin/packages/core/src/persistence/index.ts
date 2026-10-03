import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, isAbsolute, relative, basename } from "node:path";
import type { KnowledgeGraph, AnalysisMeta, ProjectConfig, DiffOverlay } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";
import { validateGraph } from "../schema.js";

const UA_DIR = ".ua";
const LEGACY_UA_DIR = ".understand-anything";
const GRAPH_FILE = "knowledge-graph.json";
const META_FILE = "meta.json";
const FINGERPRINT_FILE = "fingerprints.json";
const CONFIG_FILE = "config.json";

/**
 * Resolve the data directory NAME for a project. Projects analyzed before
 * the `.ua` rename keep their existing `.understand-anything/` for both
 * reads and writes (no migration needed); fresh projects get `.ua/`.
 */
export function resolveUaDirName(projectRoot: string): string {
  return existsSync(join(projectRoot, LEGACY_UA_DIR)) ? LEGACY_UA_DIR : UA_DIR;
}

/** Absolute path of the project's data directory (see resolveUaDirName). */
export function resolveUaDir(projectRoot: string): string {
  return join(projectRoot, resolveUaDirName(projectRoot));
}

function ensureDir(projectRoot: string): string {
  const dir = resolveUaDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitise every node's filePath before writing to disk.
 *
 * The analysis agent produces absolute paths like:
 *   /Users/alice/company/src/auth.ts
 *
 * We convert them to paths relative to projectRoot:
 *   src/auth.ts
 *
 * Three cases are handled:
 *   1. Path is inside projectRoot      → make it relative
 *   2. Path is absolute but outside    → keep only the filename (last segment)
 *   3. Path is already relative        → leave it untouched
 *
 * This means the developer's home directory, username, and company
 * directory layout are never written to knowledge-graph.json.
 */
function sanitiseFilePath(fp: string, projectRoot: string): string {
  const normalRoot = projectRoot.endsWith("/") ? projectRoot : projectRoot + "/";

  if (!isAbsolute(fp)) {
    // Already relative — nothing to do.
    return fp;
  }

  if (fp.startsWith(normalRoot) || fp.startsWith(projectRoot)) {
    // Inside the project root — make it relative.
    return relative(projectRoot, fp);
  }

  // Absolute but outside the project root — use only the filename
  // so we leak as little as possible.
  return basename(fp);
}

function sanitiseFilePaths(
  graph: KnowledgeGraph,
  projectRoot: string,
): KnowledgeGraph {
  const sanitisedNodes = graph.nodes.map((node) => {
    if (typeof node.filePath !== "string") return node;
    return { ...node, filePath: sanitiseFilePath(node.filePath, projectRoot) };
  });

  return { ...graph, nodes: sanitisedNodes };
}

export function saveGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);

  // FIX — sanitise absolute file paths before persisting.
  // Without this, absolute paths like /Users/alice/company/src/auth.ts
  // are written verbatim into knowledge-graph.json and later served
  // by the dashboard server, leaking the developer's directory layout.
  const sanitised = sanitiseFilePaths(graph, projectRoot);

  writeFileSync(
    join(dir, GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(resolveUaDir(projectRoot), GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid knowledge graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}

export function saveMeta(projectRoot: string, meta: AnalysisMeta): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), "utf-8");
}

export function loadMeta(projectRoot: string): AnalysisMeta | null {
  const filePath = join(resolveUaDir(projectRoot), META_FILE);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as AnalysisMeta;
}

export function saveFingerprints(projectRoot: string, store: FingerprintStore): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, FINGERPRINT_FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function loadFingerprints(projectRoot: string): FingerprintStore | null {
  const filePath = join(resolveUaDir(projectRoot), FINGERPRINT_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as FingerprintStore;
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG: ProjectConfig = { autoUpdate: false, outputLanguage: "en" };

export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), "utf-8");
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const filePath = join(resolveUaDir(projectRoot), CONFIG_FILE);
  if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

const DOMAIN_GRAPH_FILE = "domain-graph.json";

export function saveDomainGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);
  const sanitised = sanitiseFilePaths(graph, projectRoot);
  writeFileSync(
    join(dir, DOMAIN_GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadDomainGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(resolveUaDir(projectRoot), DOMAIN_GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid domain graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}

const DIFF_OVERLAY_FILE = "diff-overlay.json";

export function saveDiffOverlay(projectRoot: string, overlay: DiffOverlay): void {
  const dir = ensureDir(projectRoot);
  const sanitised: DiffOverlay = {
    ...overlay,
    changedFiles: overlay.changedFiles.map((fp) => sanitiseFilePath(fp, projectRoot)),
  };
  writeFileSync(join(dir, DIFF_OVERLAY_FILE), JSON.stringify(sanitised, null, 2), "utf-8");
}

export function loadDiffOverlay(projectRoot: string): DiffOverlay | null {
  const filePath = join(resolveUaDir(projectRoot), DIFF_OVERLAY_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as DiffOverlay;
  } catch {
    return null;
  }
}

#!/usr/bin/env node
/**
 * check-graph.mjs — deterministic CI guard for this repo's committed
 * self-knowledge graph. Spends ZERO LLM tokens.
 *
 * Two checks:
 *   1. SCHEMA (blocking)   — validateGraph() on knowledge-graph.json and
 *                            domain-graph.json. Catches corruption / bad
 *                            hand-edits. Exits non-zero on a fatal error.
 *   2. STALENESS (advisory)— rebuilds structural fingerprints for the current
 *                            source tree and compares against the committed
 *                            fingerprints.json (same logic as the auto-update
 *                            hook's Phase 1). If a source file was added,
 *                            removed, or structurally changed without the graph
 *                            being refreshed, it prints a ::warning:: telling
 *                            the author to run /understand. Non-blocking by
 *                            default (a stale graph is behind, not broken).
 *
 * Flags:
 *   --strict   treat staleness as an error too (exit non-zero)
 *
 * Usage: node scripts/check-graph.mjs [--strict]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const UA_DIR = resolve(REPO_ROOT, ".understand-anything");
const STRICT = process.argv.includes("--strict");

// Source extensions that carry graph-relevant structure — mirrors the
// auto-update hook's source filter (hooks/auto-update-prompt.md Phase 0).
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs",
  ".java", ".rb", ".cpp", ".c", ".h", ".cs", ".swift", ".kt", ".php",
]);

const CORE_DIST = resolve(
  REPO_ROOT,
  "understand-anything-plugin/packages/core/dist",
);

function ghError(msg) {
  console.error(`::error::${msg}`);
}
function ghWarning(msg) {
  console.log(`::warning::${msg}`);
}

async function loadCore() {
  const index = pathToFileURL(resolve(CORE_DIST, "index.js")).href;
  const schema = pathToFileURL(resolve(CORE_DIST, "schema.js")).href;
  if (!existsSync(resolve(CORE_DIST, "index.js"))) {
    ghError(
      "@understand-anything/core is not built. Run `pnpm --filter @understand-anything/core build` first.",
    );
    process.exit(1);
  }
  const core = await import(index);
  const { validateGraph } = await import(schema);
  return { ...core, validateGraph };
}

function validateOne(validateGraph, fileName) {
  const path = resolve(UA_DIR, fileName);
  if (!existsSync(path)) {
    ghError(`${fileName} is missing from .understand-anything/.`);
    return false;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    ghError(`${fileName} is not valid JSON: ${err.message}`);
    return false;
  }
  const result = validateGraph(data);
  if (!result.success) {
    ghError(
      `${fileName} failed schema validation: ${result.fatal ?? "see issues below"}`,
    );
    for (const issue of result.issues ?? []) {
      console.error(`    - ${issue.message ?? JSON.stringify(issue)}`);
    }
    return false;
  }
  console.log(`  ✓ ${fileName} — schema valid`);
  return true;
}

function trackedSourceFiles(filter) {
  const out = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => SOURCE_EXTS.has(extname(p)))
    .filter((p) => !filter.isIgnored(p));
}

async function checkStaleness(core) {
  const fpPath = resolve(UA_DIR, "fingerprints.json");
  if (!existsSync(fpPath)) {
    ghWarning(
      "fingerprints.json is missing — cannot run a staleness check. Run `/understand` to baseline.",
    );
    return STRICT ? false : true;
  }

  const store = core.loadFingerprints(REPO_ROOT);
  if (!store || !store.files) {
    ghWarning("fingerprints.json could not be loaded; skipping staleness check.");
    return STRICT ? false : true;
  }

  // Build a tree-sitter registry that mirrors build-fingerprints.mjs so the
  // comparison uses the same structural extraction as the committed baseline.
  const tsConfigs = core.builtinLanguageConfigs.filter((c) => c.treeSitter);
  const tsPlugin = new core.TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();
  const registry = new core.PluginRegistry();
  registry.register(tsPlugin);
  core.registerAllParsers(registry);

  const filter = core.createIgnoreFilter(REPO_ROOT);
  const currentSource = trackedSourceFiles(filter);
  const storedSource = Object.keys(store.files).filter((p) =>
    SOURCE_EXTS.has(extname(p)),
  );
  const candidates = [...new Set([...currentSource, ...storedSource])];

  const analysis = core.analyzeChanges(REPO_ROOT, candidates, store, registry);
  const drift = [
    ...analysis.newFiles.map((f) => `+ ${f} (new)`),
    ...analysis.deletedFiles.map((f) => `- ${f} (deleted)`),
    ...analysis.structurallyChangedFiles.map((f) => `~ ${f} (structural)`),
  ];

  if (drift.length === 0) {
    console.log(
      `  ✓ graph is in sync — ${candidates.length} source files checked, no structural drift`,
    );
    return true;
  }

  const lines = [
    `Knowledge graph is stale: ${drift.length} source file(s) changed structurally since the committed graph was generated.`,
    ...drift.slice(0, 25).map((d) => `    ${d}`),
    drift.length > 25 ? `    …and ${drift.length - 25} more` : "",
    "Run `/understand` (incremental) — or `/understand --full` — and commit the refreshed .understand-anything/ graph.",
  ].filter(Boolean);
  const msg = lines.join("\n");

  if (STRICT) {
    ghError(msg);
    return false;
  }
  ghWarning(msg);
  return true;
}

// The domain graph is DERIVED from the knowledge graph and is NOT refreshed by
// the auto-update hook (which only patches the knowledge graph). So it can drift
// even when the knowledge graph is current. Both files stamp the commit they were
// generated against — knowledge graph via meta.json, domain graph via
// project.gitCommitHash — so a mismatch is a cheap, deterministic staleness signal.
function checkDomainSync() {
  const domainPath = resolve(UA_DIR, "domain-graph.json");
  const metaPath = resolve(UA_DIR, "meta.json");
  if (!existsSync(domainPath)) {
    console.log("  · no domain-graph.json — skipping domain sync check");
    return true;
  }
  if (!existsSync(metaPath)) {
    ghWarning(
      "meta.json is missing — cannot verify the domain graph is in sync with the knowledge graph.",
    );
    return STRICT ? false : true;
  }
  let metaHash, domainHash;
  try {
    metaHash = JSON.parse(readFileSync(metaPath, "utf-8")).gitCommitHash;
    domainHash = JSON.parse(readFileSync(domainPath, "utf-8"))?.project?.gitCommitHash;
  } catch (err) {
    ghWarning(`Could not read commit hashes for the domain sync check: ${err.message}`);
    return STRICT ? false : true;
  }

  if (domainHash && metaHash && domainHash !== metaHash) {
    const msg = [
      "Domain graph is out of sync with the knowledge graph:",
      `    domain-graph.json was generated at ${domainHash.slice(0, 8)}, knowledge graph at ${metaHash.slice(0, 8)}.`,
      "The auto-update hook refreshes only the knowledge graph — re-run `/understand-domain` and commit the refreshed domain-graph.json.",
    ].join("\n");
    if (STRICT) {
      ghError(msg);
      return false;
    }
    ghWarning(msg);
    return true;
  }

  console.log(
    `  ✓ domain-graph.json in sync with the knowledge graph (${(metaHash ?? "").slice(0, 8)})`,
  );
  return true;
}

async function main() {
  const core = await loadCore();

  console.log("[check-graph] Schema validation (blocking):");
  const kgOk = validateOne(core.validateGraph, "knowledge-graph.json");
  const dgOk = validateOne(core.validateGraph, "domain-graph.json");
  const schemaOk = kgOk && dgOk;

  console.log("[check-graph] Staleness check (advisory unless --strict):");
  const freshOk = await checkStaleness(core);

  console.log("[check-graph] Domain sync check (advisory unless --strict):");
  const domainOk = checkDomainSync();

  if (!schemaOk) {
    ghError("Graph schema validation failed — see errors above.");
    process.exit(1);
  }
  if (!freshOk || !domainOk) {
    process.exit(1);
  }
  console.log("[check-graph] OK");
}

main().catch((err) => {
  ghError(`check-graph crashed: ${err.stack ?? err.message}`);
  process.exit(1);
});

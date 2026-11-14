#!/usr/bin/env node
/**
 * Benchmark: fuzzy-only search vs the hybrid semantic engine, on this
 * repository's own TypeScript (JSDoc as summaries; undocumented code has none).
 *
 *   pnpm --filter @understand-anything/core build
 *   node scripts/benchmark-semantic-search.mjs [--verbose] [--json]
 *
 * Reports MRR and success@k (a query succeeds at k if any correct answer is in
 * the top k) for each configuration, plus index build time and query latency.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { buildTsCorpus } from "./lib/ts-corpus.mjs";
import { QUERIES, HELDOUT_QUERIES } from "./lib/semantic-benchmark-queries.mjs";

const repo = resolve(import.meta.dirname, "..");
const plugin = resolve(repo, "understand-anything-plugin");
// A bare Windows path (C:\...) is not a valid ESM specifier; import it as a file:// URL.
const core = await import(pathToFileURL(resolve(plugin, "packages/core/dist/index.js")).href);
const { SearchEngine, HybridSearchEngine } = core;

const verbose = process.argv.includes("--verbose");
const asJson = process.argv.includes("--json");

const { nodes, edges } = buildTsCorpus(
  [resolve(plugin, "packages/core/src"), resolve(plugin, "src"), resolve(plugin, "packages/dashboard/src")],
  repo,
);

const relevantIds = (spec) =>
  new Set(
    spec.flatMap(([path, name]) =>
      nodes.filter((n) => n.filePath.endsWith(path) && n.name === name).map((n) => n.id),
    ),
  );

const buildTruth = (queries) => queries.map(([q, spec]) => ({ q, ids: relevantIds(spec), spec }));
const SETS = { dev: buildTruth(QUERIES), "held-out": buildTruth(HELDOUT_QUERIES) };
const missing = Object.values(SETS).flat().filter((t) => t.ids.size === 0);
if (missing.length) {
  console.error("Ground truth not found in corpus for:", missing.map((m) => m.q));
  process.exit(1);
}

const hybrid = new HybridSearchEngine(nodes, edges);
const fuzzyEngine = new SearchEngine(nodes);
const ids = (rs) => rs.map((r) => r.nodeId);
const configs = {
  "fuzzy (current)": (q) => ids(fuzzyEngine.search(q, { limit: 50 })),
  "bm25 + fuzzy": (q) => ids(hybrid.search(q, { mode: "keyword", limit: 50 })),
  "semantic channels only": (q) => ids(hybrid.search(q, { mode: "vector", limit: 50 })),
  "hybrid (default)": (q) => ids(hybrid.search(q, { limit: 50 })),
  "hybrid + graph boost": (q) => ids(hybrid.search(q, { graphBoost: true, limit: 50 })),
  "hybrid + feedback": (q) => ids(hybrid.search(q, { feedback: true, limit: 50 })),
  "hybrid + graph + feedback": (q) => ids(hybrid.search(q, { graphBoost: true, feedback: true, limit: 50 })),
};

const evaluate = (truth, run) => {
  const ranks = [];
  const t0 = performance.now();
  for (const t of truth) {
    const idx = run(t.q).findIndex((id) => t.ids.has(id));
    ranks.push(idx === -1 ? null : idx + 1);
  }
  const msPerQuery = (performance.now() - t0) / truth.length;
  const mrr = ranks.reduce((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length;
  const at = (k) => ranks.filter((r) => r !== null && r <= k).length / ranks.length;
  return { mrr, s1: at(1), s5: at(5), s10: at(10), msPerQuery, ranks };
};

const results = {};
for (const [name, run] of Object.entries(configs)) {
  results[name] = {};
  for (const [setName, truth] of Object.entries(SETS)) results[name][setName] = evaluate(truth, run);
}

if (asJson) {
  console.log(JSON.stringify({ corpus: { nodes: nodes.length, edges: edges.length }, results }, null, 2));
} else {
  const documented = nodes.filter((n) => n.summary).length;
  const counts = Object.entries(SETS).map(([k, v]) => `${k}=${v.length}`).join(", ");
  console.log(`Corpus: ${nodes.length} nodes (${documented} with JSDoc summaries), ${edges.length} edges. Queries: ${counts}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const f = (x) => x.toFixed(3);
  console.log(pad("", 28), Object.keys(SETS).map((k) => pad(`${k}: MRR  @1    @5    @10`, 34)).join(""));
  for (const [name, bySet] of Object.entries(results)) {
    console.log(pad(name, 28), Object.keys(SETS).map((k) => { const r = bySet[k]; return pad(`${f(r.mrr)} ${f(r.s1)} ${f(r.s5)} ${f(r.s10)}`, 34).padStart(34); }).join(""));
  }
  if (verbose) {
    for (const [setName, truth] of Object.entries(SETS)) {
      console.log(`\nFirst correct rank per query, ${setName} (— = not in top 50):`);
      const names = Object.keys(results);
      console.log(pad("query", 62), names.map((n) => pad(n.slice(0, 10), 11)).join(""));
      truth.forEach((t, i) => console.log(pad(t.q.slice(0, 60), 62), names.map((n) => pad(results[n][setName].ranks[i] ?? "—", 11)).join("")));
    }
  }
  const t0 = performance.now();
  new HybridSearchEngine(nodes, edges);
  const q = results["hybrid (default)"].dev.msPerQuery;
  console.log(`\nIndex build: ${(performance.now() - t0).toFixed(0)} ms for ${nodes.length} nodes; hybrid query: ${q.toFixed(1)} ms avg`);
}

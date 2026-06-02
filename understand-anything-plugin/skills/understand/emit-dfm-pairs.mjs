#!/usr/bin/env node
/**
 * emit-dfm-pairs.mjs — post-merge step for Pascal/Delphi projects.
 *
 * Pascal forms come in paired .pas + .dfm files (form source + form definition).
 * The .dfm carries the design-time component tree; the .pas carries the class
 * methods. They are conceptually one artifact and should be linked in the
 * knowledge graph with a `related` edge.
 *
 * This script reads an existing knowledge-graph.json (or assembled-graph.json),
 * scans for `file:*.pas` nodes whose filePath is matched by a `file:*.dfm`
 * sibling node, and emits `related` edges between them. Idempotent —
 * skips pairs that already have an edge.
 *
 * Usage:
 *   node emit-dfm-pairs.mjs <input-graph.json> <output-graph.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  process.stderr.write("Usage: node emit-dfm-pairs.mjs <input.json> <output.json>\n");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(inputPath, "utf8"));

// Index nodes by basename (without extension) — case-insensitive, since
// Delphi conventionally uses different casing across .pas and .dfm.
const byBase = new Map(); // base.toLowerCase() -> {pas?: id, dfm?: id}
for (const node of graph.nodes) {
  if (node.type !== "file" && node.type !== "config" && node.type !== "document") continue;
  const path = node.filePath ?? node.id.replace(/^file:/, "");
  const m = path.match(/^(.+?)\.(pas|dfm)$/i);
  if (!m) continue;
  const base = m[1].toLowerCase();
  const ext = m[2].toLowerCase();
  if (!byBase.has(base)) byBase.set(base, {});
  byBase.get(base)[ext] = node.id;
}

// Track existing edges so we don't double-emit.
const existing = new Set();
for (const e of graph.edges) existing.add(`${e.source}|${e.target}|${e.type}`);

let emitted = 0;
for (const [base, pair] of byBase) {
  if (!pair.pas || !pair.dfm) continue;
  const key1 = `${pair.pas}|${pair.dfm}|related`;
  const key2 = `${pair.dfm}|${pair.pas}|related`;
  if (existing.has(key1) || existing.has(key2)) continue;
  graph.edges.push({
    source: pair.pas,
    target: pair.dfm,
    type: "related",
    direction: "bidirectional",
    description: "Pascal unit + DFM form-definition pair (design-time component tree).",
    weight: 0.7,
  });
  existing.add(key1);
  emitted++;
}

writeFileSync(outputPath, JSON.stringify(graph, null, 2));
console.log(`Emitted ${emitted} new .pas↔.dfm pair edges. Graph now has ${graph.edges.length} edges total.`);

#!/usr/bin/env node
/**
 * resolve-external-class-refs.mjs
 *
 * Post-merge fix for inherits/implements edges that target `class:external:<Name>`
 * IDs which the file-analyzer agent emits when it can't tell which file declares
 * the parent (because the parent lives in a different batch). The merge step
 * drops these as "dangling target". This script:
 *
 *   1. Reads all batch-*.json files in <project-root>/.understand-anything/intermediate/
 *      to recover the original inherits/implements edges (which the merge dropped)
 *   2. Reads assembled-graph.json
 *   3. Builds a name → node ID map from all `class:*` nodes
 *   4. For every batch edge whose target is `class:external:<Name>`, if <Name>
 *      matches a class node, rewrite the edge target to that class's actual ID
 *      and re-add the edge to the assembled graph
 *   5. Genuinely-external classes (TForm, IInvokable, TXMLNode, etc.) stay dropped
 *
 * Usage: node resolve-external-class-refs.mjs <project-root>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.argv[2];
if (!projectRoot) {
  process.stderr.write("Usage: node resolve-external-class-refs.mjs <project-root>\n");
  process.exit(1);
}

const intermediate = join(projectRoot, ".understand-anything", "intermediate");
const assembledPath = join(intermediate, "assembled-graph.json");
const graph = JSON.parse(readFileSync(assembledPath, "utf8"));

// Build name → ID index from class nodes.
// If multiple class nodes share a name (e.g. helper records with same name in
// different files), prefer the canonical form-base class location.
const classNodes = graph.nodes.filter((n) => n.type === "class");
const nameToIds = new Map();
for (const n of classNodes) {
  // Skip placeholder `class:external:<Name>` stubs — those exist only because
  // some agents emitted them as nodes alongside the edge. They'd create false
  // multi-match ambiguity when we look up by name.
  if (n.id.startsWith("class:external:")) continue;
  // n.id is like `class:fCW2Report.pas:TfmCW2Report` — extract the name suffix.
  const m = n.id.match(/^class:[^:]+:(.+)$/);
  if (!m) continue;
  const name = m[1];
  if (!nameToIds.has(name)) nameToIds.set(name, []);
  nameToIds.get(name).push(n.id);
}

// Walk batch files for the original edges.
const batchFiles = readdirSync(intermediate)
  .filter((f) => /^batch-\d+\.json$/.test(f))
  .sort();

const existingEdgeKeys = new Set(graph.edges.map((e) => `${e.source}|${e.target}|${e.type}`));

let recovered = 0, ambiguousSkipped = 0, stillExternal = 0;
const reAdded = [];
for (const bf of batchFiles) {
  const batch = JSON.parse(readFileSync(join(intermediate, bf), "utf8"));
  for (const e of batch.edges ?? []) {
    if (e.type !== "inherits" && e.type !== "implements") continue;
    const m = String(e.target).match(/^class:external:(.+)$/);
    if (!m) continue;
    const name = m[1];
    const candidates = nameToIds.get(name);
    if (!candidates || candidates.length === 0) {
      stillExternal++;
      continue;
    }
    // Pick the single candidate; if multiple, skip to avoid wrong wiring.
    if (candidates.length > 1) {
      ambiguousSkipped++;
      continue;
    }
    const resolvedTarget = candidates[0];
    const key = `${e.source}|${resolvedTarget}|${e.type}`;
    if (existingEdgeKeys.has(key)) continue;
    graph.edges.push({
      source: e.source,
      target: resolvedTarget,
      type: e.type,
      direction: "forward",
      description: e.description ?? `${e.type} edge resolved cross-batch by class name`,
      weight: e.weight ?? (e.type === "inherits" ? 0.9 : 0.9),
    });
    existingEdgeKeys.add(key);
    recovered++;
    reAdded.push(`${e.source} → ${resolvedTarget} (${e.type})`);
  }
}

console.log(`Recovered ${recovered} cross-batch ${"inherits/implements"} edges`);
console.log(`Ambiguous (multiple matches, skipped): ${ambiguousSkipped}`);
console.log(`Still external (no in-graph match — TForm, IInvokable, etc.): ${stillExternal}`);
console.log(`Graph now has ${graph.edges.length} edges total.`);

writeFileSync(assembledPath, JSON.stringify(graph, null, 2));
console.log(`Wrote: ${assembledPath}`);

if (recovered > 0 && recovered <= 20) {
  console.log("\nSample recoveries:");
  for (const r of reAdded.slice(0, 10)) console.log(`  ${r}`);
}

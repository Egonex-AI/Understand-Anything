// skills/understand-ollama/validate-output.mjs
// Smoke check: load the produced knowledge-graph.json and validate the schema.
import { readFileSync } from "node:fs";
import * as core from "@understand-anything/core";

const root = process.argv[2];
if (!root) {
  console.error("Usage: validate-output.mjs <project-root>");
  process.exit(2);
}
const kgPath = `${root}/.understand-anything/knowledge-graph.json`;
const kg = JSON.parse(readFileSync(kgPath, "utf8"));
const schema = core.knowledgeGraphSchema ?? core.KnowledgeGraphSchema;
const r = schema?.safeParse?.(kg);
if (!r) { console.error("no schema found"); process.exit(1); }
if (!r.success) {
  console.error("FAIL: schema validation issues:");
  for (const i of r.error.issues.slice(0, 10)) console.error(`  - ${i.path.join(".")}: ${i.message}`);
  process.exit(1);
}
console.log(`OK: ${kg.nodes.length} nodes, ${kg.edges.length} edges, ${kg.layers.length} layers, ${(kg.tour ?? []).length} tour steps, project="${kg.project.name}"`);

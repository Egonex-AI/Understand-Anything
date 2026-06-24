#!/usr/bin/env node
/**
 * Generate a large fake knowledge graph for testing.
 *
 * Usage:
 *   node scripts/generate-large-graph.mjs [nodeCount]
 *   node scripts/generate-large-graph.mjs [nodeCount] --messy
 *
 * Flags:
 *   --messy   Inject LLM-style issues into ~20% of nodes/edges to test the
 *             dashboard robustness pipeline (Tier 1-3: null fields, wrong cases,
 *             missing fields, aliases, dangling refs, unrecognizable types).
 *
 * Default: 3000 nodes. Writes to .understand-anything/knowledge-graph.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const MESSY = args.includes("--messy");
const numArg = args.find((a) => !a.startsWith("--"));
const NODE_COUNT = parseInt(numArg || "3000", 10);
const EDGE_RATIO = 1.7; // edges per node (realistic for codebases)

const nodeTypes = ["file", "function", "class", "module", "concept"];
const edgeTypes = [
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "subscribes", "publishes", "middleware",
  "reads_from", "writes_to", "transforms", "validates",
  "depends_on", "tested_by", "configures",
  "related", "similar_to",
];
const complexities = ["simple", "moderate", "complex"];
const languages = ["TypeScript", "JavaScript", "Python", "Go", "Rust"];
const frameworks = ["React", "Express", "FastAPI", "Gin", "Actix"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateNodes(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const type = pick(nodeTypes);
    const name = `${type}_${i}`;
    nodes.push({
      id: `node-${i}`,
      type,
      name,
      filePath: type === "file" ? `src/${name}.ts` : undefined,
      summary: `Auto-generated ${type} node #${i} for performance testing.`,
      tags: [type, `group-${i % 20}`],
      complexity: pick(complexities),
    });
  }
  return nodes;
}

function generateEdges(nodes, edgeCount) {
  const edges = [];
  const seen = new Set();
  const n = nodes.length;

  for (let i = 0; i < edgeCount; i++) {
    let src, tgt;
    // Forward-only edges to avoid cycles (dagre blows the stack on large cyclic graphs)
    do {
      src = Math.floor(Math.random() * (n - 1));
      const offset = Math.floor(Math.random() * Math.min(50, n - src - 1)) + 1;
      tgt = src + offset;
    } while (tgt >= n || src === tgt || seen.has(`${src}-${tgt}`));

    seen.add(`${src}-${tgt}`);
    edges.push({
      source: nodes[src].id,
      target: nodes[tgt].id,
      type: pick(edgeTypes),
      direction: "forward",
      weight: Math.round(Math.random() * 100) / 100,
    });
  }
  return edges;
}

function generateLayers(nodes) {
  const layers = [];
  const layerNames = [
    "Presentation", "Application", "Domain", "Infrastructure",
    "API Gateway", "Data Access", "Utilities", "Testing",
  ];

  for (let i = 0; i < layerNames.length; i++) {
    const start = Math.floor((i / layerNames.length) * nodes.length);
    const end = Math.floor(((i + 1) / layerNames.length) * nodes.length);
    layers.push({
      id: `layer-${i}`,
      name: layerNames[i],
      description: `${layerNames[i]} layer (auto-generated)`,
      nodeIds: nodes.slice(start, end).map((n) => n.id),
    });
  }
  return layers;
}

function generateTour(nodes) {
  const steps = [];
  const stepCount = Math.min(8, Math.floor(nodes.length / 100));
  for (let i = 0; i < stepCount; i++) {
    const idx = Math.floor((i / stepCount) * nodes.length);
    steps.push({
      order: i + 1,
      title: `Step ${i + 1}: Explore ${nodes[idx].name}`,
      description: `This tour step highlights node **${nodes[idx].name}** and its surrounding context.`,
      nodeIds: [nodes[idx].id, nodes[Math.min(idx + 1, nodes.length - 1)].id],
    });
  }
  return steps;
}

// ── Messy injection (--messy flag) ──

// Tier 1: silent fixes — null optional fields, mixed-case enums
function injectTier1(node) {
  const issues = [];
  if (Math.random() < 0.5 && node.filePath !== undefined) {
    node.filePath = null; // null on optional field
    issues.push("null filePath");
  }
  if (Math.random() < 0.5) {
    node.type = node.type.toUpperCase(); // "FILE", "FUNCTION"
    issues.push(`uppercase type "${node.type}"`);
  }
  if (Math.random() < 0.5) {
    node.complexity = node.complexity[0].toUpperCase() + node.complexity.slice(1); // "Simple"
    issues.push(`mixed-case complexity "${node.complexity}"`);
  }
  return issues;
}

// Tier 2: auto-fixable — missing fields, aliases, string weights
function injectTier2Node(node) {
  const issues = [];
  const r = Math.random();
  if (r < 0.2) {
    delete node.complexity;
    issues.push("missing complexity");
  } else if (r < 0.4) {
    node.complexity = pick(["low", "easy", "medium", "intermediate", "high", "hard"]);
    issues.push(`complexity alias "${node.complexity}"`);
  }
  if (Math.random() < 0.3) {
    delete node.tags;
    issues.push("missing tags");
  }
  if (Math.random() < 0.2) {
    delete node.summary;
    issues.push("missing summary");
  }
  if (Math.random() < 0.15) {
    node.type = pick(["func", "fn", "method", "interface", "struct", "mod", "pkg"]);
    issues.push(`type alias "${node.type}"`);
  }
  return issues;
}

function injectTier2Edge(edge) {
  const issues = [];
  if (Math.random() < 0.3) {
    edge.weight = String(edge.weight); // string weight
    issues.push(`string weight "${edge.weight}"`);
  }
  if (Math.random() < 0.2) {
    delete edge.direction;
    issues.push("missing direction");
  } else if (Math.random() < 0.3) {
    edge.direction = pick(["to", "outbound", "from", "inbound", "both"]);
    issues.push(`direction alias "${edge.direction}"`);
  }
  if (Math.random() < 0.15) {
    edge.type = pick(["extends", "invokes", "uses", "requires", "relates_to"]);
    issues.push(`edge type alias "${edge.type}"`);
  }
  return issues;
}

// Tier 3: unrecoverable — missing id/name, dangling refs, bad types
function injectTier3Node(node) {
  const r = Math.random();
  if (r < 0.4) {
    delete node.id;
    return "missing id";
  } else if (r < 0.7) {
    delete node.name;
    return "missing name";
  } else {
    node.type = "totally_bogus_type";
    return `unrecognizable type "${node.type}"`;
  }
}

function injectTier3Edge(edge, _validNodeIds) {
  const r = Math.random();
  if (r < 0.4) {
    edge.target = "nonexistent-node-999999";
    return "dangling target ref";
  } else if (r < 0.7) {
    edge.source = "nonexistent-node-888888";
    return "dangling source ref";
  } else {
    edge.weight = "not_a_number";
    return "non-coercible weight";
  }
}

function applyMessy(nodes, edges) {
  const stats = { tier1: 0, tier2: 0, tier3: 0 };

  for (const node of nodes) {
    const r = Math.random();
    if (r < 0.10) {
      // ~10% get Tier 3 issues (will be dropped)
      injectTier3Node(node);
      stats.tier3++;
    } else if (r < 0.30) {
      // ~20% get Tier 2 issues (will be auto-corrected)
      injectTier2Node(node);
      stats.tier2++;
    } else if (r < 0.40) {
      // ~10% get Tier 1 issues (silently fixed)
      injectTier1(node);
      stats.tier1++;
    }
  }

  const validIds = new Set(nodes.filter((n) => n.id).map((n) => n.id));
  for (const edge of edges) {
    const r = Math.random();
    if (r < 0.05) {
      injectTier3Edge(edge, validIds);
      stats.tier3++;
    } else if (r < 0.20) {
      injectTier2Edge(edge);
      stats.tier2++;
    }
  }

  // Also set tour/layers to null (Tier 1 null-vs-empty)
  return stats;
}

// ── Generate ──

const nodes = generateNodes(NODE_COUNT);
const edgeCount = Math.floor(NODE_COUNT * EDGE_RATIO);
const edges = generateEdges(nodes, edgeCount);
const layers = generateLayers(nodes);
const tour = generateTour(nodes);

let messyStats = null;
if (MESSY) {
  messyStats = applyMessy(nodes, edges);
}

const graph = {
  version: "1.0",
  project: {
    name: "large-test-project",
    languages: languages.slice(0, 3),
    frameworks: frameworks.slice(0, 2),
    description: `Auto-generated project with ${NODE_COUNT} nodes for ${MESSY ? "robustness" : "performance"} testing.`,
    analyzedAt: new Date().toISOString(),
    gitCommitHash: "0000000000000000000000000000000000000000",
  },
  nodes,
  edges,
  layers: MESSY && Math.random() < 0.5 ? null : layers,
  tour: MESSY && Math.random() < 0.5 ? null : tour,
};

const outDir = resolve(process.cwd(), ".understand-anything");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "knowledge-graph.json");
writeFileSync(outPath, JSON.stringify(graph, null, 2));

console.log(`Generated knowledge graph${MESSY ? " (messy mode)" : ""}:`);
console.log(`  Nodes: ${nodes.length}`);
console.log(`  Edges: ${edges.length}`);
console.log(`  Layers: ${graph.layers === null ? "null (Tier 1 test)" : layers.length}`);
console.log(`  Tour steps: ${graph.tour === null ? "null (Tier 1 test)" : tour.length}`);
if (messyStats) {
  console.log(`  Injected issues:`);
  console.log(`    Tier 1 (silent fix): ~${messyStats.tier1} items`);
  console.log(`    Tier 2 (auto-correct): ~${messyStats.tier2} items`);
  console.log(`    Tier 3 (will be dropped): ~${messyStats.tier3} items`);
}
console.log(`  Written to: ${outPath}`);

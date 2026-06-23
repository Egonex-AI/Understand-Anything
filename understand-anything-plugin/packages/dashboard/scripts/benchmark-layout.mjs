// Stage 1 ELK layout perf benchmark.
//
// Mirrors `applyElkLayout` from `src/utils/elk-layout.ts` using `elkjs`
// directly. The dashboard build is a Vite bundle (hashed chunks), so it has
// no per-module `dist/utils/elk-layout.js` we can import. The Stage 1 hot
// path is `elk.layout()` on a sized input, which we reproduce faithfully
// here — same default node dimensions, same dim-defaulting behavior.
//
// Targets (spec §8.3):
//   - Stage 1 < 200ms at 500 nodes
//   - Stage 1 < 500ms at 3000 nodes
//
// Usage:
//   node understand-anything-plugin/packages/dashboard/scripts/benchmark-layout.mjs

import { performance } from "node:perf_hooks";
import ELK from "elkjs/lib/elk.bundled.js";

// Keep in lockstep with NODE_WIDTH / NODE_HEIGHT in src/utils/layout.ts.
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 120;

const elk = new ELK();

/**
 * Default missing width/height on every node (mirrors repairElkInput's
 * ensureNodeDimensions step). Stage 1 in prod always feeds ELK sized nodes,
 * but the repair pass is part of the measured path so we model it.
 */
function fillDims(children) {
  return children.map((c) => {
    const next = { ...c };
    if (next.width == null) next.width = DEFAULT_NODE_WIDTH;
    if (next.height == null) next.height = DEFAULT_NODE_HEIGHT;
    if (next.children) next.children = fillDims(next.children);
    return next;
  });
}

async function applyElkLayout(input) {
  const repaired = { ...input, children: fillDims(input.children) };
  return elk.layout(repaired);
}

/**
 * Synthetic Stage 1 graph: top-level container nodes with a sparse edge mesh.
 * Stage 1 only lays out containers (lazy children — see plan §3), so the
 * "node count" parameter is interpreted as total leaves while the container
 * count scales sub-linearly, matching production shape.
 */
function makeGraph(nodeCount, containerCount = Math.min(20, Math.ceil(nodeCount / 25))) {
  const containers = Array.from({ length: containerCount }, (_, i) => ({
    id: `c${i}`,
    width: 400,
    height: 300,
  }));
  const edges = [];
  for (let i = 0; i < containerCount; i++) {
    for (let j = i + 1; j < containerCount; j++) {
      if (Math.random() < 0.3) {
        edges.push({ id: `e-${i}-${j}`, sources: [`c${i}`], targets: [`c${j}`] });
      }
    }
  }
  return { id: "root", children: containers, edges };
}

async function bench(label, n) {
  const input = makeGraph(n);
  const t0 = performance.now();
  await applyElkLayout(input);
  const t1 = performance.now();
  const ms = t1 - t0;
  console.log(`${label} (${n} nodes): ${ms.toFixed(1)}ms`);
  return ms;
}

await bench("Stage1", 500);
await bench("Stage1", 1000);
await bench("Stage1", 3000);

// Per-layer aggregation perf benchmark.
//
// Mirrors the BEFORE shape (graph.nodes.filter(n => layer.nodeIds.includes(n.id))
// per layer) and the AFTER shape (single nodesById Map + iterate layer.nodeIds)
// from `useOverviewGraph` in `src/components/GraphView.tsx`. Issue #102 reported
// a 4.8 MB knowledge graph that froze the dashboard on overview render — the
// quadratic Array.includes pass was the dominant synchronous cost.
//
// We can't import the dashboard helper directly (Vite-bundled, no
// per-module dist), so the new shape is reproduced here in lockstep with
// `src/utils/layerStats.ts::computeLayerStats`.
//
// Usage:
//   node understand-anything-plugin/packages/dashboard/scripts/benchmark-aggregations.mjs

import { performance } from "node:perf_hooks";

function makeGraph(layerCount, nodesPerLayer) {
  const nodes = [];
  const layers = [];
  for (let li = 0; li < layerCount; li++) {
    const ids = [];
    for (let ni = 0; ni < nodesPerLayer; ni++) {
      const id = `n-${li}-${ni}`;
      const complexity = ["simple", "moderate", "complex"][(li + ni) % 3];
      nodes.push({ id, complexity });
      ids.push(id);
    }
    layers.push({ id: `L${li}`, nodeIds: ids });
  }
  return { nodes, layers };
}

// --- BEFORE: O(N × K × L) per overview render ----------------------------
function aggregateBefore(graph) {
  const out = [];
  for (const layer of graph.layers) {
    const memberNodes = graph.nodes.filter((n) => layer.nodeIds.includes(n.id));
    const c = { simple: 0, moderate: 0, complex: 0 };
    for (const n of memberNodes) c[n.complexity]++;
    const aggregate =
      c.complex > memberNodes.length * 0.3
        ? "complex"
        : c.moderate > memberNodes.length * 0.3
          ? "moderate"
          : "simple";
    out.push({ id: layer.id, aggregateComplexity: aggregate });
  }
  return out;
}

// --- AFTER: O(N + Σ K_i) per overview render ----------------------------
function aggregateAfter(graph, nodesById) {
  const out = [];
  for (const layer of graph.layers) {
    const c = { simple: 0, moderate: 0, complex: 0 };
    let resolved = 0;
    for (const nid of layer.nodeIds) {
      const node = nodesById.get(nid);
      if (!node) continue;
      resolved++;
      c[node.complexity]++;
    }
    const aggregate =
      c.complex > resolved * 0.3
        ? "complex"
        : c.moderate > resolved * 0.3
          ? "moderate"
          : "simple";
    out.push({ id: layer.id, aggregateComplexity: aggregate });
  }
  return out;
}

function bench(label, layerCount, nodesPerLayer) {
  const graph = makeGraph(layerCount, nodesPerLayer);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  const t0 = performance.now();
  const before = aggregateBefore(graph);
  const t1 = performance.now();
  const after = aggregateAfter(graph, nodesById);
  const t2 = performance.now();

  const beforeMs = t1 - t0;
  const afterMs = t2 - t1;
  const speedup = afterMs > 0 ? beforeMs / afterMs : Infinity;
  const parity = JSON.stringify(before) === JSON.stringify(after);
  console.log(
    `${label} (${layerCount} layers × ${nodesPerLayer} nodes = ${graph.nodes.length} total): ` +
      `BEFORE ${beforeMs.toFixed(1)}ms | AFTER ${afterMs.toFixed(1)}ms | ` +
      `${speedup.toFixed(1)}× faster | parity ${parity}`,
  );
}

bench("small", 10, 50);
bench("medium", 30, 100);
bench("large", 50, 200);
bench("issue#102 shape", 100, 200);

#!/usr/bin/env node
// Keeps manual deep-dive analysis of the domain graph from being lost when
// /understand-domain regenerates .ua/domain-graph.json from scratch.
//
//   capture [--note "..."]  Save manual edits in domain-graph.json (compared with the
//                           last generated baseline) into domain-curated.json.
//                           Run after every manual/deep-dive edit of domain-graph.json.
//   apply                   Run right after /understand-domain. Stores the fresh output
//                           as the new baseline, then re-applies domain-curated.json on top.
//   status                  Show what is curated and whether the graph is merged.
//
// Options: --dir <ua-dir> (default: ./.understand-anything if it exists, else ./.ua),
//          --root <project-root> (default: parent of --dir),
//          --force (apply even if the graph looks merged).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = name => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : undefined; };
// Default data dir: the legacy .understand-anything/ when present, otherwise .ua/.
const defaultDir = () => {
  const legacy = path.join(process.cwd(), '.understand-anything');
  return fs.existsSync(legacy) ? legacy : path.join(process.cwd(), '.ua');
};
const UA = path.resolve(opt('--dir') || defaultDir());
const ROOT = path.resolve(opt('--root') || path.dirname(UA));
const F = {
  graph: path.join(UA, 'domain-graph.json'),
  base: path.join(UA, 'domain-graph.generated.json'),
  cur: path.join(UA, 'domain-curated.json'),
  bak: path.join(UA, 'domain-graph.before-apply.json'),
};
const SYSTEM_TAGS = new Set(['curated', 'needs-review']);

const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const write = (f, o) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o, null, 2)); fs.renameSync(tmp, f); };
const ekey = e => `${e.source}|${e.target}|${e.type}`;
const clean = n => ({ ...n, tags: (n.tags || []).filter(t => !SYSTEM_TAGS.has(t)) });
const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
const uniq = arr => { const seen = new Set(); return arr.filter(x => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const emptyCurated = () => ({ version: 1, updatedAt: null, nodes: {}, edges: {}, removedNodes: [], removedEdges: [], log: [] });
const loadCurated = () => (fs.existsSync(F.cur) ? read(F.cur) : emptyCurated());
const isMerged = g => g.nodes.some(n => (n.tags || []).includes('curated'));

// Three-way merge: curated values win. From arrays, only items that are new in this
// regenerate (absent from the previous baseline) are appended, so facts the user already
// corrected or removed do not come back.
function mergeMeta(gen = {}, cur = {}, prev = {}) {
  const out = { ...gen };
  for (const [k, v] of Object.entries(cur)) {
    const g = gen[k];
    if (Array.isArray(v) && Array.isArray(g)) {
      const old = new Set((Array.isArray(prev[k]) ? prev[k] : []).map(x => JSON.stringify(x)));
      out[k] = uniq([...v, ...g.filter(x => !old.has(JSON.stringify(x)))]);
    }
    else if (v && typeof v === 'object' && !Array.isArray(v) && g && typeof g === 'object' && !Array.isArray(g)) out[k] = { ...g, ...v };
    else out[k] = v;
  }
  return out;
}

function capture() {
  if (!fs.existsSync(F.base)) throw new Error(`No baseline ${F.base}. Run "apply" right after /understand-domain first.`);
  const g = read(F.graph), base = read(F.base), c = loadCurated();
  const baseNodes = new Map(base.nodes.map(n => [n.id, n]));
  const curIds = new Set(g.nodes.map(n => n.id));
  const baseEdges = new Map(base.edges.map(e => [ekey(e), e]));
  const curEdges = new Map(g.edges.map(e => [ekey(e), e]));
  const stat = { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, edgesAdded: 0, edgesRemoved: 0 };

  for (const n of g.nodes) {
    const b = baseNodes.get(n.id);
    if (!b || !same(n, b)) {
      if (!c.nodes[n.id] || !same(c.nodes[n.id], n)) stat[b ? 'nodesChanged' : 'nodesAdded']++;
      c.nodes[n.id] = clean(n);
    }
  }
  // Nodes that were curated but are now deleted, or generated nodes that were deleted on purpose.
  for (const id of Object.keys(c.nodes)) if (!curIds.has(id)) { delete c.nodes[id]; stat.nodesRemoved++; }
  const removedNodes = new Set(c.removedNodes);
  for (const id of baseNodes.keys()) if (!curIds.has(id) && !removedNodes.has(id)) { removedNodes.add(id); stat.nodesRemoved++; }
  for (const id of curIds) removedNodes.delete(id);

  for (const [k, e] of curEdges) {
    const b = baseEdges.get(k);
    if (!b || JSON.stringify(b) !== JSON.stringify(e)) { if (JSON.stringify(c.edges[k]) !== JSON.stringify(e)) stat.edgesAdded++; c.edges[k] = e; }
  }
  for (const k of Object.keys(c.edges)) if (!curEdges.has(k)) delete c.edges[k];
  const removedEdges = new Set(c.removedEdges);
  for (const k of baseEdges.keys()) if (!curEdges.has(k) && !removedEdges.has(k)) { removedEdges.add(k); stat.edgesRemoved++; }
  for (const k of curEdges.keys()) removedEdges.delete(k);

  // A curated flow owns its whole step list, including steps that did not change,
  // so a regenerate that renames or drops those steps cannot break the flow.
  const curNodes = new Map(g.nodes.map(n => [n.id, n]));
  // A flow whose step list was edited (steps added/removed) is curated too, even if the flow node itself is unchanged.
  const touchedFlows = new Set([
    ...Object.values(c.edges).filter(e => e.type === 'flow_step').map(e => e.source),
    ...[...baseEdges.values()].filter(e => e.type === 'flow_step' && removedEdges.has(ekey(e))).map(e => e.source),
  ]);
  for (const id of touchedFlows) { const f = curNodes.get(id); if (f && !c.nodes[id]) c.nodes[id] = clean(f); }
  for (const flow of Object.values(c.nodes).filter(n => n.type === 'flow')) {
    for (const e of g.edges.filter(x => x.type === 'flow_step' && x.source === flow.id)) {
      c.edges[ekey(e)] = e;
      const step = curNodes.get(e.target);
      if (step && !c.nodes[step.id]) c.nodes[step.id] = clean(step);
    }
  }

  c.removedNodes = [...removedNodes].sort();
  c.removedEdges = [...removedEdges].sort();
  c.updatedAt = new Date().toISOString();
  c.log.push({ at: c.updatedAt, action: 'capture', note: opt('--note') || null, ...stat });
  write(F.cur, c);

  // Mark curated nodes in the live graph so the dashboard shows them and apply can detect a merged graph.
  const curated = new Set(Object.keys(c.nodes));
  g.nodes.forEach(n => { const t = (n.tags || []).filter(x => x !== 'curated'); if (curated.has(n.id)) t.push('curated'); n.tags = t; });
  write(F.graph, g);
  return { ...stat, curatedNodes: curated.size, curatedEdges: Object.keys(c.edges).length, removedNodes: c.removedNodes.length, removedEdges: c.removedEdges.length };
}

function apply() {
  const gen = read(F.graph), c = loadCurated();
  if (isMerged(gen) && !args.includes('--force')) throw new Error('domain-graph.json already contains curated nodes, so it is not fresh /understand-domain output. Run /understand-domain first, or "capture" to save edits. Use --force to override.');
  const prevBase = fs.existsSync(F.base) ? new Map(read(F.base).nodes.map(n => [n.id, n])) : new Map();
  fs.copyFileSync(F.graph, F.bak);
  write(F.base, gen);

  const removedNodes = new Set(c.removedNodes), removedEdges = new Set(c.removedEdges);
  const nodes = new Map(gen.nodes.filter(n => !removedNodes.has(n.id)).map(n => [n.id, n]));
  for (const [id, cn] of Object.entries(c.nodes)) {
    const g = nodes.get(id);
    const p = prevBase.get(id) || {};
    const merged = g && cn.type === 'domain'
      ? { ...g, ...cn, tags: mergeMeta({ t: g.tags || [] }, { t: cn.tags || [] }, { t: p.tags || [] }).t, domainMeta: mergeMeta(g.domainMeta, cn.domainMeta, p.domainMeta) }
      : { ...cn };
    merged.tags = uniq([...(merged.tags || []).filter(t => !SYSTEM_TAGS.has(t)), 'curated']);
    nodes.set(id, merged);
  }

  // A curated flow owns its step list: drop regenerated steps attached to it.
  const curatedFlows = new Set(Object.values(c.nodes).filter(n => n.type === 'flow').map(n => n.id));
  const edges = new Map();
  for (const e of gen.edges) {
    const k = ekey(e);
    if (removedEdges.has(k) || removedNodes.has(e.source) || removedNodes.has(e.target)) continue;
    if (e.type === 'flow_step' && curatedFlows.has(e.source) && !c.edges[k]) continue;
    edges.set(k, e);
  }
  for (const [k, e] of Object.entries(c.edges)) edges.set(k, e);

  const report = { droppedOrphanSteps: [], droppedDanglingEdges: [], needsReview: [], possibleDuplicates: [] };
  const hasParent = new Set([...edges.values()].filter(e => e.type === 'flow_step').map(e => e.target));
  for (const [id, n] of nodes) if (n.type === 'step' && !hasParent.has(id) && !c.nodes[id]) { nodes.delete(id); report.droppedOrphanSteps.push(id); }
  for (const [k, e] of edges) if (!nodes.has(e.source) || !nodes.has(e.target)) { edges.delete(k); report.droppedDanglingEdges.push(k); }

  // Curated code links can go stale when the code moves; flag them instead of dropping them.
  const lineCount = new Map();
  for (const n of nodes.values()) {
    if (!n.filePath || !c.nodes[n.id]) continue;
    const p = path.join(ROOT, n.filePath);
    let reason = null;
    if (!fs.existsSync(p)) reason = 'file missing';
    else if (n.lineRange) {
      if (!lineCount.has(p)) lineCount.set(p, fs.readFileSync(p, 'utf8').split(/\r?\n/).length);
      if (n.lineRange[1] > lineCount.get(p)) reason = `lineRange ${n.lineRange.join('-')} beyond ${lineCount.get(p)} lines`;
    }
    if (reason) { n.tags.push('needs-review'); report.needsReview.push(`${n.id}: ${reason}`); }
  }

  // Regenerated flows/domains that probably describe something already curated (IDs are not stable across runs).
  const words = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const jaccard = (a, b) => { const A = words(a), B = words(b); const i = [...A].filter(x => B.has(x)).length; return i / (A.size + B.size - i || 1); };
  const curatedOf = type => [...nodes.values()].filter(n => n.type === type && c.nodes[n.id]);
  for (const n of nodes.values()) {
    if (c.nodes[n.id] || !['flow', 'domain'].includes(n.type)) continue;
    for (const k of curatedOf(n.type)) {
      const sameEntry = n.type === 'flow' && n.domainMeta?.entryPoint && n.domainMeta.entryPoint === k.domainMeta?.entryPoint;
      const score = jaccard(n.name, k.name);
      if (sameEntry || score >= 0.5) report.possibleDuplicates.push(`${n.id} ~ ${k.id} (${sameEntry ? 'same entryPoint' : 'name similarity ' + score.toFixed(2)})`);
    }
  }

  const out = { ...gen, nodes: [...nodes.values()], edges: [...edges.values()] };
  write(F.graph, out);
  c.log.push({ at: new Date().toISOString(), action: 'apply', baselineSha256: crypto.createHash('sha256').update(JSON.stringify(gen)).digest('hex').slice(0, 16), ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) });
  write(F.cur, c);
  return { nodes: out.nodes.length, edges: out.edges.length, curatedNodes: Object.keys(c.nodes).length, ...report };
}

function status() {
  const c = loadCurated(), g = fs.existsSync(F.graph) ? read(F.graph) : null;
  const byType = {}; Object.values(c.nodes).forEach(n => { byType[n.type] = (byType[n.type] || 0) + 1; });
  return { graphMerged: g ? isMerged(g) : null, baseline: fs.existsSync(F.base), curatedNodesByType: byType, curatedEdges: Object.keys(c.edges).length, removedNodes: c.removedNodes.length, removedEdges: c.removedEdges.length, lastLog: c.log.slice(-3) };
}

try {
  const run = { capture, apply, status }[cmd];
  if (!run) { console.error('Usage: node .ua/domain-curation.mjs <capture [--note "..."] | apply [--force] | status> [--dir <ua-dir>]'); process.exit(2); }
  console.log(JSON.stringify(run(), null, 2));
} catch (e) { console.error('Error: ' + e.message); process.exit(1); }

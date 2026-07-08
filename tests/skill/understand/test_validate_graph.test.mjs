import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/validate-graph.mjs',
);

// A minimal, fully-valid KnowledgeGraph: one file node assigned to one layer,
// referenced by one tour step, with one self-consistent edge.
function validGraph() {
  return {
    version: '1.0.0',
    project: {
      name: 'demo',
      languages: ['python'],
      frameworks: ['PyTorch'],
      description: 'A demo project.',
      analyzedAt: '2026-01-01T00:00:00Z',
      gitCommitHash: 'abc123',
    },
    nodes: [
      { id: 'file:a.py', type: 'file', name: 'a.py', summary: 'Module A.', tags: ['core'] },
      { id: 'file:b.py', type: 'file', name: 'b.py', summary: 'Module B.', tags: ['core'] },
    ],
    edges: [{ source: 'file:a.py', target: 'file:b.py', type: 'imports', weight: 0.7 }],
    layers: [
      { id: 'layer:app', name: 'App', description: 'Application.', nodeIds: ['file:a.py', 'file:b.py'] },
    ],
    tour: [{ order: 1, title: 'Start', description: 'Begin here.', nodeIds: ['file:a.py'] }],
  };
}

describe('validate-graph.mjs', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ua-validate-test-'));
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function run(graph) {
    const graphPath = join(dir, 'assembled-graph.json');
    const outPath = join(dir, 'review.json');
    writeFileSync(graphPath, JSON.stringify(graph));
    const result = spawnSync('node', [SCRIPT, graphPath, outPath], { encoding: 'utf-8' });
    const report = result.status === 0 ? JSON.parse(readFileSync(outPath, 'utf-8')) : null;
    return { result, report };
  }

  it('passes a fully valid graph with no issues', () => {
    const { result, report } = run(validGraph());
    expect(result.status).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.stats.totalNodes).toBe(2);
    expect(report.stats.totalEdges).toBe(1);
    expect(report.stats.totalLayers).toBe(1);
    expect(report.stats.tourSteps).toBe(1);
  });

  it('flags a missing project.description (the dashboard-load regression)', () => {
    const g = validGraph();
    delete g.project.description;
    const { report } = run(g);
    expect(report.issues).toContain('graph.project.description is missing or not a non-empty string');
  });

  it('flags an empty-string project field', () => {
    const g = validGraph();
    g.project.name = '   ';
    const { report } = run(g);
    expect(report.issues).toContain('graph.project.name is missing or not a non-empty string');
  });

  it('flags a missing project object entirely', () => {
    const g = validGraph();
    delete g.project;
    const { report } = run(g);
    expect(report.issues).toContain('graph.project metadata is missing or not an object');
  });

  it('flags project.languages when it is not an array', () => {
    const g = validGraph();
    g.project.languages = 'python';
    const { report } = run(g);
    expect(report.issues).toContain('graph.project.languages is missing or not an array');
  });

  it('still flags a dangling edge endpoint', () => {
    const g = validGraph();
    g.edges.push({ source: 'file:a.py', target: 'file:missing.py', type: 'imports', weight: 0.7 });
    const { report } = run(g);
    expect(report.issues.some(i => i.includes("target 'file:missing.py' not found"))).toBe(true);
  });

  it('still flags a file node not assigned to any layer', () => {
    const g = validGraph();
    g.layers[0].nodeIds = ['file:a.py']; // drop file:b.py
    const { report } = run(g);
    expect(report.issues).toContain("File node 'file:b.py' not in any layer");
  });

  it('still flags a node appearing in multiple layers', () => {
    const g = validGraph();
    g.layers.push({ id: 'layer:dup', name: 'Dup', description: 'Duplicate.', nodeIds: ['file:a.py'] });
    const { report } = run(g);
    expect(report.issues).toContain("Node 'file:a.py' appears in multiple layers");
  });

  it('warns on an orphan node without failing', () => {
    const g = validGraph();
    g.nodes.push({ id: 'file:c.py', type: 'file', name: 'c.py', summary: 'Orphan.', tags: ['core'] });
    g.layers[0].nodeIds.push('file:c.py');
    const { report } = run(g);
    expect(report.warnings).toContain("Node 'file:c.py' has no edges (orphan)");
  });

  it('exits non-zero on malformed JSON input', () => {
    const graphPath = join(dir, 'assembled-graph.json');
    const outPath = join(dir, 'review.json');
    writeFileSync(graphPath, '{ not valid json');
    const result = spawnSync('node', [SCRIPT, graphPath, outPath], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/validate-graph.mjs');

function runScript(inputPath, outputPath, extraArgs = []) {
  return spawnSync('node', [SCRIPT, inputPath, outputPath, ...extraArgs], {
    encoding: 'utf-8',
  });
}

function writeGraph(dir, graph) {
  const inputPath = join(dir, 'graph.json');
  writeFileSync(inputPath, JSON.stringify(graph, null, 2));
  return inputPath;
}

function readReport(dir) {
  const reportPath = join(dir, 'report.json');
  return JSON.parse(readFileSync(reportPath, 'utf-8'));
}

const validGraph = {
  version: '1.0.0',
  project: {
    name: 'test-project',
    languages: ['typescript'],
    frameworks: ['vitest'],
    description: 'A test project',
    analyzedAt: '2026-06-07T00:00:00.000Z',
    gitCommitHash: 'abc123',
  },
  nodes: [
    {
      id: 'file:src/index.ts',
      type: 'file',
      name: 'index.ts',
      summary: 'Entry point',
      tags: ['entry'],
      complexity: 'simple',
    },
  ],
  edges: [
    {
      source: 'file:src/index.ts',
      target: 'file:src/index.ts',
      type: 'imports',
      direction: 'forward',
      weight: 0.8,
    },
  ],
  layers: [
    {
      id: 'layer:core',
      name: 'Core',
      description: 'Core layer',
      nodeIds: ['file:src/index.ts'],
    },
  ],
  tour: [
    {
      order: 1,
      title: 'Start here',
      description: 'Begin with the entry point',
      nodeIds: ['file:src/index.ts'],
    },
  ],
};

const fragmentGraph = {
  nodes: [
    {
      id: 'file:src/foo.ts',
      type: 'file',
      name: 'foo.ts',
      summary: 'A file',
      tags: ['util'],
      complexity: 'moderate',
    },
    {
      id: 'function:src/bar.ts:doStuff',
      type: 'function',
      name: 'doStuff',
      summary: 'Does stuff',
      tags: [],
      complexity: 'simple',
    },
  ],
  edges: [
    {
      source: 'file:src/foo.ts',
      target: 'function:src/bar.ts:doStuff',
      type: 'calls',
      direction: 'forward',
      weight: 0.7,
    },
  ],
};

describe('validate-graph.mjs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ua-vg-test-'));
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates a correct knowledge graph — passes', () => {
    const inputPath = writeGraph(tmpDir, validGraph);
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const report = readReport(tmpDir);
    expect(report.passed).toBe(true);
    expect(report.fatal).toBeNull();
    expect(report.stats.totalNodes).toBe(1);
    expect(report.stats.totalEdges).toBe(1);
  });

  it('validates a fragment graph (no project/layers/tour) — passes with auto-fix', () => {
    const inputPath = writeGraph(tmpDir, fragmentGraph);
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(0);

    const report = readReport(tmpDir);
    expect(report.passed).toBe(true);
    expect(report.stats.totalNodes).toBe(2);
    expect(report.stats.totalEdges).toBe(1);
    // project should have been auto-filled
    expect(report.stats.hasProject).toBe(true);
  });

  it('auto-fixes complexity aliases', () => {
    const graph = structuredClone(validGraph);
    graph.nodes[0].complexity = 'low';
    const inputPath = writeGraph(tmpDir, graph);
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(0);

    const report = readReport(tmpDir);
    expect(report.passed).toBe(true);
    // Should have auto-corrected complexity
    const correctedIssues = report.issues.filter(i => i.category === 'alias' || i.category === 'missing-field');
    expect(correctedIssues.length).toBeGreaterThanOrEqual(1);
  });

  it('drops node with missing id — exits 2 (dropped issues)', () => {
    const graph = structuredClone(validGraph);
    graph.nodes.push({
      // no id
      type: 'file',
      name: 'no-id.ts',
      summary: 'Missing id',
      tags: ['broken'],
      complexity: 'simple',
    });
    const inputPath = writeGraph(tmpDir, graph);
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    // Should exit 2 (dropped issues, no fatal)
    expect(result.status).toBe(2);

    const report = readReport(tmpDir);
    expect(report.passed).toBe(false);
    expect(report.issues.some(i => i.level === 'dropped')).toBe(true);
    // The valid node should still be present
    expect(report.stats.totalNodes).toBe(1);
  });

  it('drops edge with missing source — exits 2', () => {
    const graph = structuredClone(validGraph);
    graph.edges.push({
      source: 'nonexistent:node',
      target: 'file:src/index.ts',
      type: 'imports',
      direction: 'forward',
      weight: 0.5,
    });
    const inputPath = writeGraph(tmpDir, graph);
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(2);

    const report = readReport(tmpDir);
    expect(report.issues.some(i => i.category === 'invalid-reference')).toBe(true);
  });

  it('fatal exit on invalid JSON', () => {
    const inputPath = join(tmpDir, 'bad.json');
    writeFileSync(inputPath, 'not valid json');
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(1);
    // Script should write a report even on parse failure
    const report = readReport(tmpDir);
    expect(report.fatal).toBeDefined();
  });

  it('fatal exit on non-object JSON', () => {
    const inputPath = join(tmpDir, 'array.json');
    writeFileSync(inputPath, JSON.stringify([1, 2, 3]));
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(1);
    const report = readReport(tmpDir);
    expect(report.fatal).toBeDefined();
  });

  it('fatal exit when all nodes are dropped', () => {
    const graph = {
      nodes: [
        { type: 'file', name: 'no-id', summary: 'x', tags: ['a'], complexity: 'simple' },
      ],
      edges: [],
    };
    const inputPath = writeGraph(tmpDir, graph);
    const outputPath = join(tmpDir, 'report.json');

    const result = runScript(inputPath, outputPath);
    expect(result.status).toBe(1);

    const report = readReport(tmpDir);
    expect(report.fatal).toBeDefined();
  });
});

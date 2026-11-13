import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const SCRIPT = join(repoRoot, 'understand-anything-plugin', 'skills', 'understand', 'normalize-tour.mjs');

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setupFixture({ tour, assembled }) {
  const root = mkdtempSync(join(tmpdir(), 'ua-normalize-tour-'));
  roots.push(root);
  const intermediate = join(root, '.ua', 'intermediate');
  mkdirSync(intermediate, { recursive: true });
  if (assembled !== null) {
    writeFileSync(
      join(intermediate, 'assembled-graph.json'),
      typeof assembled === 'string' ? assembled : JSON.stringify(assembled),
    );
  }
  if (tour !== null) {
    writeFileSync(
      join(intermediate, 'tour.json'),
      typeof tour === 'string' ? tour : JSON.stringify(tour),
    );
  }
  return { root, intermediate };
}

function runScript(root) {
  return spawnSync(process.execPath, [SCRIPT, root], { cwd: root, encoding: 'utf-8' });
}

const ASSEMBLED = {
  nodes: [
    { id: 'document:README.md', type: 'document', filePath: 'README.md', name: 'README' },
    { id: 'file:src/main.tsx', type: 'file', filePath: 'src/main.tsx', name: 'main' },
    { id: 'file:src/utils.ts', type: 'file', filePath: 'src/utils.ts', name: 'utils' },
    { id: 'config:package.json', type: 'config', filePath: 'package.json', name: 'package' },
  ],
  edges: [],
};

describe('normalize-tour.mjs', () => {
  it('resolves raw paths through the finalizer pathIndex and applies the full normalization', () => {
    const { root, intermediate } = setupFixture({
      assembled: ASSEMBLED,
      tour: {
        steps: [
          { order: 2, title: 'Entry', description: 'Boots.', nodeIds: ['file:src/main.tsx', 'README.md'] },
          { order: 1, nodesToInspect: ['src/utils.ts', 'package.json', 'file:src/missing.tsx'], whyItMatters: 'Helpers first.' },
          { order: 3, title: 'Config', description: 'Manifest.', nodeIds: ['config:package.json'] },
        ],
      },
    });
    const result = runScript(root);
    expect(result.status).toBe(0);
    const normalized = JSON.parse(readFileSync(join(intermediate, 'tour.normalized.json'), 'utf-8'));
    expect(normalized).toHaveLength(3);
    // A raw README.md reference resolves to the real document: node — the
    // hand-written rule would have made it a dangling file:README.md.
    expect(normalized.find(step => step.order === 2).nodeIds).toEqual([
      'file:src/main.tsx',
      'document:README.md',
    ]);
    const step1 = normalized.find(step => step.order === 1);
    expect(step1.description).toBe('Helpers first.');
    expect(step1.nodeIds).toEqual(['file:src/utils.ts', 'config:package.json']);
    expect(normalized.find(step => step.order === 3).nodeIds).toEqual(['config:package.json']);
  });

  it('sorts steps by order and drops dangling references', () => {
    const { root, intermediate } = setupFixture({
      assembled: ASSEMBLED,
      tour: [
        { order: 3, title: 'Third', description: 'c', nodeIds: ['file:src/missing.tsx'] },
        { order: 1, title: 'First', description: 'a', nodeIds: ['file:src/main.tsx'] },
      ],
    });
    const result = runScript(root);
    expect(result.status).toBe(0);
    const normalized = JSON.parse(readFileSync(join(intermediate, 'tour.normalized.json'), 'utf-8'));
    expect(normalized.map(step => step.title)).toEqual(['First', 'Third']);
    expect(normalized[1].nodeIds).toEqual([]);
  });

  it('fails with exit 1 when assembled-graph.json is missing', () => {
    const { root } = setupFixture({ assembled: null, tour: [{ order: 1, title: 'S', description: 'd', nodeIds: [] }] });
    const result = runScript(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('assembled-graph.json is missing');
  });

  it('fails with exit 1 when tour.json is missing', () => {
    const { root } = setupFixture({ assembled: ASSEMBLED, tour: null });
    const result = runScript(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tour.json is missing');
  });

  it('fails with exit 1 when the assembled graph has no usable nodes', () => {
    const { root } = setupFixture({ assembled: { nodes: [], edges: [] }, tour: [] });
    const result = runScript(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no usable nodes');
  });

  it('accepts the legacy .understand-anything data directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-normalize-tour-legacy-'));
    roots.push(root);
    const intermediate = join(root, '.understand-anything', 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(intermediate, 'assembled-graph.json'), JSON.stringify(ASSEMBLED));
    writeFileSync(join(intermediate, 'tour.json'), JSON.stringify([
      { order: 1, title: 'S', description: 'd', nodeIds: ['file:src/main.tsx'] },
    ]));
    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(existsSync(join(root, '.understand-anything', 'intermediate', 'tour.normalized.json'))).toBe(true);
  });
});

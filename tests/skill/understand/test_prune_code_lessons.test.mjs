import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const SCRIPT = join(repoRoot, 'understand-anything-plugin', 'skills', 'understand', 'prune-code-lessons.mjs');

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setupFixture({ graph, lessons }) {
  const root = mkdtempSync(join(tmpdir(), 'ua-prune-lessons-'));
  roots.push(root);
  const dataDir = join(root, '.ua');
  mkdirSync(dataDir, { recursive: true });
  if (graph !== null) {
    writeFileSync(
      join(dataDir, 'knowledge-graph.json'),
      typeof graph === 'string' ? graph : JSON.stringify(graph),
    );
  }
  if (lessons !== null) {
    writeFileSync(
      join(dataDir, 'code-lessons.json'),
      typeof lessons === 'string' ? lessons : JSON.stringify(lessons),
    );
  }
  return { root, dataDir, lessonsPath: join(dataDir, 'code-lessons.json') };
}

function runScript(root) {
  return spawnSync(process.execPath, [SCRIPT, root], { cwd: root, encoding: 'utf-8' });
}

const GRAPH = {
  nodes: [
    { id: 'document:README.md', type: 'document', filePath: 'README.md', name: 'README' },
    { id: 'file:src/main.tsx', type: 'file', filePath: 'src/main.tsx', name: 'main' },
    { id: 'table:db/schema.sql:users', type: 'table', filePath: 'db/schema.sql', name: 'users' },
  ],
  edges: [],
};

const LESSONS = {
  version: 1,
  generatedAt: '2026-11-12T00:00:00.000Z',
  files: {
    'README.md': { overview: 'Readme lesson.', sections: [] },
    'src/main.tsx': { overview: 'Main lesson.', sections: [{ title: 'Boot', lineRange: [1, 5], explanation: 'e', tourOrder: 2 }] },
    'db/schema.sql': { overview: 'Kept via its table node.', sections: [] },
    'src/deleted.ts': { overview: 'Orphan.', sections: [] },
  },
};

describe('prune-code-lessons.mjs', () => {
  it('removes orphaned entries and keeps every surviving lesson (including table-node files)', () => {
    const { root, lessonsPath } = setupFixture({ graph: GRAPH, lessons: LESSONS });
    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('removed 1 orphaned entry');
    const pruned = JSON.parse(readFileSync(lessonsPath, 'utf-8'));
    expect(Object.keys(pruned.files).sort()).toEqual(['README.md', 'db/schema.sql', 'src/main.tsx']);
    expect(pruned.version).toBe(1);
    expect(pruned.files['src/main.tsx']).toEqual(LESSONS.files['src/main.tsx']);
  });

  it('preserves a __proto__-keyed lesson as an own entry instead of hitting the prototype setter', () => {
    const { root, lessonsPath } = setupFixture({
      // The graph really contains a file literally named "__proto__" (legal on
      // POSIX), so the lesson keyed by it must survive as a normal entry.
      graph: {
        nodes: [...GRAPH.nodes, { id: 'file:__proto__', type: 'file', filePath: '__proto__', name: 'weird' }],
        edges: [],
      },
      lessons: {
        version: 1,
        files: JSON.parse('{"__proto__": {"overview": "Weird but legal filename.", "sections": []}}'),
      },
    });
    const result = runScript(root);
    expect(result.status).toBe(0);
    const pruned = JSON.parse(readFileSync(lessonsPath, 'utf-8'));
    expect(Object.prototype.hasOwnProperty.call(pruned.files, '__proto__')).toBe(true);
    expect(pruned.files.__proto__.overview).toBe('Weird but legal filename.');
    expect(Object.keys(pruned.files)).toEqual(['__proto__']);
  });

  it('rewrites nothing when no entries are orphaned', () => {
    const { root, lessonsPath } = setupFixture({
      graph: GRAPH,
      lessons: {
        version: 1,
        files: {
          'README.md': { overview: 'r', sections: [] },
          'src/main.tsx': { overview: 'm', sections: [] },
        },
      },
    });
    const before = readFileSync(lessonsPath, 'utf-8');
    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing to remove');
    expect(readFileSync(lessonsPath, 'utf-8')).toBe(before);
  });

  it('exits 0 silently when either input file is missing', () => {
    const noLessons = setupFixture({ graph: GRAPH, lessons: null });
    expect(runScript(noLessons.root).status).toBe(0);
    const noGraph = setupFixture({ graph: null, lessons: LESSONS });
    expect(runScript(noGraph.root).status).toBe(0);
    expect(existsSync(noGraph.lessonsPath)).toBe(true);
  });

  it('normalizes path separators and ./ prefixes when matching graph nodes', () => {
    const { root, lessonsPath } = setupFixture({
      graph: GRAPH,
      lessons: { version: 1, files: { './src/main.tsx': { overview: 'keep', sections: [] } } },
    });
    const result = runScript(root);
    expect(result.status).toBe(0);
    const pruned = JSON.parse(readFileSync(lessonsPath, 'utf-8'));
    expect(Object.keys(pruned.files)).toEqual(['./src/main.tsx']);
  });
});

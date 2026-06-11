import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../understand-anything-plugin/skills/understand/plan-resume-batches.mjs');

function runScript(projectRoot) {
  return spawnSync('node', [SCRIPT, projectRoot], {
    encoding: 'utf-8',
  });
}

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'ua-resume-test-'));
  const intermediate = join(root, '.understand-anything', 'intermediate');
  mkdirSync(intermediate, { recursive: true });
  writeFileSync(join(intermediate, 'batches.json'), JSON.stringify({
    totalBatches: 3,
    batches: [
      { batchIndex: 1, files: [{ path: 'src/a.ts' }] },
      { batchIndex: 2, files: [{ path: 'src/b.ts' }] },
      { batchIndex: 3, files: [{ path: 'src/c.ts' }] },
    ],
  }));
  return root;
}

function writeBatch(root, name, body = { nodes: [], edges: [] }) {
  writeFileSync(
    join(root, '.understand-anything', 'intermediate', name),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

function readPlan(root) {
  return JSON.parse(readFileSync(
    join(root, '.understand-anything', 'intermediate', 'resume-plan.json'),
    'utf-8',
  ));
}

describe('plan-resume-batches.mjs', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('marks every batch pending when no checkpoints exist', () => {
    root = setupProject();

    const result = runScript(root);
    expect(result.status).toBe(0);

    const plan = readPlan(root);
    expect(plan.completedBatchIndexes).toEqual([]);
    expect(plan.pendingBatchIndexes).toEqual([1, 2, 3]);
    expect(plan.completed).toBe(0);
    expect(plan.pending).toBe(3);
  });

  it('reuses valid single-file and multipart checkpoints', () => {
    root = setupProject();
    writeBatch(root, 'batch-1.json');
    writeBatch(root, 'batch-2-part-1.json');

    const result = runScript(root);
    expect(result.status).toBe(0);

    const plan = readPlan(root);
    expect(plan.completedBatchIndexes).toEqual([1, 2]);
    expect(plan.pendingBatchIndexes).toEqual([3]);
    expect(plan.completed).toBe(2);
    expect(plan.pending).toBe(1);
  });

  it('keeps malformed checkpoint files pending', () => {
    root = setupProject();
    writeBatch(root, 'batch-1.json', '{not json');
    writeBatch(root, 'batch-2.json', { nodes: [] });

    const result = runScript(root);
    expect(result.status).toBe(0);

    const plan = readPlan(root);
    expect(plan.completedBatchIndexes).toEqual([]);
    expect(plan.pendingBatchIndexes).toEqual([1, 2, 3]);
    expect(plan.invalidBatchFiles).toEqual(['batch-1.json', 'batch-2.json']);
  });

  it('ignores checkpoint files from stale batch indexes', () => {
    root = setupProject();
    writeBatch(root, 'batch-9.json');

    const result = runScript(root);
    expect(result.status).toBe(0);

    const plan = readPlan(root);
    expect(plan.completedBatchIndexes).toEqual([]);
    expect(plan.pendingBatchIndexes).toEqual([1, 2, 3]);
    expect(plan.invalidBatchFiles).toEqual([]);
  });
});

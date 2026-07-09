import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/cleanup-workdirs.mjs',
);
const SKILL = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/SKILL.md',
);
const NOW_MS = Date.UTC(2026, 4, 29, 12, 0, 0);

function runCleanup(projectRoot, args = []) {
  return spawnSync('node', [SCRIPT, projectRoot, `--now-ms=${NOW_MS}`, ...args], {
    encoding: 'utf-8',
  });
}

describe('cleanup-workdirs.mjs', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('moves fresh intermediate and tmp directories into timestamped trash', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cleanup-'));
    const stateDir = join(root, '.understand-anything');
    mkdirSync(join(stateDir, 'intermediate', 'nested'), { recursive: true });
    mkdirSync(join(stateDir, 'tmp'), { recursive: true });
    writeFileSync(join(stateDir, 'intermediate', 'nested', 'graph.json'), '{"ok":true}');
    writeFileSync(join(stateDir, 'tmp', 'validate.cjs'), 'console.log("ok");');

    const result = runCleanup(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/moved intermediate, tmp/);
    expect(existsSync(join(stateDir, 'intermediate'))).toBe(false);
    expect(existsSync(join(stateDir, 'tmp'))).toBe(false);

    const trashDirs = readdirSync(stateDir).filter((name) => name.startsWith('.trash-'));
    expect(trashDirs).toHaveLength(1);
    const trashDir = join(stateDir, trashDirs[0]);

    expect(readFileSync(join(trashDir, 'intermediate', 'nested', 'graph.json'), 'utf-8'))
      .toBe('{"ok":true}');
    expect(readFileSync(join(trashDir, 'tmp', 'validate.cjs'), 'utf-8'))
      .toBe('console.log("ok");');
  });

  it('preserves scan-result.json for future incremental runs', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cleanup-scan-result-'));
    const stateDir = join(root, '.understand-anything');
    mkdirSync(join(stateDir, 'intermediate'), { recursive: true });
    writeFileSync(join(stateDir, 'intermediate', 'scan-result.json'), '{"files":[]}');
    writeFileSync(join(stateDir, 'intermediate', 'assembled-graph.json'), '{"nodes":[]}');

    const result = runCleanup(root);

    expect(result.status).toBe(0);
    expect(readFileSync(join(stateDir, 'intermediate', 'scan-result.json'), 'utf-8'))
      .toBe('{"files":[]}');
    expect(existsSync(join(stateDir, 'intermediate', 'assembled-graph.json'))).toBe(false);

    const trashDirs = readdirSync(stateDir).filter((name) => name.startsWith('.trash-'));
    expect(trashDirs).toHaveLength(1);
    expect(readFileSync(
      join(stateDir, trashDirs[0], 'intermediate', 'assembled-graph.json'),
      'utf-8',
    )).toBe('{"nodes":[]}');
  });

  it('purges expired trash while keeping recent trash', () => {
    root = mkdtempSync(join(tmpdir(), 'ua-cleanup-purge-'));
    const stateDir = join(root, '.understand-anything');
    const oldTrash = join(stateDir, '.trash-old');
    const recentTrash = join(stateDir, '.trash-recent');
    mkdirSync(oldTrash, { recursive: true });
    mkdirSync(recentTrash, { recursive: true });
    writeFileSync(join(oldTrash, 'old.txt'), 'old');
    writeFileSync(join(recentTrash, 'recent.txt'), 'recent');

    const oldDate = new Date(NOW_MS - 8 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(NOW_MS - 6 * 24 * 60 * 60 * 1000);
    utimesSync(oldTrash, oldDate, oldDate);
    utimesSync(recentTrash, recentDate, recentDate);

    const result = runCleanup(root, ['--retention-days=7']);

    expect(result.status).toBe(0);
    expect(existsSync(oldTrash)).toBe(false);
    expect(existsSync(recentTrash)).toBe(true);
    expect(result.stdout).toMatch(/purged 1 expired trash directory/);
  });

  it('documents Phase 7 cleanup without immediate recursive deletion of fresh work dirs', () => {
    const skill = readFileSync(SKILL, 'utf-8');

    expect(skill).toContain('cleanup-workdirs.mjs');
    expect(skill).not.toMatch(
      /rm\s+-rf\s+\$PROJECT_ROOT\/\.understand-anything\/(?:intermediate|tmp)/,
    );
  });
});

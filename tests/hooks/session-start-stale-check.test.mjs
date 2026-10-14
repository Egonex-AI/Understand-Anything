import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const hookScript = join(
  repoRoot,
  'understand-anything-plugin',
  'hooks',
  'session-start-stale-check.mjs',
);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function runHook({
  autoUpdate = true,
  createConfig = true,
  createGraph = true,
  createMeta = true,
  metaCommit = 'stale',
  dataDirName = '.understand-anything',
} = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ua-session-start-'));
  git(projectRoot, ['init', '-q']);
  writeFileSync(join(projectRoot, 'file.txt'), 'v1');
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']);
  const head = git(projectRoot, ['rev-parse', 'HEAD']);

  const dataDir = join(projectRoot, dataDirName);
  mkdirSync(dataDir);
  if (createConfig) {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ autoUpdate }),
    );
  }
  if (createGraph) writeFileSync(join(dataDir, 'knowledge-graph.json'), '{}');
  if (createMeta) {
    writeFileSync(
      join(dataDir, 'meta.json'),
      JSON.stringify({
        gitCommitHash: metaCommit === 'stale' ? '0'.repeat(40) : head,
      }),
    );
  }

  const result = spawnSync(process.execPath, [hookScript], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  rmSync(projectRoot, { recursive: true, force: true });
  return result;
}

describe('SessionStart stale-check hook', () => {
  it('injects the auto-update instruction when the graph commit differs from HEAD', () => {
    const result = runHook({ metaCommit: 'stale' });
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringContaining(
          '[understand-anything] Knowledge graph is stale',
        ),
      },
    });
    expect(output.hookSpecificOutput.additionalContext).toContain(
      join('hooks', 'auto-update-prompt.md'),
    );
  });

  it('stays silent when the graph commit matches HEAD', () => {
    const result = runHook({ metaCommit: 'head' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('stays silent when automatic updates are disabled', () => {
    const result = runHook({ autoUpdate: false });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it.each([
    ['a missing config', { createConfig: false }],
    ['a missing graph', { createGraph: false }],
    ['missing metadata', { createMeta: false }],
  ])('stays silent for %s', (_scenario, options) => {
    const result = runHook(options);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });
});

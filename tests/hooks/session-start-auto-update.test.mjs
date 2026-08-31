import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const hookScript = join(
  repoRoot,
  'understand-anything-plugin',
  'hooks',
  'session-start-auto-update.mjs',
);
const hooksConfig = JSON.parse(
  readFileSync(
    join(repoRoot, 'understand-anything-plugin', 'hooks', 'hooks.json'),
    'utf8',
  ),
);

function snapshotProject(projectRoot) {
  const files = {};

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        files[relative(projectRoot, path)] = 'directory';
        visit(path);
      } else {
        files[relative(projectRoot, path)] =
          `file:${readFileSync(path).toString('base64')}`;
      }
    }
  }

  visit(projectRoot);
  return files;
}

function runHook({
  autoUpdate = true,
  configContents,
  createConfig = true,
  createDataDir = true,
  createGraph = true,
  createMeta = true,
  dataDirName = '.understand-anything',
  graphCommit = '0000000000000000000000000000000000000000',
  input = {},
} = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ua-session-start-'));
  spawnSync('git', ['init'], { cwd: projectRoot });
  writeFileSync(join(projectRoot, 'fixture.txt'), 'fixture\n');
  spawnSync('git', ['add', 'fixture.txt'], { cwd: projectRoot });
  spawnSync(
    'git',
    [
      '-c',
      'user.name=Hook Test',
      '-c',
      'user.email=hook@example.invalid',
      'commit',
      '-m',
      'fixture',
    ],
    { cwd: projectRoot },
  );
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).stdout.trim();
  const dataDir = join(projectRoot, dataDirName);
  if (createDataDir) {
    mkdirSync(dataDir);
    if (createConfig) {
      writeFileSync(
        join(dataDir, 'config.json'),
        configContents ?? JSON.stringify({ autoUpdate }),
      );
    }
    if (createGraph) writeFileSync(join(dataDir, 'knowledge-graph.json'), '{}');
    if (createMeta) {
      writeFileSync(
        join(dataDir, 'meta.json'),
        JSON.stringify({
          gitCommitHash: graphCommit === 'HEAD' ? head : graphCommit,
        }),
      );
    }
  }

  const before = snapshotProject(projectRoot);
  const result = spawnSync(process.execPath, [hookScript], {
    cwd: projectRoot,
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  const after = snapshotProject(projectRoot);

  rmSync(projectRoot, { recursive: true, force: true });
  return {
    ...result,
    filesUnchanged: JSON.stringify(before) === JSON.stringify(after),
  };
}

describe('SessionStart auto-update hook', () => {
  it('is registered as a command hook instead of inline shell', () => {
    expect(hooksConfig.hooks.SessionStart[0].hooks).toEqual([
      {
        type: 'command',
        command:
          'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-auto-update.mjs"',
      },
    ]);
  });

  it('emits the shared Codex and Claude Code SessionStart JSON contract', () => {
    const result = runHook({
      input: { hook_event_name: 'SessionStart', source: 'startup' },
    });
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.filesUnchanged).toBe(true);
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: expect.stringContaining(
          '[understand-anything] Knowledge graph is stale',
        ),
      },
    });
    expect(output.hookSpecificOutput.additionalContext).toContain(
      '/hooks/auto-update-prompt.md',
    );
  });

  it('supports the legacy .ua data directory', () => {
    const result = runHook({ dataDirName: '.ua' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe(
      'SessionStart',
    );
  });

  it.each([
    ['automatic updates disabled', { autoUpdate: false }],
    ['missing data directory', { createDataDir: false }],
    ['missing config', { createConfig: false }],
    ['malformed config', { configContents: '{not-json' }],
    ['missing graph', { createGraph: false }],
    ['missing metadata', { createMeta: false }],
    ['malformed metadata', { graphCommit: '' }],
    ['fresh graph', { graphCommit: 'HEAD' }],
  ])('stays silent for %s', (_scenario, options) => {
    const result = runHook(options);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.filesUnchanged).toBe(true);
  });
});

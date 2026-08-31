import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pythonCandidates,
  resolvePython3,
  runPythonScript,
} from '../../../understand-anything-plugin/scripts/run-python.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('portable Python 3 runner', () => {
  it('uses platform-appropriate interpreter candidates', () => {
    expect(pythonCandidates('win32')).toEqual([
      { command: 'python', prefixArgs: [] },
      { command: 'py', prefixArgs: ['-3'] },
      { command: 'python3', prefixArgs: [] },
    ]);
    expect(pythonCandidates('linux')).toEqual([
      { command: 'python3', prefixArgs: [] },
      { command: 'python', prefixArgs: [] },
    ]);
  });

  it('rejects an incompatible Python and resolves the next interpreter path', () => {
    const calls = [];
    const spawnSyncImpl = (command, args, options) => {
      calls.push({ command, args, options });
      return command === 'py'
        ? { status: 0, stdout: 'C:\\Python312\\python.exe\r\n' }
        : { status: 1, stdout: '' };
    };

    expect(resolvePython3({
      platform: 'win32',
      probeCwd: 'C:\\trusted-plugin\\scripts',
      spawnSyncImpl,
    })).toEqual({
      command: 'C:\\Python312\\python.exe',
      prefixArgs: [],
    });
    expect(calls.map(call => call.command)).toEqual(['python', 'py']);
    expect(calls[1].args.slice(0, 4)).toEqual(['-3', '-I', '-S', '-c']);
    expect(calls[1].args.at(-1)).toContain('sys.version_info >= (3, 10)');
    expect(calls[1].options.cwd).toBe('C:\\trusted-plugin\\scripts');
    expect(calls[1].options.shell).toBe(false);
    expect(calls[1].options.timeout).toBe(5000);
  });

  it('continues when an interpreter candidate is missing from PATH', () => {
    const calls = [];
    const executable = process.platform === 'win32'
      ? 'C:\\Python312\\python.exe'
      : '/usr/bin/python3';
    const missing = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const results = [
      { error: missing, status: null, stdout: '' },
      { status: 0, stdout: `${executable}\n` },
    ];

    expect(resolvePython3({
      spawnSyncImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return results.shift();
      },
    })).toEqual({ command: executable, prefixArgs: [] });
    expect(calls.map(call => call.command)).toEqual(
      pythonCandidates(process.platform).slice(0, 2).map(candidate => candidate.command),
    );
  });

  it('returns usage without probing Python when no helper is provided', () => {
    const spawnSyncImpl = vi.fn();
    const stderr = { write: vi.fn() };

    expect(runPythonScript([], { spawnSyncImpl, stderr })).toBe(64);
    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('returns a clear error when Python 3 is unavailable', () => {
    const stderr = { write: vi.fn() };
    const status = runPythonScript(
      ['helper.py'],
      {
        platform: 'linux',
        spawnSyncImpl: () => ({ status: 1, stdout: '' }),
        stderr,
      },
    );

    expect(status).toBe(127);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Python 3.10 or newer'));
  });

  it('reports a failure to start the resolved interpreter', () => {
    const stderr = { write: vi.fn() };
    const startError = Object.assign(new Error('access denied'), { code: 'EACCES' });
    const results = [
      { status: 0, stdout: `${resolve('python')}\n` },
      { error: startError, status: null },
    ];

    expect(runPythonScript(
      ['helper.py'],
      {
        spawnSyncImpl: () => results.shift(),
        stderr,
      },
    )).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start Python 3: access denied'),
    );
  });

  it('maps child signals to conventional shell exit statuses', () => {
    const calls = [];
    const results = [
      { status: 0, stdout: `${resolve('python')}\n` },
      { status: null, signal: 'SIGINT' },
    ];
    expect(runPythonScript(
      ['helper.py'],
      {
        spawnSyncImpl: (command, args, options) => {
          calls.push({ command, args, options });
          return results.shift();
        },
      },
    )).toBe(130);
    expect(calls[1].command).toBe(resolve('python'));
    expect(calls[1].options.shell).toBe(false);
  });

  it('runs through a linked plugin path and propagates the script exit status', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-python-runner-'));
    tempDirs.push(root);
    const spacedDir = join(root, 'path with spaces');
    mkdirSync(spacedDir);
    const pluginLink = join(root, 'linked plugin');
    symlinkSync(
      resolve(repoRoot, 'understand-anything-plugin'),
      pluginLink,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const linkedRunnerPath = join(pluginLink, 'scripts', 'run-python.mjs');
    const scriptPath = join(spacedDir, 'helper.py');
    writeFileSync(
      scriptPath,
      [
        'import sys',
        'if sys.argv[1] == "exit":',
        '    raise SystemExit(7)',
        'print("|".join(sys.argv[1:]))',
        '',
      ].join('\n'),
      'utf8',
    );

    const success = spawnSync(
      process.execPath,
      [linkedRunnerPath, scriptPath, 'hello world', 'second'],
      { encoding: 'utf8' },
    );
    expect(success.status).toBe(0);
    expect(success.stdout.trim()).toBe('hello world|second');

    const failure = spawnSync(
      process.execPath,
      [linkedRunnerPath, scriptPath, 'exit'],
      { encoding: 'utf8' },
    );
    expect(failure.status).toBe(7);
  });
});

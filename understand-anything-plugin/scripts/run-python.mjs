/**
 * Run a bundled Python helper with an available Python 3 interpreter.
 *
 * Keep this module shebang-free: skill commands always invoke it through
 * `node`, and Vitest must also be able to import CRLF checkouts on Windows.
 *
 * Skill instructions are consumed on macOS, Linux, and Windows, where the
 * interpreter may be exposed as `python3`, `python`, or the Windows `py -3`
 * launcher. Keep that platform detail here so every skill command can invoke
 * the same shell-neutral Node entry point.
 *
 * Usage:
 *   node run-python.mjs <script.py> [args...]
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON3_PROBE =
  'import os, sys; ' +
  'print(os.path.realpath(sys.executable)) ' +
  'if sys.version_info >= (3, 10) else sys.exit(1)';
const PROBE_TIMEOUT_MS = 5000;
const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

export function pythonCandidates(platform = process.platform) {
  if (platform === 'win32') {
    // Respect an activated virtual environment before falling back to the
    // Windows launcher. Some Windows installs also expose `python3`.
    return [
      { command: 'python', prefixArgs: [] },
      { command: 'py', prefixArgs: ['-3'] },
      { command: 'python3', prefixArgs: [] },
    ];
  }

  return [
    { command: 'python3', prefixArgs: [] },
    { command: 'python', prefixArgs: [] },
  ];
}

export function resolvePython3({
  platform = process.platform,
  probeCwd = RUNNER_DIR,
  spawnSyncImpl = spawnSync,
} = {}) {
  const pathFlavor = platform === 'win32' ? win32 : posix;

  for (const candidate of pythonCandidates(platform)) {
    const probe = spawnSyncImpl(
      candidate.command,
      [...candidate.prefixArgs, '-I', '-S', '-c', PYTHON3_PROBE],
      {
        cwd: probeCwd,
        encoding: 'utf8',
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      },
    );

    const executable = typeof probe.stdout === 'string' ? probe.stdout.trim() : '';
    if (!probe.error && probe.status === 0 && pathFlavor.isAbsolute(executable)) {
      return { command: executable, prefixArgs: [] };
    }
  }

  return null;
}

export function runPythonScript(
  argv,
  {
    platform = process.platform,
    spawnSyncImpl = spawnSync,
    stderr = process.stderr,
  } = {},
) {
  const [scriptPath, ...scriptArgs] = argv;
  if (!scriptPath) {
    stderr.write('Usage: node run-python.mjs <script.py> [args...]\n');
    return 64;
  }

  const python = resolvePython3({ platform, spawnSyncImpl });
  if (!python) {
    stderr.write(
      'Error: Python 3.10 or newer is required. ' +
      'Install it and ensure python3, python, or py is on PATH.\n',
    );
    return 127;
  }

  const result = spawnSyncImpl(
    python.command,
    [...python.prefixArgs, scriptPath, ...scriptArgs],
    {
      shell: false,
      stdio: 'inherit',
      windowsHide: false,
    },
  );

  if (result.error) {
    stderr.write(`Error: Failed to start Python 3: ${result.error.message}\n`);
    return 1;
  }

  if (result.signal) {
    const signalNumber = osConstants.signals[result.signal];
    return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
  }

  return typeof result.status === 'number' ? result.status : 1;
}

export function isDirectExecution({
  entryPath = process.argv[1],
  moduleUrl = import.meta.url,
  realpathSyncImpl = realpathSync,
} = {}) {
  if (!entryPath) return false;

  try {
    return realpathSyncImpl(resolve(entryPath)) === realpathSyncImpl(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  process.exitCode = runPythonScript(process.argv.slice(2));
}

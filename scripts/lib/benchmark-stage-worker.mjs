#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STAGE_METRICS_PREFIX = '__UA_BENCHMARK_METRICS__';

const [scriptPath, ...scriptArgs] = process.argv.slice(2);
if (!scriptPath) {
  process.stderr.write('benchmark-stage-worker: missing script path\n');
  process.exit(2);
}

const resolvedScript = resolve(scriptPath);
const startedAt = performance.now();
const usageBefore = process.resourceUsage();
let failure = null;
const originalExit = process.exit;

class ImportedHelperExitError extends Error {
  constructor(code) {
    super(`Imported benchmark helper requested process exit ${code}`);
    this.name = 'ImportedHelperExitError';
    this.code = code;
  }
}

try {
  // The deterministic helpers use process.argv to identify their CLI entry
  // point. Recreate the argv shape they receive when launched directly, then
  // import them in this process so resourceUsage() measures the real stage.
  process.argv = [process.execPath, resolvedScript, ...scriptArgs];
  process.exit = (code = 0) => {
    throw new ImportedHelperExitError(code);
  };
  await import(pathToFileURL(resolvedScript).href);
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  process.stderr.write(`${failure.stack ?? failure.message}\n`);
} finally {
  process.exit = originalExit;
}

const usageAfter = process.resourceUsage();
const metrics = {
  durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  // Node reports maxRSS in KiB on every supported platform.
  peakRssBytes: usageAfter.maxRSS * 1024,
  userCpuTimeMicros: usageAfter.userCPUTime - usageBefore.userCPUTime,
  systemCpuTimeMicros: usageAfter.systemCPUTime - usageBefore.systemCPUTime,
};

// Start the marker on its own line even when a helper left stderr unterminated.
process.stderr.write(`\n${STAGE_METRICS_PREFIX}${JSON.stringify(metrics)}\n`);
if (failure) process.exitCode = 1;

#!/usr/bin/env node

import {
  BenchmarkArtifactCleanupError,
  BenchmarkReportWriteError,
  CliUsageError,
  helpText,
  parseArgs,
  runBenchmark,
} from './lib/large-repo-benchmark.mjs';

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`Error: ${error.message}\n\n${helpText()}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  let result;
  try {
    result = await runBenchmark(options, {
      onProgress(stage) {
        process.stderr.write(`[benchmark] ${stage}\n`);
      },
      onBatchProgress(completed, total) {
        process.stderr.write(`[benchmark] structure ${completed}/${total}\n`);
      },
    });
  } catch (error) {
    if (error instanceof BenchmarkArtifactCleanupError) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof BenchmarkReportWriteError) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  process.stdout.write(
    `Benchmark ${result.report.status}. JSON report: ${options.outputPath}\n` +
      `Markdown report: ${options.markdownPath}\n`,
  );
  if (result.artifactRoot) {
    process.stdout.write(`Artifacts preserved at: ${result.artifactRoot}\n`);
  }
  process.exitCode = result.exitCode;
}

await main();

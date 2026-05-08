#!/usr/bin/env node
/**
 * publish-to-understand-quickly.mjs
 *
 * Opt-in registry publish for `looptech-ai/understand-quickly`. Invoked
 * by Phase 7 of the `/understand` skill when the user passes `--publish`.
 *
 * Behaviour:
 *
 *   1. Stamps the on-disk `knowledge-graph.json` with a registry-shaped
 *      `metadata` block (`tool`, `tool_version`, `generated_at`, `commit`).
 *      This step always runs, regardless of token presence — embedding the
 *      commit sha is what enables drift detection upstream.
 *
 *   2. If `UNDERSTAND_QUICKLY_TOKEN` is set, fires a `repository_dispatch`
 *      event at the registry asking it to re-sync this entry. If the
 *      dispatch fails for any reason, this script logs and exits 0 — a
 *      failed publish must never fail the parent `/understand` run.
 *
 * Usage:
 *
 *   node publish-to-understand-quickly.mjs <project-root>
 *
 * Exit codes:
 *
 *   0 — always (best-effort; status is communicated via stdout only).
 *
 * Protocol reference:
 *   https://github.com/looptech-ai/understand-quickly/blob/main/docs/integrations/protocol.md
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(require.resolve('@understand-anything/core'));
} catch {
  core = await import(resolve(pluginRoot, 'packages/core/dist/index.js'));
}
const { publish } = core;

// Read the plugin version from the plugin manifest so the `metadata.tool_version`
// embedded on the graph matches what users see in `/plugin list`.
function readToolVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf-8'),
    );
    if (typeof manifest.version === 'string') return manifest.version;
  } catch {
    // fall through
  }
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(pluginRoot, 'package.json'), 'utf-8'),
    );
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // fall through
  }
  return 'unknown';
}

async function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write(
      'Usage: node publish-to-understand-quickly.mjs <project-root>\n',
    );
    process.exit(1);
  }

  const result = await publish({
    projectRoot,
    toolVersion: readToolVersion(),
  });

  switch (result.status) {
    case 'no-graph':
      console.log(
        '[understand-quickly] No knowledge-graph.json found; skipping publish.',
      );
      break;
    case 'no-token':
      console.log(
        '[understand-quickly] Graph stamped with metadata.{tool, tool_version, generated_at, commit}.',
      );
      console.log(
        '[understand-quickly] UNDERSTAND_QUICKLY_TOKEN is unset; skipping registry dispatch.',
      );
      console.log(
        '[understand-quickly] To enable instant publish: create a fine-grained PAT scoped to repository_dispatch on looptech-ai/understand-quickly and export it as UNDERSTAND_QUICKLY_TOKEN.',
      );
      console.log(
        '[understand-quickly] Or commit the graph + the workflow at https://github.com/looptech-ai/understand-quickly/blob/main/docs/integrations/sample-publish-workflow.yml and let CI handle it.',
      );
      break;
    case 'no-remote':
      console.log(
        '[understand-quickly] No GitHub `origin` remote detected; skipping registry dispatch.',
      );
      break;
    case 'ok':
      console.log(
        `[understand-quickly] Sync requested for ${result.id} (HTTP ${result.httpStatus}).`,
      );
      console.log(
        '[understand-quickly] If the repo is not yet registered, register it once with: npx @understand-quickly/cli add',
      );
      break;
    case 'dispatch-failed':
      console.log(
        `[understand-quickly] Registry dispatch failed${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}${result.error ? `: ${result.error}` : ''}.`,
      );
      console.log(
        '[understand-quickly] This is non-blocking; the next nightly sync will pick the change up.',
      );
      break;
  }
}

main().catch((err) => {
  // Best-effort — never fail the parent run on a publish error.
  console.log(`[understand-quickly] Publish error (non-blocking): ${err?.message ?? err}`);
  process.exit(0);
});

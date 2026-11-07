#!/usr/bin/env node
/**
 * session-start-stale-check.mjs — SessionStart hook for the Understand
 * Anything auto-update feature.
 *
 * Prints a hookSpecificOutput.additionalContext reminder when the current
 * project's knowledge graph is stale (autoUpdate enabled, graph exists, and
 * the analyzed commit differs from HEAD). Prints nothing otherwise.
 *
 * Self-locating: the update prompt ships next to this script, so no
 * platform-specific plugin-root env var is required. Set
 * UNDERSTAND_AUTO_UPDATE_PROMPT to override the prompt path.
 *
 * Registered in hooks/hooks.json, which both Claude Code and Devin load.
 * Emitting JSON (rather than plain stdout) is what lets Devin inject the
 * reminder; Claude Code accepts the same shape.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROMPT_PATH = process.env.UNDERSTAND_AUTO_UPDATE_PROMPT
  ?? fileURLToPath(new URL('./auto-update-prompt.md', import.meta.url));

const UA_DIR = existsSync('.understand-anything') ? '.understand-anything' : '.ua';

function stale() {
  let config;
  try {
    config = JSON.parse(readFileSync(`${UA_DIR}/config.json`, 'utf8'));
  } catch {
    return false;
  }
  if (config.autoUpdate !== true) return false;
  if (!existsSync(`${UA_DIR}/knowledge-graph.json`)) return false;

  let graphCommit;
  try {
    graphCommit = JSON.parse(readFileSync(`${UA_DIR}/meta.json`, 'utf8')).gitCommitHash;
  } catch {
    return false;
  }
  if (!graphCommit) return false;

  let head;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return false;
  }
  return graphCommit !== head;
}

if (stale()) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          '[understand-anything] Knowledge graph is stale. You MUST read the file at ' +
          `${PROMPT_PATH} and execute its instructions to check for structural ` +
          'changes and update the graph. Do not ask the user for confirmation — just do it.',
      },
    }),
  );
}

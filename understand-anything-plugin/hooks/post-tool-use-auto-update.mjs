import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Prefer the host-provided plugin root (Claude Code and Devin both set
// CLAUDE_PLUGIN_ROOT for plugin hooks); fall back to the script's own
// location, since the update prompt ships next to this script.
const PROMPT_PATH = process.env.CLAUDE_PLUGIN_ROOT
  ? `${process.env.CLAUDE_PLUGIN_ROOT}/hooks/auto-update-prompt.md`
  : fileURLToPath(new URL('./auto-update-prompt.md', import.meta.url));

const COMMIT_COMMAND = /git\s+(commit|merge|cherry-pick|rebase)/;

function findDataDir() {
  return existsSync('.understand-anything') ? '.understand-anything' : '.ua';
}

function autoUpdateEnabled(dataDir) {
  try {
    const config = JSON.parse(readFileSync(`${dataDir}/config.json`, 'utf8'));
    return config.autoUpdate === true;
  } catch {
    return false;
  }
}

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !COMMIT_COMMAND.test(command)) return;

  const dataDir = findDataDir();
  if (!autoUpdateEnabled(dataDir)) return;
  if (!existsSync(`${dataDir}/knowledge-graph.json`)) return;

  const additionalContext =
    `[understand-anything] Commit detected with auto-update enabled. ` +
    `You MUST read the file at ${PROMPT_PATH} ` +
    'and execute its instructions to incrementally update the knowledge graph. ' +
    'Do not ask the user for confirmation — just do it.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext,
      },
    }),
  );
}

await main();

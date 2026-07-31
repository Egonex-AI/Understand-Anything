import { existsSync, readFileSync } from 'node:fs';

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

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? '';
  const additionalContext =
    `[understand-anything] Commit detected with auto-update enabled. ` +
    `You MUST read the file at ${pluginRoot}/hooks/auto-update-prompt.md ` +
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

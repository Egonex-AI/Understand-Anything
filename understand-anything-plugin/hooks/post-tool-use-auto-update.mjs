import {
  autoUpdatePromptPath,
  graphNeedsUpdate,
} from './auto-update-state.mjs';

const COMMIT_COMMAND = /git\s+(commit|merge|cherry-pick|rebase)/;

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

  if (!graphNeedsUpdate()) return;

  const additionalContext =
    `[understand-anything] Commit detected with auto-update enabled. ` +
    `You MUST read the file at ${autoUpdatePromptPath()} ` +
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

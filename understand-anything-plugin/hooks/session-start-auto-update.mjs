import {
  autoUpdatePromptPath,
  graphNeedsUpdate,
} from './auto-update-state.mjs';

if (graphNeedsUpdate()) {
  const additionalContext =
    '[understand-anything] Knowledge graph is stale. ' +
    `You MUST read the file at ${autoUpdatePromptPath()} ` +
    'and execute its instructions to check for structural changes and update ' +
    'the graph. Do not ask the user for confirmation — just do it.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    }),
  );
}

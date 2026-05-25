# Dashboard Exploration

Instructions for launching and using the interactive knowledge graph dashboard.

## When to activate

The user wants to visualize, explore, or interact with the knowledge graph. They may say things like:
- "Show me the dashboard"
- "Visualize the codebase"
- "Open the graph"
- "I want to explore the architecture"
- "Show me the code structure"

## Locate the skill

```bash
SKILL_PATH=""
for candidate in \
  "$HOME/.understand-anything-plugin/skills/understand-dashboard/SKILL.md" \
  "$HOME/.understand-anything/repo/understand-anything-plugin/skills/understand-dashboard/SKILL.md" \
  "$HOME/.kiro/skills/understand-anything/understand-dashboard/SKILL.md"; do
  if [ -f "$candidate" ]; then
    SKILL_PATH="$candidate"; break
  fi
done
echo "$SKILL_PATH"
```

## Locate the plugin root

The dashboard needs the plugin root to find `packages/dashboard/`. Check these paths:

```bash
PLUGIN_ROOT=""
for candidate in \
  "$HOME/.understand-anything-plugin" \
  "$HOME/.understand-anything/repo/understand-anything-plugin" \
  "$HOME/.kiro/powers/understand-anything/understand-anything-plugin"; do
  if [ -n "$candidate" ] && [ -d "$candidate/packages/dashboard" ]; then
    PLUGIN_ROOT="$candidate"; break
  fi
done
echo "$PLUGIN_ROOT"
```

## Instructions

1. Verify `.understand-anything/knowledge-graph.json` exists. If not, tell the user to run `/understand` first.
2. Install dependencies: `cd <plugin-root>/packages/dashboard && pnpm install --frozen-lockfile 2>/dev/null || pnpm install`
3. Build the core package: `cd <plugin-root> && pnpm --filter @understand-anything/core build`
4. Start the server: `cd <dashboard-dir> && GRAPH_DIR=<project-dir> npx vite --host 127.0.0.1`
5. Capture the tokenized URL from output (includes `?token=<TOKEN>`) and share with the user.

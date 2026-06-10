# Diff Impact Analysis

Instructions for analyzing the impact of code changes before committing.

## When to activate

The user wants to understand what their code changes affect. They may say things like:
- "What does this change affect?"
- "Analyze my diff"
- "What's the impact of these changes?"
- "Is it safe to commit this?"
- "What tests should I run?"

## Locate the skill

```bash
SKILL_PATH=""
for candidate in \
  "$HOME/.understand-anything-plugin/skills/understand-diff/SKILL.md" \
  "$HOME/.understand-anything/repo/understand-anything-plugin/skills/understand-diff/SKILL.md" \
  "$HOME/.kiro/skills/understand-anything/understand-diff/SKILL.md"; do
  if [ -f "$candidate" ]; then
    SKILL_PATH="$candidate"; break
  fi
done
echo "$SKILL_PATH"
```

## Instructions

1. Verify `.understand-anything/knowledge-graph.json` exists.
2. Read the skill file and follow its instructions.
3. The diff analysis identifies which nodes in the graph are affected by current uncommitted changes.
4. Shows ripple effects across the codebase — what depends on the changed files.
5. Helps the user understand the blast radius before committing.

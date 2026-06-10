# Code Query

Instructions for answering questions about a codebase using the knowledge graph.

## When to activate

The user is asking questions about the codebase. They may say things like:
- "How does the payment flow work?"
- "Where is authentication handled?"
- "What calls this function?"
- "Explain the data pipeline"
- "What depends on this module?"

## Locate the skill

```bash
SKILL_PATH=""
for candidate in \
  "$HOME/.understand-anything-plugin/skills/understand-chat/SKILL.md" \
  "$HOME/.understand-anything/repo/understand-anything-plugin/skills/understand-chat/SKILL.md" \
  "$HOME/.kiro/skills/understand-anything/understand-chat/SKILL.md"; do
  if [ -f "$candidate" ]; then
    SKILL_PATH="$candidate"; break
  fi
done
echo "$SKILL_PATH"
```

## Instructions

1. Verify `.understand-anything/knowledge-graph.json` exists.
2. Read project metadata from the top of the JSON file.
3. Use Grep to search for relevant nodes by name, summary, and tags.
4. Follow edges to find connected components (imports, calls, depends_on).
5. Check which architectural layers the matched nodes belong to.
6. Answer using specific file paths, function names, and relationships from the graph.

## Efficiency tips

- Never dump the entire graph into context — search first, read selectively.
- Node `name` and `summary` fields are most useful for understanding.
- Edge `type` tells you the relationship: imports, calls, contains, depends_on, etc.
- Layer membership gives architectural context (API, Service, Data, UI, Utility).

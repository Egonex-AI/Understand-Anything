# Domain Analysis

Instructions for extracting business domain knowledge from a codebase.

## When to activate

The user wants to understand business logic, domain concepts, or process flows. They may say things like:
- "What are the business domains?"
- "Show me the domain model"
- "How does the checkout flow work?"
- "Map the business processes"
- "Extract domain knowledge"

## Locate the skill

```bash
SKILL_PATH=""
for candidate in \
  "$HOME/.understand-anything-plugin/skills/understand-domain/SKILL.md" \
  "$HOME/.understand-anything/repo/understand-anything-plugin/skills/understand-domain/SKILL.md" \
  "$HOME/.kiro/skills/understand-anything/understand-domain/SKILL.md"; do
  if [ -f "$candidate" ]; then
    SKILL_PATH="$candidate"; break
  fi
done
echo "$SKILL_PATH"
```

## Instructions

1. Verify `.understand-anything/knowledge-graph.json` exists (run `/understand` first if not).
2. Read the skill file and follow its instructions.
3. The domain analyzer extracts:
   - **Domains**: High-level business areas (e.g., Authentication, Payments, Inventory)
   - **Flows**: Business processes within each domain (e.g., Login Flow, Checkout Flow)
   - **Steps**: Individual actions within each flow
4. Output is added to the knowledge graph as domain, flow, and step nodes with edges linking them.

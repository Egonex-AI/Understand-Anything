# Codebase Analysis

Instructions for analyzing a codebase and building a knowledge graph.

## When to activate

The user wants to analyze, scan, index, or understand a new codebase. They may say things like:
- "Analyze this project"
- "Build a knowledge graph"
- "Scan this codebase"
- "I want to understand this code"
- "Index this repo"

## Locate the skill

Find the analysis skill at one of these paths (first match wins):

```bash
SKILL_PATH=""
for candidate in \
  "$HOME/.understand-anything-plugin/skills/understand/SKILL.md" \
  "$HOME/.understand-anything/repo/understand-anything-plugin/skills/understand/SKILL.md" \
  "$HOME/.kiro/skills/understand-anything/understand/SKILL.md"; do
  if [ -f "$candidate" ]; then
    SKILL_PATH="$candidate"; break
  fi
done
echo "$SKILL_PATH"
```

## Instructions

1. Read and follow the instructions in the skill file located above.
2. The skill runs a multi-agent pipeline: project-scanner → file-analyzer → architecture-analyzer → tour-builder → graph-reviewer.
3. Output is saved to `.understand-anything/knowledge-graph.json`.
4. Supports `--language` flag for localized output (en, zh, zh-TW, ja, ko, ru).
5. Supports incremental updates — only re-analyzes changed files.
6. Use `--auto-update` to set up a post-commit hook for continuous updates.

## Scope options

- Full project: `/understand`
- Subdirectory: `/understand src/frontend`
- With language: `/understand --language zh`
- Force full re-analysis: `/understand --force`

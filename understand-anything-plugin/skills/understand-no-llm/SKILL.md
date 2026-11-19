---
name: understand-no-llm
description: Generate a deterministic code graph without using LLM agents. Produces file/function/class nodes and contains/imports/calls edges only.
argument-hint: [project-path] [--write-knowledge-graph] [--no-scripts]
---

# /understand-no-llm

Generate a code graph without LLM usage.

This command intentionally does less than `/understand`:
- no project summary generation
- no file/function natural-language explanation
- no architecture layer interpretation
- no tour
- no domain/business graph
- no LLM review

It only runs deterministic scripts and writes:
- `<project-root>/.understand-anything/code-graph.json`
- `<project-root>/.understand-anything/code-graph.report.json`
- optionally `<project-root>/.understand-anything/knowledge-graph.json` when `--write-knowledge-graph` is passed

Intermediate scan/import/structure files are cleaned by default. Use `--keep-intermediate` when debugging.

## Instructions

1. Resolve the project directory:
   - If `$ARGUMENTS` contains a path, use that as the project root.
   - Otherwise, use the current working directory.

2. Resolve the plugin root. Check these candidates in order:
   - `${CLAUDE_PLUGIN_ROOT}`
   - `$HOME/.understand-anything-plugin`
   - two levels up from the real path of `~/.agents/skills/understand-no-llm`
   - two levels up from the real path of `~/.copilot/skills/understand-no-llm`
   - `$HOME/.codex/understand-anything/understand-anything-plugin`
   - `$HOME/.opencode/understand-anything/understand-anything-plugin`
   - `$HOME/.pi/understand-anything/understand-anything-plugin`
   - `$HOME/understand-anything/understand-anything-plugin`

3. Run the deterministic script:

   ```bash
   node "$PLUGIN_ROOT/skills/understand/no-llm-code-graph.mjs" "$PROJECT_ROOT" $ARGUMENT_FLAGS
   ```

   Supported flags:
   - `--write-knowledge-graph`: also write `knowledge-graph.json` so `/understand-dashboard` can open it.
   - `--no-scripts`: exclude shell/batch/powershell script files and include only `fileCategory=code`.
   - `--output=<path>`: write the code graph to a custom path.
   - `--keep-intermediate`: keep deterministic intermediate files under `.understand-anything/intermediate/no-llm-code-graph/`.

4. Report the generated paths and graph counts from the script JSON output.

## Output Shape

The graph uses the normal Understand-Anything `KnowledgeGraph` JSON shape for compatibility, but contains only deterministic code graph data:

- `nodes[]`
  - `file:<path>` nodes
  - `function:<path>:<name>` nodes
  - `class:<path>:<name>` nodes
- `edges[]`
  - `contains`: file → function/class
  - `imports`: file → imported file
  - `calls`: function/class symbol → function/class symbol, only when resolved unambiguously
- `layers[]`: empty
- `tour[]`: empty

## Security

This command reads repository files for static analysis only. It does not execute project build/test scripts, and it does not send source code to an LLM.

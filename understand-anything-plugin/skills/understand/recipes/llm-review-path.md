# Recipe: Phase 6 `--review` Path (LLM Graph Reviewer)

> The alternative Phase 6 validation branch when `--review` is in `$ARGUMENTS`. Dispatches the LLM `graph-reviewer` subagent instead of the inline deterministic validator. Referenced from `SKILL.md` Phase 6 → "`--review` path: full LLM reviewer".

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the `graph-reviewer` agent definition (at `agents/graph-reviewer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-5]
>
> Cross-validate: every file in the scan inventory should have a corresponding node in the graph (node types may vary: `file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`). Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.understand-anything/intermediate/review.json`

---
name: understand-sandbox
description: Run a conservative Understand Anything preflight from a sanitized copy of a repo, using deterministic scan/import/structure scripts only.
argument-hint: [project-root]
---

# /understand-sandbox

Run a low-risk repository-understanding kickoff before using the full Understand Anything flow.

This skill is for security-sensitive environments where a user wants architecture signal without installing hooks, enabling auto-update, launching the dashboard, or writing Understand Anything artifacts into the live repository.

## Contract

- Copy only selected project files into a temporary sandbox.
- Exclude dependency folders, build output, VCS metadata, caches, binary/media assets, and secret-bearing local configuration files.
- Run deterministic scripts only:
  - `scan-project.mjs`
  - `extract-import-map.mjs`
  - `extract-structure.mjs`
- Keep all generated files under the sandbox path.
- Leave auto-update disabled.
- Leave the dashboard closed.
- Skip LLM subagent dispatch.
- Leave the live project root untouched.

## Instructions

1. Resolve the target project root from the argument or current working directory.
2. Resolve the plugin root. Prefer `CLAUDE_PLUGIN_ROOT`, then `~/.understand-anything-plugin`, then the current skill's real path.
3. Ensure `@understand-anything/core` is built. If missing, run package installation/build from the plugin root.
4. Run:

   ```bash
   python3 <SKILL_DIR>/sandbox-pilot.py --source <PROJECT_ROOT> --sandbox /tmp/understand-anything-sandbox-<slug>
   ```

5. Report:
   - files scanned
   - complexity
   - category/language counts
   - import edge count
   - top import hubs
   - skipped files
   - artifact paths

## Exit criteria

Treat the sandbox pass as successful only if:

- deterministic scripts exit successfully;
- no source files were skipped unexpectedly;
- output artifacts exist in the sandbox;
- the summary gives useful architecture signal for the next task.

If the sandbox pass is useful, the next step is to use it as a preflight before an ambiguous ticket. Do not promote it to auto-update or live-repo mode until it has been useful on multiple real tasks.

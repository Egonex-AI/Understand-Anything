# Recipe: Phase 2 Incremental Update Path

> The "Incremental update path" branch of Phase 2 — how to re-batch only changed files, prune the prior graph, and re-merge. Referenced from `SKILL.md` Phase 2 → "Incremental update path".

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

Run compute-batches with `--changed-files`:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.understand-anything/tmp/changed-files.txt
```

This produces a `batches.json` that contains only batches with changed files, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Then dispatch file-analyzer subagents per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the same merge script — it will combine `batch-existing.json` with the fresh `batch-*.json` files:
   ```bash
   python <SKILL_DIR>/merge-batch-graphs.py $PROJECT_ROOT
   ```

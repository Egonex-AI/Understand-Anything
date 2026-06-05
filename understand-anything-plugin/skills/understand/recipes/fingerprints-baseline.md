# Recipe: Phase 7 Structural Fingerprints Baseline

> Builds the fingerprint baseline that future auto-update runs compare against. Referenced from `SKILL.md` Phase 7 step 2 (Generate structural fingerprints baseline).

Generate structural fingerprints baseline. This creates the basis for future automatic incremental updates and **must succeed before `meta.json` is written** — otherwise auto-update sees a fresh commit hash with no fingerprints to compare against, classifies every file as STRUCTURAL, and escalates to `FULL_UPDATE` on every subsequent commit (issue #152).

Write the input file:
```bash
cat > $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json <<EOF
{
  "projectRoot": "$PROJECT_ROOT",
  "sourceFilePaths": [<all source file paths from Phase 1, as JSON array>],
  "gitCommitHash": "<current commit hash>"
}
EOF
```

Then invoke the bundled script (located next to this SKILL.md):
```bash
node <SKILL_DIR>/build-fingerprints.mjs \
  $PROJECT_ROOT/.understand-anything/intermediate/fingerprint-input.json
```

The script uses `TreeSitterPlugin + PluginRegistry` exactly like `extract-structure.mjs`, so the baseline matches the comparison logic used during auto-updates.

**If the script exits non-zero or stdout does not include `Fingerprints baseline:`, abort Phase 7 and report the error. Do NOT proceed to write `meta.json`.**

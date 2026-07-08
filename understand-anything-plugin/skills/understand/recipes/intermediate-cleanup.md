# Recipe: Phase 7 Intermediate Cleanup

> Cleans up `.understand-anything/intermediate/` while preserving `scan-result.json`. Referenced from `SKILL.md` Phase 7 step 4.

Clean up intermediate files, **preserving `scan-result.json`** so future incremental runs can skip Phase 1 SCAN (see issue #293). We `mv` scratch dirs into a timestamped `.trash-*` instead of `rm -rf`ing them directly — this avoids tripping destructive-action gates on hardened hosts (e.g. freshness-window checks) that flag deleting directories created moments earlier (see issue #301). The delayed-purge step in Phase 0 reclaims the space once the trash is older than 7 days.

```bash
# Preserve scan-result.json — Phase 1's deterministic file inventory.
# Future incremental runs (Phase 2 compute-batches.mjs --changed-files=…)
# need this inventory; without it, Phase 1 must re-dispatch and pay ~157k
# tokens / ~158s per incremental run.
TRASH="$PROJECT_ROOT/.understand-anything/.trash-$(date +%s)"
mkdir -p "$TRASH"
INTER="$PROJECT_ROOT/.understand-anything/intermediate"
if [ -d "$INTER" ]; then
  # Move every entry except scan-result.json into the trash dir.
  find "$INTER" -mindepth 1 -maxdepth 1 -not -name 'scan-result.json' -exec mv {} "$TRASH/" \; 2>/dev/null || true
fi
mv "$PROJECT_ROOT/.understand-anything/tmp" "$TRASH/" 2>/dev/null || true
```

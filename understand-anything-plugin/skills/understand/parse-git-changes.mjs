#!/usr/bin/env node
/**
 * parse-git-changes.mjs — parse `git diff <base>..HEAD --name-status -M`
 * output into two disjoint sets:
 *
 *   - changedSet — files to re-analyze (M, A, R-new, C-new)
 *   - pruneSet   — files whose nodes/edges must be dropped from the existing
 *                  graph (D, R-old). Subset of operations that drop content.
 *
 * Why `-M` (rename detection):
 *   Without it, `git mv old new` is reported only as the new path on a single
 *   line, so the existing graph keeps a stale node + edges keyed off `old`
 *   even after re-analysis adds `new` (issue #366, Bug 1).
 *
 *   With `-M`, the same rename appears as:
 *       R<score>\t<old>\t<new>
 *   which lets us prune `old` AND analyze `new`.
 *
 * Copy (`C<score>\t<old>\t<new>`) is treated as "analyze new, do NOT prune
 * old" — the source file still exists, so its nodes must survive.
 *
 * Modes:
 *   - CLI: `parse-git-changes.mjs <diff-output-path> <changed-out> <prune-out>`
 *     Reads the diff text from <diff-output-path>, writes newline-delimited
 *     paths to <changed-out> and <prune-out>.
 *   - Importable: `parseGitNameStatus(rawDiff)` returns
 *     `{ changedSet: Set<string>, pruneSet: Set<string> }`.
 */

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Parse the raw output of `git diff <base>..HEAD --name-status -M`.
 *
 * Each line is tab-separated:
 *   M\t<path>                      → modified, add to changedSet
 *   A\t<path>                      → added,    add to changedSet
 *   D\t<path>                      → deleted,  add to pruneSet (no analysis)
 *   T\t<path>                      → type change (e.g. file ↔ symlink),
 *                                    treat as modified — add to changedSet
 *   R<score>\t<old>\t<new>         → rename,   prune old, analyze new
 *   C<score>\t<old>\t<new>         → copy,     analyze new only (old still exists)
 *   U\t<path>                      → unmerged, add to changedSet so the user
 *                                    is forced to resolve it during analysis
 *   X\t...                         → "unknown" status; surface a warning and
 *                                    skip rather than silently dropping data
 *
 * Blank lines are ignored. Unknown statuses are skipped (with a stderr
 * warning) rather than dropped silently so regressions surface.
 */
export function parseGitNameStatus(rawDiff) {
  const changedSet = new Set();
  const pruneSet = new Set();
  if (!rawDiff) return { changedSet, pruneSet };

  const lines = rawDiff.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    if (!status) continue;

    // First char drives semantics; rename/copy carry a similarity score
    // (e.g. R100, C75) we don't need for routing.
    const op = status[0];

    if (op === 'M' || op === 'A' || op === 'T' || op === 'U') {
      if (parts[1]) changedSet.add(parts[1]);
    } else if (op === 'D') {
      if (parts[1]) pruneSet.add(parts[1]);
    } else if (op === 'R') {
      // R<score>\t<old>\t<new> — prune old, analyze new
      if (parts[1]) pruneSet.add(parts[1]);
      if (parts[2]) changedSet.add(parts[2]);
    } else if (op === 'C') {
      // C<score>\t<old>\t<new> — copy: source still exists, don't prune.
      if (parts[2]) changedSet.add(parts[2]);
    } else {
      // Unknown / future status (e.g. X = "unknown changes"). Surface it
      // rather than silently dropping the line.
      process.stderr.write(
        `Warning: parse-git-changes: unknown git --name-status code '${status}' ` +
        `on line '${line}' — skipped\n`,
      );
    }
  }
  return { changedSet, pruneSet };
}

function writeLines(path, items) {
  // Sort for determinism — tests + repro runs need byte-identical output.
  const sorted = [...items].sort();
  writeFileSync(path, sorted.length ? sorted.join('\n') + '\n' : '', 'utf-8');
}

async function main() {
  const [diffPath, changedOutPath, pruneOutPath] = process.argv.slice(2);
  if (!diffPath || !changedOutPath || !pruneOutPath) {
    process.stderr.write(
      'Usage: node parse-git-changes.mjs <diff-output-path> <changed-out> <prune-out>\n',
    );
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(diffPath, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `Error: parse-git-changes: cannot read diff input at ${diffPath} (${err.message})\n`,
    );
    process.exit(1);
  }

  const { changedSet, pruneSet } = parseGitNameStatus(raw);
  writeLines(changedOutPath, changedSet);
  writeLines(pruneOutPath, pruneSet);

  process.stderr.write(
    `parse-git-changes: ${changedSet.size} changed, ${pruneSet.size} prune-only\n`,
  );
}

// Run only when executed directly as a CLI (see compute-batches.mjs for the
// canonicalize-via-realpath rationale — symlinked plugin caches break a raw
// equality check on import.meta.url vs process.argv[1]).
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`parse-git-changes.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

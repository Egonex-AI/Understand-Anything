import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { IgnoreFilter } from "@understand-anything/core";

/**
 * Recursively lists files under root that pass the ignore filter, as paths
 * relative to root.
 *
 * `statSync` follows symlinks, so a symlink anywhere under root that isn't
 * covered by the ignore patterns (e.g. a tooling symlink pointing outside the
 * repo) could otherwise read files outside the configured project — the
 * entire point of the `projects` allowlist this feeds into. Every resolved
 * entry is therefore checked to still live under root's real path, and
 * visited real directories are tracked to break symlink cycles that would
 * otherwise recurse forever and crash the whole gateway process (this runs
 * in-process, not in a subprocess).
 */
export function walkProject(root: string, ignoreFilter: IgnoreFilter): string[] {
  const results: string[] = [];
  const visitedRealDirs = new Set<string>();

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return results;
  }
  const realRootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  // Seed with root itself so a top-level self-referential symlink (`ln -s . self`)
  // is caught by the same cycle guard as any deeper one, rather than walking
  // root's own contents an extra time before the guard has anything to match.
  visitedRealDirs.add(realRoot);

  function isContained(realPath: string): boolean {
    return realPath === realRoot || realPath.startsWith(realRootPrefix);
  }

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = join(dir, entry);
      const rel = relative(root, abs);
      if (ignoreFilter.isIgnored(rel)) continue;

      let stat;
      let realAbs: string;
      try {
        realAbs = realpathSync(abs);
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (!isContained(realAbs)) continue; // symlink escapes the project root

      if (stat.isDirectory()) {
        if (visitedRealDirs.has(realAbs)) continue; // symlink cycle guard
        visitedRealDirs.add(realAbs);
        walk(abs);
      } else if (stat.isFile()) {
        results.push(rel);
      }
    }
  }

  walk(root);
  return results;
}

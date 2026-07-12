import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { IgnoreFilter } from "@understand-anything/core";

/** Recursively lists files under root that pass the ignore filter, as paths relative to root. */
export function walkProject(root: string, ignoreFilter: IgnoreFilter): string[] {
  const results: string[] = [];

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
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(abs);
      } else if (stat.isFile()) {
        results.push(rel);
      }
    }
  }

  walk(root);
  return results;
}

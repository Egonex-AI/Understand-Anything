import type { GraphNode } from "@understand-anything/core/types";

/** Mirrors core's git-hotspots.ts (redeclared: the dashboard may only import core's browser-safe subpaths). */
export interface FileChurn {
  commits: number;
  lastChanged: string;
  authors: number;
}

export interface HotspotsReport {
  available: boolean;
  reason?: "not-a-git-repo" | "git-missing" | "error";
  days: number;
  commitCount: number;
  truncated: boolean;
  maxCommits: number;
  files: Record<string, FileChurn>;
}

export const HOTSPOT_WINDOWS = [30, 90, 365] as const;
export const HEAT_LEVELS = 5;

/**
 * Bucket a commit count into heat level 1..HEAT_LEVELS on a log scale
 * relative to the busiest file (0 = untouched). Log scale keeps one
 * monster file from flattening everyone else into level 1.
 */
export function heatLevel(commits: number, maxCommits: number): number {
  if (commits <= 0 || maxCommits <= 0) return 0;
  const ratio = Math.log1p(commits) / Math.log1p(maxCommits);
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil(ratio * HEAT_LEVELS)));
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function churnForPath(report: HotspotsReport | null, filePath: string | undefined): FileChurn | undefined {
  if (!report || !filePath) return undefined;
  return report.files[normalizePath(filePath)];
}

/** Heat level per node: every node with a churned filePath (files, and their functions/classes). */
export function hotspotLevels(nodes: GraphNode[], report: HotspotsReport): Map<string, number> {
  const levels = new Map<string, number>();
  for (const node of nodes) {
    const churn = churnForPath(report, node.filePath);
    if (!churn) continue;
    const level = heatLevel(churn.commits, report.maxCommits);
    if (level > 0) levels.set(node.id, level);
  }
  return levels;
}

/** Busiest files first (ties: most recent change, then path). */
export function topHotspots(report: HotspotsReport, limit = 10): { path: string; churn: FileChurn }[] {
  return Object.entries(report.files)
    .map(([path, churn]) => ({ path, churn }))
    .sort(
      (a, b) =>
        b.churn.commits - a.churn.commits ||
        Date.parse(b.churn.lastChanged) - Date.parse(a.churn.lastChanged) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, limit);
}

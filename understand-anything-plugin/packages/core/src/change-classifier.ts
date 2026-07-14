import { dirname } from "node:path";
import type { ChangeAnalysis } from "./fingerprint.js";

export interface UpdateDecision {
  action: "SKIP" | "PARTIAL_UPDATE" | "ARCHITECTURE_UPDATE" | "FULL_UPDATE";
  filesToReanalyze: string[];
  rerunArchitecture: boolean;
  rerunTour: boolean;
  reason: string;
}

/**
 * Classify the type of graph update needed based on structural change analysis.
 *
 * Decision matrix:
 * - SKIP: all files NONE or COSMETIC only
 * - PARTIAL_UPDATE: some STRUCTURAL, same directories
 * - ARCHITECTURE_UPDATE: new/deleted directories or >10 structural files
 * - FULL_UPDATE: >30 structural files or >50% of total files changed structurally
 */
export function classifyUpdate(
  analysis: ChangeAnalysis,
  totalFilesInGraph: number,
  allKnownFiles: string[] = [],
): UpdateDecision {
  const { newFiles, deletedFiles, structurallyChangedFiles, cosmeticOnlyFiles } = analysis;
  const structuralCount = structurallyChangedFiles.length + newFiles.length + deletedFiles.length;

  // No structural changes at all — skip
  if (structuralCount === 0) {
    const cosmeticCount = cosmeticOnlyFiles.length;
    const reason = cosmeticCount > 0
      ? `${cosmeticCount} file(s) have cosmetic-only changes (no structural impact)`
      : "No changes detected";

    return {
      action: "SKIP",
      filesToReanalyze: [],
      rerunArchitecture: false,
      rerunTour: false,
      reason,
    };
  }

  // Too many structural changes — suggest full rebuild
  const triggeredByCount = structuralCount > 30;
  const triggeredByPercentage = totalFilesInGraph > 0 && structuralCount / totalFilesInGraph > 0.5;
  if (triggeredByCount || triggeredByPercentage) {
    const thresholdReason =
      triggeredByCount && triggeredByPercentage
        ? ">30 files and >50% of project"
        : triggeredByCount
          ? ">30 files"
          : ">50% of project";
    return {
      action: "FULL_UPDATE",
      filesToReanalyze: [...structurallyChangedFiles, ...newFiles, ...deletedFiles],
      rerunArchitecture: true,
      rerunTour: true,
      reason: `${structuralCount} files have structural changes (${thresholdReason}) — full rebuild recommended`,
    };
  }

  // Check if directory structure changed (new/deleted top-level directories)
  const hasDirectoryChanges = detectDirectoryChanges(newFiles, deletedFiles, allKnownFiles);

  if (hasDirectoryChanges || structuralCount > 10) {
    return {
      action: "ARCHITECTURE_UPDATE",
      filesToReanalyze: [...structurallyChangedFiles, ...newFiles, ...deletedFiles],
      rerunArchitecture: true,
      rerunTour: true,
      reason: hasDirectoryChanges
        ? `Directory structure changed (${newFiles.length} new, ${deletedFiles.length} deleted files)`
        : `${structuralCount} files have structural changes — architecture re-analysis needed`,
    };
  }

  // Localized structural changes — partial update
  return {
    action: "PARTIAL_UPDATE",
    filesToReanalyze: [...structurallyChangedFiles, ...newFiles, ...deletedFiles],
    rerunArchitecture: false,
    rerunTour: false,
    reason: `${structuralCount} file(s) have structural changes: ${summarizeChanges(analysis)}`,
  };
}

/**
 * Detect if the changes affect the directory structure (new or removed directories).
 * Uses all known files in the project as the baseline for existing directories,
 * then checks if any new/deleted files introduce or remove a top-level source directory.
 */
function detectDirectoryChanges(
  newFiles: string[],
  deletedFiles: string[],
  allKnownFiles: string[],
): boolean {
  const existingDirs = new Set(
    allKnownFiles.map((f) => topDirectory(f)).filter(Boolean),
  );

  for (const f of newFiles) {
    const dir = topDirectory(f);
    if (dir && !existingDirs.has(dir)) return true;
  }

  for (const f of deletedFiles) {
    const dir = topDirectory(f);
    if (dir && !existingDirs.has(dir)) return true;
  }

  return false;
}

/**
 * Get the top-level directory of a file path (first path segment).
 */
function topDirectory(filePath: string): string | null {
  const dir = dirname(filePath);
  if (dir === "." || dir === "") return null;
  const segments = dir.split("/");
  return segments[0] || null;
}

/**
 * Produce a concise human-readable summary of structural changes.
 */
function summarizeChanges(analysis: ChangeAnalysis): string {
  const parts: string[] = [];

  if (analysis.newFiles.length > 0) {
    parts.push(`${analysis.newFiles.length} new`);
  }
  if (analysis.deletedFiles.length > 0) {
    parts.push(`${analysis.deletedFiles.length} deleted`);
  }
  if (analysis.structurallyChangedFiles.length > 0) {
    parts.push(`${analysis.structurallyChangedFiles.length} modified`);
  }

  return parts.join(", ");
}

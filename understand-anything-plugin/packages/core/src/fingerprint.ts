import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StructuralAnalysis } from "./types.js";
import type { PluginRegistry } from "./plugins/registry.js";

// ---- Fingerprint types ----

export interface FunctionFingerprint {
  name: string;
  params: string[];
  returnType?: string;
  exported: boolean;
  lineCount: number;
}

export interface ClassFingerprint {
  name: string;
  methods: string[];
  properties: string[];
  exported: boolean;
  lineCount: number;
}

export interface ImportFingerprint {
  source: string;
  specifiers: string[];
}

export interface FileFingerprint {
  filePath: string;
  contentHash: string;
  functions: FunctionFingerprint[];
  classes: ClassFingerprint[];
  imports: ImportFingerprint[];
  exports: string[];
  totalLines: number;
  hasStructuralAnalysis: boolean;
}

export interface FingerprintStore {
  version: "1.0.0";
  gitCommitHash: string;
  generatedAt: string;
  files: Record<string, FileFingerprint>;
}

export type ChangeLevel = "NONE" | "COSMETIC" | "STRUCTURAL";

export interface FileChangeResult {
  filePath: string;
  changeLevel: ChangeLevel;
  details: string[];
}

export interface ChangeAnalysis {
  fileChanges: FileChangeResult[];
  newFiles: string[];
  deletedFiles: string[];
  structurallyChangedFiles: string[];
  cosmeticOnlyFiles: string[];
  unchangedFiles: string[];
}

// ---- Core functions ----

/**
 * Compute SHA-256 content hash for a file's content.
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Extract a structural fingerprint from a file using its tree-sitter analysis.
 * The fingerprint captures only the elements that affect the knowledge graph
 * (function/class/import/export signatures), not implementation details.
 */
export function extractFileFingerprint(
  filePath: string,
  content: string,
  analysis: StructuralAnalysis,
): FileFingerprint {
  const hash = contentHash(content);
  const exportedNames = new Set(analysis.exports.map((e) => e.name));

  const functions: FunctionFingerprint[] = analysis.functions.map((fn) => ({
    name: fn.name,
    params: [...fn.params],
    returnType: fn.returnType,
    exported: exportedNames.has(fn.name),
    lineCount: fn.lineRange[1] - fn.lineRange[0] + 1,
  }));

  const classes: ClassFingerprint[] = analysis.classes.map((cls) => ({
    name: cls.name,
    methods: [...cls.methods],
    properties: [...cls.properties],
    exported: exportedNames.has(cls.name),
    lineCount: cls.lineRange[1] - cls.lineRange[0] + 1,
  }));

  const imports: ImportFingerprint[] = analysis.imports.map((imp) => ({
    source: imp.source,
    specifiers: [...imp.specifiers],
  }));

  const exports = analysis.exports.map((e) => e.name);

  const totalLines = content.split("\n").length;

  return {
    filePath,
    contentHash: hash,
    functions,
    classes,
    imports,
    exports,
    totalLines,
    hasStructuralAnalysis: true,
  };
}

/**
 * Compare two file fingerprints and determine the change level.
 *
 * - NONE: content hash identical (file unchanged)
 * - COSMETIC: content differs but structural signatures match (internal logic only)
 * - STRUCTURAL: signature-level changes detected
 */
export function compareFingerprints(
  oldFp: FileFingerprint,
  newFp: FileFingerprint,
): FileChangeResult {
  const details: string[] = [];

  // Fast path: identical content
  if (oldFp.contentHash === newFp.contentHash) {
    return { filePath: newFp.filePath, changeLevel: "NONE", details: [] };
  }

  // Conservative path: if either fingerprint lacks structural analysis,
  // we cannot verify structure didn't change — classify as STRUCTURAL.
  if (!oldFp.hasStructuralAnalysis || !newFp.hasStructuralAnalysis) {
    return {
      filePath: newFp.filePath,
      changeLevel: "STRUCTURAL",
      details: ["no structural analysis available — conservative classification"],
    };
  }

  // Compare function signatures
  const oldFuncNames = new Set(oldFp.functions.map((f) => f.name));
  const newFuncNames = new Set(newFp.functions.map((f) => f.name));

  for (const name of newFuncNames) {
    if (!oldFuncNames.has(name)) {
      details.push(`new function: ${name}`);
    }
  }
  for (const name of oldFuncNames) {
    if (!newFuncNames.has(name)) {
      details.push(`removed function: ${name}`);
    }
  }

  // Compare shared functions for signature changes
  for (const newFn of newFp.functions) {
    const oldFn = oldFp.functions.find((f) => f.name === newFn.name);
    if (!oldFn) continue;

    if (JSON.stringify(oldFn.params) !== JSON.stringify(newFn.params)) {
      details.push(`params changed: ${newFn.name}`);
    }
    if (oldFn.returnType !== newFn.returnType) {
      details.push(`return type changed: ${newFn.name}`);
    }
    if (oldFn.exported !== newFn.exported) {
      details.push(`export status changed: ${newFn.name}`);
    }
    // Flag large line count changes (>50% growth or shrink)
    if (oldFn.lineCount > 0) {
      const ratio = newFn.lineCount / oldFn.lineCount;
      if (ratio > 1.5 || ratio < 0.5) {
        details.push(`significant size change: ${newFn.name} (${oldFn.lineCount} → ${newFn.lineCount} lines)`);
      }
    }
  }

  // Compare class signatures
  const oldClassNames = new Set(oldFp.classes.map((c) => c.name));
  const newClassNames = new Set(newFp.classes.map((c) => c.name));

  for (const name of newClassNames) {
    if (!oldClassNames.has(name)) {
      details.push(`new class: ${name}`);
    }
  }
  for (const name of oldClassNames) {
    if (!newClassNames.has(name)) {
      details.push(`removed class: ${name}`);
    }
  }

  for (const newCls of newFp.classes) {
    const oldCls = oldFp.classes.find((c) => c.name === newCls.name);
    if (!oldCls) continue;

    if (JSON.stringify([...oldCls.methods].sort()) !== JSON.stringify([...newCls.methods].sort())) {
      details.push(`methods changed: ${newCls.name}`);
    }
    if (JSON.stringify([...oldCls.properties].sort()) !== JSON.stringify([...newCls.properties].sort())) {
      details.push(`properties changed: ${newCls.name}`);
    }
    if (oldCls.exported !== newCls.exported) {
      details.push(`export status changed: ${newCls.name}`);
    }
  }

  // Compare imports
  const oldImports = oldFp.imports.map((i) => `${i.source}:${[...i.specifiers].sort().join(",")}`).sort();
  const newImports = newFp.imports.map((i) => `${i.source}:${[...i.specifiers].sort().join(",")}`).sort();

  if (JSON.stringify(oldImports) !== JSON.stringify(newImports)) {
    details.push("imports changed");
  }

  // Compare exports
  const oldExports = [...oldFp.exports].sort();
  const newExports = [...newFp.exports].sort();

  if (JSON.stringify(oldExports) !== JSON.stringify(newExports)) {
    details.push("exports changed");
  }

  if (details.length > 0) {
    return { filePath: newFp.filePath, changeLevel: "STRUCTURAL", details };
  }

  // Content changed but structure is identical
  return {
    filePath: newFp.filePath,
    changeLevel: "COSMETIC",
    details: ["internal logic changed (no structural impact)"],
  };
}

/**
 * Build a fingerprint store for a set of files.
 * Files without tree-sitter support get content-hash-only fingerprints
 * (conservative: any change is treated as STRUCTURAL).
 */
export function buildFingerprintStore(
  projectDir: string,
  filePaths: string[],
  registry: PluginRegistry,
  gitCommitHash: string,
): FingerprintStore {
  const files: Record<string, FileFingerprint> = {};

  for (const filePath of filePaths) {
    const absolutePath = join(projectDir, filePath);
    if (!existsSync(absolutePath)) continue;

    const content = readFileSync(absolutePath, "utf-8");
    const analysis = registry.analyzeFile(filePath, content);

    if (analysis) {
      files[filePath] = extractFileFingerprint(filePath, content, analysis);
    } else {
      // No tree-sitter support: content hash only (conservative)
      files[filePath] = {
        filePath,
        contentHash: contentHash(content),
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: content.split("\n").length,
        hasStructuralAnalysis: false,
      };
    }
  }

  return {
    version: "1.0.0",
    gitCommitHash,
    generatedAt: new Date().toISOString(),
    files,
  };
}

/**
 * Analyze changes between the current state of files and stored fingerprints.
 * Returns a detailed breakdown of what changed and at what level.
 */
export function analyzeChanges(
  projectDir: string,
  changedFiles: string[],
  existingStore: FingerprintStore,
  registry: PluginRegistry,
): ChangeAnalysis {
  const fileChanges: FileChangeResult[] = [];
  const newFiles: string[] = [];
  const deletedFiles: string[] = [];
  const structurallyChangedFiles: string[] = [];
  const cosmeticOnlyFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const filePath of changedFiles) {
    const absolutePath = join(projectDir, filePath);
    const existedBefore = filePath in existingStore.files;
    const existsNow = existsSync(absolutePath);

    // File was deleted
    if (!existsNow) {
      if (existedBefore) {
        deletedFiles.push(filePath);
        fileChanges.push({
          filePath,
          changeLevel: "STRUCTURAL",
          details: ["file deleted"],
        });
      }
      continue;
    }

    // File is new
    if (!existedBefore) {
      newFiles.push(filePath);
      fileChanges.push({
        filePath,
        changeLevel: "STRUCTURAL",
        details: ["new file"],
      });
      continue;
    }

    // File exists in both — compare fingerprints
    const content = readFileSync(absolutePath, "utf-8");
    const analysis = registry.analyzeFile(filePath, content);
    const oldFp = existingStore.files[filePath];

    let newFp: FileFingerprint;
    if (analysis) {
      newFp = extractFileFingerprint(filePath, content, analysis);
    } else {
      // No tree-sitter support: content hash only
      newFp = {
        filePath,
        contentHash: contentHash(content),
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: content.split("\n").length,
        hasStructuralAnalysis: false,
      };
    }

    const result = compareFingerprints(oldFp, newFp);
    fileChanges.push(result);

    switch (result.changeLevel) {
      case "NONE":
        unchangedFiles.push(filePath);
        break;
      case "COSMETIC":
        cosmeticOnlyFiles.push(filePath);
        break;
      case "STRUCTURAL":
        structurallyChangedFiles.push(filePath);
        break;
    }
  }

  return {
    fileChanges,
    newFiles,
    deletedFiles,
    structurallyChangedFiles,
    cosmeticOnlyFiles,
    unchangedFiles,
  };
}

#!/usr/bin/env node
/**
 * fingerprint-check — Phase 0/1 of the auto-update hook, shipped as a binary.
 *
 * Replaces the LLM-regenerated Node script that hooks/auto-update-prompt.md
 * previously asked the model to write inline every commit. The inline approach
 * caused issues #152 and #153 (silent fingerprint-store overwrites). This
 * binary uses the same fingerprint + classifier modules that /understand uses
 * to populate the baseline, so the comparison is consistent end-to-end.
 *
 * Inputs (in priority order):
 *   --project-dir <path>     project root (default: process.cwd())
 *   --since <commit>         git rev to diff HEAD against (default: meta.json.gitCommitHash)
 *   --changed <csv>          explicit changed-files list (skips git diff)
 *   --output <path>          where to write change-analysis.json
 *                            (default: <project>/.understand-anything/intermediate/change-analysis.json)
 *   --json                   write only JSON to stdout (no human-readable summary)
 *
 * Exit codes:
 *   0   success — change-analysis.json written, decision printed
 *   2   no fingerprints.json (run /understand first to baseline)
 *   3   no meta.json AND no --since given (cannot determine compare base)
 *   4   silent-load-failure guard tripped (fingerprints.json existed but loaded empty)
 *   5   git diff failed (commit missing, shallow clone, pruned object, history rewrite)
 *   1   unexpected error
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  analyzeChanges,
  type ChangeAnalysis,
  type FingerprintStore,
} from "../fingerprint.js";
import { classifyUpdate, type UpdateDecision } from "../change-classifier.js";
import { getChangedFilesStrict } from "../staleness.js";
import { PluginRegistry } from "../plugins/registry.js";
import { TreeSitterPlugin } from "../plugins/tree-sitter-plugin.js";
import { registerAllParsers } from "../plugins/parsers/index.js";
import { createIgnoreFilter } from "../ignore-filter.js";
import { builtinLanguageConfigs } from "../languages/configs/index.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb",
  ".cpp", ".cc", ".c", ".h", ".hpp",
  ".cs", ".swift", ".kt", ".php",
]);

interface CliArgs {
  projectDir: string;
  since?: string;
  changed?: string[];
  output?: string;
  jsonOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { projectDir: process.cwd(), jsonOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) die(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "--project-dir": args.projectDir = resolve(next()); break;
      case "--since": args.since = next(); break;
      case "--changed": args.changed = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--output": args.output = resolve(next()); break;
      case "--json": args.jsonOnly = true; break;
      case "-h":
      case "--help": usage(); process.exit(0);
      default: die(`Unknown arg: ${a}`);
    }
  }
  return args;
}

function usage(): void {
  process.stderr.write(`fingerprint-check — classify a commit's structural impact for /understand --auto-update.

Usage:
  fingerprint-check [--project-dir <path>] [--since <sha>] [--changed <csv>] [--output <path>] [--json]

Inputs:
  --project-dir   Project root. Default: cwd.
  --since         Compare HEAD against this commit. Default: meta.json gitCommitHash.
  --changed       Explicit CSV of changed files. Skips git diff.
  --output        Where to write change-analysis.json.
                  Default: <project>/.understand-anything/intermediate/change-analysis.json.
  --json          Print only the JSON to stdout (no human-readable summary on stderr).

Exit codes: 0 ok | 2 no fingerprints.json | 3 cannot determine since | 4 load-guard tripped | 5 git diff failed | 1 other
`);
}

function die(msg: string, code = 1): never {
  process.stderr.write(`fingerprint-check: ${msg}\n`);
  process.exit(code);
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

async function buildRegistry(): Promise<PluginRegistry> {
  const registry = new PluginRegistry();
  // Pass the full language config set so non-TS/JS file changes (Python, Go,
  // Java, etc.) are analyzed structurally instead of falling back to a
  // content-hash-only comparison — the default TreeSitterPlugin constructor
  // would only load TypeScript and JavaScript, which would classify every
  // non-TS change as STRUCTURAL and defeat the cosmetic fast path.
  const treeSitter = new TreeSitterPlugin(builtinLanguageConfigs);
  await treeSitter.init();
  registry.register(treeSitter);
  registerAllParsers(registry);
  return registry;
}

function filterSourceFiles(files: string[]): string[] {
  return files.filter((f) => {
    const idx = f.lastIndexOf(".");
    if (idx < 0) return false;
    return SOURCE_EXTENSIONS.has(f.slice(idx).toLowerCase());
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  // Legacy directory first — projects analyzed before the `.ua` rename keep
  // their existing `.understand-anything/` data.
  const ua = join(
    args.projectDir,
    existsSync(join(args.projectDir, ".understand-anything")) ? ".understand-anything" : ".ua",
  );
  const fingerprintsPath = join(ua, "fingerprints.json");
  const metaPath = join(ua, "meta.json");
  const outputPath =
    args.output ?? join(ua, "intermediate", "change-analysis.json");

  // Load fingerprints (with silent-load-failure guard from issue #152).
  if (!existsSync(fingerprintsPath)) {
    die(`No fingerprints at ${fingerprintsPath}. Run /understand first to baseline.`, 2);
  }
  const rawFingerprints = readFileSync(fingerprintsPath, "utf-8");
  const existedAndNonEmpty = rawFingerprints.trim().length > 0;
  let store: FingerprintStore;
  try {
    store = JSON.parse(rawFingerprints) as FingerprintStore;
  } catch (err) {
    die(`Failed to parse ${fingerprintsPath}: ${(err as Error).message}`);
  }
  const fileCount = Object.keys(store.files ?? {}).length;
  if (existedAndNonEmpty && fileCount === 0) {
    die(
      `fingerprints.json existed and was non-empty but loaded as 0 files — refusing to proceed (issue #152 guard)`,
      4,
    );
  }

  // Determine the compare base sha.
  let sinceSha = args.since;
  if (!sinceSha) {
    if (!existsSync(metaPath)) {
      die(`No --since given and no meta.json at ${metaPath}.`, 3);
    }
    const meta = loadJson<{ gitCommitHash?: string }>(metaPath);
    sinceSha = meta.gitCommitHash;
    if (!sinceSha) {
      die(`meta.json has no gitCommitHash field.`, 3);
    }
  }

  // Determine changed-file list.
  let changedFiles: string[];
  if (args.changed) {
    changedFiles = args.changed;
  } else {
    try {
      changedFiles = getChangedFilesStrict(args.projectDir, sinceSha);
    } catch (err: unknown) {
      // Distinguish a real empty diff from a git failure. Previously the
      // catching variant returned [], which made the hook silently SKIP
      // when meta.json pointed at a commit not available locally (shallow
      // clone, history rewrite, pruned object).
      let stderr: string;
      if (err && typeof err === "object" && "stderr" in err) {
        const s = (err as { stderr?: unknown }).stderr;
        stderr = typeof s === "string" ? s.trim() : String(s).trim();
      } else if (err instanceof Error) {
        stderr = err.message;
      } else {
        stderr = String(err);
      }
      die(
        `could not diff from ${sinceSha}: ${stderr}\n` +
          `  This often happens after a shallow clone, history rewrite, or pruned commit.\n` +
          `  Re-baseline with /understand to refresh meta.json.`,
        5,
      );
    }
  }

  // Filter to source extensions (matches the prompt's Phase 0 step 7).
  const sourceFiles = filterSourceFiles(changedFiles);

  // Apply .understandignore if present (matches Phase 0 step 9).
  const filter = createIgnoreFilter(args.projectDir);
  const kept = sourceFiles.filter((f) => !filter.isIgnored(f));
  const ignored = sourceFiles.length - kept.length;

  // Trivial fast path: nothing source-relevant changed.
  if (kept.length === 0) {
    const decision: UpdateDecision = {
      action: "SKIP",
      filesToReanalyze: [],
      rerunArchitecture: false,
      rerunTour: false,
      reason:
        sourceFiles.length === 0
          ? "No source files changed since the last analyzed commit."
          : `All ${sourceFiles.length} changed source file(s) are in .understandignore paths.`,
    };
    writeOutput(outputPath, { decision, analysis: emptyAnalysis(), kept, ignored });
    summarize(args, decision, emptyAnalysis(), kept, ignored);
    return;
  }

  // Build registry + run analysis.
  const registry = await buildRegistry();
  const analysis: ChangeAnalysis = analyzeChanges(args.projectDir, kept, store, registry);
  // Subtract this commit's deletions before handing the baseline to the classifier — otherwise
  // detectDirectoryChanges() sees the very file being removed still counted in the "known files"
  // set, so a directory's last file being deleted never registers as a directory change (the
  // check `!existingDirs.has(dir)` is trivially false when the deleted file itself put `dir`
  // in `existingDirs`).
  const deletedSet = new Set(analysis.deletedFiles);
  const remainingKnownFiles = Object.keys(store.files).filter((f) => !deletedSet.has(f));
  const decision = classifyUpdate(analysis, fileCount, remainingKnownFiles);

  writeOutput(outputPath, { decision, analysis, kept, ignored });
  summarize(args, decision, analysis, kept, ignored);
}

function emptyAnalysis(): ChangeAnalysis {
  return {
    fileChanges: [],
    newFiles: [],
    deletedFiles: [],
    structurallyChangedFiles: [],
    cosmeticOnlyFiles: [],
    unchangedFiles: [],
  };
}

function writeOutput(
  outputPath: string,
  payload: {
    decision: UpdateDecision;
    analysis: ChangeAnalysis;
    kept: string[];
    ignored: number;
  },
): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const tmp = outputPath + ".tmp";
  writeFileSync(
    tmp,
    JSON.stringify(
      {
        action: payload.decision.action,
        filesToReanalyze: payload.decision.filesToReanalyze,
        rerunArchitecture: payload.decision.rerunArchitecture,
        rerunTour: payload.decision.rerunTour,
        reason: payload.decision.reason,
        fileChanges: payload.analysis.fileChanges,
        stats: {
          consideredFiles: payload.kept.length,
          ignoredByUnderstandignore: payload.ignored,
          newFiles: payload.analysis.newFiles.length,
          deletedFiles: payload.analysis.deletedFiles.length,
          structurallyChanged: payload.analysis.structurallyChangedFiles.length,
          cosmeticOnly: payload.analysis.cosmeticOnlyFiles.length,
          unchanged: payload.analysis.unchangedFiles.length,
        },
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  // rename is atomic on the same volume — daemons see complete file or nothing.
  renameSync(tmp, outputPath);
}

function summarize(
  args: CliArgs,
  decision: UpdateDecision,
  analysis: ChangeAnalysis,
  kept: string[],
  ignored: number,
): void {
  if (args.jsonOnly) {
    process.stdout.write(
      JSON.stringify({
        action: decision.action,
        filesToReanalyze: decision.filesToReanalyze.length,
        reason: decision.reason,
      }) + "\n",
    );
    return;
  }
  const lines = [
    `action: ${decision.action}`,
    `reason: ${decision.reason}`,
    `considered: ${kept.length} source file(s), ${ignored} ignored by .understandignore`,
    `new: ${analysis.newFiles.length}, deleted: ${analysis.deletedFiles.length}, structural: ${analysis.structurallyChangedFiles.length}, cosmetic: ${analysis.cosmeticOnlyFiles.length}, unchanged: ${analysis.unchangedFiles.length}`,
    `filesToReanalyze: ${decision.filesToReanalyze.length}`,
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

main().catch((err) => {
  die(`Unexpected: ${(err as Error).stack ?? err}`);
});

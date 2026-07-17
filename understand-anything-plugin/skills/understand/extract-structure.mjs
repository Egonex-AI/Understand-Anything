#!/usr/bin/env node
/**
 * extract-structure.mjs
 *
 * Deterministic structural extraction script for the file-analyzer agent.
 * Uses PluginRegistry (TreeSitterPlugin + non-code parsers) from @understand-anything/core
 * to replace the LLM-generated throwaway regex scripts in Phase 1.
 *
 * Usage:
 *   node extract-structure.mjs <input.json> <output.json>
 *
 * Input JSON:
 *   { projectRoot, batchFiles: [{path, language, sizeLines, fileCategory}], batchImportData }
 *
 * Output JSON:
 *   { scriptCompleted, filesAnalyzed, filesSkipped, results: [...] }
 */

import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { buildResult as buildExtractResult } from './extract-structure-result.mjs';
import { readTreeSitterExtensionLanguageMap } from './config.mjs';

export { buildResult } from './extract-structure-result.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/understand/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @understand-anything/core
//
// Node ESM dynamic import() requires a file:// URL on Windows; passing a raw
// absolute path like "C:\..." throws ERR_UNSUPPORTED_ESM_URL_SCHEME because the
// loader parses "C:" as a URL scheme. Wrap both resolutions in pathToFileURL().
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  // Fallback: direct path for installed plugin cache layouts
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const {
  TreeSitterPlugin,
  PluginRegistry,
  LanguageRegistry,
  builtinLanguageConfigs,
  registerAllParsers,
} = core;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node extract-structure.mjs <input.json> <output.json>\n');
    process.exit(1);
  }

  // Read input
  const inputRaw = readFileSync(inputPath, 'utf-8');
  const input = JSON.parse(inputRaw);
  const { projectRoot, batchFiles, batchImportData } = input;

  if (!projectRoot || !Array.isArray(batchFiles)) {
    throw new Error('Invalid input: must contain projectRoot and batchFiles array');
  }

  const validLanguageIds = new Set(builtinLanguageConfigs.map((config) => config.id));
  validLanguageIds.add('tsx');
  const treeSitterExtensionLanguageMap = readTreeSitterExtensionLanguageMap(
    projectRoot,
    { validLanguageIds },
  );

  // Create tree-sitter plugin with all configs that have WASM grammars
  const tsConfigs = builtinLanguageConfigs.filter(c => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs, undefined, {
    extensionLanguageMap: treeSitterExtensionLanguageMap,
  });
  await tsPlugin.init();

  // Create registry and register tree-sitter + all non-code parsers
  const languageRegistry = LanguageRegistry.createDefault();
  for (const [ext, languageId] of Object.entries(treeSitterExtensionLanguageMap)) {
    languageRegistry.registerExtensionAlias(ext, languageId);
  }
  const registry = new PluginRegistry(languageRegistry);
  registry.register(tsPlugin);
  registerAllParsers(registry);

  const results = [];
  const filesSkipped = [];

  for (const file of batchFiles) {
    const absolutePath = join(projectRoot, file.path);

    // Read file content
    let content;
    try {
      content = readFileSync(absolutePath, 'utf-8');
    } catch {
      filesSkipped.push(file.path);
      continue;
    }

    // Line counts. POSIX text files end in a trailing newline, which makes
    // `split('\n')` produce one extra empty element. Match `wc -l` semantics
    // (used by the project scanner for `sizeLines`) so the two counts agree.
    const lines = content.split('\n');
    const totalLines = content.endsWith('\n') ? Math.max(0, lines.length - 1) : lines.length;
    const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;

    const wantsCallGraph =
      file.fileCategory === 'code' || file.fileCategory === 'script';

    const mapCallGraph = cg =>
      cg && cg.length > 0
        ? cg.map(entry => ({
            caller: entry.caller,
            callee: entry.callee,
            lineNumber: entry.lineNumber,
          }))
        : null;

    let analysis = null;
    let callGraph = null;

    // Single-parse fast path: when both structure and call graph are needed,
    // analyzeFileFull parses the file once instead of analyzeFile +
    // extractCallGraph parsing it twice (~40% less parse work on code files).
    // Falls back to the two separate calls (preserving their independent
    // degradation) when the registry/plugin lacks the combined method or it
    // throws.
    let full = null;
    if (wantsCallGraph && typeof registry.analyzeFileFull === 'function') {
      try {
        full = registry.analyzeFileFull(file.path, content);
      } catch {
        full = null;
      }
    }

    if (full) {
      analysis = full.structure;
      callGraph = mapCallGraph(full.callGraph);
    } else {
      // Structural analysis via registry
      try {
        analysis = registry.analyzeFile(file.path, content);
      } catch {
        // If analysis throws, treat as degraded — still include basic metrics
      }

      // Call graph extraction (code files only)
      if (wantsCallGraph) {
        try {
          callGraph = mapCallGraph(registry.extractCallGraph(file.path, content));
        } catch {
          // Call graph extraction failed — non-fatal
        }
      }
    }

    // Build result object
    const result = buildExtractResult(file, totalLines, nonEmptyLines, analysis, callGraph, batchImportData);
    results.push(result);
  }

  // Write output
  const output = {
    scriptCompleted: true,
    filesAnalyzed: results.length,
    filesSkipped,
    results,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  if (!existsSync(outputPath)) {
    throw new Error(`output file missing after write: ${outputPath}`);
  }
}

// ---------------------------------------------------------------------------
// Run only when executed directly as a CLI; importing the module (e.g. from
// tests) must not trigger main().
//
// Canonicalize both sides through realpathSync. Node ESM resolves
// import.meta.url through symlinks but pathToFileURL(process.argv[1]) preserves
// them, so a raw equality check silently no-ops when the script is invoked via
// a symlinked plugin install path (the default in Claude Code / Copilot CLI
// caches). See GitHub issue #162.
// ---------------------------------------------------------------------------
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
    process.stderr.write(`extract-structure.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

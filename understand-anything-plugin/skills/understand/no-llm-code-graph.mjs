#!/usr/bin/env node
/**
 * no-llm-code-graph.mjs
 *
 * Deterministic code graph generator for Understand-Anything.
 *
 * This is intentionally narrower than /understand:
 *   - no LLM agents
 *   - no natural-language architecture interpretation
 *   - no tour, domain graph, business flow, chat, or review
 *
 * It produces only a code graph:
 *   - file/function/class nodes
 *   - contains/imports/calls edges
 *
 * Usage:
 *   node no-llm-code-graph.mjs <projectRoot> [--output=<path>] [--write-knowledge-graph] [--no-scripts] [--keep-intermediate]
 *
 * Output:
 *   <projectRoot>/.understand-anything/code-graph.json by default
 *   optionally also <projectRoot>/.understand-anything/knowledge-graph.json
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { validateGraph } = core;

const SCRIPT_DIR = __dirname;

function usage() {
  return [
    'Usage:',
    '  node no-llm-code-graph.mjs <projectRoot> [--output=<path>] [--write-knowledge-graph] [--no-scripts] [--keep-intermediate]',
    '',
    'Options:',
    '  --output=<path>            Output path. Defaults to <projectRoot>/.understand-anything/code-graph.json',
    '  --write-knowledge-graph    Also copy output to <projectRoot>/.understand-anything/knowledge-graph.json',
    '  --no-scripts               Exclude shell/batch/powershell script files; include only fileCategory=code',
    '  --keep-intermediate        Keep scan/import/structure intermediate files for debugging',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    projectRoot: '',
    output: '',
    writeKnowledgeGraph: false,
    includeScripts: true,
    keepIntermediate: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--write-knowledge-graph') {
      args.writeKnowledgeGraph = true;
      continue;
    }
    if (arg === '--no-scripts') {
      args.includeScripts = false;
      continue;
    }
    if (arg === '--keep-intermediate') {
      args.keepIntermediate = true;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!args.projectRoot) {
      args.projectRoot = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!args.projectRoot) {
    throw new Error('Missing projectRoot\n\n' + usage());
  }
  return args;
}

function ensureProjectRoot(rawRoot) {
  const root = resolve(rawRoot);
  if (!existsSync(root)) throw new Error(`Project root does not exist: ${root}`);
  const stat = statSync(root);
  if (!stat.isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  return realpathSync(root);
}

function runNodeScript(scriptName, args) {
  const scriptPath = join(SCRIPT_DIR, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: pluginRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result.stdout;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function getGitHash(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

function detectProjectName(projectRoot) {
  const packageJson = join(projectRoot, 'package.json');
  if (existsSync(packageJson)) {
    try {
      const parsed = readJson(packageJson);
      if (typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // fall through
    }
  }
  return basename(projectRoot);
}

function normalizeOutputPath(projectRoot, rawOutput) {
  if (!rawOutput) return join(projectRoot, '.understand-anything', 'code-graph.json');
  return isAbsolute(rawOutput) ? rawOutput : resolve(projectRoot, rawOutput);
}

function isCodeFile(file, includeScripts) {
  if (file.fileCategory === 'code') return true;
  return includeScripts && file.fileCategory === 'script';
}

function complexityFromFile(result) {
  const lines = result.totalLines ?? 0;
  const functionCount = result.functions?.length ?? 0;
  const classCount = result.classes?.length ?? 0;
  const symbolCount = functionCount + classCount;
  if (lines > 500 || symbolCount > 25) return 'complex';
  if (lines > 150 || symbolCount > 8) return 'moderate';
  return 'simple';
}

function complexityFromRange(startLine, endLine) {
  const lines = Math.max(0, (endLine ?? 0) - (startLine ?? 0) + 1);
  if (lines > 200) return 'complex';
  if (lines > 80) return 'moderate';
  return 'simple';
}

function stableName(value, fallback) {
  const str = String(value ?? '').replace(/\s+/g, ' ').trim();
  return str || fallback;
}

function addUniqueNode(graph, node, nodeIds) {
  let id = node.id;
  if (nodeIds.has(id)) {
    const suffixBase = node.lineRange?.[0] ? String(node.lineRange[0]) : 'duplicate';
    id = `${id}:${suffixBase}`;
    let i = 2;
    while (nodeIds.has(id)) {
      id = `${node.id}:${suffixBase}:${i}`;
      i += 1;
    }
  }
  const finalNode = { ...node, id };
  nodeIds.add(id);
  graph.nodes.push(finalNode);
  return id;
}

function addEdge(graph, edge, edgeKeys, nodeIds) {
  if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
  if (edge.source === edge.target && edge.type !== 'contains') return false;
  const key = `${edge.source}|${edge.target}|${edge.type}`;
  if (edgeKeys.has(key)) return false;
  edgeKeys.add(key);
  graph.edges.push(edge);
  return true;
}

function fileSummary(result, importMap) {
  const functions = result.functions?.length ?? 0;
  const classes = result.classes?.length ?? 0;
  const imports = importMap[result.path]?.length ?? 0;
  const pieces = [
    `Deterministic code file generated without LLM.`,
    `${functions} function${functions === 1 ? '' : 's'}.`,
    `${classes} class${classes === 1 ? '' : 'es'}.`,
    `${imports} internal import${imports === 1 ? '' : 's'}.`,
  ];
  return pieces.join(' ');
}

function functionSummary(filePath, fn) {
  const params = Array.isArray(fn.params) && fn.params.length > 0
    ? ` Parameters: ${fn.params.join(', ')}.`
    : '';
  return `Function ${fn.name} in ${filePath}.${params}`;
}

function classSummary(filePath, cls) {
  const methods = Array.isArray(cls.methods) ? cls.methods.length : 0;
  return `Class ${cls.name} in ${filePath}. ${methods} method${methods === 1 ? '' : 's'} detected.`;
}

function buildCodeGraph({ projectRoot, scanResult, importMap, structureResult, includeScripts }) {
  const gitHash = getGitHash(projectRoot);
  const codeFiles = scanResult.files.filter((file) => isCodeFile(file, includeScripts));
  const codeFileSet = new Set(codeFiles.map((file) => file.path));
  const resultByPath = new Map(structureResult.results.map((result) => [result.path, result]));
  const languages = [...new Set(codeFiles.map((file) => file.language).filter(Boolean))].sort();

  const graph = {
    version: '1.0.0',
    kind: 'codebase',
    project: {
      name: detectProjectName(projectRoot),
      languages,
      frameworks: [],
      description: 'Deterministic no-LLM code graph. Contains only file/function/class structure and code relationships.',
      analyzedAt: new Date().toISOString(),
      gitCommitHash: gitHash,
    },
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
  };

  const nodeIds = new Set();
  const edgeKeys = new Set();
  const fileNodeByPath = new Map();
  const symbolIdsByFile = new Map();
  const symbolIdsByName = new Map();

  for (const file of codeFiles) {
    const structure = resultByPath.get(file.path) ?? {
      path: file.path,
      language: file.language,
      fileCategory: file.fileCategory,
      totalLines: file.sizeLines ?? 0,
      nonEmptyLines: 0,
      metrics: {},
    };
    const totalLines = structure.totalLines ?? file.sizeLines ?? 0;
    const lineRange = totalLines > 0 ? [1, Math.max(1, totalLines)] : undefined;
    const fileId = addUniqueNode(graph, {
      id: `file:${file.path}`,
      type: 'file',
      name: basename(file.path),
      filePath: file.path,
      ...(lineRange ? { lineRange } : {}),
      summary: fileSummary(structure, importMap),
      tags: ['no-llm', 'code-graph', `language:${file.language}`, `category:${file.fileCategory}`],
      complexity: complexityFromFile(structure),
    }, nodeIds);
    fileNodeByPath.set(file.path, fileId);
    symbolIdsByFile.set(file.path, new Map());

    const exportedNames = new Set((structure.exports ?? []).map((exp) => exp.name).filter(Boolean));

    for (const fn of structure.functions ?? []) {
      const name = stableName(fn.name, `anonymous@${fn.startLine ?? 'unknown'}`);
      const startLine = Number.isFinite(fn.startLine) ? fn.startLine : undefined;
      const endLine = Number.isFinite(fn.endLine) ? fn.endLine : startLine;
      const line = startLine && endLine ? [startLine, endLine] : undefined;
      const tags = ['no-llm', 'function'];
      if (exportedNames.has(name)) tags.push('exported');
      const functionId = addUniqueNode(graph, {
        id: `function:${file.path}:${name}`,
        type: 'function',
        name,
        filePath: file.path,
        ...(line ? { lineRange: line } : {}),
        summary: functionSummary(file.path, { ...fn, name }),
        tags,
        complexity: complexityFromRange(startLine, endLine),
      }, nodeIds);
      addEdge(graph, {
        source: fileId,
        target: functionId,
        type: 'contains',
        direction: 'forward',
        weight: 1,
      }, edgeKeys, nodeIds);
      indexSymbol(symbolIdsByFile, symbolIdsByName, file.path, name, functionId);
    }

    for (const cls of structure.classes ?? []) {
      const name = stableName(cls.name, `anonymous-class@${cls.startLine ?? 'unknown'}`);
      const startLine = Number.isFinite(cls.startLine) ? cls.startLine : undefined;
      const endLine = Number.isFinite(cls.endLine) ? cls.endLine : startLine;
      const line = startLine && endLine ? [startLine, endLine] : undefined;
      const tags = ['no-llm', 'class'];
      if (exportedNames.has(name)) tags.push('exported');
      const classId = addUniqueNode(graph, {
        id: `class:${file.path}:${name}`,
        type: 'class',
        name,
        filePath: file.path,
        ...(line ? { lineRange: line } : {}),
        summary: classSummary(file.path, { ...cls, name }),
        tags,
        complexity: complexityFromRange(startLine, endLine),
      }, nodeIds);
      addEdge(graph, {
        source: fileId,
        target: classId,
        type: 'contains',
        direction: 'forward',
        weight: 1,
      }, edgeKeys, nodeIds);
      indexSymbol(symbolIdsByFile, symbolIdsByName, file.path, name, classId);
    }
  }

  for (const [sourcePath, targets] of Object.entries(importMap)) {
    if (!codeFileSet.has(sourcePath)) continue;
    const sourceId = fileNodeByPath.get(sourcePath);
    if (!sourceId) continue;
    for (const targetPath of targets) {
      if (!codeFileSet.has(targetPath)) continue;
      const targetId = fileNodeByPath.get(targetPath);
      if (!targetId) continue;
      addEdge(graph, {
        source: sourceId,
        target: targetId,
        type: 'imports',
        direction: 'forward',
        weight: 0.7,
      }, edgeKeys, nodeIds);
    }
  }

  let resolvedCalls = 0;
  let unresolvedCalls = 0;
  for (const structure of structureResult.results) {
    if (!codeFileSet.has(structure.path)) continue;
    for (const call of structure.callGraph ?? []) {
      const callerId = resolveSingleSymbol(symbolIdsByFile, structure.path, call.caller);
      if (!callerId) {
        unresolvedCalls += 1;
        continue;
      }

      const calleeId = resolveCallee({
        sourcePath: structure.path,
        calleeName: call.callee,
        importMap,
        symbolIdsByFile,
      });

      if (!calleeId) {
        unresolvedCalls += 1;
        continue;
      }

      if (addEdge(graph, {
        source: callerId,
        target: calleeId,
        type: 'calls',
        direction: 'forward',
        weight: 0.8,
      }, edgeKeys, nodeIds)) {
        resolvedCalls += 1;
      }
    }
  }

  const stats = {
    scannedFiles: scanResult.totalFiles ?? scanResult.files.length,
    codeFiles: codeFiles.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    importEdges: graph.edges.filter((edge) => edge.type === 'imports').length,
    containsEdges: graph.edges.filter((edge) => edge.type === 'contains').length,
    callEdges: graph.edges.filter((edge) => edge.type === 'calls').length,
    resolvedCalls,
    unresolvedCalls,
    skippedStructureFiles: structureResult.filesSkipped?.length ?? 0,
  };

  return { graph, stats };
}

function indexSymbol(symbolIdsByFile, symbolIdsByName, filePath, name, id) {
  if (!symbolIdsByFile.has(filePath)) symbolIdsByFile.set(filePath, new Map());
  const byFile = symbolIdsByFile.get(filePath);
  const existingForFile = byFile.get(name) ?? [];
  existingForFile.push(id);
  byFile.set(name, existingForFile);

  const existingGlobal = symbolIdsByName.get(name) ?? [];
  existingGlobal.push(id);
  symbolIdsByName.set(name, existingGlobal);
}

function resolveSingleSymbol(symbolIdsByFile, filePath, name) {
  const byFile = symbolIdsByFile.get(filePath);
  if (!byFile) return null;
  const ids = byFile.get(name) ?? [];
  return ids.length === 1 ? ids[0] : null;
}

function resolveCallee({ sourcePath, calleeName, importMap, symbolIdsByFile }) {
  const local = resolveSingleSymbol(symbolIdsByFile, sourcePath, calleeName);
  if (local) return local;

  const candidates = [];
  for (const targetPath of importMap[sourcePath] ?? []) {
    const target = resolveSingleSymbol(symbolIdsByFile, targetPath, calleeName);
    if (target) candidates.push(target);
  }

  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

function validateIfPossible(graph) {
  if (graph.nodes.length === 0) {
    return { graph, warnings: ['No code nodes found; skipped KnowledgeGraph validation because schema requires at least one node.'] };
  }

  const result = validateGraph(graph);
  if (!result.success) {
    throw new Error(`Generated code graph failed validation: ${result.fatal ?? 'unknown error'}`);
  }

  return {
    graph: { ...result.data, kind: graph.kind },
    warnings: result.issues?.map((issue) => issue.message) ?? [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = ensureProjectRoot(args.projectRoot);
  const uaDir = join(projectRoot, '.understand-anything');
  const intermediateDir = join(uaDir, 'intermediate', 'no-llm-code-graph');
  mkdirSync(intermediateDir, { recursive: true });

  const scanPath = join(intermediateDir, 'scan-result.json');
  const importInputPath = join(intermediateDir, 'import-input.json');
  const importOutputPath = join(intermediateDir, 'import-map.json');
  const structureInputPath = join(intermediateDir, 'structure-input.json');
  const structureOutputPath = join(intermediateDir, 'structure-output.json');
  const outputPath = normalizeOutputPath(projectRoot, args.output);

  process.stderr.write(`[no-llm] scanning files\n`);
  runNodeScript('scan-project.mjs', [projectRoot, scanPath]);
  const scanResult = readJson(scanPath);
  const codeFiles = scanResult.files.filter((file) => isCodeFile(file, args.includeScripts));

  process.stderr.write(`[no-llm] resolving imports for ${codeFiles.length} code files\n`);
  writeJson(importInputPath, { projectRoot, files: codeFiles });
  runNodeScript('extract-import-map.mjs', [importInputPath, importOutputPath]);
  const importResult = readJson(importOutputPath);
  const importMap = importResult.importMap ?? {};

  process.stderr.write(`[no-llm] extracting code structure\n`);
  writeJson(structureInputPath, {
    projectRoot,
    batchFiles: codeFiles,
    batchImportData: importMap,
  });
  runNodeScript('extract-structure.mjs', [structureInputPath, structureOutputPath]);
  const structureResult = readJson(structureOutputPath);

  process.stderr.write(`[no-llm] assembling code graph\n`);
  const { graph, stats } = buildCodeGraph({
    projectRoot,
    scanResult,
    importMap,
    structureResult,
    includeScripts: args.includeScripts,
  });

  const validated = validateIfPossible(graph);
  writeJson(outputPath, validated.graph);

  const reportPath = outputPath.replace(/\.json$/i, '.report.json');
  writeJson(reportPath, {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    projectRoot,
    outputPath,
    writeKnowledgeGraph: args.writeKnowledgeGraph,
    includeScripts: args.includeScripts,
    stats,
    validationWarnings: validated.warnings,
    intermediateDir: args.keepIntermediate ? intermediateDir : null,
    intermediateKept: args.keepIntermediate,
  });

  if (args.writeKnowledgeGraph) {
    const knowledgeGraphPath = join(uaDir, 'knowledge-graph.json');
    copyFileSync(outputPath, knowledgeGraphPath);
  }

  if (!args.keepIntermediate) {
    rmSync(intermediateDir, { recursive: true, force: true });
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    outputPath,
    reportPath,
    knowledgeGraphPath: args.writeKnowledgeGraph ? join(uaDir, 'knowledge-graph.json') : null,
    stats,
  }, null, 2) + '\n');
}

try {
  await main();
} catch (err) {
  process.stderr.write(`no-llm-code-graph failed: ${err.message}\n`);
  if (err.stack) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
}

/** Shared merge/finalize gate. Reports evidence; never restores old graph data. */
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const skillDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(skillDir, '../..');
const require = createRequire(join(pluginRoot, 'package.json'));
let corePromise;
async function getCore() {
  corePromise ??= (async () => {
    try {
      return await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
    } catch {
      return import(pathToFileURL(join(pluginRoot, 'packages/core/dist/index.js')).href);
    }
  })();
  return corePromise;
}

export async function getIntermediateDir(projectRoot) {
  return join((await getCore()).resolveUaDir(projectRoot), 'intermediate');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function atomicWriteJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function normalizePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)) return null;
  const path = (process.platform === 'win32' ? value.replaceAll('\\', '/') : value).replace(/^\.\//, '');
  return path.split('/').includes('..') ? null : path;
}

export function symbolKind(node) {
  if (node.type === 'class') return 'class';
  if (['function', 'func', 'method'].includes(node.type)) return 'callable';
  return null;
}

function qualifiedName(name) {
  return typeof name === 'string' ? name.replaceAll('::', '.').replaceAll('#', '.') : '';
}

function symbolKey(symbol) {
  return JSON.stringify([symbol.kind, symbol.owner, symbol.name]);
}

function validScope(scope) {
  return scope && (['file', 'unknown'].includes(scope.kind)
    || scope.kind === 'class' && typeof scope.name === 'string' && scope.name.length > 0
    || scope.kind === 'local' && Number.isInteger(scope.id));
}
function validRange(range) {
  return Array.isArray(range) && range.length === 2 && range.every(Number.isInteger)
    && range[0] > 0 && range[1] >= range[0];
}
function validSupplement(evidence) {
  const supplement = evidence?.symbolEvidence;
  const validEntry = item => item && [null, 'callable', 'class'].includes(item.kind)
    && validScope(item.scope) && (item.name === null || typeof item.name === 'string')
    && typeof item.reason === 'string' && validRange(item.lineRange)
    && (item.nameSuffix === undefined || typeof item.nameSuffix === 'string');
  const validDeclaration = item => item && typeof item.name === 'string'
    && validScope(item.scope) && validRange(item.lineRange);
  return supplement?.version === 2 && Array.isArray(supplement.effects) && supplement.effects.every(validEntry)
    && Array.isArray(supplement.functions) && supplement.functions.every(validDeclaration)
    && Array.isArray(supplement.classes) && supplement.classes.every(validDeclaration)
    && supplement.coverage?.profile === 'structural-declarations-v1'
    && Array.isArray(supplement.coverage.gaps) && supplement.coverage.gaps.every(validEntry);
}
function scopeOwner(scope) {
  return scope.kind === 'class' ? scope.name : scope.kind === 'file' ? '' : null;
}
function compatibleEvidence(records, symbol) {
  return records.filter(item => {
    if (item.scope.kind === 'local') return false;
    if (item.kind !== null && item.kind !== symbol.kind) return false;
    const owner = scopeOwner(item.scope);
    if (item.scope.kind !== 'unknown' && qualifiedName(owner) !== qualifiedName(symbol.owner)) return false;
    // Actual source names are not graph-ID spelling hints.
    const names = [symbol.name];
    if (item.scope.kind === 'unknown') names.push(names[0].split('.').at(-1));
    if (item.name !== null && !names.includes(item.name)) return false;
    return !item.nameSuffix || names.some(name => name.endsWith(item.nameSuffix));
  });
}

function sourceSymbols(evidence) {
  if (evidence?.status !== 'succeeded' || !evidence.structure || !evidence.language || !validSupplement(evidence)) return [];
  const { functions, classes } = evidence.structure;
  const symbols = [];
  for (const fn of functions) {
    if (fn.owner !== undefined) symbols.push({ kind: 'callable', owner: fn.owner, name: fn.name, lineRange: fn.lineRange });
  }
  // Supplementary identities come from AST scope, never guessed by line-range
  // containment (which cannot distinguish same-line free functions/methods).
  for (const fn of evidence.symbolEvidence.functions) {
    if (fn.scope.kind !== 'local') symbols.push({ kind: 'callable', owner: scopeOwner(fn.scope), name: fn.name, lineRange: fn.lineRange });
  }
  for (const fn of functions.filter(fn => fn.owner === undefined)) {
    if (!evidence.symbolEvidence.functions.some(candidate => candidate.name === fn.name
      && JSON.stringify(candidate.lineRange) === JSON.stringify(fn.lineRange))) {
      symbols.push({ kind: 'callable', owner: null, name: fn.name, lineRange: fn.lineRange });
    }
  }
  for (const cls of classes) {
    const declaration = evidence.symbolEvidence.classes.find(item => item.name === cls.name
      && JSON.stringify(item.lineRange) === JSON.stringify(cls.lineRange));
    if (declaration?.scope.kind === 'local') continue;
    const classVerified = declaration?.scope.kind === 'file';
    symbols.push({ kind: 'class', owner: classVerified ? '' : null, name: cls.name, lineRange: cls.lineRange });
    const used = new Map();
    for (const name of cls.methods) {
      const count = used.get(name) ?? 0;
      used.set(name, count + 1);
      const detailed = symbols.filter(symbol => symbol.kind === 'callable'
        && symbol.owner === cls.name && symbol.name === name);
      // Prefer method-definition ranges (Go receivers, Rust impls, C++ out-of-
      // class definitions). Retain additional overloads and ambiguous classes.
      if (classes.filter(other => other.name === cls.name).length === 1 && count < detailed.length) continue;
      const unknownOwner = symbols.some(symbol => symbol.kind === 'callable'
        && symbol.name === name && symbol.owner === null);
      symbols.push({ kind: 'callable', owner: unknownOwner || !classVerified ? null : cls.name, name, lineRange: cls.lineRange });
    }
  }
  return symbols;
}

function ambiguousOwner(symbol, source) {
  return symbol.owner && source.filter(item => item.kind === 'class' && item.name === symbol.owner).length > 1;
}

function nodeNames(node) {
  const path = normalizePath(node.filePath);
  const names = new Set([qualifiedName(node.name)]);
  // Accept ID spelling changes, including func/function and class separators.
  // Path and kind are independently checked; the ID is only a name hint.
  const marker = `:${path}:`;
  if (typeof node.id === 'string' && node.id.includes(marker)) {
    names.add(qualifiedName(node.id.slice(node.id.indexOf(marker) + marker.length)));
  }
  return names;
}

function classOwners(node, graph) {
  const parents = new Set(graph.edges.filter(edge => edge.type === 'contains' && edge.target === node.id)
    .map(edge => edge.source));
  return graph.nodes.filter(parent => parent.type === 'class' && parents.has(parent.id));
}

function hasPreservedIdentity(node, previous, current, sameRevision = false) {
  const candidate = current.nodes.find(candidate => candidate.id === node.id
    && symbolKind(candidate) === symbolKind(node) && candidate.name === node.name);
  if (!candidate) return false;
  const owners = (item, graph) => classOwners(item, graph)
    .map(owner => JSON.stringify([owner.id, owner.name])).sort();
  const oldOwners = owners(node, previous);
  if (JSON.stringify(oldOwners) !== JSON.stringify(owners(candidate, current))) return false;
  // An unowned callable cannot prove its scope: missing class nodes may itself
  // be analyzer under-reporting. Across revisions always verify it in source.
  // Within one HEAD, identical descriptors preserve existing current refs;
  // changed source locations still require matching against that HEAD.
  if (symbolKind(node) === 'callable' && oldOwners.length === 0
    && (!sameRevision || JSON.stringify(node.lineRange) !== JSON.stringify(candidate.lineRange))) return false;
  return true;
}

function resolveSymbol(node, graph, symbols) {
  const kind = symbolKind(node);
  const names = nodeNames(node);
  let candidates = symbols.filter(symbol => symbol.kind === kind && (
    names.has(qualifiedName(symbol.name))
    || (symbol.owner && names.has(qualifiedName(`${symbol.owner}.${symbol.name}`)))
  ));
  const qualified = candidates.filter(symbol => symbol.owner
    && names.has(qualifiedName(`${symbol.owner}.${symbol.name}`)));
  if (qualified.length) candidates = qualified;
  const owners = classOwners(node, graph).map(parent => qualifiedName(parent.name));
  if (owners.length) candidates = candidates.filter(symbol => symbol.owner !== null && owners.includes(qualifiedName(symbol.owner)));
  // Lines locate ownership within one revision only; they are never identity
  // across revisions. Do not use lines to guess among overloads/same-name classes.
  if (candidates.length > 1 && Array.isArray(node.lineRange)) {
    const located = candidates.filter(symbol => node.lineRange[0] >= symbol.lineRange[0]
      && node.lineRange[1] <= symbol.lineRange[1]);
    if (located.length === 1) candidates = located;
  }
  return candidates.length === 1 && candidates[0].owner !== null ? candidates[0] : null;
}

export function compareFileSymbols(previous, current, baseEvidence, headEvidence, sameRevision = false) {
  const oldSymbols = previous.nodes.filter(symbolKind);
  const newSymbols = current.nodes.filter(symbolKind);
  const baseSource = sourceSymbols(baseEvidence);
  const headSource = sourceSymbols(headEvidence);
  const oldMappings = oldSymbols.map(node => resolveSymbol(node, previous, baseSource));
  const newMappings = newSymbols.map(node => resolveSymbol(node, current, headSource));
  const missing = [];
  const replacements = [];
  const evidenceValid = validSupplement(baseEvidence) && validSupplement(headEvidence);
  for (let index = 0; index < oldSymbols.length; index++) {
    const node = oldSymbols[index];
    if (hasPreservedIdentity(node, previous, current, sameRevision)) continue;
    const entry = { id: node.id, name: node.name, type: node.type, status: 'unknown', reason: '' };
    const old = oldMappings[index];
    if (baseEvidence?.status === 'succeeded' && headEvidence?.status === 'succeeded' && !evidenceValid) {
      entry.reason = 'Strict parser lacks valid scoped symbol evidence; rebuild the core package';
    } else if (!old || baseEvidence?.status !== 'succeeded' || headEvidence?.status !== 'succeeded') {
      entry.reason = 'Old symbol cannot be mapped uniquely, or source parsing is unavailable/failed';
    } else if (baseEvidence.language === 'cpp' && old.name.includes('::')) {
      entry.reason = 'Compound C++ qualification does not establish a verified receiver identity';
    } else if ([old.name, old.owner].some(name => name.includes('\\') || name.includes('`') || name.startsWith('@')
      || name.startsWith('r#') || name.normalize('NFKC') !== name)) {
      entry.reason = 'Old source spelling does not establish a stable name or owner';
    } else if (oldMappings.filter(symbol => symbol && symbolKey(symbol) === symbolKey(old)).length !== 1
      || baseSource.filter(symbol => symbolKey(symbol) === symbolKey(old)).length !== 1) {
      entry.reason = 'Old source identity or graph binding is ambiguous';
    } else {
      const matches = headSource.filter(symbol => symbolKey(symbol) === symbolKey(old));
      const graphMatches = newMappings.filter(symbol => symbol && symbolKey(symbol) === symbolKey(old));
      if (ambiguousOwner(old, baseSource) || matches.some(symbol => ambiguousOwner(symbol, headSource))) {
        entry.reason = 'Source contains ambiguous same-name declaring classes';
        missing.push(entry);
        continue;
      }
      if (matches.length === 1 && graphMatches.length === 1) {
        const matchedIndex = newMappings.findIndex(symbol => symbol && symbolKey(symbol) === symbolKey(old));
        if (newSymbols[matchedIndex].id !== node.id) {
          replacements.push({ oldId: node.id, newId: newSymbols[matchedIndex].id });
        }
        continue;
      }
      if (matches.length === 1) {
        entry.status = 'still-present';
        entry.reason = 'Symbol still exists in current source but is missing or ambiguous in the new graph';
      } else if (matches.length > 1) {
        entry.reason = 'Current source has ambiguous same-name symbols';
      } else if (headSource.length === 0) {
        entry.reason = 'Empty structural extraction is not proof of deletion';
      } else if (headSource.some(symbol => symbol.kind === old.kind && symbol.name === old.name && symbol.owner !== null
        && qualifiedName(symbol.owner).replace(/\s+/g, '') === qualifiedName(old.owner).replace(/\s+/g, ''))) {
        entry.reason = 'Receiver formatting may describe the old identity; type equivalence is not verified';
      } else if (!evidenceValid) {
        entry.reason = 'Strict parser lacks valid scoped symbol evidence; rebuild the core package';
      } else {
        const uncertain = [
          ...compatibleEvidence(baseEvidence.symbolEvidence.coverage.gaps, old).filter(item => item.reason === 'Unresolved declaration name'),
          ...compatibleEvidence(headEvidence.symbolEvidence.coverage.gaps, old),
          ...compatibleEvidence(headEvidence.symbolEvidence.effects, old),
        ];
        const reusedIndex = newSymbols.findIndex(candidate => candidate.id === node.id);
        if (uncertain.length) {
          entry.reason = 'Compatible source evidence prevents confirming deletion';
          entry.evidence = uncertain;
        } else if (reusedIndex >= 0 && (!newMappings[reusedIndex]
          || symbolKey(newMappings[reusedIndex]) !== symbolKey(old))) {
          entry.reason = 'The old graph ID is reused by a different or unresolved source identity';
        } else {
          entry.status = 'deleted';
          entry.reason = 'Old identity is absent under the declaration coverage profile, with no compatible gaps or effects';
        }
      }
    }
    missing.push(entry);
  }
  return {
    filePath: previous.filePath,
    beforeCount: previous.nodes.length,
    afterCount: current.nodes.length,
    beforeSymbolCount: oldSymbols.length,
    afterSymbolCount: newSymbols.length,
    missing,
    replacements,
  };
}

export function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr || result.error || result.status}`);
  return result.stdout;
}

export function loadSymbolContext(projectRoot, intermediateDir) {
  const plan = readJson(join(intermediateDir, 'incremental-plan.json'));
  const baseline = readJson(join(intermediateDir, 'incremental-symbol-baseline.json'));
  if (baseline.version !== 1 || baseline.baseCommit !== plan.baseCommit || baseline.headCommit !== plan.headCommit
    || !Array.isArray(baseline.files)) throw new Error('Symbol baseline does not match the incremental plan');
  const paths = baseline.files.map(file => file.filePath).sort();
  if (JSON.stringify(paths) !== JSON.stringify([...plan.filesToReanalyze].sort())
    || paths.some(path => !normalizePath(path) || (plan.deletedFiles ?? []).includes(path))
    || new Set(paths).size !== paths.length) {
    throw new Error('Symbol baseline file inventory does not match the incremental plan');
  }
  if (git(projectRoot, ['rev-parse', 'HEAD']).trim() !== plan.headCommit) {
    throw new Error('HEAD changed since prepare; baseline not advanced');
  }
  // Check every analyzer input, even if all IDs survive and parsing is skipped.
  // Git compares normalized contents, including repository clean/EOL rules.
  if (paths.length) git(projectRoot, [
    'diff', '--quiet', '--no-ext-diff', plan.headCommit, '--', ...paths.map(path => `:(literal)${path}`),
  ]);
  return { plan, baseline };
}

export async function validateIncrementalSymbols(projectRoot, { graph, intermediateDir } = {}) {
  const core = await getCore();
  intermediateDir ??= join(core.resolveUaDir(projectRoot), 'intermediate');
  const reportPath = join(intermediateDir, 'incremental-symbol-report.json');
  const report = { version: 1, ok: false, files: [], unresolvedFiles: [], errors: [] };
  const graphFromDisk = graph === undefined;
  try {
    const { plan, baseline } = loadSymbolContext(projectRoot, intermediateDir);
    report.baseCommit = plan.baseCommit;
    report.headCommit = plan.headCommit;
    graph ??= readJson(join(intermediateDir, 'assembled-graph.json'));
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid assembled graph');
    report.graphHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    let parser;
    const evidenceByPath = new Map();
    const parseHead = async path => {
      if (evidenceByPath.get(path)?.head) return evidenceByPath.get(path).head;
      if (!parser) {
        parser = new core.TreeSitterPlugin(core.builtinLanguageConfigs.filter(config => config.treeSitter));
        await parser.init();
      }
      // :./ keeps git-show relative to projectRoot, including monorepo subdirectories.
      const headContent = git(projectRoot, ['show', `${plan.headCommit}:./${path}`]);
      const evidence = { head: parser.analyzeFileStrict(path, headContent) };
      evidenceByPath.set(path, evidence);
      return evidence.head;
    };
    const parseRevisions = async path => {
      await parseHead(path);
      const evidence = evidenceByPath.get(path);
      if (!evidence.base) {
        const oldContent = git(projectRoot, ['show', `${plan.baseCommit}:./${path}`]);
        evidence.base = parser.analyzeFileStrict(path, oldContent);
      }
      return evidence;
    };
    const fileGraph = filePath => {
      const nodes = graph.nodes.filter(node => normalizePath(node.filePath) === filePath);
      const ids = new Set(nodes.map(node => node.id));
      return { nodes, edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)) };
    };
    for (const previous of baseline.files) {
      const current = fileGraph(previous.filePath);
      let baseEvidence;
      let headEvidence;
      if (previous.nodes.some(node => symbolKind(node) && !hasPreservedIdentity(node, previous, current))) {
        try {
          const evidence = await parseRevisions(previous.filePath);
          baseEvidence = evidence.base;
          headEvidence = evidence.head;
        } catch (error) {
          baseEvidence = { status: 'failed' };
          headEvidence = { status: 'failed' };
          report.errors.push(`${previous.filePath}: ${error.message}`);
        }
      }
      const result = compareFileSymbols(previous, current, baseEvidence, headEvidence);
      report.files.push(result);
      if (result.missing.some(node => node.status !== 'deleted')) report.unresolvedFiles.push(previous.filePath);
    }
    report.ok = report.errors.length === 0 && report.unresolvedFiles.length === 0;
    if (report.ok) {
      const retryPath = join(intermediateDir, 'incremental-symbol-retry.json');
      const retry = existsSync(retryPath) ? readJson(retryPath) : null;
      const candidatePath = join(intermediateDir, 'incremental-edge-candidates.json');
      const currentCandidates = existsSync(candidatePath) ? readJson(candidatePath) : null;
      if (currentCandidates && (currentCandidates.baseCommit !== plan.baseCommit
        || currentCandidates.headCommit !== plan.headCommit || !Array.isArray(currentCandidates.edges))) {
        throw new Error('Current edge candidates do not match the incremental plan');
      }
      const hasRetry = retry?.baseCommit === plan.baseCommit && retry.headCommit === plan.headCommit
        && Array.isArray(retry.inboundEdgeCandidates);
      if (hasRetry && !Array.isArray(retry.currentFiles)) throw new Error('Retry endpoint descriptors are missing');
      const candidates = [
        ...(currentCandidates?.edges ?? []).map(edge => ({ edge, saved: false })),
        ...(hasRetry ? retry.inboundEdgeCandidates : []).map(edge => ({ edge, saved: true })),
      ];
      if (candidates.length || hasRetry) {
        const ids = new Set(graph.nodes.map(node => node.id));
        const replacements = new Map(report.files.flatMap(file => file.replacements)
          .map(({ oldId, newId }) => [oldId, newId]));
        const deleted = new Set(report.files.flatMap(file => file.missing.map(node => node.id)));
        const baselineBindings = new Map(baseline.files.flatMap(file => file.nodes.filter(symbolKind))
          .map(node => [node.id, deleted.has(node.id) ? null : replacements.get(node.id) ?? node.id]));
        const currentBindings = new Map();
        // These descriptors belong to the initial CURRENT analysis, not the
        // old published graph. Both sides therefore map against HEAD source.
        for (const previous of hasRetry ? retry.currentFiles : []) {
          const current = fileGraph(previous.filePath);
          const needsEvidence = previous.nodes.some(node => symbolKind(node) && !hasPreservedIdentity(node, previous, current, true));
          const evidence = needsEvidence && previous.filePath ? await parseHead(previous.filePath) : undefined;
          const result = compareFileSymbols(previous, current, evidence, evidence, true);
          const missing = new Set(result.missing.map(node => node.id));
          const aliases = new Map(result.replacements.map(({ oldId, newId }) => [oldId, newId]));
          for (const node of previous.nodes) {
            const match = symbolKind(node)
              ? missing.has(node.id) ? null : aliases.get(node.id) ?? node.id
              : current.nodes.some(candidate => candidate.id === node.id && candidate.type === node.type && candidate.name === node.name)
                ? node.id : null;
            // Even a failed match overrides the old baseline meaning of this
            // ID. The current analysis may have reused it for another symbol.
            currentBindings.set(node.id, match);
          }
        }
        const endpoint = (id, saved) => {
          if (saved && currentBindings.has(id)) return currentBindings.get(id);
          if (!saved && ids.has(id)) return id;
          if (baselineBindings.has(id)) return baselineBindings.get(id);
          return ids.has(id) ? id : null;
        };
        const edgeKey = edge => JSON.stringify([edge.source, edge.target, edge.type, edge.direction]);
        const existing = new Map(graph.edges.map((edge, index) => [edgeKey(edge), index]));
        report.reconciledCurrentEdges = 0;
        report.droppedCurrentEdges = [];
        report.idReplacements = [...replacements].map(([oldId, newId]) => ({ oldId, newId }));
        report.currentIdBindings = [...currentBindings].map(([oldId, newId]) => ({ oldId, newId }));
        for (const { edge: candidate, saved } of candidates) {
          const edge = {
            ...candidate,
            source: endpoint(candidate.source, saved),
            target: endpoint(candidate.target, saved),
          };
          if (!ids.has(edge.source) || !ids.has(edge.target)) {
            report.droppedCurrentEdges.push({ source: candidate.source, target: candidate.target, type: candidate.type });
          } else {
            const index = existing.get(edgeKey(edge));
            if (index === undefined) {
              existing.set(edgeKey(edge), graph.edges.length);
              graph.edges.push(edge);
              report.reconciledCurrentEdges++;
            } else if (Number(edge.weight) > Number(graph.edges[index].weight)) {
              graph.edges[index] = edge;
              report.reconciledCurrentEdges++;
            }
          }
        }
        // Merge's earlier dangling-edge cleanup cannot see semantic ID aliases.
        // Save the reconciled candidate before architecture/tour consumers run.
        if (graphFromDisk && report.reconciledCurrentEdges > 0) {
          atomicWriteJson(join(intermediateDir, 'assembled-graph.json'), graph);
        }
        report.graphHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
      }
    }
  } catch (error) {
    report.ok = false;
    report.errors.push(error.message);
  }
  atomicWriteJson(reportPath, report);
  return report;
}

export function formatSymbolReport(report) {
  const lines = ['Incremental symbol validation:'];
  for (const file of report.files) {
    lines.push(`  ${JSON.stringify(file.filePath)}: nodes ${file.beforeCount} -> ${file.afterCount}; symbols ${file.beforeSymbolCount} -> ${file.afterSymbolCount}`);
    for (const node of file.missing) lines.push(`    ${node.status}: ${JSON.stringify(node.id)} (${JSON.stringify(node.name)}) — ${node.reason}`);
  }
  lines.push(...report.errors.map(error => `  Error: ${error}`));
  if (report.reconciledCurrentEdges) lines.push(`  Reconciled ${report.reconciledCurrentEdges} current edge(s)`);
  for (const edge of report.droppedCurrentEdges ?? []) {
    lines.push(`  Dropped current edge with unresolved endpoint: ${JSON.stringify(edge)}`);
  }
  lines.push(report.ok ? 'Symbol validation passed' : 'Symbol validation blocked publication; baseline not advanced');
  return lines.join('\n');
}

const isCli = process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isCli) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node validate-incremental-symbols.mjs <projectRoot>\n');
    process.exitCode = 1;
  } else {
    try {
      const report = await validateIncrementalSymbols(realpathSync(process.argv[2]));
      process.stderr.write(`${formatSymbolReport(report)}\n`);
      process.exitCode = report.ok ? 0 : 1;
    } catch (error) {
      process.stderr.write(`Symbol validation failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

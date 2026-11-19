#!/usr/bin/env node
/** Configure or refresh a project's opt-in grammar claims alongside its saved graph. */
import { isUtf8 } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentosDependencyParser, relativeModuleSpecifier } from './grammar/agentos-js-bindings.mjs';

const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(pluginRoot, 'package.json'));
const reportName = 'semantic-claims.json';
const profileUrl = new URL('./grammar/agentos.json', import.meta.url);
const bindingsHelper = fileURLToPath(new URL('./grammar/agentos-python-bindings.py', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const jsonObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fileTypes = new Set(['file', 'config', 'schema']);
const isWholeFile = node => node && fileTypes.has(node.type) && projectFile(node.filePath) &&
  node.id === `${node.type}:${node.filePath}`;

async function loadCore() {
  let entry;
  try {
    entry = require.resolve('@understand-anything/core');
  } catch {
    entry = join(pluginRoot, 'packages/core/dist/index.js');
  }
  return import(pathToFileURL(entry).href);
}

function projectFile(path) {
  return typeof path === 'string' && !/[\\:\0]/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..') &&
    !['.ua', '.understand-anything', '.git'].includes(path.split('/')[0]);
}

function snapshotJson(path) {
  const bytes = readFileSync(path);
  return { data: JSON.parse(bytes), hash: sha256(bytes) };
}

function projectDataDir(project, core) {
  const uaDir = core.resolveUaDir(project);
  if (existsSync(uaDir) && realpathSync(uaDir) !== uaDir) {
    throw new Error('The project analysis data directory must be local to the project.');
  }
  return uaDir;
}

function readConfig(uaDir) {
  const configPath = join(uaDir, 'config.json');
  if (!existsSync(configPath)) return {};
  const { data } = snapshotJson(configPath);
  if (!jsonObject(data)) throw new Error('Invalid project config: expected a JSON object.');
  return data;
}

function grammarChoice(profile = 'off') {
  if (profile !== 'agentos' && profile !== 'off') {
    throw new Error('Unknown grammar profile; expected agentos or off.');
  }
  return profile;
}

function atomicWrite(path, data) {
  const bytes = `${JSON.stringify(data, null, 2)}\n`;
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function configure(projectRoot, choice) {
  const profile = grammarChoice(choice);
  const uaDir = projectDataDir(realpathSync(projectRoot), await loadCore());
  const config = readConfig(uaDir);
  mkdirSync(uaDir, { recursive: true });
  if (config.grammarProfile !== profile) atomicWrite(join(uaDir, 'config.json'), { ...config, grammarProfile: profile });
  if (profile === 'off') rmSync(join(uaDir, reportName), { force: true });
  return profile;
}

function readProjectFile(project, path) {
  if (!projectFile(path)) return { reason: 'invalid_file_path' };
  try {
    const requested = join(project, path);
    if (realpathSync(requested) !== requested || !statSync(requested).isFile()) return { reason: 'unsafe_file_path' };
    const bytes = readFileSync(requested);
    if (!isUtf8(bytes)) return { reason: 'unsupported_source_encoding' };
    // For valid UTF-8 these are the exact bytes hashed by the fingerprint baseline.
    return { content: bytes.toString('utf8'), hash: sha256(bytes) };
  } catch {
    return { reason: 'unreadable_file' };
  }
}

function snapshotReader(project, fingerprints) {
  const cache = new Map();
  function read(path) {
    if (!projectFile(path)) return { reason: 'invalid_file_path' };
    const expected = Object.hasOwn(fingerprints, path) ? fingerprints[path] : null;
    if (expected?.filePath !== path || !digestPattern.test(expected.contentHash)) {
      return { reason: 'missing_fingerprint' };
    }
    const snapshot = readProjectFile(project, path);
    if (snapshot.reason) return snapshot;
    return snapshot.hash === expected.contentHash ? snapshot : { reason: 'stale_fingerprint' };
  }
  return path => {
    if (!cache.has(path)) cache.set(path, read(path));
    return cache.get(path);
  };
}

function buildNodeIndex(graph) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  if (byId.size !== graph.nodes.length) throw new Error('The graph has duplicate node IDs.');
  const byPath = new Map();
  for (const node of graph.nodes.filter(isWholeFile)) {
    byPath.set(node.filePath, byPath.has(node.filePath) ? null : node);
  }
  return { byId, byPath };
}

function candidatesFor(graph, byId, predicate, select) {
  const candidates = new Map();
  for (const edge of graph.edges) {
    if (!select(edge, byId.get(edge.source), byId.get(edge.target))) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    const candidate = candidates.get(key) ?? { predicate, subject: edge.source, object: edge.target, graphEdges: [], evidence: [] };
    if (!candidate.graphEdges.some(old => old.type === edge.type && old.direction === edge.direction)) {
      candidate.graphEdges.push({ type: edge.type, direction: edge.direction });
    }
    candidates.set(key, candidate);
  }
  return candidates;
}

function sourceLauncherInvocation(sourcePath, targetPath, binding, readWrapper) {
  if (!binding || !projectFile(binding.specifier)) return { reason: 'no_launcher_only_binding' };
  const directory = posix.dirname(sourcePath);
  const appRoot = posix.dirname(directory);
  const entry = posix.relative(appRoot, sourcePath);
  if (!/^tools\/[A-Za-z0-9._-]+\.mjs$/.test(entry) || posix.join(appRoot, binding.specifier) !== targetPath) {
    return { reason: 'launcher_target_mismatch' };
  }
  const filePath = posix.join(directory, `${posix.basename(sourcePath, '.mjs')}-source.sh`);
  const wrapper = readWrapper(filePath);
  if (wrapper.reason) return { reason: `launcher_wrapper_${wrapper.reason}` };

  // Recognize the complete source-wrapper command sequence. Executing or
  // interpreting arbitrary shell in a project is outside the grammar refresh.
  const [shebang, ...lines] = wrapper.content.split('\n');
  const statements = lines.map((text, index) => ({ text: text.replace(/^[ \t]+|[ \t]+$/g, ''), line: index + 2 }))
    .filter(({ text }) => text && !text.startsWith('#'));
  const [strict, root, invoke] = statements;
  if (shebang !== '#!/bin/sh' || statements.length !== 3 || strict.text !== 'set -eu' ||
      root.text !== 'APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)' ||
      invoke.text !== 'exec node "$APP_ROOT/' + entry + '" --app-root "$APP_ROOT" --launcher-only "$@"') {
    return { reason: 'unverified_launcher_wrapper' };
  }
  return { filePath, sha256: wrapper.hash, line: invoke.line, rootLine: root.line, appRoot, mode: '--launcher-only' };
}

async function dependencyClaims(graph, { byId, byPath }, read, readWrapper, core) {
  const candidates = candidatesFor(graph, byId, 'depends_on', (edge, source) =>
    ['imports', 'depends_on'].includes(edge.type) && source?.filePath?.endsWith('.mjs'));
  if (!candidates.size) return [];
  const parser = agentosDependencyParser(core);
  await parser.init();
  const parsed = new Map();
  const parse = (path, snapshot) => {
    if (!parsed.has(path)) parsed.set(path, parser.analyzeFileStrict(path, snapshot.content));
    return parsed.get(path);
  };
  const bindModule = (path, role) => {
    if (byPath.get(path)?.type !== 'file') return { reason: `${role}_unbound_module` };
    const snapshot = read(path);
    if (snapshot.reason) return { reason: `${role}_${snapshot.reason}` };
    const result = parse(path, snapshot);
    if (result.status !== 'succeeded') return { reason: `${role}_parse_${result.status}` };
    const binding = result.structure.agentosFileBindings[role];
    return binding ? { filePath: path, sha256: snapshot.hash, ...binding } : { reason: `unverified_${role}_binding` };
  };
  for (const claim of candidates.values()) {
    const source = byId.get(claim.subject);
    const target = byId.get(claim.object);
    const evidence = claim.evidence;
    claim.reason = (() => {
      if (!source || !target) return 'unbound_node';
      const jsonTarget = target.filePath?.endsWith('.json') && fileTypes.has(target.type);
      if (source.type !== 'file' || target.type !== 'file' && !jsonTarget) return 'wrong_endpoint_sort';
      if (byPath.get(source.filePath) !== source || byPath.get(target.filePath) !== target) return 'ambiguous_file_binding';
      if (!claim.graphEdges.some(edge => edge.direction === 'forward')) return 'unsupported_edge_direction';
      const jsTarget = target.filePath.endsWith('.mjs');
      const shellTarget = target.filePath.endsWith('.sh');
      const kind = jsonTarget ? 'static_json_read' : target.filePath.endsWith('.py') ? 'python_helper_invocation' : null;
      if (!jsTarget && !shellTarget && !kind) return 'no_static_file_binding';
      const from = read(source.filePath);
      const to = read(target.filePath);
      if (from.reason || to.reason) return from.reason ? `source_${from.reason}` : `target_${to.reason}`;
      const result = parse(source.filePath, from);
      if (result.status !== 'succeeded') return `source_parse_${result.status}`;
      const directory = posix.dirname(source.filePath);
      if (jsTarget) {
        for (const entry of result.structure.imports) {
          if (relativeModuleSpecifier.test(entry.source) && posix.join(directory, entry.source) === target.filePath) {
            evidence.push({ kind: 'static_import', status: 'observed', filePath: source.filePath,
              line: entry.lineNumber, specifier: entry.source, sha256: from.hash,
              resolvedPath: target.filePath, resolvedSha256: to.hash });
          }
        }
        return evidence.length ? undefined : 'no_supported_import';
      }
      if (shellTarget) {
        const binding = result.structure.agentosFileBindings.launcher;
        const invocation = sourceLauncherInvocation(source.filePath, target.filePath, binding, readWrapper);
        if (invocation.reason) return invocation.reason;
        evidence.push({ kind: 'source_launcher_invocation', status: 'observed', filePath: source.filePath,
          ...binding, sha256: from.hash, resolvedPath: target.filePath, resolvedSha256: to.hash, invocation });
        return;
      }
      let reason = 'no_static_file_binding';
      for (const use of result.structure.agentosFileBindings.uses) {
        if (use.kind !== kind || !projectFile(use.specifier)) continue;
        const rootPath = posix.join(directory, use.rootModule);
        if (posix.join(posix.dirname(rootPath), '..', use.specifier) !== target.filePath) continue;
        const rootBinding = bindModule(rootPath, 'root');
        if (rootBinding.reason) {
          reason = rootBinding.reason;
          continue;
        }
        const runnerBinding = use.runnerModule ? bindModule(posix.join(directory, use.runnerModule), 'runner') : null;
        if (runnerBinding?.reason) {
          reason = runnerBinding.reason;
          continue;
        }
        evidence.push({ kind, status: 'observed', filePath: source.filePath, line: use.line,
          specifier: use.specifier, sha256: from.hash, resolvedPath: target.filePath, resolvedSha256: to.hash, rootBinding,
          ...(runnerBinding ? { runnerBinding } : {}) });
      }
      return evidence.length ? undefined : reason;
    })();
  }
  return [...candidates.values()];
}

function resolveSchemaKey(project, directory, key) {
  if (directory !== '.' && !projectFile(directory)) return { reason: 'invalid_catalog_path' };
  try {
    const absolute = join(project, directory);
    if (realpathSync(absolute) !== absolute) return { reason: 'unsafe_catalog_path' };
    const files = readdirSync(absolute).filter(name => name.endsWith('.schema.json') && name.split('.')[0] === key);
    if (files.length !== 1) return { reason: files.length ? 'ambiguous_schema_key' : 'unbound_schema_key' };
    return { schemaPath: posix.join(directory, files[0]) };
  } catch {
    return { reason: 'unreadable_catalog' };
  }
}

function parseData(content) {
  try { return JSON.parse(content); } catch { return null; }
}

function jsonSchema(value) {
  return jsonObject(value) && typeof value.$schema === 'string' &&
    /^https:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/.test(value.$schema);
}

function extractPythonBindings(sources, mode) {
  const args = ['-I', '-S', bindingsHelper];
  if (mode !== 'schema') args.push(`--${mode}`);
  const extraction = spawnSync('python3', args, {
    input: JSON.stringify(sources), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000,
  });
  if (extraction.error || extraction.status !== 0) {
    throw new Error(`Python ${mode} binding extraction failed: ${extraction.error?.message ?? extraction.stderr.trim()}`);
  }
  return JSON.parse(extraction.stdout);
}

function schemaClaims(project, graph, { byId, byPath }, read) {
  const candidates = candidatesFor(graph, byId, 'constrains', (edge, schema, record) =>
    edge.type === 'defines_schema' && isWholeFile(schema) && isWholeFile(record) &&
    schema.filePath.endsWith('.json') && record.filePath.endsWith('.json'));
  for (const claim of candidates.values()) claim.reason = 'no_explicit_schema_binding';

  const sources = [];
  const gaps = [];
  for (const [path, node] of [...byPath].sort()) {
    if (node?.type !== 'file' || !path.endsWith('.py')) continue;
    const source = read(path);
    if (source.reason) gaps.push({ filePath: path, reason: source.reason });
    else if (source.content.includes('jsonschema')) sources.push({ path, source: source.content });
  }
  if (!sources.length) return { claims: [...candidates.values()], gaps };
  const { bindings, parseFailures } = extractPythonBindings(sources, 'schema');
  for (const path of parseFailures) gaps.push({ filePath: path, reason: 'python_parse_failed' });
  for (const binding of bindings) {
    const location = { filePath: binding.filePath, line: binding.line };
    const selection = binding.schemaPath ? { schemaPath: binding.schemaPath }
      : resolveSchemaKey(project, binding.catalogPath, binding.schemaKey);
    if (selection.reason) {
      gaps.push({ ...location, ...binding, reason: selection.reason });
      continue;
    }
    const schemaPath = selection.schemaPath;
    const recordPath = binding.recordPath;
    const schema = byPath.get(schemaPath);
    const record = byPath.get(recordPath);
    const key = schema && record ? JSON.stringify([schema.id, record.id]) : null;
    const reject = reason => {
      if (candidates.has(key)) candidates.get(key).reason = reason;
      gaps.push({ ...location, schemaPath, recordPath, reason });
    };
    if (!schema || !record) {
      reject('schema_or_record_missing_or_ambiguous_in_graph');
      continue;
    }
    if (schemaPath === recordPath || !schemaPath.endsWith('.json') || !recordPath.endsWith('.json') || record.type === 'schema') {
      reject('wrong_endpoint_sort');
      continue;
    }
    const schemaSnapshot = read(schemaPath);
    const recordSnapshot = read(recordPath);
    if (schemaSnapshot.reason || recordSnapshot.reason) {
      reject(schemaSnapshot.reason ? `schema_${schemaSnapshot.reason}` : `record_${recordSnapshot.reason}`);
      continue;
    }
    const recordValue = parseData(recordSnapshot.content);
    if (!jsonSchema(parseData(schemaSnapshot.content)) || !jsonObject(recordValue) || jsonSchema(recordValue)) {
      reject('expected_json_schema_and_json_record');
      continue;
    }
    const claim = candidates.get(key) ?? { predicate: 'constrains', subject: schema.id, object: record.id, graphEdges: [], evidence: [] };
    claim.evidence.push({ ...binding, schemaPath, status: 'observed', sha256: read(binding.filePath).hash,
      schemaSha256: schemaSnapshot.hash, recordSha256: recordSnapshot.hash });
    candidates.set(key, claim);
  }
  return { claims: [...candidates.values()], gaps };
}

function classNodeId(byId, filePath, name) {
  const id = `class:${filePath}:${name}`;
  const node = byId.get(id);
  return node?.type === 'class' && node.filePath === filePath && node.name === name ? id : null;
}

function auditObservationClaims({ byId, byPath }, read, gaps) {
  const sources = [];
  for (const [path, node] of [...byPath].sort()) {
    if (node?.type !== 'file' || !path.endsWith('.py')) continue;
    const recordPath = posix.join(posix.dirname(path), 'base.py');
    if (recordPath === path || byPath.get(recordPath)?.type !== 'file') continue;
    if (!['RoutingEventRecord', 'StorageActionRecord'].some(name => byId.has(`class:${recordPath}:${name}`))) continue;
    const source = read(path);
    const record = read(recordPath);
    if (source.reason || record.reason ||
        !/\bdef\s+(?:log_routing_event|log_storage_action|get_routing_events)\s*\(/.test(source.content)) continue;
    sources.push({ path, source: source.content, recordSource: record.content });
  }
  if (!sources.length) return [];
  const { bindings, parseFailures } = extractPythonBindings(sources, 'audit');
  for (const path of parseFailures) gaps.push({ filePath: path, reason: 'audit_python_parse_failed' });

  const claims = new Map();
  for (const { observerClass, recordClass, recordLine, reason, ...evidence } of bindings) {
    const { filePath, methodLine } = evidence;
    const recordPath = posix.join(posix.dirname(filePath), 'base.py');
    const subject = classNodeId(byId, filePath, observerClass);
    const object = classNodeId(byId, recordPath, recordClass);
    if (!subject || !object) {
      gaps.push({ filePath, line: methodLine, recordPath, reason: 'audit_class_missing_in_graph' });
      continue;
    }
    const key = JSON.stringify([subject, object]);
    const claim = claims.get(key) ?? { predicate: 'observes', subject, object, graphEdges: [], evidence: [] };
    if (reason) claim.reason = reason;
    else claim.evidence.push({ ...evidence, status: 'observed', sha256: read(filePath).hash,
      recordBinding: { filePath: recordPath, line: recordLine, sha256: read(recordPath).hash } });
    claims.set(key, claim);
  }
  return [...claims.values()];
}

function flattenedAuditLayout(enginePath, read) {
  const filePath = posix.join(posix.dirname(enginePath), 'README.md');
  const layout = read(filePath);
  if (layout.reason) return null;
  const trees = [...layout.content.matchAll(/^├── engine\/(?:\r?\n│[^\r\n]*)+/gm)];
  if (trees.length !== 1) return null;
  const [tree] = trees;
  const lines = tree[0].split(/\r?\n/).map(line => line.split('#', 1)[0].trimEnd());
  const engine = lines.indexOf(`│   ├── ${posix.basename(enginePath)}`);
  const adapters = lines.indexOf('│   └── adapters/');
  const base = lines.findIndex(line => line === '│       ├── base.py' || line === '│       └── base.py');
  if (engine < 1 || adapters <= engine || base <= adapters) return null;
  const firstLine = layout.content.slice(0, tree.index).split('\n').length;
  return { filePath, sha256: layout.hash, line: firstLine + engine, recordLine: firstLine + base };
}

function auditProductionClaims(project, { byId, byPath }, read, gaps, reachabilityAnnotations) {
  const recordTypes = new Map([['storage_engine.py', 'StorageActionRecord'], ['routing_engine.py', 'RoutingEventRecord']]);
  const sources = [];
  const recordBindings = new Map();
  for (const [path, node] of [...byPath].sort()) {
    const recordClass = recordTypes.get(posix.basename(path));
    if (node?.type !== 'file' || !recordClass) continue;
    const directory = posix.dirname(path);
    const adapterDirectory = posix.join(directory, 'adapters');
    const modulePath = posix.join(adapterDirectory, 'base.py');
    const flattened = !byPath.has(modulePath) && !existsSync(join(project, adapterDirectory));
    const recordPath = flattened ? posix.join(directory, 'base.py') : modulePath;
    if (byPath.get(recordPath)?.type !== 'file' || !classNodeId(byId, recordPath, recordClass)) continue;
    const source = read(path);
    const record = read(recordPath);
    if (source.reason || record.reason) continue;
    const layoutBinding = flattened ? flattenedAuditLayout(path, read) : null;
    if (flattened && !layoutBinding) {
      gaps.push({ filePath: path, recordPath, reason: 'audit_package_layout_unverified' });
      continue;
    }
    sources.push({ path, source: source.content, recordSource: record.content });
    recordBindings.set(path, { recordPath, layoutBinding });
  }
  if (!sources.length) return [];
  const { bindings, parseFailures } = extractPythonBindings(sources, 'production');
  for (const path of parseFailures) gaps.push({ filePath: path, reason: 'audit_python_parse_failed' });

  const claims = new Map();
  for (const { producerClass, recordClass, recordLine, reason, ...evidence } of bindings) {
    const { filePath, method, methodLine } = evidence;
    const { recordPath, layoutBinding } = recordBindings.get(filePath);
    const subject = classNodeId(byId, filePath, producerClass);
    const object = classNodeId(byId, recordPath, recordClass);
    if (!subject || !object) {
      gaps.push({ filePath, line: methodLine, recordPath, reason: 'audit_class_missing_in_graph' });
      continue;
    }
    const subjectScope = { kind: 'python-method', method };
    const key = JSON.stringify([subject, object, method]);
    const claim = claims.get(key) ?? { predicate: 'produces', subject, subjectScope, object, graphEdges: [], evidence: [] };
    if (reason) {
      claim.reason = reason;
    } else {
      const site = { ...evidence, status: 'observed', sha256: read(filePath).hash,
        recordBinding: { filePath: recordPath, line: recordLine, sha256: read(recordPath).hash },
        ...(layoutBinding ? { layoutBinding } : {}) };
      const annotation = reachabilityAnnotations.find(item => item.method === method && item.line === site.line
        && item.engineSha256 === site.sha256 && item.recordSha256 === site.recordBinding.sha256);
      if (annotation) {
        const directory = posix.dirname(filePath);
        const registryPath = posix.join(directory, 'routing_maps.v1.json');
        if (read(registryPath).hash === annotation.registryBinding.sha256) {
          site.reachability = { ...annotation.reachability,
            registryBinding: { filePath: registryPath, ...annotation.registryBinding } };
          if (annotation.testBinding) {
            const { fileName, ...binding } = annotation.testBinding;
            const testPath = posix.join(directory, fileName);
            if (read(testPath).hash === binding.sha256) {
              site.reachability.testBinding = { filePath: testPath, ...binding };
            }
          }
        }
      }
      claim.evidence.push(site);
    }
    claims.set(key, claim);
  }
  return [...claims.values()];
}

function registryItemClaims(claim, { byId, byPath }, read, readWrapper) {
  if (!claim.graphEdges.some(edge => edge.direction === 'forward')) return [];
  const schemaNode = byId.get(claim.subject);
  const recordNode = byId.get(claim.object);
  const schemaPath = schemaNode.filePath;
  const recordPath = recordNode.filePath;
  const directory = posix.dirname(recordPath);
  if (byPath.get(schemaPath) !== schemaNode || byPath.get(recordPath) !== recordNode ||
      schemaPath === recordPath || posix.dirname(schemaPath) !== directory) return [];

  const recordSnapshot = read(recordPath);
  const record = parseData(recordSnapshot.content);
  if (!jsonObject(record) || jsonSchema(record) || typeof record.schema_id !== 'string') return [];
  const versionedId = /^([a-zA-Z][a-zA-Z0-9_-]*)\.(v[1-9][0-9]*)$/.exec(record.schema_id);
  if (!versionedId) return [];
  const [, name, version] = versionedId;
  const wrapperPath = posix.join(directory, `${name}.schema.${version}.json`);
  if (wrapperPath === schemaPath) return [];

  // The filename locates a candidate. Its required schema_id constant binds it to the record.
  const wrapperSnapshot = readWrapper(wrapperPath);
  const wrapper = parseData(wrapperSnapshot.content);
  if (!jsonSchema(wrapper) || wrapper.type !== 'object' || !jsonObject(wrapper.properties) ||
      !Array.isArray(wrapper.required) || !wrapper.required.includes('schema_id') ||
      wrapper.properties.schema_id?.const !== record.schema_id ||
      typeof wrapper.$id !== 'string' || wrapper.$id.includes('#')) return [];

  const schemaSnapshot = read(schemaPath);
  const schema = parseData(schemaSnapshot.content);
  if (!jsonSchema(schema) || schema.type !== 'object') return [];
  const scoped = [];
  for (const [field, arraySchema] of Object.entries(wrapper.properties)) {
    if (!wrapper.required.includes(field) || !Array.isArray(record[field]) ||
        !jsonObject(arraySchema) || arraySchema.type !== 'array' || Object.hasOwn(arraySchema, 'prefixItems')) continue;
    const items = arraySchema.items;
    if (!jsonObject(items) || [arraySchema, items].some(part => Object.hasOwn(part, '$id') || Object.hasOwn(part, '$schema'))) continue;
    const ref = items.$ref;
    if (ref !== posix.basename(schemaPath) || !URL.canParse(ref, wrapper.$id) ||
        new URL(ref, wrapper.$id).href !== schema.$id) continue;

    const pointer = `/${field.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    scoped.push({ ...claim, objectScope: { kind: 'array_items', pointer }, evidence: [{
      kind: 'json_schema_items_ref', status: 'observed', filePath: wrapperPath, sha256: wrapperSnapshot.hash,
      pointer: `/properties${pointer}/items/$ref`, wrapperSchemaId: wrapper.$id, recordSchemaId: record.schema_id,
      ref, schemaPath, schemaSha256: schemaSnapshot.hash, recordPath, recordSha256: recordSnapshot.hash,
    }] });
  }
  return scoped;
}

const outputId = value => typeof value === 'string' && /^O-[0-9]+\.[0-9]+\.[0-9]+-[0-9]+$/.test(value);
const routeId = value => typeof value === 'string' && /^R-[0-9]+$/.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const routeEvents = new Set(['created', 'updated', 'published', 'qa_passed', 'qa_failed', 'threshold_crossed', 'weekly_rollup']);
const outputActions = new Set(['CREATE_OUTPUT', 'UPDATE_OUTPUT']);

function routingRegistry(filePath, node, schemaId, field, read) {
  if (!node || node.type === 'schema') return { reason: 'unbound_registry' };
  const snapshot = read(filePath);
  if (snapshot.reason) return snapshot;
  const data = parseData(snapshot.content);
  if (!jsonObject(data) || data.schema_id !== schemaId || data.schema_version !== '1.0' ||
      !nonempty(data.registry_version) || !Array.isArray(data[field])) return { reason: 'invalid_registry' };
  return { filePath, graphNode: node.id, sha256: snapshot.hash, data };
}

function registryRows(rows, key, validId) {
  const entries = new Map();
  for (const [index, row] of rows.entries()) {
    if (!jsonObject(row) || !validId(row[key])) continue;
    const id = row[key];
    entries.set(id, entries.has(id) ? null : { index, row });
  }
  return entries;
}

function routingUnit(registry, kind, identifier, label, pointer) {
  const id = `unit:${kind}:${sha256(JSON.stringify([registry.graphNode, identifier]))}`;
  return { id, kind, identifier, label, filePath: registry.filePath, graphNode: registry.graphNode,
    pointer, sha256: registry.sha256 };
}

function outputUnit(registry, entries, id, role) {
  const entry = entries.get(id);
  if (entry === null) return { reason: `ambiguous_${role}_output` };
  if (!entry || !nonempty(entry.row.output_name)) return { reason: `unbound_${role}_output` };
  return routingUnit(registry, 'output', id, entry.row.output_name, `/entries/${entry.index}`);
}

function publishThresholdSources(maps, storage, entries, gaps) {
  const emitters = maps.data.threshold_crossed_on_publish;
  const path = '/threshold_crossed_on_publish';
  if (!jsonObject(emitters)) {
    if (emitters !== undefined) gaps.push({ filePath: maps.filePath, pointer: path, reason: 'invalid_publish_thresholds' });
    return [];
  }
  const sources = [];
  for (const [id, conditions] of Object.entries(emitters)) {
    const pointer = `${path}/${id.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    const source = outputUnit(storage, entries, id, 'source');
    const reason = !outputId(id) || !nonempty(conditions) ? 'invalid_publish_threshold' : source.reason;
    if (reason) {
      gaps.push({ filePath: maps.filePath, pointer, reason });
      continue;
    }
    sources.push({ source, emitterBinding: { pointer, sourceOutputId: id,
      onEvent: 'published', emits: 'threshold_crossed', conditions } });
  }
  return sources;
}

function storageRouteClaims(maps, storage, gaps) {
  const claims = [];
  const entries = registryRows(storage.data.entries, 'output_id', outputId);
  const routeRows = registryRows(maps.data.routes, 'route_id', routeId);
  const emitters = publishThresholdSources(maps, storage, entries, gaps);
  for (const [index, route] of maps.data.routes.entries()) {
    const pointer = `/routes/${index}`;
    const reject = (reason, at = pointer) => gaps.push({ filePath: maps.filePath, pointer: at, reason });
    if (!jsonObject(route) || !routeId(route.route_id) ||
        !(route.source_output_id === 'ANY' || outputId(route.source_output_id)) ||
        !routeEvents.has(route.on_event) || !nonempty(route.conditions) || !Array.isArray(route.targets) ||
        !Array.isArray(route.actions) || route.downstream_outputs !== undefined && !Array.isArray(route.downstream_outputs)) {
      reject('invalid_route_row');
      continue;
    }
    if (routeRows.get(route.route_id) === null) {
      reject('ambiguous_route_id');
      continue;
    }

    const sourceId = route.source_output_id;
    const declaredSource = sourceId === 'ANY' ? { reason: 'wildcard_source' } : outputUnit(storage, entries, sourceId, 'source');
    const sources = [{ source: declaredSource }];
    if (sourceId === 'ANY' && route.on_event === 'threshold_crossed') {
      sources.push(...emitters.filter(({ emitterBinding }) => emitterBinding.conditions === route.conditions));
    }
    const destinations = [
      ...route.targets.map((id, i) => ({ kind: 'target', id, pointer: `${pointer}/targets/${i}` })),
      ...(route.downstream_outputs ?? []).map((output, i) => ({ kind: 'output', id: output?.output_id,
        action: output?.action, pointer: `${pointer}/downstream_outputs/${i}/output_id` })),
    ];
    const seen = new Set();
    for (const { kind, id, action, pointer: destinationPointer } of destinations) {
      if (!nonempty(id) || kind === 'output' && !(outputId(id) && outputActions.has(action))) {
        reject('invalid_route_destination', destinationPointer);
        continue;
      }
      const key = JSON.stringify([kind, id, action]);
      if (seen.has(key)) continue;
      seen.add(key);
      const destination = { kind, id, ...(action ? { action } : {}) };
      const scope = { registry: maps.graphNode, pointer, routeId: route.route_id, sourceOutputId: sourceId,
        destination, onEvent: route.on_event, conditions: route.conditions,
        ...(nonempty(route.qa_gate) ? { qaGate: route.qa_gate } : {}),
        ...(Array.isArray(route.suppressors) ? { suppressors: route.suppressors } : {}) };
      const legend = maps.data.target_legend;
      const target = kind === 'output' ? outputUnit(storage, entries, id, 'destination')
        : Object.hasOwn(legend, id) && nonempty(legend[id])
          ? routingUnit(maps, 'target', id, legend[id], `/target_legend/${id.replaceAll('~', '~0').replaceAll('/', '~1')}`)
          : { reason: 'unbound_target_legend' };
      const actionIndex = kind === 'output'
        ? route.actions.findIndex(entry => entry?.verb === action && entry.params?.output_id === id) : -1;
      for (const { source, emitterBinding } of sources) {
        const routeScope = emitterBinding
          ? { ...scope, declaredSourceOutputId: sourceId, sourceOutputId: source.identifier, sourceEvent: emitterBinding.onEvent }
          : scope;
        const reason = source.reason ?? target.reason ?? (kind === 'output' && actionIndex < 0 ? 'unbound_downstream_action' : undefined);
        const evidence = reason ? [] : [{
          kind: emitterBinding ? 'storage_routing_publish_emitter' : 'storage_routing_declaration', status: 'observed',
          filePath: maps.filePath, sha256: maps.sha256, pointer, sourcePointer: `${pointer}/source_output_id`, destinationPointer,
          ...(actionIndex >= 0 ? { actionPointer: `${pointer}/actions/${actionIndex}` } : {}),
          ...(emitterBinding ? { emitterBinding } : {}), sourceBinding: source, destinationBinding: target,
        }];
        claims.push({ predicate: 'routes_to', subject: source.id ?? null, object: target.id ?? null,
          routeScope, reason, graphEdges: [], evidence });
      }
    }
  }
  return claims;
}

function storageRoutingClaims({ byPath }, read, gaps) {
  const claims = [];
  for (const [path, node] of [...byPath].sort()) {
    if (posix.basename(path) !== 'routing_maps.v1.json') continue;
    const maps = routingRegistry(path, node, 'routing_maps_registry.v1', 'routes', read);
    if (maps.reason || !jsonObject(maps.data.target_legend)) {
      gaps.push({ filePath: path, reason: `routing_maps_${maps.reason ?? 'invalid_target_legend'}` });
      continue;
    }
    const storagePath = posix.join(posix.dirname(path), 'storage_conventions.v1.json');
    const storage = routingRegistry(storagePath, byPath.get(storagePath), 'storage_conventions_registry.v1', 'entries', read);
    if (storage.reason) {
      gaps.push({ filePath: storagePath, reason: `storage_conventions_${storage.reason}` });
      continue;
    }
    claims.push(...storageRouteClaims(maps, storage, gaps));
  }
  return claims;
}

const storageRoutingRegistryInputs = [
  { engineName: 'StorageEngine', engineFile: 'storage_engine.py', parameter: 'conventions_data',
    pathParameter: 'conventions_registry_path',
    registryFile: 'storage_conventions.v1.json', schemaId: 'storage_conventions_registry.v1', collection: 'entries' },
  { engineName: 'RoutingEngine', engineFile: 'routing_engine.py', parameter: 'routing_data',
    pathParameter: 'routing_registry_path',
    registryFile: 'routing_maps.v1.json', schemaId: 'routing_maps_registry.v1', collection: 'routes' },
];

function flattenedRegistryLayout(directory, engineFile, registryFile, read) {
  const filePath = posix.join(directory, 'README.md');
  const layout = read(filePath);
  if (layout.reason) return null;
  const lines = layout.content.split(/\r?\n/).map(line => line.split('#', 1)[0].trimEnd());
  function entryLine(folder, name) {
    const heading = `├── ${folder}/`;
    const start = lines.indexOf(heading);
    if (start < 0 || start !== lines.lastIndexOf(heading)) return null;
    const matches = [];
    for (let index = start + 1; lines[index]?.startsWith('│'); index++) {
      if (lines[index] === `│   ├── ${name}` || lines[index] === `│   └── ${name}`) matches.push(index + 1);
    }
    return matches.length === 1 ? matches[0] : null;
  }
  const testLine = entryLine('tests', 'test_acceptance.py');
  const engineLine = entryLine('engine', engineFile);
  const registryLine = entryLine('registries', registryFile);
  if (!testLine || !engineLine || !registryLine) return null;
  return { filePath, sha256: layout.hash, testLine, engineLine, registryLine };
}

function registryConsumptionClaims(project, { byId, byPath }, read, readSupplement, gaps) {
  const sources = [];
  const contexts = new Map();
  for (const [path, node] of [...byPath].sort()) {
    if (node?.type !== 'file' || posix.basename(path) !== 'test_acceptance.py') continue;
    const testDirectory = posix.dirname(path);
    const packaged = posix.basename(testDirectory) === 'tests';
    const directory = packaged ? posix.dirname(testDirectory) : testDirectory;
    for (const input of storageRoutingRegistryInputs) {
      const { engineName, engineFile, registryFile, schemaId, collection, parameter } = input;
      const packageEnginePath = posix.join('engine', engineFile);
      const packageRegistryPath = posix.join('registries', registryFile);
      const enginePath = posix.join(directory, packaged ? packageEnginePath : engineFile);
      const registryPath = posix.join(directory, packaged ? packageRegistryPath : registryFile);
      const subject = classNodeId(byId, enginePath, engineName);
      if (!subject || byPath.get(enginePath)?.type !== 'file' || !byPath.get(registryPath)) continue;
      const source = read(path);
      const engine = read(enginePath);
      const registry = routingRegistry(registryPath, byPath.get(registryPath), schemaId, collection, read);
      if (source.reason || engine.reason || registry.reason) continue;
      const layoutBinding = packaged ? null : flattenedRegistryLayout(directory, engineFile, registryFile, read);
      if (!packaged && (!layoutBinding || ['tests/test_acceptance.py', packageEnginePath, packageRegistryPath]
        .some(relative => existsSync(join(project, directory, relative))))) {
        gaps.push({ filePath: path, enginePath, registryPath, reason: 'registry_package_layout_unverified' });
        continue;
      }
      const engineImport = `engine.${posix.basename(engineFile, '.py')}.${engineName}`;
      sources.push({ path, source: source.content, enginePath, engineSource: engine.content, engineName, engineImport, parameter, collection });
      contexts.set(JSON.stringify([path, engineName]), { subject, enginePath, registry, expectedPath: packageRegistryPath,
        layoutBinding, sourceHash: source.hash, evidenceKind: 'python_acceptance_registry_load' });
    }
  }
  for (const [enginePath, node] of [...byPath].sort()) {
    const input = storageRoutingRegistryInputs.find(input => input.engineFile === posix.basename(enginePath));
    if (node?.type !== 'file' || !input) continue;
    const { engineName, engineFile, parameter, pathParameter, registryFile, schemaId, collection } = input;
    const subject = classNodeId(byId, enginePath, engineName);
    const directory = posix.dirname(enginePath);
    const registryPath = posix.join(directory, registryFile);
    if (!subject || !byPath.get(registryPath)) continue;
    const path = posix.join(directory, 'run_storage_routing.py');
    const source = readSupplement(path);
    const engine = read(enginePath);
    const registry = routingRegistry(registryPath, byPath.get(registryPath), schemaId, collection, read);
    if (source.reason || engine.reason || registry.reason) continue;
    const moduleName = posix.basename(engineFile, '.py');
    const packagePaths = ['engine/__init__.py', 'engine/adapters/__init__.py'].map(path => posix.join(directory, path));
    const packages = new Map(packagePaths.map(path => [path, readSupplement(path)]));
    const shadowPaths = [posix.join('engine', engineFile), posix.join('engine', moduleName)];
    if ([...packages.values()].some(snapshot => snapshot.reason) ||
        shadowPaths.some(path => existsSync(join(project, directory, path)))) {
      gaps.push({ filePath: path, enginePath, registryPath, reason: 'registry_runtime_package_unverified' });
      continue;
    }
    const packageSources = [...packages].map(([path, snapshot]) => ({ path, source: snapshot.content }));
    const engineImport = `engine.${moduleName}.${engineName}`;
    sources.push({ path, source: source.content, enginePath, engineSource: engine.content, engineName, engineImport,
      parameter, pathParameter, collection, directory, packageSources });
    contexts.set(JSON.stringify([path, engineName]), { subject, enginePath, registry, expectedPath: registryPath,
      packages, sourceHash: source.hash, evidenceKind: 'python_runtime_registry_load' });
  }
  if (!sources.length) return { claims: [], validations: [] };
  const { bindings, parseFailures } = extractPythonBindings(sources, 'consumption');
  for (const path of new Set(parseFailures)) gaps.push({ filePath: path, reason: 'registry_python_parse_failed' });

  const claims = new Map();
  const validations = new Map();
  for (const { engineName, packageRegistryPath, resolvedRegistryPath, packageBindings, registryValidations, loader, reason,
    ...evidence } of bindings) {
    const { filePath } = evidence;
    const context = contexts.get(JSON.stringify([filePath, engineName]));
    if (context.expectedPath !== (packageRegistryPath ?? resolvedRegistryPath)) continue;
    const { subject, enginePath, registry, layoutBinding, packages, sourceHash, evidenceKind } = context;
    const object = registry.graphNode;
    const key = JSON.stringify([subject, object, evidenceKind]);
    const subjectScope = { kind: 'python-method', method: '__init__' };
    const claim = claims.get(key) ?? { predicate: 'consumes', subject, subjectScope, object, evidenceKind, graphEdges: [], evidence: [] };
    if (reason) claim.reason = reason;
    else claim.evidence.push({ ...evidence, packageRegistryPath, resolvedRegistryPath, status: 'observed', sha256: sourceHash,
      engineBinding: { filePath: enginePath, sha256: read(enginePath).hash, ...loader },
      registryBinding: { filePath: registry.filePath, sha256: registry.sha256, schemaId: registry.data.schema_id,
        collectionPointer: `/${loader.collection}` },
      ...(layoutBinding ? { layoutBinding } : {}),
      ...(packageBindings ? { packageBindings: packageBindings.map(binding => ({
        ...binding, sha256: packages.get(binding.filePath).hash,
      })) } : {}) });
    if (!reason) {
      for (const site of registryValidations ?? []) {
        validations.set(JSON.stringify([filePath, site]), { ...site, filePath, sha256: sourceHash });
      }
    }
    claims.set(key, claim);
  }
  return { claims: [...claims.values()], validations: [...validations.values()] };
}

function attachRegistryValidations(claims, validations) {
  for (const { evidence } of claims) {
    const items = evidence.find(site => site.kind === 'json_schema_items_ref');
    if (!items) continue;
    for (const { recordPath, wrapperPath, itemSchemaPath, ...site } of validations) {
      if (recordPath !== items.recordPath || wrapperPath !== items.filePath || itemSchemaPath !== items.schemaPath) continue;
      evidence.push({ kind: 'python_startup_registry_validation', status: 'observed', ...site,
        recordBinding: { filePath: recordPath, sha256: items.recordSha256 },
        wrapperBinding: { filePath: wrapperPath, sha256: items.sha256, pointer: items.pointer },
        itemSchemaBinding: { filePath: itemSchemaPath, sha256: items.schemaSha256 },
      });
    }
  }
}

function finalizeClaims(claims, profile) {
  const rules = new Map(profile.rules.map(rule => [rule.predicate, rule]));
  return claims.map(({ subject, predicate, object, graphEdges, evidence, evidenceKind = evidence[0]?.kind,
    reason, subjectScope, objectScope, routeScope }) => {
    const rule = rules.get(predicate);
    const frame = rule.evidenceFrames?.[evidenceKind] ?? rule.frame;
    const tuple = [subject, predicate, object, frame];
    const fileClaimId = `claim:${sha256(JSON.stringify(tuple))}`;
    let id = fileClaimId;
    if (subjectScope) id = `claim:${sha256(JSON.stringify([...tuple, subjectScope.kind, subjectScope.method]))}`;
    if (objectScope) id = `claim:${sha256(JSON.stringify([...tuple, objectScope.kind, objectScope.pointer]))}`;
    if (routeScope) {
      const { registry, routeId, sourceOutputId, destination, onEvent } = routeScope;
      id = `claim:${sha256(JSON.stringify([...tuple, registry, routeId, sourceOutputId, destination, onEvent]))}`;
    }
    const supported = evidence.length > 0;
    return { id, subject, predicate, object, frame,
      ...(subjectScope ? { subjectScope } : {}),
      ...(objectScope ? { objectScope, refines: fileClaimId } : {}),
      ...(routeScope ? { routeScope } : {}),
      subjectSort: supported ? rule.subjectSort ?? rule.domain : null,
      objectSort: supported ? rule.range : null,
      status: supported ? 'inferred' : 'unknown', admission: supported ? 'supported' : 'withheld',
      ...(supported ? {} : { reason }), graphEdges, evidence };
  }).sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
}

function attachReviewedTests(claims, reviews, read) {
  if (!reviews.length) return [];
  const byId = new Map(claims.map(claim => [claim.id, claim]));
  const anchors = [];
  for (const { testBinding, sources, links } of reviews) {
    const pinned = [testBinding, ...sources];
    if (pinned.some(anchor => read(anchor.filePath).hash !== anchor.sha256)) continue;
    let linked = false;
    for (const { claimId, kind, line, coverageLines, covers } of links) {
      const claim = byId.get(claimId);
      if (claim?.admission !== 'supported') continue;
      const sites = claim.evidence.filter(site => site.kind === kind && (line === undefined || site.line === line));
      if (sites.length !== 1) continue;
      const [site] = sites;
      site.testBindings ??= [];
      site.testBindings.push({ ...testBinding, coverageLines, covers });
      linked = true;
    }
    if (linked) anchors.push(...pinned);
  }
  return anchors;
}

export async function refreshGrammarProfile(projectRoot, { requireEnabled = false, core } = {}) {
  core ??= await loadCore();
  const project = realpathSync(projectRoot);
  const uaDir = projectDataDir(project, core);
  if (grammarChoice(readConfig(uaDir).grammarProfile) === 'off') {
    if (requireEnabled) throw new Error('Enable the AgentOS grammar profile first with --grammar-profile agentos.');
    return null;
  }

  const graphPath = join(uaDir, 'knowledge-graph.json');
  const fingerprintsPath = join(uaDir, 'fingerprints.json');
  if (!existsSync(graphPath) || !existsSync(fingerprintsPath)) {
    throw new Error('A saved graph and fingerprint baseline are required. Run /understand first.');
  }
  const graphInput = snapshotJson(graphPath);
  const baseline = snapshotJson(fingerprintsPath);
  const profileInput = snapshotJson(profileUrl);
  const graph = core.KnowledgeGraphSchema.parse(graphInput.data);
  if (!jsonObject(baseline.data.files) || baseline.data.gitCommitHash !== graph.project.gitCommitHash) {
    throw new Error('The graph and its fingerprint baseline must describe the same revision.');
  }
  const index = buildNodeIndex(graph);
  const read = snapshotReader(project, baseline.data.files);
  // New source companions can supply evidence before they have a graph node.
  // The claim endpoints require fingerprints, and companion bytes are pinned below.
  const readWrapper = path => index.byPath.has(path) || Object.hasOwn(baseline.data.files, path)
    ? read(path) : readProjectFile(project, path);
  const dependencies = await dependencyClaims(graph, index, read, readWrapper, core);
  const { claims: constraints, gaps } = schemaClaims(project, graph, index, read);
  const refined = constraints.flatMap(claim => {
    const items = registryItemClaims(claim, index, read, readWrapper);
    return items.length && !claim.evidence.length ? items : [claim, ...items];
  });
  const routes = storageRoutingClaims(index, read, gaps);
  const observations = auditObservationClaims(index, read, gaps);
  const productionRule = profileInput.data.rules.find(rule => rule.predicate === 'produces');
  const productions = auditProductionClaims(project, index, read, gaps, productionRule?.reachabilityAnnotations ?? []);
  const { claims: consumptions, validations } = registryConsumptionClaims(project, index, read, readWrapper, gaps);
  attachRegistryValidations(refined, validations);
  const claims = finalizeClaims([...dependencies, ...refined, ...routes, ...observations, ...productions, ...consumptions], profileInput.data);
  const testAnchors = attachReviewedTests(claims, profileInput.data.reviewedTests ?? [], readWrapper);
  const counts = Object.fromEntries(profileInput.data.rules.map(({ predicate }) => {
    const rows = claims.filter(claim => claim.predicate === predicate);
    const supported = rows.filter(claim => claim.admission === 'supported').length;
    return [predicate, { candidates: rows.length, supported, withheld: rows.length - supported }];
  }));
  const report = {
    schema: 'ua.agentos-semantic-claims/0.1.0',
    project: graph.project.name,
    profile: profileInput.data,
    provenance: { graphSha256: graphInput.hash, fingerprintsSha256: baseline.hash,
      graphAnalyzedAt: graph.project.analyzedAt, gitCommitHash: graph.project.gitCommitHash,
      profileSha256: profileInput.hash },
    counts, gaps, claims,
  };
  if (sha256(readFileSync(graphPath)) !== graphInput.hash || sha256(readFileSync(fingerprintsPath)) !== baseline.hash ||
      readConfig(uaDir).grammarProfile !== 'agentos') {
    throw new Error('The graph, fingerprints, or profile selection changed during extraction; retry the grammar refresh.');
  }
  const anchors = testAnchors.concat(claims.flatMap(claim => claim.evidence.flatMap(evidence => {
    if (evidence.kind === 'json_schema_items_ref') return [evidence];
    if (evidence.kind === 'python_startup_registry_validation') {
      return [evidence, evidence.recordBinding, evidence.wrapperBinding, evidence.itemSchemaBinding];
    }
    if (evidence.kind === 'source_launcher_invocation') {
      return [evidence, evidence.invocation, { filePath: evidence.resolvedPath, sha256: evidence.resolvedSha256 }];
    }
    if (['storage_routing_declaration', 'storage_routing_publish_emitter'].includes(evidence.kind)) {
      return [evidence, evidence.sourceBinding, evidence.destinationBinding];
    }
    if (['sqlite_audit_write', 'sqlite_audit_read', 'postgres_audit_write', 'postgres_audit_read'].includes(evidence.kind)) {
      return [evidence, evidence.recordBinding];
    }
    if (evidence.kind === 'audit_record_emission') {
      return [evidence, evidence.recordBinding, evidence.layoutBinding,
        evidence.reachability?.registryBinding, evidence.reachability?.testBinding].filter(Boolean);
    }
    if (['python_acceptance_registry_load', 'python_runtime_registry_load'].includes(evidence.kind)) {
      return [evidence, evidence.engineBinding, evidence.registryBinding, evidence.layoutBinding,
        ...(evidence.packageBindings ?? [])].filter(Boolean);
    }
    return [];
  })));
  const checked = new Map();
  const changed = anchors.find(anchor => {
    if (!checked.has(anchor.filePath)) checked.set(anchor.filePath, readProjectFile(project, anchor.filePath).hash);
    return checked.get(anchor.filePath) !== anchor.sha256;
  });
  if (changed) throw new Error(`Source evidence changed during extraction: ${changed.filePath}`);
  const output = join(uaDir, reportName);
  atomicWrite(output, report);
  return { output, counts, gaps: gaps.length };
}

export function formatGrammarResult({ output, counts, gaps }) {
  const summary = Object.entries(counts).map(([predicate, value]) =>
    `${predicate}: ${value.supported} supported, ${value.withheld} withheld`).join('; ');
  return `AgentOS grammar: ${summary}; ${gaps} evidence gaps. Saved ${output}`;
}

async function main(args) {
  const [project, flag, choice] = args;
  if (!project || project.startsWith('--') || args.length > 3 ||
      !(args.length === 1 || args.length === 2 && flag === '--require' || args.length === 3 && flag === '--configure')) {
    throw new Error('Usage: node grammar-profile.mjs <project-root> [--require | --configure agentos|off]');
  }
  if (flag === '--configure') {
    console.log(`Grammar profile: ${await configure(project, choice)}`);
  } else {
    const result = await refreshGrammarProfile(project, { requireEnabled: flag === '--require' });
    if (result) console.log(formatGrammarResult(result));
  }
}

function isCliEntry() {
  try {
    return process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`Grammar profile: ${error.message}`);
    process.exitCode = 1;
  }
}

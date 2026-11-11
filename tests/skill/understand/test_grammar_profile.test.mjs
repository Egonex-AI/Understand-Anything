import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = fileURLToPath(new URL('../../../understand-anything-plugin/skills/understand/', import.meta.url));
const grammar = join(skill, 'grammar-profile.mjs');
const finalizer = join(skill, 'finalize-incremental.mjs');
const scanner = join(skill, 'scan-project.mjs');
const roots = [];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const schema = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' });
const header = `import json
from pathlib import Path
from jsonschema import Draft202012Validator
root = Path(__file__).resolve().parents[1]
`;
const table = `schemas = {p.stem.split('.')[0]: json.loads(p.read_text()) for p in (root/'schemas').glob('*.schema.json')}
validators = {key: Draft202012Validator(s) for key, s in schemas.items()}
for key, record_path in [('alpha', root/'records/a.json'), ('beta', root/'records/b.json')]:
    validators[key].validate(json.loads(record_path.read_text()))
`;
const direct = `record = json.loads((root/'records/c.json').read_text())
schema = json.loads((root/'schemas/gamma.schema.json').read_text())
Draft202012Validator(schema).validate(record)
`;
const cliText = header + `import argparse

def check(model, registry, schema_root=root):
    schema_root = Path(schema_root).resolve()
    schema = json.loads((schema_root/'schemas/gamma.schema.json').read_text())
    Draft202012Validator.check_schema(schema)
    return list(Draft202012Validator(schema).iter_errors(model))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, default=root/'records/c.json')
    parser.add_argument('--registry', type=Path, default=root/'records/a.json')
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text())
    model = json.loads(args.model.read_text())
    return check(model, registry)

if __name__ == '__main__':
    raise SystemExit(main())
`;
const cliBytes = `import argparse
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]

def check(model, schema_root, enabled=True):
    schema_root = Path(schema_root).resolve()
    if enabled:
        try:
            from jsonschema import Draft202012Validator
            schema_path = schema_root/'schemas/gamma.schema.json'
            schema = json.loads(schema_path.read_text())
            for error in Draft202012Validator(schema).iter_errors(model):
                return error
        except ImportError:
            return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('model', nargs='?', type=Path, default=root/'records/c.json')
    parser.add_argument('--root', type=Path, default=root)
    args = parser.parse_args()
    model = None
    try:
        def reject_constant(value):
            raise ValueError(value)
        def strict_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError(key)
                result[key] = value
            return result
        raw = args.model.read_bytes()
        model = json.loads(raw, parse_constant=reject_constant, object_pairs_hook=strict_object)
        return check(model, schema_root=args.root)
    except ValueError:
        return None

if __name__ == '__main__':
    main()
`;

const dependencyRoot = `import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
`;
const dependencyRunner = `import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {ROOT} from './root.mjs';
const runtimeRoot = () => resolve(ROOT, 'runtime');
const sandbox = data => resolve(data, 'offline.sb');
export const python = () => resolve(runtimeRoot(), 'python/bin/python3.12');
export function boundedProcess(args, {data}) {
  const inherited = process.env.INHERITED,
    command = inherited ? python() : '/usr/bin/sandbox-exec',
    parameters = inherited ? ['-I', '-B', ...args] : ['-f', sandbox(data), python(), '-I', '-B', ...args];
  const child = spawn(command, parameters, {cwd: ROOT});
  return child;
}
`;
const dependencyCaller = `import {readFileSync as read} from 'node:fs';
import {resolve as absolute} from 'node:path';
import {ROOT as root} from './root.mjs';
import {boundedProcess as run} from './runner.mjs';
const data = absolute(process.argv[2]);
read(absolute(root, 'records/a.json'));
read(absolute(data, 'records/b.json'));
run([absolute(root, 'tools/helper.py'), 'export'], {data});
run([absolute(root, 'tools/helper.py'), 'verify'], {data});
`;
const dependencySource = 'file:src/dependency.mjs';
const dependencyTargets = ['config:records/a.json', 'config:records/b.json', 'file:tools/helper.py'];

function dependencyFixture(extraFiles = {}) {
  return fixture({
    extraFiles: {
      'src/root.mjs': dependencyRoot, 'src/runner.mjs': dependencyRunner, 'src/dependency.mjs': dependencyCaller,
      'tools/helper.py': 'raise RuntimeError("The grammar must never execute the helper")\n',
      ...extraFiles,
    },
    extraEdges: dependencyTargets.map(target => ['depends_on', dependencySource, target]),
  });
}

const qualifierPath = 'tools/qualify.mjs';
const invocationPath = 'tools/qualify-source.sh';
const launcherPath = 'plugin/scripts/launch.sh';
const launcherBytes = '#!/bin/sh\nexit 37\n';
const qualifier = `import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const args = Object.freeze(process.argv.slice(2));
const arg = name => { const index = args.indexOf('--' + name); return index === -1 ? undefined : args[index + 1]; };
const appRoot = resolve(arg('app-root'));
const launcherOnly = args.includes('--launcher-only');
const launcherPath = resolve(appRoot, 'plugin/scripts/launch.sh');
const launcherTransport = () => new StdioClientTransport({ command: launcherPath, args: [] });
if (launcherOnly) {
  const launcherClient = new Client({ name: 'fixture', version: '1.0.0' });
  try { await launcherClient.connect(launcherTransport()); }
  finally { await launcherClient.close(); }
}
`;
const launcherWrapper = [
  '#!/bin/sh',
  'set -eu',
  '',
  'APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)',
  'exec node "$APP_ROOT/tools/qualify.mjs" --app-root "$APP_ROOT" --launcher-only "$@"',
  '',
].join('\n');

function launcherFixture(source = qualifier, wrapper = launcherWrapper) {
  const f = fixture({
    extraFiles: { [qualifierPath]: source, [launcherPath]: launcherBytes },
    extraEdges: [['depends_on', `file:${qualifierPath}`, `file:${launcherPath}`]],
  });
  f.write(invocationPath, wrapper);
  return { ...f, launcherClaim: () => f.report().claims.find(claim => claim.object === `file:${launcherPath}`) };
}

const routingMapPath = 'registries/routing_maps.v1.json';
const storagePath = 'registries/storage_conventions.v1.json';
const signalId = 'O-1.1.1-001';
const briefId = 'O-3.2.2-001';
const storageEntries = [
  { output_id: signalId, output_name: 'Signal Log' },
  { output_id: briefId, output_name: '10-Line Brief' },
];
const routeRow = (id, overrides = {}) => ({
  route_id: id, source_output_id: signalId, on_event: 'created', conditions: 'always',
  targets: ['P-QA'], actions: [{ verb: 'NOTIFY', params: { target: 'P-QA' } }], ...overrides,
});
const downstream = { action: 'CREATE_OUTPUT', output_id: briefId };

function routingFixture(routes, entries = storageEntries, thresholdCrossedOnPublish) {
  const maps = { schema_id: 'routing_maps_registry.v1', schema_version: '1.0', registry_version: '1.0',
    target_legend: { 'P-QA': 'Quality pod', ALL_PODS: 'All pods (broadcast)' },
    threshold_crossed_on_publish: thresholdCrossedOnPublish, routes };
  const storage = { schema_id: 'storage_conventions_registry.v1', schema_version: '1.0', registry_version: '1.0', entries };
  const f = fixture({ extraFiles: { [routingMapPath]: JSON.stringify(maps), [storagePath]: JSON.stringify(storage) } });
  return { ...f, maps, storage, routes: () => f.report().claims.filter(claim => claim.predicate === 'routes_to') };
}

const auditBase = 'audit/base.py';
const auditAdapter = 'audit/local_routing_adapter.py';
const auditRecordSource = `class RoutingAdapter:
    pass

class RoutingEventRecord:
    event_id: str
`;
const auditAdapterSource = `import sqlite3
from .base import RoutingAdapter, RoutingEventRecord

class LocalRoutingAdapter(RoutingAdapter):
    def log_routing_event(self, event: RoutingEventRecord):
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT INTO routing_events (event_id) VALUES (?)", (event.event_id,))
        conn.commit()
        conn.close()

    def get_routing_events(self) -> list[RoutingEventRecord]:
        conn = sqlite3.connect(self.db_path)
        query = "SELECT event_id FROM routing_events WHERE 1=1"
        params = []
        query += " ORDER BY event_id ASC"
        cursor = conn.cursor()
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        results = []
        for row in rows:
            results.append(RoutingEventRecord(event_id=row[0]))
        return results

class WebRoutingAdapter(RoutingAdapter):
    def log_routing_event(self, event: RoutingEventRecord):
        raise NotImplementedError

class WrongIdentityAdapter(RoutingAdapter):
    def log_routing_event(self, event: RoutingEventRecord):
        conn = sqlite3.connect(self.db_path)
        conn.execute("INSERT INTO routing_events (event_id) VALUES (?)", (event.route_id,))
        conn.commit()
        conn.close()
`;
const classNode = (filePath, name) => ({ id: `class:${filePath}:${name}`, type: 'class', filePath, name,
  summary: 'Audit fixture', tags: ['fixture'], complexity: 'simple' });

const runtimePackageShim = depth => `from pathlib import Path

__path__.append(str(Path(__file__).resolve().parents[${depth}]))
`;
const registryPreflight = `import json
from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource

def preflight(record_path, wrapper_path, item_path):
    record = json.loads(record_path.read_text(encoding="utf-8"))
    wrapper = json.loads(wrapper_path.read_text(encoding="utf-8"))
    item = json.loads(item_path.read_text(encoding="utf-8"))
    schemas = Registry().with_resource(item["$id"], Resource.from_contents(item))
    try:
        Draft202012Validator(wrapper, registry=schemas).validate(record)
    except ValidationError:
        raise SystemExit(1)

`;

function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 15_000 });
}

function ok(script, ...args) {
  const result = run(script, ...args);
  if (result.status !== 0) throw new Error(result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function fixture({ legacy = false, source = header + table + direct, extraFiles = {}, extraEdges = [], extraNodes = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-agentos-profile-'));
  roots.push(root);
  const ua = join(root, legacy ? '.understand-anything' : '.ua');
  const write = (path, value) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const files = {
    'tools/check.py': source,
    'schemas/alpha.schema.json': schema, 'schemas/beta.schema.json': schema, 'schemas/gamma.schema.json': schema,
    'records/a.json': '{}', 'records/b.json': '{}', 'records/c.json': '{}', 'records/guess.json': '{}',
    'src/entry.mjs': "import './a.mjs';\nconst later = () => import('./b.mjs');\n",
    'src/a.mjs': 'export {};\n', 'src/b.mjs': 'export {};\n',
    ...extraFiles,
  };
  for (const [path, content] of Object.entries(files)) write(path, content);
  const nodes = Object.keys(files).map(filePath => {
    const type = filePath.includes('.schema.') ? 'schema' : filePath.endsWith('.json') ? 'config' : 'file';
    return { id: `${type}:${filePath}`, type, filePath, name: basename(filePath),
      summary: 'Fixture', tags: ['fixture'], complexity: 'simple' };
  });
  nodes.push(...extraNodes);
  const graph = {
    version: '1.0.0', project: { name: 'fixture', description: 'Fixture', languages: ['python', 'javascript'],
      frameworks: [], analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'base' },
    nodes, layers: [], tour: [], edges: [
      ['defines_schema', 'schema:schemas/gamma.schema.json', 'config:records/c.json'],
      ['defines_schema', 'schema:schemas/alpha.schema.json', 'config:records/guess.json'],
      ['imports', 'file:src/entry.mjs', 'file:src/a.mjs'],
      ['imports', 'file:src/entry.mjs', 'file:src/b.mjs'],
      ...extraEdges,
    ].map(([type, source, target]) => ({ type, source, target, direction: 'forward', weight: 0.9 })),
  };
  const fingerprints = { version: '1.0.0', gitCommitHash: 'base',
    files: Object.fromEntries(Object.entries(files).map(([filePath, text]) => [filePath, { filePath, contentHash: sha256(text) }])) };
  const graphPath = join(ua, 'knowledge-graph.json');
  const fingerprintPath = join(ua, 'fingerprints.json');
  const reportPath = join(ua, 'semantic-claims.json');
  mkdirSync(ua);
  writeFileSync(graphPath, JSON.stringify(graph));
  writeFileSync(fingerprintPath, JSON.stringify(fingerprints));
  writeFileSync(join(ua, 'config.json'), JSON.stringify({ autoUpdate: true, outputLanguage: 'fr' }));
  return { root, ua, graphPath, fingerprintPath, reportPath, write,
    report: () => JSON.parse(readFileSync(reportPath, 'utf8')),
    enable: () => ok(grammar, root, '--configure', 'agentos'),
    refresh: () => ok(grammar, root, '--require'),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('AgentOS grammar profile', { timeout: 20_000 }, () => {
  it('is opt-in per project, preserves config, and uses the legacy data directory when present', () => {
    const f = fixture({ legacy: true });
    expect(ok(grammar, f.root)).toBe('');
    expect(run(grammar, f.root, '--require').status).toBe(1);
    expect(run(grammar, f.root, '--configure', 'unknown').status).toBe(1);
    expect(existsSync(f.reportPath)).toBe(false);

    f.enable();
    expect(JSON.parse(readFileSync(join(f.ua, 'config.json'), 'utf8'))).toEqual({
      autoUpdate: true, outputLanguage: 'fr', grammarProfile: 'agentos',
    });
    f.refresh();
    expect(existsSync(f.reportPath)).toBe(true);
    expect(existsSync(join(f.root, '.ua'))).toBe(false);

    ok(grammar, f.root, '--configure', 'off');
    expect(existsSync(f.reportPath)).toBe(false);
    expect(ok(grammar, f.root)).toBe('');
  });

  it('admits literal schema bindings with source evidence and withholds bare graph guesses and dynamic imports', () => {
    const f = fixture();
    const graphBefore = readFileSync(f.graphPath);
    const fingerprintsBefore = readFileSync(f.fingerprintPath);
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts).toEqual({ constrains: { candidates: 4, supported: 3, withheld: 1 },
      depends_on: { candidates: 2, supported: 1, withheld: 1 }, routes_to: { candidates: 0, supported: 0, withheld: 0 },
      observes: { candidates: 0, supported: 0, withheld: 0 }, produces: { candidates: 0, supported: 0, withheld: 0 },
      consumes: { candidates: 0, supported: 0, withheld: 0 } });
    const tableClaim = report.claims.find(claim => claim.object === 'config:records/a.json');
    expect(tableClaim).toMatchObject({ subject: 'schema:schemas/alpha.schema.json', subjectSort: 'Unit', objectSort: 'Unit',
      predicate: 'constrains', status: 'inferred', graphEdges: [], evidence: [{ status: 'observed', kind: 'python_validator_table',
        filePath: 'tools/check.py', bindingLine: 7, line: 8, schemaPath: 'schemas/alpha.schema.json', recordPath: 'records/a.json' }] });
    expect(report.claims.find(claim => claim.object === 'config:records/c.json').evidence[0]).toMatchObject({
      kind: 'python_validator_call', filePath: 'tools/check.py', line: 11,
      schemaSha256: sha256(schema), recordSha256: sha256('{}'),
    });
    expect(report.claims.find(claim => claim.object === 'config:records/guess.json')).toMatchObject({
      status: 'unknown', admission: 'withheld', reason: 'no_explicit_schema_binding', evidence: [],
    });
    expect(report.claims.find(claim => claim.object === 'file:src/b.mjs').reason).toBe('no_supported_import');
    const before = readFileSync(f.reportPath, 'utf8');
    f.refresh();
    expect(readFileSync(f.reportPath, 'utf8')).toBe(before);
    expect(readFileSync(f.graphPath)).toEqual(graphBefore);
    expect(readFileSync(f.fingerprintPath)).toEqual(fingerprintsBefore);
    ok(scanner, f.root, join(f.root, 'scan.json'));
    const scan = JSON.parse(readFileSync(join(f.root, 'scan.json'), 'utf8'));
    expect(scan.files.some(file => file.path === '.ua/semantic-claims.json')).toBe(false);
  });

  it('admits literal JSON reads and Python invocations with pinned root and runner evidence', () => {
    const f = dependencyFixture();
    f.enable();
    f.refresh();
    const { claims } = f.report();
    const [json, dynamic, python] = dependencyTargets.map(target =>
      claims.find(claim => claim.subject === dependencySource && claim.object === target));
    const rootBinding = { filePath: 'src/root.mjs', line: 3, sha256: sha256(dependencyRoot) };
    expect(json).toMatchObject({ admission: 'supported', frame: 'module-relative-json-read', evidence: [{
      kind: 'static_json_read', line: 6, resolvedPath: 'records/a.json', resolvedSha256: sha256('{}'), rootBinding,
    }] });
    expect(dynamic).toMatchObject({ admission: 'withheld', reason: 'no_static_file_binding', evidence: [] });
    expect(python).toMatchObject({ admission: 'supported', frame: 'static-python-helper' });
    expect(python.evidence).toMatchObject([8, 9].map(line => ({
      kind: 'python_helper_invocation', line, resolvedPath: 'tools/helper.py', rootBinding,
      runnerBinding: { filePath: 'src/runner.mjs', line: 11, interpreterLine: 6, sha256: sha256(dependencyRunner) },
    })));
  });

  it.each([
    ['a non-module-relative root', { 'src/root.mjs': 'export const ROOT = process.cwd();' }, 'unverified_root_binding'],
    ['an altered argv prefix', { 'src/runner.mjs': dependencyRunner.replace("['-I', '-B', ...args]", "['-I', '-B', 'other.py', ...args]") },
      'unverified_runner_binding'],
    ['a default-only runner export', { 'src/runner.mjs': dependencyRunner.replace('export function boundedProcess',
      'export default function boundedProcess') }, 'unverified_runner_binding'],
    ['a shadowed runner import', { 'src/dependency.mjs': dependencyCaller.slice(0, dependencyCaller.indexOf('run([')) +
      "function shadow(run) { run([absolute(root, 'tools/helper.py')], {data}); }" }, 'no_static_file_binding'],
    ['a leading argv hole', { 'src/dependency.mjs': dependencyCaller.replaceAll('run([absolute', 'run([, absolute') },
      'no_static_file_binding'],
    ['a stale runner', {}, 'runner_stale_fingerprint'],
  ])('withholds a helper invocation with %s', (label, extraFiles, reason) => {
    const f = dependencyFixture(extraFiles);
    if (label === 'a stale runner') f.write('src/runner.mjs', dependencyRunner + '\n');
    f.enable();
    f.refresh();
    expect(f.report().claims.find(claim => claim.subject === dependencySource && claim.object === dependencyTargets[2]))
      .toMatchObject({ admission: 'withheld', reason, evidence: [] });
  });

  it('binds a source wrapper to the exact launcher under launcher-only mode', () => {
    const f = launcherFixture();
    f.enable();
    f.refresh();
    expect(f.launcherClaim()).toMatchObject({ admission: 'supported', frame: 'source-launcher-invocation', evidence: [{
      kind: 'source_launcher_invocation', filePath: qualifierPath, sha256: sha256(qualifier), line: 8, connectLine: 12,
      resolvedPath: launcherPath, resolvedSha256: sha256(launcherBytes),
      invocation: { filePath: invocationPath, sha256: sha256(launcherWrapper), rootLine: 4, line: 5, appRoot: '.', mode: '--launcher-only' },
    }] });
    f.write(qualifierPath, qualifier + '\n');
    f.refresh();
    expect(f.launcherClaim()).toMatchObject({ admission: 'withheld', reason: 'source_stale_fingerprint', evidence: [] });
  });

  it.each([
    ['a different command path', qualifier.replace(launcherPath, 'plugin/scripts/installed.sh'), launcherWrapper, 'launcher_target_mismatch'],
    ['a disconnected mode', qualifier.replace('if (launcherOnly)', 'if (!launcherOnly)'), launcherWrapper, 'no_launcher_only_binding'],
    ['an installed app root', qualifier, launcherWrapper.replace(/APP_ROOT=\$\([^\n]+/, 'APP_ROOT=/Applications/AgentOS'),
      'unverified_launcher_wrapper'],
    ['caller arguments before the fixed root', qualifier,
      launcherWrapper.replace('--app-root "$APP_ROOT" --launcher-only "$@"', '"$@" --app-root "$APP_ROOT" --launcher-only'),
      'unverified_launcher_wrapper'],
  ])('withholds a source launcher claim with %s', (_label, source, wrapper, reason) => {
    const f = launcherFixture(source, wrapper);
    f.enable();
    f.refresh();
    expect(f.launcherClaim()).toMatchObject({ admission: 'withheld', reason, evidence: [] });
  });

  it('binds declared route endpoints and retains route identity and conditions', () => {
    const f = routingFixture([
      routeRow('R-001', { targets: ['P-QA', 'ALL_PODS'], conditions: 'severity == high', qa_gate: 'required',
        downstream_outputs: [downstream], actions: [{ verb: 'CREATE_OUTPUT', params: { output_id: briefId } }] }),
      routeRow('R-002', { conditions: 'severity == low' }),
      routeRow('R-003', { source_output_id: 'ANY' }),
    ]);
    f.enable();
    f.refresh();
    expect(f.report().counts.routes_to).toEqual({ candidates: 5, supported: 4, withheld: 1 });
    const claims = f.routes();
    const targetClaims = claims.filter(claim => claim.admission === 'supported' && claim.routeScope.destination.id === 'P-QA');
    expect(new Set(targetClaims.map(claim => claim.id)).size).toBe(2);
    expect(new Set(targetClaims.map(claim => claim.subject)).size).toBe(1);
    expect(new Set(targetClaims.map(claim => claim.object)).size).toBe(1);
    expect(claims.find(claim => claim.routeScope.destination.id === briefId)).toMatchObject({
      frame: 'storage-routing-declaration', subjectSort: 'Unit', objectSort: 'Unit', graphEdges: [],
      routeScope: { routeId: 'R-001', onEvent: 'created', conditions: 'severity == high', qaGate: 'required',
        destination: { kind: 'output', id: briefId, action: 'CREATE_OUTPUT' } },
      evidence: [{ kind: 'storage_routing_declaration', filePath: routingMapPath, sha256: sha256(JSON.stringify(f.maps)),
        sourcePointer: '/routes/0/source_output_id', destinationPointer: '/routes/0/downstream_outputs/0/output_id',
        actionPointer: '/routes/0/actions/0',
        sourceBinding: { identifier: signalId, pointer: '/entries/0', filePath: storagePath, sha256: sha256(JSON.stringify(f.storage)) },
        destinationBinding: { identifier: briefId, pointer: '/entries/1', filePath: storagePath } }],
    });
    expect(claims.find(claim => claim.routeScope.destination.id === 'ALL_PODS')).toMatchObject({
      admission: 'supported', evidence: [{ destinationBinding: { identifier: 'ALL_PODS', pointer: '/target_legend/ALL_PODS' } }],
    });
    expect(claims.find(claim => claim.routeScope.routeId === 'R-003')).toMatchObject({
      subject: null, admission: 'withheld', reason: 'wildcard_source', evidence: [],
    });
    f.write(storagePath, { ...f.storage, registry_version: 'changed' });
    f.refresh();
    expect(f.routes()).toEqual([]);
    expect(f.report().gaps).toContainEqual({ filePath: storagePath, reason: 'storage_conventions_stale_fingerprint' });
  });

  it('withholds ambiguous or missing route endpoints and unmatched downstream actions', () => {
    const ambiguousId = 'O-7.3.2-001';
    const repeated = { output_id: ambiguousId, output_name: 'Duplicate Backlog' };
    const f = routingFixture([
      routeRow('R-001', { targets: ['UNKNOWN'], downstream_outputs: [downstream] }),
      routeRow('R-002', { source_output_id: ambiguousId }),
      routeRow('R-003', { source_output_id: 'O-0.0.0-000' }),
      routeRow('R-004', { targets: [], downstream_outputs: [{ ...downstream, output_id: ambiguousId }],
        actions: [{ verb: 'CREATE_OUTPUT', params: { output_id: ambiguousId } }] }),
      routeRow('R-005'), routeRow('R-005'),
    ], [...storageEntries, repeated, repeated]);
    f.enable();
    f.refresh();
    expect(f.report().counts.routes_to).toEqual({ candidates: 5, supported: 0, withheld: 5 });
    expect(f.routes().map(claim => claim.reason).sort()).toEqual([
      'ambiguous_destination_output', 'ambiguous_source_output', 'unbound_downstream_action',
      'unbound_source_output', 'unbound_target_legend',
    ]);
    expect(f.report().gaps.filter(gap => gap.reason === 'ambiguous_route_id')).toHaveLength(2);
  });

  it('supports a named publish emitter while retaining the wildcard threshold claims', () => {
    const conditions = 'confidentiality_level == C3 OR risk_severity == RS-4';
    const f = routingFixture([
      routeRow('R-018', { source_output_id: 'ANY', on_event: 'threshold_crossed', conditions,
        targets: ['P-QA', 'ALL_PODS'] }),
      routeRow('R-019', { source_output_id: 'ANY', on_event: 'threshold_crossed', conditions: 'other == true' }),
      routeRow('R-020', { source_output_id: 'ANY', on_event: 'published', conditions }),
    ], storageEntries, { [signalId]: conditions, 'O-0.0.0-000': conditions });
    f.enable();
    f.refresh();
    expect(f.report().counts.routes_to).toEqual({ candidates: 6, supported: 2, withheld: 4 });
    const supported = f.routes().filter(claim => claim.admission === 'supported');
    expect(supported.map(claim => claim.routeScope.destination.id).sort()).toEqual(['ALL_PODS', 'P-QA']);
    for (const claim of supported) {
      expect(claim).toMatchObject({
        frame: 'storage-routing-publish-emitter', routeScope: {
          routeId: 'R-018', declaredSourceOutputId: 'ANY', sourceOutputId: signalId,
          sourceEvent: 'published', onEvent: 'threshold_crossed',
        },
        evidence: [{
          kind: 'storage_routing_publish_emitter', sha256: sha256(JSON.stringify(f.maps)),
          emitterBinding: { pointer: `/threshold_crossed_on_publish/${signalId}`, sourceOutputId: signalId,
            onEvent: 'published', emits: 'threshold_crossed', conditions },
          sourceBinding: { identifier: signalId, pointer: '/entries/0', filePath: storagePath },
        }],
      });
    }
    expect(f.routes().filter(claim => claim.routeScope.routeId === 'R-018' && claim.reason === 'wildcard_source')).toHaveLength(2);
    expect(f.report().gaps).toContainEqual({
      filePath: routingMapPath, pointer: '/threshold_crossed_on_publish/O-0.0.0-000', reason: 'unbound_source_output',
    });
  });

  it('binds audit instruments through executed SQLite statements and record identities', () => {
    const record = classNode(auditBase, 'RoutingEventRecord');
    const local = classNode(auditAdapter, 'LocalRoutingAdapter');
    const stub = classNode(auditAdapter, 'WebRoutingAdapter');
    const wrong = classNode(auditAdapter, 'WrongIdentityAdapter');
    const f = fixture({ extraFiles: { [auditBase]: auditRecordSource, [auditAdapter]: auditAdapterSource },
      extraNodes: [record, local, stub, wrong] });
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.observes).toEqual({ candidates: 3, supported: 1, withheld: 2 });
    const claims = report.claims.filter(claim => claim.predicate === 'observes');
    expect(claims.find(claim => claim.subject === local.id)).toMatchObject({
      object: record.id, subjectSort: 'Instrument', objectSort: 'Unit',
      frame: 'storage-routing-audit', admission: 'supported', evidence: [
        { kind: 'sqlite_audit_write', line: 7, methodLine: 5, commitLine: 8 },
        { kind: 'sqlite_audit_read', line: 17, methodLine: 11, recordConstructionLine: 22 },
      ],
    });
    for (const evidence of claims.find(claim => claim.subject === local.id).evidence) {
      expect(evidence).toMatchObject({ filePath: auditAdapter, sha256: sha256(auditAdapterSource),
        table: 'routing_events', identityColumn: 'event_id',
        recordBinding: { filePath: auditBase, line: 4, sha256: sha256(auditRecordSource) } });
    }
    expect(claims.find(claim => claim.subject === stub.id)).toMatchObject({
      admission: 'withheld', reason: 'unimplemented_audit_method', evidence: [],
    });
    expect(claims.find(claim => claim.subject === wrong.id)).toMatchObject({
      admission: 'withheld', reason: 'unverified_audit_binding', evidence: [],
    });

    f.write(auditBase, auditRecordSource + '\n');
    f.refresh();
    expect(f.report().counts.observes.supported).toBe(0);
    expect(f.report().gaps).toContainEqual({ filePath: auditBase, reason: 'stale_fingerprint' });
  });

  it('binds audit producers to the record passed to the injected adapter', () => {
    const storageEngine = 'audit/storage_engine.py';
    const layoutPath = 'audit/README.md';
    const routingEngine = 'pkg/engine/routing_engine.py';
    const routingBase = 'pkg/engine/adapters/base.py';
    const storageBase = `class StorageActionRecord:
    action_id: str

class StorageAdapter:
    def write_artifact(self) -> StorageActionRecord:
        ...
`;
    const layout = `├── engine/
│   ├── storage_engine.py
│   └── adapters/
│       └── base.py
`;
    const storage = `from .adapters.base import StorageAdapter, StorageActionRecord

class StorageEngine:
    def __init__(self, adapter: StorageAdapter):
        self.adapter = adapter

    def store(self) -> StorageActionRecord:
        action = self.adapter.write_artifact()
        action.index_updated = True
        self.adapter.log_storage_action(action)
        return action

    def return_only(self) -> StorageActionRecord:
        return self.adapter.write_artifact()

    def forward(self, incoming: StorageActionRecord) -> StorageActionRecord:
        action = self.adapter.write_artifact()
        action = incoming
        self.adapter.log_storage_action(action)
        return action
`;
    const routing = `from .adapters.base import RoutingAdapter, RoutingEventRecord

class RoutingEngine:
    def __init__(self, adapter: RoutingAdapter):
        self.adapter = adapter

    def evaluate(self, suppressed) -> RoutingEventRecord:
        if False:
            event = RoutingEventRecord(event_id="dead")
            self.adapter.log_routing_event(event)
            return event
        if suppressed:
            event = RoutingEventRecord(event_id="suppressed")
            self.adapter.log_routing_event(event)
            return event
        event = RoutingEventRecord(event_id="executed")
        self.adapter.log_routing_event(event)
        return event
`;
    const storageNode = classNode(storageEngine, 'StorageEngine');
    const routingNode = classNode(routingEngine, 'RoutingEngine');
    const actionNode = classNode(auditBase, 'StorageActionRecord');
    const eventNode = classNode(routingBase, 'RoutingEventRecord');
    const f = fixture({ extraFiles: { [storageEngine]: storage, [auditBase]: storageBase,
      [layoutPath]: layout, [routingEngine]: routing, [routingBase]: auditRecordSource },
    extraNodes: [storageNode, routingNode, actionNode, eventNode] });
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.produces).toEqual({ candidates: 3, supported: 2, withheld: 1 });
    const claims = report.claims.filter(claim => claim.predicate === 'produces');
    const claimFor = method => claims.find(claim => claim.subjectScope.method === method);
    expect(claimFor('store')).toMatchObject({
      subject: storageNode.id, object: actionNode.id, subjectScope: { kind: 'python-method', method: 'store' },
      subjectSort: 'Action', objectSort: 'Output', admission: 'supported',
      evidence: [{ kind: 'audit_record_emission', filePath: storageEngine, sha256: sha256(storage),
        line: 10, sink: 'log_storage_action', origin: { kind: 'adapter_return', line: 8, contractLine: 5 },
        recordBinding: { filePath: auditBase, sha256: sha256(storageBase) },
        layoutBinding: { filePath: layoutPath, sha256: sha256(layout), line: 2, recordLine: 4 } }],
    });
    expect(claimFor('evaluate')).toMatchObject({
      subject: routingNode.id, object: eventNode.id, admission: 'supported',
      evidence: [
        { line: 14, sink: 'log_routing_event', guardLines: [12], origin: { kind: 'constructor', line: 13 },
          recordBinding: { filePath: routingBase, sha256: sha256(auditRecordSource) } },
        { line: 17, sink: 'log_routing_event', guardLines: [], origin: { kind: 'constructor', line: 16 } },
      ],
    });
    expect(claimFor('return_only')).toBeUndefined();
    expect(claimFor('forward')).toMatchObject({ admission: 'withheld', reason: 'unverified_audit_emission', evidence: [] });

    f.write(layoutPath, layout + '\n');
    f.refresh();
    expect(f.report().counts.produces).toEqual({ candidates: 1, supported: 1, withheld: 0 });
    expect(f.report().gaps).toContainEqual({
      filePath: storageEngine, recordPath: auditBase, reason: 'audit_package_layout_unverified',
    });
  });

  it.each(['flattened', 'packaged'])('traces registry consumption in a %s bundle', layout => {
    const flattened = layout === 'flattened';
    const locate = (folder, name) => `bundle/${flattened ? '' : folder + '/'}${name}`;
    const testPath = locate('tests', 'test_acceptance.py');
    const storagePath = locate('engine', 'storage_engine.py');
    const routingPath = locate('engine', 'routing_engine.py');
    const conventionsPath = locate('registries', 'storage_conventions.v1.json');
    const mapsPath = locate('registries', 'routing_maps.v1.json');
    const storage = `class StorageEngine:
    def __init__(self, adapter, conventions_data=None):
        self._conventions = {}
        if conventions_data:
            self._load_conventions(conventions_data)

    def _load_conventions(self, data):
        for entry in data.get("entries", []):
            self._conventions[entry["output_id"]] = entry
`;
    const routing = `class RoutingEngine:
    def __init__(self, adapter, routing_data=None):
        if routing_data:
            self._load_registry(routing_data)

    def _load_registry(self, data):
        self._routes = data.get("routes", [])
`;
    const conventions = JSON.stringify({ schema_id: 'storage_conventions_registry.v1', schema_version: '1.0',
      registry_version: '1.0', entries: [] });
    const maps = JSON.stringify({ schema_id: 'routing_maps_registry.v1', schema_version: '1.0',
      registry_version: '1.0', routes: [], target_legend: {} });
    const testSource = `import json
import unittest
from pathlib import Path
from engine.storage_engine import StorageEngine
from engine.routing_engine import RoutingEngine

class TestEngines(unittest.TestCase):
    def setUp(self):
        registries = Path(__file__).parent.parent / "registries"
        with open(registries / "storage_conventions.v1.json") as f:
            conventions = json.load(f)
        self.storage = StorageEngine(adapter=None, conventions_data=conventions)
        with open(registries / "routing_maps.v1.json") as f:
            maps = json.load(f)
        self.routing = RoutingEngine(adapter=None, routing_data=maps)
        with open(registries / "storage_conventions.v1.json") as f:
            rebound = json.load(f)
        rebound = {}
        self.rebound = StorageEngine(adapter=None, conventions_data=rebound)
        with open(registries / "storage_conventions.v1.json") as f:
            changed = json.load(f)
        changed["entries"] = []
        self.changed = StorageEngine(adapter=None, conventions_data=changed)

    def test_engines(self):
        self.assertIsInstance(self.storage, StorageEngine)
`;
    const readmePath = 'bundle/README.md';
    const readme = `├── registries/
│   ├── storage_conventions.v1.json
│   └── routing_maps.v1.json
├── engine/
│   ├── storage_engine.py
│   └── routing_engine.py
├── tests/
│   └── test_acceptance.py
`;
    const storageNode = classNode(storagePath, 'StorageEngine');
    const routingNode = classNode(routingPath, 'RoutingEngine');
    const f = fixture({ extraFiles: { [testPath]: testSource, [storagePath]: storage, [routingPath]: routing,
      [conventionsPath]: conventions, [mapsPath]: maps, ...(flattened ? { [readmePath]: readme } : {}) },
    extraNodes: [storageNode, routingNode] });
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.consumes).toEqual({ candidates: 2, supported: 2, withheld: 0 });
    const consumption = subject => report.claims.find(claim => claim.predicate === 'consumes' && claim.subject === subject.id);
    const storageClaim = consumption(storageNode);
    expect(storageClaim).toMatchObject({
      object: `config:${conventionsPath}`, subjectScope: { kind: 'python-method', method: '__init__' },
      subjectSort: 'Action', objectSort: 'Unit', frame: 'storage-routing-acceptance-registry-load',
      evidence: [{ kind: 'python_acceptance_registry_load', filePath: testPath, sha256: sha256(testSource),
        testClass: 'TestEngines', testMethod: 'setUp', openLine: 10, jsonLoadLine: 11, line: 12,
        parameter: 'conventions_data',
        engineBinding: { filePath: storagePath, sha256: sha256(storage), loadCallLine: 5, collectionReadLine: 8 },
        registryBinding: { filePath: conventionsPath, sha256: sha256(conventions), collectionPointer: '/entries' } }],
    });
    expect(consumption(routingNode)).toMatchObject({ object: `config:${mapsPath}`,
      evidence: [{ parameter: 'routing_data', engineBinding: { filePath: routingPath, collectionReadLine: 7 },
        registryBinding: { filePath: mapsPath, sha256: sha256(maps), collectionPointer: '/routes' } }] });
    if (flattened) {
      expect(storageClaim.evidence[0].layoutBinding).toMatchObject({
        filePath: readmePath, sha256: sha256(readme), testLine: 8, engineLine: 5, registryLine: 2,
      });
    } else {
      expect(storageClaim.evidence[0].layoutBinding).toBeUndefined();
    }

    const ignoredInput = storage.replace('_load_conventions(conventions_data)', '_load_conventions({})');
    f.write(storagePath, ignoredInput);
    const fingerprints = JSON.parse(readFileSync(f.fingerprintPath, 'utf8'));
    fingerprints.files[storagePath].contentHash = sha256(ignoredInput);
    writeFileSync(f.fingerprintPath, JSON.stringify(fingerprints));
    f.refresh();
    const ignored = f.report();
    expect(ignored.counts.consumes).toEqual({ candidates: 2, supported: 1, withheld: 1 });
    expect(ignored.claims.find(claim => claim.predicate === 'consumes' && claim.subject === storageNode.id))
      .toMatchObject({ admission: 'withheld', reason: 'unverified_registry_loader', evidence: [] });
  });

  it('binds a guarded runtime registry path through the constructor file branch', () => {
    const enginePath = 'bundle/storage_engine.py';
    const registryPath = 'bundle/storage_conventions.v1.json';
    const wrapperPath = 'bundle/storage_conventions_registry.schema.v1.json';
    const itemPath = 'bundle/storage_convention.schema.v1.json';
    const runtimePath = 'bundle/run_storage_routing.py';
    const enginePackage = 'bundle/engine/__init__.py';
    const adapterPackage = 'bundle/engine/adapters/__init__.py';
    const engine = `import json

class StorageEngine:
    def __init__(self, adapter, conventions_registry_path=None, conventions_data=None):
        self._conventions = {}
        if conventions_data:
            self._load_conventions(conventions_data)
        elif conventions_registry_path:
            with open(conventions_registry_path, "r") as f:
                self._load_conventions(json.load(f))

    def _load_conventions(self, data):
        for entry in data.get("entries", []):
            self._conventions[entry["output_id"]] = entry
`;
    const registry = JSON.stringify({ schema_id: 'storage_conventions_registry.v1', schema_version: '1.0',
      registry_version: '1.0', entries: [] });
    const item = { ...JSON.parse(schema), $id: 'https://example.test/storage_convention.schema.v1.json' };
    const wrapper = {
      ...JSON.parse(schema), $id: 'https://example.test/storage_conventions_registry.schema.v1.json',
      required: ['schema_id', 'entries'], properties: {
        schema_id: { const: 'storage_conventions_registry.v1' },
        entries: { type: 'array', items: { $ref: 'storage_convention.schema.v1.json' } },
      },
    };
    const runtime = `from pathlib import Path
from engine.storage_engine import StorageEngine

ROOT = Path(__file__).resolve().parent

def main():
    StorageEngine(adapter=None, conventions_registry_path=str(ROOT / "storage_conventions.v1.json"))
    StorageEngine(adapter=None, conventions_registry_path=str(ROOT / "storage_conventions.v1.json"),
                  conventions_data={"entries": []})

if __name__ == "__main__":
    main()
`;
    const storage = classNode(enginePath, 'StorageEngine');
    const f = fixture({ extraFiles: { [enginePath]: engine, [registryPath]: registry, [itemPath]: JSON.stringify(item) },
      extraNodes: [storage], extraEdges: [['defines_schema', `schema:${itemPath}`, `config:${registryPath}`]] });
    // Runtime companions can supply evidence before they have graph nodes.
    f.write(runtimePath, runtime);
    f.write(enginePackage, runtimePackageShim(1));
    f.write(adapterPackage, runtimePackageShim(2));
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.consumes).toEqual({ candidates: 1, supported: 1, withheld: 0 });
    expect(report.claims.find(claim => claim.predicate === 'consumes')).toMatchObject({
      subject: storage.id, object: `config:${registryPath}`, frame: 'storage-routing-runtime-registry-load',
      evidence: [{ kind: 'python_runtime_registry_load', line: 7, filePath: runtimePath, sha256: sha256(runtime),
        entrypointLine: 11, entryFunction: 'main', parameter: 'conventions_registry_path',
        resolvedRegistryPath: registryPath,
        engineBinding: { filePath: enginePath, sha256: sha256(engine), pathGuardLine: 8,
          openLine: 9, jsonLoadLine: 10, collectionReadLine: 13 },
        registryBinding: { filePath: registryPath, sha256: sha256(registry), collectionPointer: '/entries' },
        packageBindings: [
          { filePath: enginePackage, line: 3, sha256: sha256(runtimePackageShim(1)) },
          { filePath: adapterPackage, line: 3, sha256: sha256(runtimePackageShim(2)) },
        ] }],
    });

    const dispatch = `    preflight(ROOT / "storage_conventions.v1.json",
              ROOT / "storage_conventions_registry.schema.v1.json", ROOT / "storage_convention.schema.v1.json")
`;
    const preflight = registryPreflight + 'from engine.adapters.local_routing_adapter import LocalRoutingAdapter\n\n' +
      runtime.replace('def main():\n', `def main():\n${dispatch}`);
    const constraint = () => f.report().claims.find(claim => claim.predicate === 'constrains' &&
      claim.object === `config:${registryPath}`);
    f.write(wrapperPath, wrapper);
    f.write(runtimePath, preflight);
    f.refresh();
    const claim = constraint();
    expect(claim).toMatchObject({
      admission: 'supported', objectScope: { kind: 'array_items', pointer: '/entries' },
      evidence: [{ kind: 'json_schema_items_ref' }, { kind: 'python_startup_registry_validation',
        filePath: runtimePath, sha256: sha256(preflight),
        recordBinding: { filePath: registryPath, sha256: sha256(registry) },
        wrapperBinding: { filePath: wrapperPath, sha256: sha256(JSON.stringify(wrapper)),
          pointer: '/properties/entries/items/$ref' },
        itemSchemaBinding: { filePath: itemPath, sha256: sha256(JSON.stringify(item)) } }],
    });
    expect(claim.evidence[1].startupCallLine).toBeLessThan(claim.evidence[1].initializationLine);
    for (const variant of [
      preflight.replace('"storage_conventions_registry.schema.v1.json"', '"routing_maps_registry.schema.v1.json"'),
      preflight.replace('"storage_convention.schema.v1.json"', '"routing_rule.schema.v1.json"'),
      preflight.replace('raise SystemExit(1)', 'pass'),
      preflight.replace('def main():\n', 'def main():\n    LocalRoutingAdapter(db_path="state.sqlite3")\n'),
    ]) {
      f.write(runtimePath, variant);
      f.refresh();
      expect(constraint()).toMatchObject({
        id: claim.id, admission: 'supported', evidence: [{ kind: 'json_schema_items_ref' }],
      });
    }
    f.write(runtimePath, runtime);

    f.write(enginePackage, runtimePackageShim(0));
    f.refresh();
    expect(f.report().counts.consumes).toEqual({ candidates: 0, supported: 0, withheld: 0 });
    f.write(enginePackage, runtimePackageShim(1));

    const ignoredPath = engine.replace('open(conventions_registry_path, "r")', 'open("other.json", "r")');
    f.write(enginePath, ignoredPath);
    const fingerprints = JSON.parse(readFileSync(f.fingerprintPath, 'utf8'));
    fingerprints.files[enginePath].contentHash = sha256(ignoredPath);
    writeFileSync(f.fingerprintPath, JSON.stringify(fingerprints));
    f.refresh();
    const ignored = f.report();
    expect(ignored.counts.consumes).toEqual({ candidates: 1, supported: 0, withheld: 1 });
    expect(ignored.claims.find(claim => claim.predicate === 'consumes')).toMatchObject({
      frame: 'storage-routing-runtime-registry-load', admission: 'withheld', reason: 'unverified_registry_loader',
      evidence: [],
    });
  });

  function registryStartupFixture() {
    const runtimePath = 'bundle/run_storage_routing.py';
    const testPath = 'bundle/test_runtime_registry_validation.py';
    const extraFiles = {};
    const wrappers = {};
    const extraEdges = [];
    const extraNodes = [];
    const imports = [];
    const validations = [];
    const constructors = [];
    const inputs = [
      { engine: 'StorageEngine', module: 'storage_engine', parameter: 'conventions',
        registry: 'storage_conventions', item: 'storage_convention', collection: 'entries' },
      { engine: 'RoutingEngine', module: 'routing_engine', parameter: 'routing',
        registry: 'routing_maps', item: 'routing_rule', collection: 'routes' },
    ];
    for (const { engine, module, parameter, registry, item, collection } of inputs) {
      const enginePath = `bundle/${module}.py`;
      const dataParameter = `${parameter}_data`;
      const pathParameter = `${parameter}_registry_path`;
      const recordName = `${registry}.v1.json`;
      const itemName = `${item}.schema.v1.json`;
      const wrapperName = `${registry}_registry.schema.v1.json`;
      const schemaId = `${registry}_registry.v1`;
      const record = { schema_id: schemaId, schema_version: '1.0', registry_version: '1.0', [collection]: [] };
      if (collection === 'routes') record.target_legend = {};
      extraFiles[`bundle/${recordName}`] = JSON.stringify(record);
      extraFiles[`bundle/${itemName}`] = JSON.stringify({
        ...JSON.parse(schema), $id: `https://example.test/${itemName}`,
      });
      wrappers[`bundle/${wrapperName}`] = JSON.stringify({
        ...JSON.parse(schema), $id: `https://example.test/${wrapperName}`,
        required: ['schema_id', collection], properties: {
          schema_id: { const: schemaId },
          [collection]: { type: 'array', items: { $ref: itemName } },
        },
      });
      extraFiles[enginePath] = `import json

class ${engine}:
    def __init__(self, ${pathParameter}=None, ${dataParameter}=None):
        if ${dataParameter}:
            self._load_registry(${dataParameter})
        elif ${pathParameter}:
            with open(${pathParameter}, "r") as f:
                self._load_registry(json.load(f))

    def _load_registry(self, data):
        self._rows = data.get("${collection}", [])
`;
      extraEdges.push(['defines_schema', `schema:bundle/${itemName}`, `config:bundle/${recordName}`]);
      extraNodes.push(classNode(enginePath, engine));
      imports.push(`from engine.${module} import ${engine}`);
      validations.push(`    preflight(ROOT / "${recordName}", ROOT / "${wrapperName}", ROOT / "${itemName}")`);
      constructors.push(`    ${engine}(${pathParameter}=str(ROOT / "${recordName}"))`);
    }
    const runtime = registryPreflight + `from pathlib import Path
${imports.join('\n')}

ROOT = Path(__file__).resolve().parent

def main():
${validations.join('\n')}
${constructors.join('\n')}

if __name__ == "__main__":
    main()
`;
    const testSource = `import subprocess
import sys
import unittest
from pathlib import Path

class TestRegistryStartup(unittest.TestCase):
    def test_valid_registries(self):
        script = Path(__file__).with_name("run_storage_routing.py")
        result = subprocess.run([sys.executable, str(script)], capture_output=True)
        self.assertEqual(result.returncode, 0)
`;
    const f = fixture({ source: '', extraFiles, extraEdges, extraNodes });
    // Load the current wrapper references without fingerprinting the wrappers in the saved graph.
    for (const [path, wrapper] of Object.entries(wrappers)) f.write(path, wrapper);
    f.write(runtimePath, runtime);
    f.write('bundle/engine/__init__.py', runtimePackageShim(1));
    f.write('bundle/engine/adapters/__init__.py', runtimePackageShim(2));
    f.write(testPath, testSource);
    f.enable();
    f.refresh();

    const constraints = report => report.claims.filter(claim => claim.predicate === 'constrains' && claim.objectScope);
    const original = constraints(f.report());
    expect(original.map(claim => claim.objectScope.pointer).sort()).toEqual(['/entries', '/routes']);
    expect(original.map(claim => claim.admission)).toEqual(['supported', 'supported']);
    const kind = 'python_startup_registry_validation';
    const startupSite = claim => claim.evidence.find(site => site.kind === kind);
    const testBinding = { filePath: testPath, sha256: sha256(testSource), line: 7,
      test: 'TestRegistryStartup.test_valid_registries' };
    const coverage = { coverageLines: [9, 10], covers: 'Both bundled registries pass startup validation.' };

    const fixturePlugin = join(f.ua, 'fixture-plugin');
    const fixtureSkill = join(fixturePlugin, 'skills', 'understand');
    const fixtureGrammar = join(fixtureSkill, 'grammar-profile.mjs');
    mkdirSync(fixtureSkill, { recursive: true });
    cpSync(grammar, fixtureGrammar);
    cpSync(join(skill, 'grammar'), join(fixtureSkill, 'grammar'), { recursive: true });
    symlinkSync(join(skill, '../../packages'), join(fixturePlugin, 'packages'), 'junction');
    const profilePath = join(fixtureSkill, 'grammar', 'agentos.json');
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    profile.reviewedTests = [{
      testBinding,
      sources: Object.entries({ [runtimePath]: runtime, ...wrappers })
        .map(([filePath, source]) => ({ filePath, sha256: sha256(source) })),
      links: original.map(claim => ({ claimId: claim.id, kind, line: startupSite(claim).line, ...coverage })),
    }];
    writeFileSync(profilePath, JSON.stringify(profile));
    const refresh = () => ok(fixtureGrammar, f.root, '--require');

    refresh();
    const linked = constraints(f.report());
    expect(linked).toEqual(original.map(claim => ({
      ...claim,
      evidence: claim.evidence.map(site => site.kind === kind
        ? { ...site, testBindings: [{ ...testBinding, ...coverage }] }
        : site),
    })));

    const editedTestSource = testSource.replace('result.returncode, 0', 'result.returncode, 1');
    const wrapperCases = inputs.map(({ registry, collection }) => {
      const pointer = `/${collection}`;
      const wrapperPath = `bundle/${registry}_registry.schema.v1.json`;
      const wrapper = wrappers[wrapperPath];
      const brokenWrapper = JSON.parse(wrapper);
      brokenWrapper.properties[collection].items.$ref = 'missing.schema.v1.json';
      const claim = original.find(claim => claim.objectScope.pointer === pointer);
      return { pointer, wrapperPath, wrapper, brokenWrapper, claim };
    });
    const expectClaims = (expected, step) => {
      const report = f.report();
      expect(constraints(report), step).toEqual(expected);
      for (const claim of original) {
        if (expected.some(candidate => candidate.id === claim.id)) continue;
        const withheld = report.claims.find(candidate => candidate.id === claim.refines);
        expect(withheld, `${step} leaves ${claim.objectScope.pointer} withheld`).toMatchObject({
          predicate: 'constrains', admission: 'withheld', evidence: [],
        });
      }
    };
    const breakBothWrappers = () => {
      for (const { wrapperPath, brokenWrapper } of wrapperCases) f.write(wrapperPath, brokenWrapper);
      refresh();
      expectClaims([], 'both wrappers are broken');
    };
    return {
      write: f.write, refresh, expectClaims, breakBothWrappers, original, linked, wrapperCases, kind, profilePath,
      runtime: { path: runtimePath, source: runtime },
      test: { path: testPath, source: testSource, editedSource: editedTestSource },
    };
  }

  it('refreshes registry constraints and test links after test, startup, and wrapper edits', () => {
    const { write, refresh, expectClaims, breakBothWrappers, original, linked, wrapperCases, kind, runtime, test } =
      registryStartupFixture();

    write(test.path, test.editedSource);
    refresh();
    expectClaims(original, 'after editing the startup test');

    write(test.path, test.source);
    refresh();
    expectClaims(linked, 'after restoring the startup test');

    const commentedRuntime = `${runtime.source}\n# Fixture comment.\n`;
    const commentedHash = sha256(commentedRuntime);
    write(runtime.path, commentedRuntime);
    refresh();
    expectClaims(original.map(claim => ({
      ...claim,
      evidence: claim.evidence.map(site => site.kind === kind ? { ...site, sha256: commentedHash } : site),
    })), 'after editing startup code');

    write(runtime.path, runtime.source);
    refresh();
    expectClaims(linked, 'after restoring startup code');

    for (const { pointer, wrapperPath, wrapper, brokenWrapper } of wrapperCases) {
      write(wrapperPath, brokenWrapper);
      refresh();
      const survivingClaims = original.filter(claim => claim.objectScope.pointer !== pointer);
      expectClaims(survivingClaims, `after breaking ${pointer}`);

      write(wrapperPath, wrapper);
      refresh();
      expectClaims(linked, `after restoring ${pointer}`);
    }

    const [storage, routing] = wrapperCases;
    for (const [first, second] of [[storage, routing], [routing, storage]]) {
      breakBothWrappers();

      write(first.wrapperPath, first.wrapper);
      refresh();
      expectClaims([first.claim], `after restoring only ${first.pointer}`);

      write(second.wrapperPath, second.wrapper);
      refresh();
      expectClaims(linked, `after restoring ${first.pointer} then ${second.pointer}`);
    }
  });

  it.each([
    { first: 'storage', second: 'routing', last: 'test',
      afterFirst: ['/entries'], afterSecond: ['/entries', '/routes'] },
    { first: 'routing', second: 'storage', last: 'test',
      afterFirst: ['/routes'], afterSecond: ['/entries', '/routes'] },
    { first: 'storage', second: 'test', last: 'routing',
      afterFirst: ['/entries'], afterSecond: ['/entries'] },
    { first: 'routing', second: 'test', last: 'storage',
      afterFirst: ['/routes'], afterSecond: ['/routes'] },
    { first: 'test', second: 'storage', last: 'routing',
      afterFirst: [], afterSecond: ['/entries'] },
    { first: 'test', second: 'routing', last: 'storage',
      afterFirst: [], afterSecond: ['/routes'] },
  ])('restores registry claims and test links in order $first → $second → $last', ({
    first, second, last, afterFirst, afterSecond,
  }) => {
    const { write, refresh, expectClaims, breakBothWrappers, original, linked, wrapperCases, test } =
      registryStartupFixture();
    const [storage, routing] = wrapperCases;
    const restores = {
      storage: { path: storage.wrapperPath, source: storage.wrapper },
      routing: { path: routing.wrapperPath, source: routing.wrapper },
      test,
    };
    const steps = [
      { file: first, claims: original.filter(claim => afterFirst.includes(claim.objectScope.pointer)) },
      { file: second, claims: original.filter(claim => afterSecond.includes(claim.objectScope.pointer)) },
      { file: last, claims: linked },
    ];

    write(test.path, test.editedSource);
    breakBothWrappers();
    for (const { file, claims } of steps) {
      const { path, source } = restores[file];
      write(path, source);
      refresh();
      expectClaims(claims, `after restoring ${file}`);
    }
  });

  function twoPinnedStartupTestsFixture() {
    const { write, refresh, expectClaims, original, linked, kind, profilePath, test } = registryStartupFixture();
    const independentPath = 'bundle/test_registry_preflight.py';
    const independentSource = `import unittest
from run_storage_routing import main

class TestRegistryPreflight(unittest.TestCase):
    def test_accepts_both_registries(self):
        main()
`;
    const independentBinding = {
      filePath: independentPath,
      sha256: sha256(independentSource),
      line: 5,
      test: 'TestRegistryPreflight.test_accepts_both_registries',
    };
    const coverage = { coverageLines: [6], covers: 'Calling main validates both registry wrappers.' };
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const [startupReview] = profile.reviewedTests;
    profile.reviewedTests.push({
      testBinding: independentBinding,
      sources: startupReview.sources,
      links: startupReview.links.map(link => ({ ...link, ...coverage })),
    });
    write(independentPath, independentSource);
    writeFileSync(profilePath, JSON.stringify(profile));

    const independentLink = { ...independentBinding, ...coverage };
    const withIndependentLink = claims => claims.map(claim => ({
      ...claim,
      evidence: claim.evidence.map(site => site.kind === kind
        ? { ...site, testBindings: [...(site.testBindings ?? []), independentLink] }
        : site),
    }));
    const bothLinked = withIndependentLink(linked);
    refresh();
    expectClaims(bothLinked, 'after linking both startup tests');

    const tests = {
      first: { ...test, linkedClaims: linked },
      second: {
        path: independentPath,
        source: independentSource,
        editedSource: independentSource.replace('main()', 'self.fail("edited preflight test")'),
        linkedClaims: withIndependentLink(original),
      },
    };
    return { write, refresh, expectClaims, original, bothLinked, tests };
  }

  it.each([
    { edited: 'first', untouched: 'second' },
    { edited: 'second', untouched: 'first' },
  ])('keeps the untouched startup test links when the $edited pinned test changes', ({ edited, untouched }) => {
    const { write, refresh, expectClaims, bothLinked, tests } = twoPinnedStartupTestsFixture();
    const { path, source, editedSource } = tests[edited];
    write(path, editedSource);
    refresh();
    expectClaims(tests[untouched].linkedClaims, `after editing only the ${edited} startup test`);

    write(path, source);
    refresh();
    expectClaims(bothLinked, `after restoring the ${edited} startup test`);
  });

  it('restores startup test links in order after editing both pinned tests', () => {
    const { write, refresh, expectClaims, original, bothLinked, tests: { first, second } } =
      twoPinnedStartupTestsFixture();

    write(first.path, first.editedSource);
    write(second.path, second.editedSource);
    refresh();
    expectClaims(original, 'after editing both startup tests');

    write(first.path, first.source);
    refresh();
    expectClaims(first.linkedClaims, 'after restoring only the first startup test');

    write(second.path, second.source);
    refresh();
    expectClaims(bothLinked, 'after restoring both startup tests');
  });

  it('binds Postgres audit reads and writes through Psycopg transactions', () => {
    const filePath = 'audit/web_adapters.py';
    const base = auditRecordSource + `
class StorageAdapter:
    pass

class StorageActionRecord:
    action_id: str
`;
    const source = `from .base import RoutingAdapter, RoutingEventRecord, StorageAdapter, StorageActionRecord

def store(database_url, action):
    import psycopg
    with psycopg.connect(database_url) as conn:
        conn.execute(
            "INSERT INTO storage_actions (action_id, payload_json) VALUES (%s, %s) "
            "ON CONFLICT (action_id) DO UPDATE SET payload_json = EXCLUDED.payload_json",
            (action.action_id, '{}'),
        )

class WebStorageAdapter(StorageAdapter):
    def log_storage_action(self, action: StorageActionRecord):
        store(self.database_url, action)

class WebRoutingAdapter(RoutingAdapter):
    def log_storage_action(self, action: StorageActionRecord):
        store(self.database_url, action)

    def log_routing_event(self, event: RoutingEventRecord):
        import psycopg
        with psycopg.connect(self.database_url) as conn:
            conn.execute("INSERT INTO routing_events (event_id) VALUES (%s)", (event.event_id,))

    def get_routing_events(self) -> list[RoutingEventRecord]:
        import psycopg
        query = "SELECT event_id FROM routing_events WHERE 1=1"
        query += " ORDER BY event_id ASC"
        with psycopg.connect(self.database_url) as conn:
            rows = conn.execute(query, []).fetchall()
        results = []
        for row in rows:
            results.append(RoutingEventRecord(event_id=row[0]))
        return results

class WrongIdentityAdapter(RoutingAdapter):
    def log_routing_event(self, event: RoutingEventRecord):
        import psycopg
        with psycopg.connect(self.database_url) as conn:
            conn.execute("INSERT INTO routing_events (event_id) VALUES (%s)", (event.route_id,))

class WrongDatabaseAdapter(StorageAdapter):
    def log_storage_action(self, action: StorageActionRecord):
        store("unrelated", action)
`;
    const storage = classNode(auditBase, 'StorageActionRecord');
    const event = classNode(auditBase, 'RoutingEventRecord');
    const [webStorage, webRouting, wrongIdentity, wrongDatabase] = [
      'WebStorageAdapter', 'WebRoutingAdapter', 'WrongIdentityAdapter', 'WrongDatabaseAdapter',
    ].map(name => classNode(filePath, name));
    const f = fixture({ extraFiles: { [auditBase]: base, [filePath]: source },
      extraNodes: [storage, event, webStorage, webRouting, wrongIdentity, wrongDatabase] });
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.observes).toEqual({ candidates: 5, supported: 3, withheld: 2 });
    const claim = (subject, object) => report.claims.find(row =>
      row.predicate === 'observes' && row.subject === subject.id && row.object === object.id);
    for (const adapter of [webStorage, webRouting]) {
      expect(claim(adapter, storage)).toMatchObject({
        admission: 'supported',
        evidence: [{ kind: 'postgres_audit_write', table: 'storage_actions', identityColumn: 'action_id',
          filePath, sha256: sha256(source), dispatchLine: expect.any(Number), helperLine: expect.any(Number),
          transactionLine: expect.any(Number), recordBinding: { filePath: auditBase, sha256: sha256(base) } }],
      });
    }
    expect(claim(webRouting, event)).toMatchObject({
      admission: 'supported',
      evidence: [
        { kind: 'postgres_audit_write', table: 'routing_events', identityColumn: 'event_id' },
        { kind: 'postgres_audit_read', table: 'routing_events', identityColumn: 'event_id',
          recordConstructionLine: expect.any(Number) },
      ],
    });
    for (const withheld of [claim(wrongIdentity, event), claim(wrongDatabase, storage)]) {
      expect(withheld).toMatchObject({ admission: 'withheld', reason: 'unverified_audit_binding', evidence: [] });
    }
  });

  it('fails closed on ambiguous schema keys and changed evidence files', () => {
    const f = fixture();
    f.write('schemas/alpha.copy.schema.json', schema);
    f.write('records/c.json', '{"changed":true}');
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.constrains.supported).toBe(1);
    expect(report.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ schemaKey: 'alpha', reason: 'ambiguous_schema_key' }),
      expect.objectContaining({ recordPath: 'records/c.json', reason: 'record_stale_fingerprint' }),
    ]));
  });

  it('requires the real validator and a direct read of the record', () => {
    const cases = [
      header + 'Draft202012Validator = custom_validator\n' + direct,
      header + direct.replace('Draft202012Validator(schema).validate(record)', 'Draft202012Validator.check_schema(schema)'),
      header + direct.replace('Draft202012Validator(schema).validate(record)', 'record["derived"] = 1\nDraft202012Validator(schema).validate(record)'),
      header + table.replace('for key, record_path', "validators['alpha'] = another_validator\nfor key, record_path"),
    ];
    for (const source of cases) {
      const f = fixture({ source });
      f.enable();
      f.refresh();
      expect(f.report().counts.constrains).toEqual({ candidates: 2, supported: 0, withheld: 2 });
    }
  });

  it.each([
    ['named path option and text read', cliText, '--model', []],
    ['positional default and guarded strict byte read', cliBytes, 'model', ['if enabled:']],
  ])('binds a CLI default through the record argument for %s', (_label, source, argument, guards) => {
    const line = text => source.split('\n').findIndex(row => row.includes(text)) + 1;
    const f = fixture({ source });
    f.enable();
    f.refresh();
    const report = f.report();
    expect(report.counts.constrains).toEqual({ candidates: 2, supported: 1, withheld: 1 });
    const [claim] = report.claims.filter(row => row.predicate === 'constrains' && row.admission === 'supported');
    expect(claim).toMatchObject({ subject: 'schema:schemas/gamma.schema.json', object: 'config:records/c.json',
      evidence: [{ kind: 'python_cli_default', argument, argumentLine: line(`add_argument('${argument}'`),
        recordReadLine: line('args.model.read_'), dispatchLine: line('return check('),
        line: line('.iter_errors(model)'), guardLines: guards.map(line) }] });
  });

  it('withholds CLI claims when the default, record, or validator call is unproven', () => {
    const cases = [
      cliText.replace('args = parser.parse_args()', "parser.set_defaults(model=root/'records/a.json')\n    args = parser.parse_args()"),
      cliText.replace("default=root/'records/c.json')", "default=root/'records/c.json', help=register(parser))"),
      cliText.replace('args = parser.parse_args()', 'args = parser.parse_args()\n    args.model = args.registry'),
      cliText.replace('def check(model, registry, schema_root=root):', 'def check(model, registry, schema_root=root):\n    model.clear()'),
      cliText.replace('return list(Draft202012Validator(schema).iter_errors(model))', 'return Draft202012Validator(schema).iter_errors(model)'),
      cliBytes.replace('result[key] = value', 'result[key] = None'),
    ];
    for (const source of cases) {
      const f = fixture({ source });
      f.enable();
      f.refresh();
      expect(f.report().counts.constrains).toEqual({ candidates: 2, supported: 0, withheld: 2 });
    }
  });

  it('refines a saved candidate to array items using the wrapper identity and resolved reference', () => {
    const schemaPath = 'bundle/route.schema.v1.json';
    const recordPath = 'bundle/routes.v1.json';
    const wrapperPath = 'bundle/route_registry.schema.v1.json';
    const schemaId = 'https://example.test/contracts/route.schema.v1.json';
    const subject = `schema:${schemaPath}`;
    const object = `config:${recordPath}`;
    const itemSchema = { ...JSON.parse(schema), $id: schemaId };
    const record = { schema_id: 'route_registry.v1', routes: [{ id: 'R-001' }] };
    const wrapper = {
      ...JSON.parse(schema), $id: 'https://example.test/contracts/route_registry.schema.v1.json',
      required: ['schema_id', 'routes'], properties: {
        schema_id: { const: record.schema_id },
        routes: { type: 'array', items: { $ref: 'route.schema.v1.json' } },
      },
    };
    const f = fixture({ source: '',
      extraFiles: { [schemaPath]: JSON.stringify(itemSchema), [recordPath]: JSON.stringify(record) },
      extraEdges: [['defines_schema', subject, object]],
    });
    const findClaim = () => f.report().claims.filter(claim => claim.subject === subject && claim.object === object);
    const baseline = readFileSync(f.fingerprintPath);
    f.enable();
    f.refresh();
    const [unscoped] = findClaim();
    expect(unscoped.admission).toBe('withheld');

    f.write(wrapperPath, wrapper);
    f.refresh();
    expect(findClaim()).toEqual([expect.objectContaining({
      id: expect.not.stringMatching(unscoped.id), refines: unscoped.id, admission: 'supported',
      objectScope: { kind: 'array_items', pointer: '/routes' },
      evidence: [expect.objectContaining({ kind: 'json_schema_items_ref', filePath: wrapperPath,
        pointer: '/properties/routes/items/$ref', sha256: sha256(JSON.stringify(wrapper)),
        schemaSha256: sha256(JSON.stringify(itemSchema)), recordSha256: sha256(JSON.stringify(record)) })],
    })]);
    expect(readFileSync(f.fingerprintPath)).toEqual(baseline);

    const variants = [
      { ...wrapper, $id: 'https://example.test/other/route_registry.schema.v1.json' },
      { ...wrapper, properties: { ...wrapper.properties, schema_id: { const: 'other.v1' } } },
      { ...wrapper, properties: { ...wrapper.properties, routes: { ...wrapper.properties.routes, prefixItems: [{}] } } },
    ];
    for (const variant of variants) {
      f.write(wrapperPath, variant);
      f.refresh();
      expect(findClaim()).toEqual([unscoped]);
    }
  });

  it('refreshes after an incremental save and skips generated-only changes', () => {
    const f = fixture();
    f.enable();
    const write = (name, value) => f.write(`.ua/intermediate/${name}`, value);
    const plan = { action: 'SKIP', baseCommit: 'base', headCommit: 'next', generatedArtifactFiles: [],
      filesToReanalyze: [], deletedFiles: [], cosmeticFiles: ['src/a.mjs'], ignoredFiles: [] };
    write('incremental-plan.json', plan);
    write('fingerprint-patch.json', { baseCommit: 'base', headCommit: 'next', files: {} });
    expect(ok(finalizer, f.root)).toContain('AgentOS grammar:');
    const report = f.report();
    expect(report.provenance).toMatchObject({ gitCommitHash: 'next', graphSha256: sha256(readFileSync(f.graphPath)) });
    expect(report.counts.constrains.supported).toBe(3);

    write('incremental-plan.json', { ...plan, generatedArtifactFiles: ['.ua/semantic-claims.json'], cosmeticFiles: [] });
    expect(ok(finalizer, f.root)).toContain('analysis baseline unchanged');
    expect(f.report()).toEqual(report);
  });
});

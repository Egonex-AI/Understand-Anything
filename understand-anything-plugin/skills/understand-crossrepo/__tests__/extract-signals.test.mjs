/**
 * TDD test for extract-crossrepo-signals.mjs
 * Uses node:test + node:assert (stdlib only, no vitest/jest).
 * Gate: node --test skills/understand-crossrepo/__tests__/extract-signals.test.mjs
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'extract-crossrepo-signals.mjs');

// Track temp dirs for cleanup
const tempDirs = [];

after(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

/** Build a fixture repo and run the extractor. Returns parsed JSON output. */
function runExtractor(files, namespace = 'test_service') {
  const repoDir = mkdtempSync(join(tmpdir(), 'ua-crossrepo-test-'));
  tempDirs.push(repoDir);

  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(repoDir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }

  const outDir = mkdtempSync(join(tmpdir(), 'ua-crossrepo-out-'));
  tempDirs.push(outDir);
  const outPath = join(outDir, 'signals.json');

  const result = spawnSync('node', [SCRIPT, repoDir, namespace, outPath], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(`Extractor exited ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }

  return JSON.parse(readFileSync(outPath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Fixture: a fake pricing service repo
// ---------------------------------------------------------------------------
const FIXTURE_FILES = {
  // Env file with outbound API signal
  '.env': [
    'BRIDGE_API_URL=https://bridge.example/api',
    'DB_HOST=my-db.internal',
    'SOME_VAR=not_a_url',
  ].join('\n'),

  // Keycloak / auth config
  'config/keycloak.json': JSON.stringify({
    realm: 'savo',
    'auth-server-url': 'https://auth.example/auth',
    'ssl-required': 'external',
    resource: 'savo_pricing',
    'public-client': true,
  }),

  // Python route file with FastAPI decorator
  'routes/pricing.py': [
    'from fastapi import APIRouter',
    'router = APIRouter(prefix="/api/pricing")',
    '',
    '@router.get("/items")',
    'async def list_items():',
    '    pass',
    '',
    '@router.post("/submit")',
    'async def submit_price():',
    '    pass',
  ].join('\n'),

  // pyproject.toml for service name
  'pyproject.toml': [
    '[tool.poetry]',
    'name = "savo-pricing-service"',
  ].join('\n'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('output has required top-level fields', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.ok(typeof out.repo === 'string', 'repo field missing');
  assert.ok(typeof out.namespace === 'string', 'namespace field missing');
  assert.ok(typeof out.identity === 'object', 'identity field missing');
  assert.ok(Array.isArray(out.outbound), 'outbound must be array');
});

test('namespace is echoed verbatim', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.equal(out.namespace, 'savo_pricing_service');
});

test('repo is the basename of repoPath', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  // The temp dir basename starts with "ua-crossrepo-test-" — we just check it's a non-empty string
  assert.ok(out.repo.length > 0, 'repo should be non-empty basename');
});

test('BRIDGE_API_URL env var produces outbound api signal', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  const apiSignals = out.outbound.filter(s => s.kind === 'api');
  assert.ok(apiSignals.length > 0, 'expected at least one outbound api signal');

  // Find the BRIDGE signal specifically
  const bridgeSignal = apiSignals.find(s => s.value.includes('BRIDGE_API_URL'));
  assert.ok(bridgeSignal, `no BRIDGE_API_URL signal — got: ${JSON.stringify(apiSignals)}`);

  // evidence must be file:line (relative path, no leading slash)
  assert.match(bridgeSignal.evidence, /^[^/][^:]*:\d+$/, 'evidence must be relpath:line');
  assert.ok(bridgeSignal.evidence.includes('.env'), 'evidence must reference .env');
});

test('Keycloak config produces outbound auth signal', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  const authSignals = out.outbound.filter(s => s.kind === 'auth');
  assert.ok(authSignals.length > 0, `no auth signals — outbound: ${JSON.stringify(out.outbound)}`);

  const kc = authSignals.find(s => s.value.includes('savo'));
  assert.ok(kc, `no keycloak realm signal — got: ${JSON.stringify(authSignals)}`);
});

test('identity.serviceName extracted from pyproject.toml', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.ok(
    out.identity.serviceName && out.identity.serviceName.length > 0,
    'serviceName must be non-empty',
  );
  // Should come from pyproject.toml name field
  assert.ok(
    out.identity.serviceName.includes('pricing') || out.identity.serviceName.includes('savo'),
    `unexpected serviceName: ${out.identity.serviceName}`,
  );
});

test('identity.keycloakClientId extracted from keycloak.json', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  // keycloak.json has resource = "savo_pricing"
  assert.equal(out.identity.keycloakClientId, 'savo_pricing');
});

test('identity.endpoints contains FastAPI route paths', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.ok(Array.isArray(out.identity.endpoints), 'endpoints must be array');
  assert.ok(out.identity.endpoints.length > 0, 'expected at least one endpoint');
  // Should find /items or /submit (possibly with prefix)
  const found = out.identity.endpoints.some(e => e.includes('/items') || e.includes('/submit'));
  assert.ok(found, `no expected endpoint — got: ${JSON.stringify(out.identity.endpoints)}`);
});

test('evidence paths are relative (no leading slash)', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  for (const sig of out.outbound) {
    assert.ok(!sig.evidence.startsWith('/'), `evidence is absolute: ${sig.evidence}`);
  }
});

test('outbound is sorted (stable)', () => {
  const out1 = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  const out2 = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.deepEqual(out1.outbound, out2.outbound, 'outbound must be deterministically ordered');
});

test('identity arrays are sorted (stable)', () => {
  const out1 = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  const out2 = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.deepEqual(out1.identity.endpoints, out2.identity.endpoints);
  assert.deepEqual(out1.identity.servedHosts, out2.identity.servedHosts);
});

test('identity has required array fields', () => {
  const out = runExtractor(FIXTURE_FILES, 'savo_pricing_service');
  assert.ok(Array.isArray(out.identity.servedHosts), 'servedHosts must be array');
  assert.ok(Array.isArray(out.identity.endpoints), 'endpoints must be array');
  assert.ok(Array.isArray(out.identity.ownedTopics), 'ownedTopics must be array');
  assert.ok(Array.isArray(out.identity.ownedBuckets), 'ownedBuckets must be array');
});

test('node_modules and .git are skipped', () => {
  const files = {
    ...FIXTURE_FILES,
    'node_modules/some-pkg/index.js': 'const FOO_URL = "https://should-not-appear.example";',
    '.git/config': 'KEYCLOAK_CLIENT_ID=should-not-appear',
  };
  const out = runExtractor(files, 'savo_pricing_service');
  const allEvidence = out.outbound.map(s => s.evidence);
  assert.ok(
    !allEvidence.some(e => e.startsWith('node_modules')),
    'node_modules must be skipped',
  );
  assert.ok(
    !allEvidence.some(e => e.startsWith('.git')),
    '.git must be skipped',
  );
});

// Fix 1: .env URL must produce exactly ONE api outbound entry (no bare-host duplicate)
test('Fix 1: .env URL produces exactly one api outbound entry — no bare-host duplicate', () => {
  const files = {
    '.env': 'BRIDGE_API_URL=https://bridge.example/api\n',
    'pyproject.toml': '[tool.poetry]\nname = "svc"\n',
  };
  const out = runExtractor(files, 'test_svc');
  const apiSignals = out.outbound.filter(s => s.kind === 'api' && s.value.includes('bridge.example'));
  assert.equal(
    apiSignals.length,
    1,
    `expected exactly 1 api signal for bridge.example, got ${apiSignals.length}: ${JSON.stringify(apiSignals)}`,
  );
  // The single entry must be the structured KEY=value form from scanEnvConfig
  assert.ok(
    apiSignals[0].value.includes('BRIDGE_API_URL='),
    `expected KEY=value form, got: ${apiSignals[0].value}`,
  );
});

// Fix 2: values*.yaml bucket/topic signals are captured
test('Fix 2: values-staging.yaml BUCKET and TOPIC keys produce identity and outbound signals', () => {
  const files = {
    ...FIXTURE_FILES,
    'helm/values-staging.yaml': [
      'replicaCount: 2',
      'MEDIA_BUCKET: savo-media-staging',
      'EVENTS_TOPIC: savo-events-staging',
      'ingress:',
      '  host: staging.example.com',
    ].join('\n'),
  };
  const out = runExtractor(files, 'savo_pricing_service');

  // ownedBuckets should include the bucket value
  assert.ok(
    out.identity.ownedBuckets.includes('savo-media-staging'),
    `ownedBuckets missing savo-media-staging: ${JSON.stringify(out.identity.ownedBuckets)}`,
  );

  // ownedTopics should include the topic value
  assert.ok(
    out.identity.ownedTopics.includes('savo-events-staging'),
    `ownedTopics missing savo-events-staging: ${JSON.stringify(out.identity.ownedTopics)}`,
  );

  // outbound should have bucket and pubsub entries with evidence pointing to the yaml file
  const bucketSig = out.outbound.find(s => s.kind === 'bucket' && s.value.includes('savo-media-staging'));
  assert.ok(bucketSig, `no bucket outbound for savo-media-staging: ${JSON.stringify(out.outbound)}`);
  assert.ok(bucketSig.evidence.includes('values-staging.yaml'), `bucket evidence must reference values-staging.yaml: ${bucketSig.evidence}`);

  const pubsubSig = out.outbound.find(s => s.kind === 'pubsub' && s.value.includes('savo-events-staging'));
  assert.ok(pubsubSig, `no pubsub outbound for savo-events-staging: ${JSON.stringify(out.outbound)}`);
  assert.ok(pubsubSig.evidence.includes('values-staging.yaml'), `pubsub evidence must reference values-staging.yaml: ${pubsubSig.evidence}`);
});

// Fix 2b: K8s two-line env form (- name: / value:) in values YAML
test('Fix 2b: K8s two-line name/value form in values YAML produces topic and bucket signals', () => {
  const files = {
    ...FIXTURE_FILES,
    'helm/values-k8s.yaml': [
      'env:',
      '  - name: ORDER_TOPIC',
      '    value: orders-topic',
      '  - name: ARCHIVE_BUCKET',
      '    value: gs://archive-bucket',
    ].join('\n'),
  };
  const out = runExtractor(files, 'savo_pricing_service');

  // ownedTopics and ownedBuckets
  assert.ok(
    out.identity.ownedTopics.includes('orders-topic'),
    `ownedTopics missing orders-topic: ${JSON.stringify(out.identity.ownedTopics)}`,
  );
  assert.ok(
    out.identity.ownedBuckets.some(b => b === 'gs://archive-bucket' || b === 'archive-bucket'),
    `ownedBuckets missing archive-bucket: ${JSON.stringify(out.identity.ownedBuckets)}`,
  );

  // outbound pubsub + bucket with evidence pointing at the yaml file
  const topicSig = out.outbound.find(s => s.kind === 'pubsub' && s.value.includes('orders-topic'));
  assert.ok(topicSig, `no pubsub outbound for orders-topic: ${JSON.stringify(out.outbound)}`);
  assert.ok(topicSig.evidence.includes('values-k8s.yaml'), `topic evidence must reference values-k8s.yaml: ${topicSig.evidence}`);

  const bucketSig = out.outbound.find(s => s.kind === 'bucket' && s.value.includes('archive-bucket'));
  assert.ok(bucketSig, `no bucket outbound for archive-bucket: ${JSON.stringify(out.outbound)}`);
  assert.ok(bucketSig.evidence.includes('values-k8s.yaml'), `bucket evidence must reference values-k8s.yaml: ${bucketSig.evidence}`);
});

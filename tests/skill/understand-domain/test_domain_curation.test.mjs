import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const script = join(repoRoot, 'understand-anything-plugin', 'skills', 'understand-domain', 'domain-curation.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ua-domain-curation-'));
  roots.push(root);
  const ua = join(root, '.ua');
  mkdirSync(ua);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'checkout.ts'), Array.from({ length: 20 }, (_, i) => `// line ${i + 1}`).join('\n'));
  return { root, ua };
}

function run(ua, ...args) {
  const r = spawnSync(process.execPath, [script, ...args, '--dir', ua], { encoding: 'utf-8' });
  return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

const read = (ua, name) => JSON.parse(readFileSync(join(ua, name), 'utf-8'));
const write = (ua, name, obj) => writeFileSync(join(ua, name), JSON.stringify(obj, null, 2));
const ids = (g) => new Set(g.nodes.map((n) => n.id));

// Minimal domain graph as produced by /understand-domain.
function generated() {
  return {
    version: '1.0.0',
    project: { name: 'demo', gitCommitHash: 'abc' },
    nodes: [
      {
        id: 'domain:checkout',
        type: 'domain',
        name: 'Checkout',
        summary: 'Paying for orders',
        tags: ['checkout'],
        complexity: 'moderate',
        domainMeta: { businessRules: ['Generic rule', 'Wrong rule'], entities: ['Order'] },
      },
      { id: 'flow:pay', type: 'flow', name: 'Pay order', summary: 'Pay', tags: [], complexity: 'simple', domainMeta: { entryPoint: 'GET /checkout' } },
      { id: 'step:pay:open', type: 'step', name: 'Open checkout', summary: 'Opens', tags: [], complexity: 'simple', filePath: 'src/checkout.ts', lineRange: [1, 5] },
      { id: 'step:pay:verify', type: 'step', name: 'Verify history', summary: 'Wrong step', tags: [], complexity: 'simple', filePath: 'src/checkout.ts', lineRange: [6, 8] },
    ],
    edges: [
      { source: 'domain:checkout', target: 'flow:pay', type: 'contains_flow', direction: 'forward', weight: 1 },
      { source: 'flow:pay', target: 'step:pay:open', type: 'flow_step', direction: 'forward', weight: 0.5 },
      { source: 'flow:pay', target: 'step:pay:verify', type: 'flow_step', direction: 'forward', weight: 1 },
    ],
  };
}

// First run: store baseline, then make a deep-dive edit and capture it.
function curate(ua) {
  write(ua, 'domain-graph.json', generated());
  expect(run(ua, 'apply').status).toBe(0);

  const g = read(ua, 'domain-graph.json');
  const domain = g.nodes.find((n) => n.id === 'domain:checkout');
  domain.domainMeta.businessRules = ['Generic rule', 'Balance must cover price'];
  domain.domainMeta.knownIssues = ['First() throws on empty list'];
  // Replace the wrong step, add a deep-dive flow.
  g.nodes = g.nodes.filter((n) => n.id !== 'step:pay:verify');
  g.edges = g.edges.filter((e) => e.target !== 'step:pay:verify');
  g.nodes.push(
    { id: 'step:pay:check-wallet', type: 'step', name: 'Check wallet active', summary: 'Real gate', tags: [], complexity: 'simple', filePath: 'src/checkout.ts', lineRange: [6, 9] },
    { id: 'flow:unlock', type: 'flow', name: 'Unlock wallet', summary: 'Criteria', tags: [], complexity: 'moderate', domainMeta: { entryPoint: 'GET /dashboard' } },
    { id: 'step:unlock:criteria', type: 'step', name: 'Five criteria', summary: 'Checklist', tags: [], complexity: 'simple', filePath: 'src/checkout.ts', lineRange: [10, 12] },
  );
  g.edges.push(
    { source: 'flow:pay', target: 'step:pay:check-wallet', type: 'flow_step', direction: 'forward', weight: 1 },
    { source: 'domain:checkout', target: 'flow:unlock', type: 'contains_flow', direction: 'forward', weight: 1 },
    { source: 'flow:unlock', target: 'step:unlock:criteria', type: 'flow_step', direction: 'forward', weight: 1 },
  );
  write(ua, 'domain-graph.json', g);
  const cap = run(ua, 'capture', '--note', 'deep dive');
  expect(cap.status).toBe(0);
  return cap.out;
}

describe('domain-curation.mjs', () => {
  it('first apply stores the baseline and leaves a fresh graph unchanged', () => {
    const { ua } = project();
    write(ua, 'domain-graph.json', generated());
    const r = run(ua, 'apply');
    expect(r.status).toBe(0);
    expect(read(ua, 'domain-graph.generated.json')).toEqual(generated());
    expect(read(ua, 'domain-graph.json').nodes).toEqual(generated().nodes);
  });

  it('capture records additions, changes and deletions against the baseline', () => {
    const { ua } = project();
    const out = curate(ua);
    expect(out.nodesAdded).toBe(3);
    expect(out.nodesChanged).toBe(1);
    expect(out.nodesRemoved).toBe(1);
    const curated = read(ua, 'domain-curated.json');
    expect(curated.removedNodes).toEqual(['step:pay:verify']);
    expect(curated.log.at(-1).note).toBe('deep dive');
    // Curated flows own their full step list, including unchanged steps.
    expect(Object.keys(curated.nodes)).toContain('step:pay:open');
  });

  it('re-applies curated analysis after a regenerate that would otherwise wipe it', () => {
    const { ua } = project();
    curate(ua);
    // Simulate /understand-domain overwriting the file with fresh output.
    write(ua, 'domain-graph.json', generated());
    const r = run(ua, 'apply');
    expect(r.status).toBe(0);

    const g = read(ua, 'domain-graph.json');
    const all = ids(g);
    expect(all.has('flow:unlock')).toBe(true);
    expect(all.has('step:pay:check-wallet')).toBe(true);
    expect(all.has('step:pay:verify')).toBe(false);
    const rules = g.nodes.find((n) => n.id === 'domain:checkout').domainMeta;
    expect(rules.businessRules).toEqual(['Generic rule', 'Balance must cover price']);
    expect(rules.knownIssues).toEqual(['First() throws on empty list']);
    expect(g.edges.every((e) => all.has(e.source) && all.has(e.target))).toBe(true);
    expect(g.nodes.find((n) => n.id === 'flow:unlock').tags).toContain('curated');
  });

  it('keeps new regenerated content and flags likely duplicates', () => {
    const { ua } = project();
    curate(ua);
    const fresh = generated();
    fresh.nodes[0].domainMeta.businessRules.push('Rule found by new regenerate');
    fresh.nodes.push(
      { id: 'flow:refund', type: 'flow', name: 'Refund order', summary: 'New', tags: [], complexity: 'simple', domainMeta: { entryPoint: 'GET /refund' } },
      { id: 'flow:unlock-v2', type: 'flow', name: 'Unlock wallet', summary: 'Same flow, new id', tags: [], complexity: 'simple', domainMeta: { entryPoint: 'GET /dashboard' } },
    );
    fresh.edges.push(
      { source: 'domain:checkout', target: 'flow:refund', type: 'contains_flow', direction: 'forward', weight: 1 },
      { source: 'domain:checkout', target: 'flow:unlock-v2', type: 'contains_flow', direction: 'forward', weight: 1 },
    );
    write(ua, 'domain-graph.json', fresh);
    const r = run(ua, 'apply');
    expect(r.status).toBe(0);

    const g = read(ua, 'domain-graph.json');
    expect(ids(g).has('flow:refund')).toBe(true);
    const rules = g.nodes.find((n) => n.id === 'domain:checkout').domainMeta.businessRules;
    expect(rules).toContain('Rule found by new regenerate');
    expect(rules).not.toContain('Wrong rule');
    expect(r.out.possibleDuplicates.some((d) => d.startsWith('flow:unlock-v2 ~ flow:unlock'))).toBe(true);
  });

  it('tags curated steps whose code location went stale instead of dropping them', () => {
    const { root, ua } = project();
    curate(ua);
    writeFileSync(join(root, 'src', 'checkout.ts'), '// shrunk\n');
    write(ua, 'domain-graph.json', generated());
    const r = run(ua, 'apply');
    expect(r.status).toBe(0);
    expect(r.out.needsReview.some((x) => x.startsWith('step:unlock:criteria'))).toBe(true);
    const step = read(ua, 'domain-graph.json').nodes.find((n) => n.id === 'step:unlock:criteria');
    expect(step.tags).toContain('needs-review');
  });

  it('refuses to apply twice on an already merged graph', () => {
    const { ua } = project();
    curate(ua);
    const r = run(ua, 'apply');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/already contains curated nodes/);
    expect(existsSync(join(ua, 'domain-graph.before-apply.json'))).toBe(true);
  });

  it('capture without a baseline explains what to do', () => {
    const { ua } = project();
    write(ua, 'domain-graph.json', generated());
    const r = run(ua, 'capture');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/No baseline/);
  });
});

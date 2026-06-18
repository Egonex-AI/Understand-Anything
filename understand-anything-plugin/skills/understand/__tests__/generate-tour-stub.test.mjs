import { describe, it, expect } from 'vitest';
import { generateTour } from '../generate-tour-stub.mjs';

function fileNode(id, filePath, type = 'file', extra = {}) {
  return { id, type, name: filePath.split('/').pop(), filePath, summary: 's', ...extra };
}

function layer(id, name, description, nodeIds) {
  return { id, name, description, nodeIds };
}

describe('generateTour', () => {
  it('returns an empty tour for an empty graph', () => {
    expect(generateTour({ nodes: [] }, [])).toEqual([]);
  });

  it('tolerates malformed input', () => {
    expect(generateTour(null, null)).toEqual([]);
    expect(generateTour({}, [])).toEqual([]);
    expect(generateTour({ nodes: null }, null)).toEqual([]);
  });

  it('step 1: README at root is the first step', () => {
    const tour = generateTour(
      { nodes: [fileNode('document:README.md', 'README.md', 'document')] },
      [],
    );
    expect(tour[0]).toMatchObject({
      order: 1,
      title: 'Project Overview',
      nodeIds: ['document:README.md'],
    });
  });

  it('step 2: entry point is added when provided and resolvable', () => {
    const tour = generateTour(
      { nodes: [fileNode('file:src/index.ts', 'src/index.ts')] },
      [],
      'src/index.ts',
    );
    expect(tour[0]).toMatchObject({ title: 'Application Entry Point' });
    expect(tour[0].description).toContain('src/index.ts');
    expect(tour[0].nodeIds).toEqual(['file:src/index.ts']);
  });

  it('entry point is skipped silently when not found in graph', () => {
    const tour = generateTour(
      { nodes: [fileNode('file:src/other.ts', 'src/other.ts')] },
      [],
      'src/index.ts',
    );
    expect(tour.every((s) => s.title !== 'Application Entry Point')).toBe(true);
  });

  it('step 3: priority configs picked over arbitrary configs', () => {
    const tour = generateTour(
      {
        nodes: [
          fileNode('config:package.json', 'package.json', 'config'),
          fileNode('config:some.toml', 'some.toml', 'config'),
        ],
      },
      [layer('layer:config', 'Configuration', 'd', ['config:some.toml', 'config:package.json'])],
    );
    const cfgStep = tour.find((s) => s.title === 'Project Configuration');
    expect(cfgStep).toBeDefined();
    expect(cfgStep.nodeIds).toEqual(['config:package.json']);
  });

  it('config step falls back to first nodeId when no priority config matches', () => {
    const tour = generateTour(
      { nodes: [fileNode('config:weird.ini', 'weird.ini', 'config')] },
      [layer('layer:config', 'Configuration', 'd', ['config:weird.ini'])],
    );
    const cfgStep = tour.find((s) => s.title === 'Project Configuration');
    expect(cfgStep.nodeIds).toEqual(['config:weird.ini']);
  });

  it('logic-layer step prefers API over services over core', () => {
    const layers = [
      layer('layer:api', 'API & Routes', 'd', ['file:a.ts']),
      layer('layer:services', 'Business Logic', 'd', ['file:s.ts']),
      layer('layer:core', 'Core', 'd', ['file:c.ts']),
    ];
    const tour = generateTour(
      { nodes: [fileNode('file:a.ts', 'a.ts'), fileNode('file:s.ts', 's.ts'), fileNode('file:c.ts', 'c.ts')] },
      layers,
    );
    const logicStep = tour.find((s) => s.title === 'API & Routes');
    expect(logicStep).toBeDefined();
    expect(logicStep.nodeIds).toEqual(['file:a.ts']);
  });

  it('logic-layer step falls back to services when no API layer', () => {
    const layers = [
      layer('layer:services', 'Business Logic', 'd', ['file:s.ts']),
      layer('layer:core', 'Core', 'd', ['file:c.ts']),
    ];
    const tour = generateTour({ nodes: [fileNode('file:s.ts', 's.ts')] }, layers);
    expect(tour.find((s) => s.title === 'Business Logic')).toBeDefined();
  });

  it('builds the canonical 7-step tour from a full set of layers', () => {
    const layers = [
      layer('layer:api', 'API & Routes', 'd', ['file:api.ts']),
      layer('layer:data', 'Data & Models', 'd', ['file:model.ts']),
      layer('layer:infra', 'Infrastructure & CI/CD', 'd', ['service:Dockerfile']),
      layer('layer:testing', 'Testing', 'd', ['file:test.ts']),
      layer('layer:config', 'Configuration', 'd', ['config:package.json']),
    ];
    const graph = {
      nodes: [
        fileNode('document:README.md', 'README.md', 'document'),
        fileNode('file:src/index.ts', 'src/index.ts'),
        fileNode('config:package.json', 'package.json', 'config'),
        fileNode('file:api.ts', 'api.ts'),
        fileNode('file:model.ts', 'model.ts'),
        fileNode('service:Dockerfile', 'Dockerfile', 'service'),
        fileNode('file:test.ts', 'test.ts'),
      ],
    };
    const tour = generateTour(graph, layers, 'src/index.ts');
    expect(tour).toHaveLength(7);
    expect(tour.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(tour.map((s) => s.title)).toEqual([
      'Project Overview',
      'Application Entry Point',
      'Project Configuration',
      'API & Routes',
      'Data & Models',
      'Infrastructure & Deployment',
      'Test Suite',
    ]);
  });

  it('fallback adds remaining layers when fewer than 3 canonical steps', () => {
    // No README, no entry, no config — only a custom layer.
    const layers = [layer('layer:utils', 'Utilities & Helpers', 'Utility files.', ['file:u.ts'])];
    const tour = generateTour({ nodes: [fileNode('file:u.ts', 'u.ts')] }, layers);
    expect(tour.length).toBeGreaterThan(0);
    expect(tour.find((s) => s.title === 'Utilities & Helpers')).toBeDefined();
  });

  it('produces deterministic, sorted nodeIds within each step', () => {
    const nodeIds = ['file:z.ts', 'file:a.ts', 'file:m.ts'];
    const layers = [layer('layer:api', 'API & Routes', 'd', nodeIds)];
    const graph = {
      nodes: nodeIds.map((id) => fileNode(id, id.replace('file:', ''))),
    };
    const tour1 = generateTour(graph, layers);
    const tour2 = generateTour(graph, [layer('layer:api', 'API & Routes', 'd', [...nodeIds].reverse())]);
    const step1 = tour1.find((s) => s.title === 'API & Routes');
    const step2 = tour2.find((s) => s.title === 'API & Routes');
    expect(step1.nodeIds).toEqual(['file:a.ts', 'file:m.ts', 'file:z.ts']);
    expect(step2.nodeIds).toEqual(step1.nodeIds);
  });

  it('every step has order (number), title, description, nodeIds[]', () => {
    const tour = generateTour(
      {
        nodes: [
          fileNode('document:README.md', 'README.md', 'document'),
          fileNode('config:package.json', 'package.json', 'config'),
        ],
      },
      [layer('layer:config', 'Configuration', 'd', ['config:package.json'])],
    );
    for (const s of tour) {
      expect(typeof s.order).toBe('number');
      expect(typeof s.title).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(Array.isArray(s.nodeIds)).toBe(true);
      expect(s.nodeIds.length).toBeGreaterThan(0);
    }
  });

  it('step order is monotonically increasing', () => {
    const layers = [
      layer('layer:api', 'API & Routes', 'd', ['file:a.ts']),
      layer('layer:data', 'Data & Models', 'd', ['file:m.ts']),
    ];
    const tour = generateTour(
      {
        nodes: [
          fileNode('document:README.md', 'README.md', 'document'),
          fileNode('file:a.ts', 'a.ts'),
          fileNode('file:m.ts', 'm.ts'),
        ],
      },
      layers,
    );
    for (let i = 1; i < tour.length; i++) {
      expect(tour[i].order).toBe(tour[i - 1].order + 1);
    }
  });

  it('recognizes readme.md (lowercase) and README.rst variants', () => {
    const lowercase = generateTour(
      { nodes: [fileNode('document:readme.md', 'readme.md', 'document')] },
      [],
    );
    expect(lowercase[0]?.title).toBe('Project Overview');

    const rst = generateTour(
      { nodes: [fileNode('document:README.rst', 'README.rst', 'document')] },
      [],
    );
    expect(rst[0]?.title).toBe('Project Overview');
  });

  it('caps nodeIds per step at the documented limits', () => {
    const manyIds = Array.from({ length: 10 }, (_, i) => `file:n${i}.ts`);
    const layers = [layer('layer:api', 'API & Routes', 'd', manyIds)];
    const tour = generateTour(
      { nodes: manyIds.map((id) => fileNode(id, id.replace('file:', ''))) },
      layers,
    );
    const apiStep = tour.find((s) => s.title === 'API & Routes');
    expect(apiStep.nodeIds.length).toBeLessThanOrEqual(5);
  });

  // Regression: priority-config lookup must pick the root file by actual
  // filePath, not by string-suffix match on the node id. Otherwise a nested
  // `packages/server/package.json` could shadow the root `package.json`
  // depending on lexical ordering of the config layer's nodeIds.
  it('priority config picks root package.json over nested ones', () => {
    const graph = {
      nodes: [
        fileNode('config:packages/server/package.json', 'packages/server/package.json', 'config'),
        fileNode('config:package.json', 'package.json', 'config'),
      ],
    };
    const layers = [
      layer('layer:config', 'Configuration', 'd', [
        'config:packages/server/package.json',
        'config:package.json',
      ]),
    ];
    const tour = generateTour(graph, layers);
    const cfgStep = tour.find((s) => s.title === 'Project Configuration');
    expect(cfgStep).toBeDefined();
    expect(cfgStep.nodeIds).toEqual(['config:package.json']);
  });

  // Regression: if a nested same-named config exists but the root does not,
  // we fall through to the next priority config / first-nodeId rather than
  // matching the nested one (which would mislabel a sub-package as "the"
  // project config).
  it('priority config does not match nested same-named files when root absent', () => {
    const graph = {
      nodes: [
        fileNode('config:packages/server/package.json', 'packages/server/package.json', 'config'),
      ],
    };
    const layers = [
      layer('layer:config', 'Configuration', 'd', ['config:packages/server/package.json']),
    ];
    const tour = generateTour(graph, layers);
    const cfgStep = tour.find((s) => s.title === 'Project Configuration');
    expect(cfgStep).toBeDefined();
    // No root package.json → falls back to first nodeId (the only one).
    expect(cfgStep.nodeIds).toEqual(['config:packages/server/package.json']);
  });
});

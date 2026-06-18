import { describe, it, expect } from 'vitest';
import { assignLayers, LAYER_RULES, FILE_LEVEL_TYPES } from '../assign-layers-simple.mjs';

function fileNode(id, filePath, extra = {}) {
  return { id, type: 'file', name: filePath.split('/').pop(), filePath, summary: 's', ...extra };
}

function layerById(layers, id) {
  return layers.find((l) => l.id === id);
}

describe('assignLayers', () => {
  it('returns an empty array for an empty graph', () => {
    expect(assignLayers({ nodes: [], edges: [] })).toEqual([]);
  });

  it('tolerates malformed input', () => {
    expect(assignLayers(null)).toEqual([]);
    expect(assignLayers({})).toEqual([]);
    expect(assignLayers({ nodes: null })).toEqual([]);
    expect(assignLayers({ nodes: [null, undefined, { type: 'file' }] })).toEqual([]);
  });

  it('routes API directory patterns to layer:api', () => {
    const layers = assignLayers({
      nodes: [
        fileNode('file:src/api/users.ts', 'src/api/users.ts'),
        fileNode('file:src/routes/index.ts', 'src/routes/index.ts'),
        fileNode('file:controllers/auth.ts', 'controllers/auth.ts'),
        fileNode('file:src/pages/api/login.ts', 'src/pages/api/login.ts'),
      ],
    });
    expect(layerById(layers, 'layer:api').nodeIds).toEqual([
      'file:controllers/auth.ts',
      'file:src/api/users.ts',
      'file:src/pages/api/login.ts',
      'file:src/routes/index.ts',
    ]);
  });

  it('keeps src/pages/about.tsx in UI, not API (rule order matters)', () => {
    const layers = assignLayers({
      nodes: [
        fileNode('file:src/pages/about.tsx', 'src/pages/about.tsx'),
        fileNode('file:src/pages/api/login.ts', 'src/pages/api/login.ts'),
      ],
    });
    expect(layerById(layers, 'layer:api').nodeIds).toEqual(['file:src/pages/api/login.ts']);
    expect(layerById(layers, 'layer:ui').nodeIds).toEqual(['file:src/pages/about.tsx']);
  });

  it('routes each layer rule correctly', () => {
    const layers = assignLayers({
      nodes: [
        fileNode('file:src/components/Btn.tsx', 'src/components/Btn.tsx'),
        fileNode('file:src/services/auth.ts', 'src/services/auth.ts'),
        fileNode('file:src/models/User.ts', 'src/models/User.ts'),
        fileNode('file:src/utils/format.ts', 'src/utils/format.ts'),
        fileNode('file:src/middleware/cors.ts', 'src/middleware/cors.ts'),
        fileNode('file:src/__tests__/auth.spec.ts', 'src/__tests__/auth.spec.ts'),
        fileNode('file:.github/workflows/ci.yml', '.github/workflows/ci.yml'),
        fileNode('file:docs/guide.md', 'docs/guide.md'),
      ],
    });
    expect(layerById(layers, 'layer:ui').nodeIds).toEqual(['file:src/components/Btn.tsx']);
    expect(layerById(layers, 'layer:services').nodeIds).toEqual(['file:src/services/auth.ts']);
    expect(layerById(layers, 'layer:data').nodeIds).toEqual(['file:src/models/User.ts']);
    expect(layerById(layers, 'layer:utils').nodeIds).toEqual(['file:src/utils/format.ts']);
    expect(layerById(layers, 'layer:middleware').nodeIds).toEqual(['file:src/middleware/cors.ts']);
    expect(layerById(layers, 'layer:testing').nodeIds).toEqual(['file:src/__tests__/auth.spec.ts']);
    expect(layerById(layers, 'layer:infra').nodeIds).toEqual(['file:.github/workflows/ci.yml']);
    expect(layerById(layers, 'layer:docs').nodeIds).toEqual(['file:docs/guide.md']);
  });

  it('matches config patterns: root config files and dotfiles', () => {
    const layers = assignLayers({
      nodes: [
        fileNode('file:package.json', 'package.json'),
        fileNode('file:tsconfig.json', 'tsconfig.json'),
        fileNode('file:.env.example', '.env.example'),
        fileNode('file:.eslintrc.json', '.eslintrc.json'),
        fileNode('file:.prettierrc', '.prettierrc'),
      ],
    });
    const cfgIds = layerById(layers, 'layer:config').nodeIds;
    expect(cfgIds).toContain('file:package.json');
    expect(cfgIds).toContain('file:tsconfig.json');
    expect(cfgIds).toContain('file:.env.example');
    expect(cfgIds).toContain('file:.eslintrc.json');
    expect(cfgIds).toContain('file:.prettierrc');
  });

  it('routes README at root via the docs README pattern', () => {
    const layers = assignLayers({
      nodes: [fileNode('file:README.md', 'README.md')],
    });
    expect(layerById(layers, 'layer:docs').nodeIds).toEqual(['file:README.md']);
  });

  it('tag-based override: test tag wins over directory', () => {
    const layers = assignLayers({
      nodes: [
        fileNode('file:src/api/handler.spec.ts', 'src/api/handler.spec.ts', { tags: ['test'] }),
      ],
    });
    expect(layerById(layers, 'layer:testing').nodeIds).toEqual(['file:src/api/handler.spec.ts']);
    expect(layerById(layers, 'layer:api')).toBeUndefined();
  });

  it('node-type fallbacks: service/pipeline/resource → infra', () => {
    const layers = assignLayers({
      nodes: [
        { id: 'service:Dockerfile', type: 'service', filePath: 'Dockerfile', name: 'Dockerfile', summary: 's' },
        { id: 'pipeline:.github/workflows/release.yml', type: 'pipeline', filePath: 'weird-path/release.yml', name: 'release.yml', summary: 's' },
        { id: 'resource:terraform-thing', type: 'resource', filePath: 'weird-path/main.tf', name: 'main.tf', summary: 's' },
      ],
    });
    const infra = layerById(layers, 'layer:infra').nodeIds;
    expect(infra).toContain('service:Dockerfile');
    expect(infra).toContain('pipeline:.github/workflows/release.yml');
    expect(infra).toContain('resource:terraform-thing');
  });

  it('node-type fallbacks: document → docs, config → config, table/schema/endpoint → data', () => {
    const layers = assignLayers({
      nodes: [
        { id: 'document:weird/notes.md', type: 'document', filePath: 'weird/notes.md', name: 'notes.md', summary: 's' },
        { id: 'config:weird/extra.toml', type: 'config', filePath: 'weird/extra.toml', name: 'extra.toml', summary: 's' },
        { id: 'table:users', type: 'table', filePath: 'weird/users.sql', name: 'users', summary: 's' },
        { id: 'schema:posts', type: 'schema', filePath: 'weird/posts.graphql', name: 'posts', summary: 's' },
        { id: 'endpoint:GET-/health', type: 'endpoint', filePath: 'weird/health.yaml', name: 'health', summary: 's' },
      ],
    });
    expect(layerById(layers, 'layer:docs').nodeIds).toEqual(['document:weird/notes.md']);
    expect(layerById(layers, 'layer:config').nodeIds).toEqual(['config:weird/extra.toml']);
    const data = layerById(layers, 'layer:data').nodeIds;
    expect(data).toContain('table:users');
    expect(data).toContain('schema:posts');
    expect(data).toContain('endpoint:GET-/health');
  });

  it('unmatched files land in layer:core catch-all', () => {
    const layers = assignLayers({
      nodes: [
        fileNode('file:src/index.ts', 'src/index.ts'),
        fileNode('file:weird/random.ts', 'weird/random.ts'),
      ],
    });
    expect(layerById(layers, 'layer:core').nodeIds).toEqual([
      'file:src/index.ts',
      'file:weird/random.ts',
    ]);
  });

  it('skips nodes without filePath', () => {
    const layers = assignLayers({
      nodes: [
        { id: 'file:nofile', type: 'file', name: 'x' },
        fileNode('file:src/index.ts', 'src/index.ts'),
      ],
    });
    expect(layerById(layers, 'layer:core').nodeIds).toEqual(['file:src/index.ts']);
  });

  it('skips non-file-level node types', () => {
    const layers = assignLayers({
      nodes: [
        { id: 'function:foo', type: 'function', filePath: 'src/x.ts', name: 'foo', summary: 's' },
        { id: 'class:Bar', type: 'class', filePath: 'src/y.ts', name: 'Bar', summary: 's' },
      ],
    });
    expect(layers).toEqual([]);
  });

  it('produces deterministic, sorted nodeIds within each layer', () => {
    const nodes = [
      fileNode('file:src/api/zzz.ts', 'src/api/zzz.ts'),
      fileNode('file:src/api/aaa.ts', 'src/api/aaa.ts'),
      fileNode('file:src/api/mmm.ts', 'src/api/mmm.ts'),
    ];
    const layers1 = assignLayers({ nodes });
    const layers2 = assignLayers({ nodes: [...nodes].reverse() });
    expect(layerById(layers1, 'layer:api').nodeIds).toEqual([
      'file:src/api/aaa.ts',
      'file:src/api/mmm.ts',
      'file:src/api/zzz.ts',
    ]);
    expect(layerById(layers2, 'layer:api').nodeIds).toEqual(
      layerById(layers1, 'layer:api').nodeIds,
    );
  });

  it('omits empty layers from the output', () => {
    const layers = assignLayers({
      nodes: [fileNode('file:src/api/x.ts', 'src/api/x.ts')],
    });
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('layer:api');
  });

  it('every layer has id, name, description, nodeIds[]', () => {
    const layers = assignLayers({
      nodes: [fileNode('file:src/components/X.tsx', 'src/components/X.tsx')],
    });
    for (const l of layers) {
      expect(typeof l.id).toBe('string');
      expect(typeof l.name).toBe('string');
      expect(typeof l.description).toBe('string');
      expect(Array.isArray(l.nodeIds)).toBe(true);
    }
  });

  it('exports FILE_LEVEL_TYPES set', () => {
    expect(FILE_LEVEL_TYPES.has('file')).toBe(true);
    expect(FILE_LEVEL_TYPES.has('config')).toBe(true);
    expect(FILE_LEVEL_TYPES.has('function')).toBe(false);
  });

  it('LAYER_RULES is non-empty and ordered with API before UI (covers pages/api)', () => {
    expect(LAYER_RULES.length).toBeGreaterThan(0);
    const apiIdx = LAYER_RULES.findIndex((r) => r.id === 'layer:api');
    const uiIdx = LAYER_RULES.findIndex((r) => r.id === 'layer:ui');
    expect(apiIdx).toBeGreaterThanOrEqual(0);
    expect(uiIdx).toBeGreaterThanOrEqual(0);
    expect(apiIdx).toBeLessThan(uiIdx);
  });

  // Regression: a pipeline file at root must route to infra, not get pulled
  // into layer:config by the `\.yml$` pattern. The type-based check runs
  // before pattern matching for service/pipeline/resource node types.
  it('routes a root pipeline yml to infra, not config (type beats pattern)', () => {
    const layers = assignLayers({
      nodes: [
        { id: 'pipeline:release.yml', type: 'pipeline', filePath: 'release.yml', name: 'release.yml', summary: 's' },
        { id: 'service:Dockerfile', type: 'service', filePath: 'Dockerfile', name: 'Dockerfile', summary: 's' },
        { id: 'resource:main.tf', type: 'resource', filePath: 'main.tf', name: 'main.tf', summary: 's' },
      ],
    });
    const infra = layerById(layers, 'layer:infra').nodeIds;
    expect(infra).toContain('pipeline:release.yml');
    expect(infra).toContain('service:Dockerfile');
    expect(infra).toContain('resource:main.tf');
    expect(layerById(layers, 'layer:config')).toBeUndefined();
  });

  // Regression: test tag still wins over the new type-based infra check.
  it('test tag wins over infra-shaped node types', () => {
    const layers = assignLayers({
      nodes: [
        { id: 'pipeline:test.yml', type: 'pipeline', filePath: 'test.yml', name: 'test.yml', summary: 's', tags: ['test'] },
      ],
    });
    expect(layerById(layers, 'layer:testing').nodeIds).toEqual(['pipeline:test.yml']);
    expect(layerById(layers, 'layer:infra')).toBeUndefined();
  });
});

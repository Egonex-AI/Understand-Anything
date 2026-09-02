import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf-8'));
}

const manifestPaths = [
  'understand-anything-plugin/package.json',
  'understand-anything-plugin/.claude-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.copilot-plugin/plugin.json',
];

const manifests = manifestPaths.map((path) => ({ path, json: readRepoJson(path) }));
const marketplace = readRepoJson('.claude-plugin/marketplace.json');

describe('version sync across manifests', () => {
  it('every manifest has a non-empty string version', () => {
    for (const { path, json } of manifests) {
      expect(typeof json.version, `${path} version type`).toBe('string');
      expect(json.version.length, `${path} version non-empty`).toBeGreaterThan(0);
    }
  });

  it('all five manifests have the same version', () => {
    const versions = manifests.map((m) => m.json.version);
    expect(new Set(versions).size, `distinct versions: ${versions.join(', ')}`).toBe(1);
  });

  it('marketplace.json has no top-level version key', () => {
    expect(Object.prototype.hasOwnProperty.call(marketplace, 'version')).toBe(false);
  });

  it('marketplace.json plugins[] entries have no version key', () => {
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins.length).toBeGreaterThan(0);
    for (const plugin of marketplace.plugins) {
      expect(
        Object.prototype.hasOwnProperty.call(plugin, 'version'),
        `plugin "${plugin.name}" should not have a version key`,
      ).toBe(false);
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, CONFIG_DEFAULTS } from '../../../understand-anything-plugin/skills/shared/config-reader.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ua-config-test-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('readConfig', () => {
  it('returns defaults when no config files exist', () => {
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: join(tmpDir, 'server', 'order-service'),
    });
    expect(config).toEqual(CONFIG_DEFAULTS);
  });

  it('reads Level 1 config', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'en' })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: join(tmpDir, 'server', 'order-service'),
    });
    expect(config.outputLanguage).toBe('en');
    expect(config.autoUpdate).toBe(false);
  });

  it('Level 3 overrides Level 1', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'en', autoUpdate: true })
    );
    const svcDir = join(tmpDir, 'server', 'order-service');
    mkdirSync(join(svcDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(svcDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'zh-CN' })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: svcDir,
    });
    expect(config.outputLanguage).toBe('zh-CN');
    expect(config.autoUpdate).toBe(true);
  });

  it('Level 2 overrides Level 1, Level 3 overrides Level 2', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'en' })
    );
    const facetDir = join(tmpDir, 'server');
    mkdirSync(join(facetDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(facetDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'ja', rpcAnnotations: ['@DubboService'] })
    );
    const svcDir = join(tmpDir, 'server', 'order-service');
    mkdirSync(join(svcDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(svcDir, '.understand-anything', 'config.json'),
      JSON.stringify({ outputLanguage: 'zh-CN' })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: facetDir,
      servicePath: svcDir,
    });
    expect(config.outputLanguage).toBe('zh-CN');
    expect(config.rpcAnnotations).toEqual(['@DubboService']);
  });

  it('empty array overrides parent (explicit empty is defined)', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ excludeServices: ['legacy-*'] })
    );
    const svcDir = join(tmpDir, 'server', 'order-service');
    mkdirSync(join(svcDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(svcDir, '.understand-anything', 'config.json'),
      JSON.stringify({ excludeServices: [] })
    );
    const config = readConfig({
      projectRoot: tmpDir,
      facetPath: join(tmpDir, 'server'),
      servicePath: svcDir,
    });
    expect(config.excludeServices).toEqual([]);
  });
});

// tests/skill/shared/config-reader-business-terms.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../../../understand-anything-plugin/skills/shared/config-reader.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ua-bt-test-'));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('readConfig businessTermsPath', () => {
  // 意图：businessTermsPath 是可选增强项，未配置时返回空串（走降级），不阻断。
  it('defaults to empty string when not configured', () => {
    const config = readConfig({ projectRoot: tmpDir });
    expect(config.businessTermsPath).toBe('');
  });

  // 意图：config-reader 的字段过滤 (key in CONFIG_DEFAULTS) 不能丢弃 businessTermsPath。
  // 若有人忘了把它加进 CONFIG_DEFAULTS，此测试失败——因为字段会被静默吞。
  it('reads businessTermsPath from Level 1 config', () => {
    mkdirSync(join(tmpDir, '.understand-anything'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.understand-anything', 'config.json'),
      JSON.stringify({ businessTermsPath: '../../terms.md' })
    );
    const config = readConfig({ projectRoot: tmpDir });
    expect(config.businessTermsPath).toBe('../../terms.md');
  });
});

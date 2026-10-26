import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadFrameworkAddendums } from '../../../understand-anything-plugin/skills/understand/framework-addendums.mjs';

const helper = fileURLToPath(new URL('../../../understand-anything-plugin/skills/understand/framework-addendums.mjs', import.meta.url));

describe('framework addendums', () => {
  it.each(['JPA', 'Java Persistence', 'Jakarta Persistence', 'EclipseLink', 'Hibernate'])('loads entity relationships for %s without Spring conventions', (framework) => {
    const result = loadFrameworkAddendums([framework]);
    expect(result.map(({ id }) => id)).toEqual(['jpa']);
    expect(result[0].content).toContain('@OneToMany');
    expect(result[0].content).toContain('@ManyToOne');
    expect(result[0].content).not.toContain('@Autowired');
  });

  it('preserves Spring rules while deduplicating shared JPA context', () => {
    const result = loadFrameworkAddendums(['Spring Boot', 'Hibernate', 'JPA']);
    expect(result.map(({ id }) => id)).toEqual(['spring', 'jpa']);
    expect(result[0].content).toContain('@Autowired');
    expect(result[1].content).toContain('@ManyToMany');
  });

  it('keeps existing framework addendums and skips unsupported framework names', () => {
    expect(loadFrameworkAddendums(['React', 'Next.js', 'unknown', null, '']))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'react' }),
        expect.objectContaining({ id: 'nextjs' }),
      ]));
    expect(loadFrameworkAddendums(['unknown'])).toEqual([]);
  });

  it('prints the standalone persistence context from a scan result', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ua-frameworks-'));
    try {
      const input = join(directory, 'scan-result.json');
      writeFileSync(input, JSON.stringify({ frameworks: ['EclipseLink', 'JPA'] }));
      const output = execFileSync(process.execPath, [helper, input], { encoding: 'utf8' });
      expect(output.match(/# JPA \/ Jakarta Persistence Framework Addendum/g)).toHaveLength(1);
      expect(output).toContain('depends_on');
      expect(output).not.toContain('# Spring Boot Framework Addendum');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

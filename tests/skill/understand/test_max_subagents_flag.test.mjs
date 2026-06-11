import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf-8');
}

describe('/understand max-subagents flag docs/instructions', () => {
  it('documents --max-subagents in argument-hint and options', () => {
    const skill = read('understand-anything-plugin/skills/understand/SKILL.md');

    expect(skill).toContain('--max-subagents <n>');
    expect(skill).toContain('Allowed range: `1..5`. Default: `5`.');
  });

  it('uses max-subagents variable in Phase 2 concurrency instructions', () => {
    const skill = read('understand-anything-plugin/skills/understand/SKILL.md');

    expect(skill).toContain('up to $MAX_SUBAGENTS concurrent');
    expect(skill).toContain('Run up to **$MAX_SUBAGENTS subagents concurrently**');
    expect(skill).toContain('If `$MAX_SUBAGENTS=1`, run batches strictly sequentially.');
  });
});

describe('related skills/hooks max-subagents support', () => {
  it('documents max-subagents in /understand-knowledge', () => {
    const skill = read('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(skill).toContain('--max-subagents <n>');
    expect(skill).toContain('clamp to `1..3`');
    expect(skill).toContain('Run up to `$MAX_SUBAGENTS` batches concurrently');
  });

  it('supports max-subagents override in auto-update hook prompt', () => {
    const prompt = read('understand-anything-plugin/hooks/auto-update-prompt.md');

    expect(prompt).toContain('--max-subagents <n>');
    expect(prompt).toContain('Clamp to range `1..5`.');
    expect(prompt).toContain('Dispatch up to `$MAX_SUBAGENTS` batch subagents concurrently.');
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf-8');
}

describe('/understand split-pass flags in skill instructions', () => {
  it('documents stop-after/resume-from/reuse-intermediate in argument-hint and options', () => {
    const skill = read('understand-anything-plugin/skills/understand/SKILL.md');

    expect(skill).toContain('--stop-after <phase>');
    expect(skill).toContain('--resume-from <phase>');
    expect(skill).toContain('--reuse-intermediate');
    expect(skill).toContain('Phase names for split-pass execution');
  });

  it('lists all supported phase names', () => {
    const skill = read('understand-anything-plugin/skills/understand/SKILL.md');
    const phases = [
      'scan',
      'batch',
      'analyze',
      'assemble',
      'architecture',
      'tour',
      'review',
      'save',
    ];

    for (const phase of phases) {
      expect(skill).toContain(`- \`${phase}\``);
    }
  });

  it('defines resume prerequisite checks and invalid window validation', () => {
    const skill = read('understand-anything-plugin/skills/understand/SKILL.md');

    expect(skill).toContain('If both `--stop-after` and `--resume-from` are present and `resume-from` is later than `stop-after`, report error and STOP.');
    expect(skill).toContain('resume-from analyze');
    expect(skill).toContain('resume-from assemble');
    expect(skill).toContain('If missing files are found, report exactly which files are missing');
  });

  it('contains stop boundaries for each major phase', () => {
    const skill = read('understand-anything-plugin/skills/understand/SKILL.md');

    expect(skill).toContain('If `--stop-after scan` is set');
    expect(skill).toContain('If `--stop-after batch` is set');
    expect(skill).toContain('If `--stop-after analyze` is set');
    expect(skill).toContain('If `--stop-after assemble` is set');
    expect(skill).toContain('If `--stop-after architecture` is set');
    expect(skill).toContain('If `--stop-after tour` is set');
    expect(skill).toContain('If `--stop-after review` is set');
  });
});

describe('README multi-pass guidance', () => {
  it('documents valid phase names and phase-window usage', () => {
    const readme = read('README.md');

    expect(readme).toContain('Multi-pass workflow (switch models between runs):');
    expect(readme).toContain('Valid phase names for `--stop-after` and `--resume-from`');
    expect(readme).toContain('/understand --resume-from assemble --stop-after review --reuse-intermediate');
    expect(readme).toContain('/understand --resume-from analyze --reuse-intermediate');
  });
});

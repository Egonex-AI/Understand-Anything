import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

describe('skill command hardening', () => {
  it('quotes PROJECT_ROOT in shell command snippets', () => {
    const files = [
      'understand-anything-plugin/skills/understand/SKILL.md',
      'understand-anything-plugin/hooks/auto-update-prompt.md',
    ];

    const unsafePatterns = [
      /\b(?:node|python|python3|mkdir|find|rm|cat)\s+(?:-[^\n]*\s+)*\$PROJECT_ROOT\b/,
      />\s*\$PROJECT_ROOT\b/,
      /--changed-files=\$PROJECT_ROOT\b/,
      /rm\s+-rf\s+\$PROJECT_ROOT\b/,
    ];

    for (const relPath of files) {
      const content = readRepoFile(relPath);
      for (const pattern of unsafePatterns) {
        expect(content, `${relPath} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('quotes skill and target directory placeholders in knowledge commands', () => {
    const content = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(content).not.toMatch(/python3\s+<SKILL_DIR>\/[^\n]+ <TARGET_DIR>/);
    expect(content).not.toMatch(/rm\s+-rf\s+<TARGET_DIR>/);
  });

  it('does not rewrite metadata for generated-only commits', () => {
    const content = readRepoFile(
      'understand-anything-plugin/hooks/auto-update-prompt.md',
    );

    expect(content).toContain('generated-artifact-only');
    expect(content).toContain('intentionally advances nothing for generated-only commits');
    expect(content).toContain('Never update `meta.json` for a generated-artifact-only commit');
  });

  it('requires a local viewer without remote installation', () => {
    const content = readRepoFile(
      'understand-anything-plugin/skills/understand-dashboard/SKILL.md',
    );

    expect(content).not.toMatch(/<(?:dashboard-dir|plugin-root|project-dir)>/);
    expect(content).not.toMatch(/\bcd <(?:dashboard-dir|plugin-root)>/);
    expect(content).not.toMatch(/GRAPH_DIR=<project-dir>/);

    expect(content).toMatch(/PROJECT_DIR=\$\(pwd -P\)/);
    expect(content).toMatch(/UA_DIR="\$PROJECT_DIR\/\.understand-anything"/);
    expect(content).toMatch(/\[ ! -f "\$UA_DIR\/knowledge-graph\.json" \]/);

    expect(content).toContain('VIEWER_DIR="$PLUGIN_ROOT/packages/viewer"');
    expect(content).toContain(': "${PLUGIN_ROOT:?Plugin root required}"');
    expect(content).toContain('node "$VIEWER_DIR/bin/viewer.mjs" "$PROJECT_DIR"');

    expect(content).toContain('dist/index.html');
    expect(content).toContain('bin/dist/staleness.js');

    expect(content).not.toMatch(/\bnpx\b/);
    expect(content).not.toMatch(/\b(?:pnpm|npm|yarn)\s+install\b/);
    expect(content).not.toMatch(/\b(?:pnpm|npm|yarn)\s+[^\n]*\bbuild\b/);
    expect(content).not.toMatch(/VIEWER_URL=/);
    expect(content).not.toMatch(/\b(?:curl|wget)\s+/);
  });

  it('marks project-controlled context as untrusted data', () => {
    const understand = readRepoFile('understand-anything-plugin/skills/understand/SKILL.md');
    const knowledge = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(understand).not.toMatch(/README and manifest are authoritative/i);
    expect(understand).toMatch(/untrusted project data/i);
    expect(knowledge).toMatch(/untrusted article data/i);
  });
});

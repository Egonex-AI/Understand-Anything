import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const agentsDir = resolve(repoRoot, 'understand-anything-plugin/agents');

function readRepoText(path) {
  return readFileSync(resolve(repoRoot, path), 'utf-8').replace(/\r\n?/g, '\n');
}

/**
 * Parse the leading YAML frontmatter block (between the first two `---`
 * lines) with a simple line-based scan — no YAML dependency needed since
 * frontmatter here is always flat `key: value` pairs (with `description`
 * using a `|` block scalar).
 */
function parseFrontmatterKeys(source) {
  const lines = source.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const keys = new Set();
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([a-zA-Z_]+):/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

describe('agent frontmatter', () => {
  it('finds a plausible number of agent files', () => {
    expect(agentFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of agentFiles) {
    describe(file, () => {
      const source = readRepoText(`understand-anything-plugin/agents/${file}`);
      const keys = parseFrontmatterKeys(source);

      it('has a parseable frontmatter block', () => {
        expect(keys, `${file} frontmatter block`).not.toBeNull();
      });

      it('has name and description keys', () => {
        expect(keys.has('name'), `${file} missing "name"`).toBe(true);
        expect(keys.has('description'), `${file} missing "description"`).toBe(true);
      });

      // #167: opencode (and similar platforms) treat `model` as a literal
      // model id rather than the Claude Code-only `inherit` keyword and
      // reject it with ProviderModelNotFoundError, so agent frontmatter must
      // omit `model` entirely and fall back to the platform's default.
      it('has no model key', () => {
        expect(keys.has('model'), `${file} must not set "model" (see #167)`).toBe(false);
      });

      it('has no tools key', () => {
        expect(keys.has('tools'), `${file} must not set "tools"`).toBe(false);
      });

      it('name matches the file basename', () => {
        const nameLine = source
          .split('\n')
          .find((line) => /^name:/.test(line));
        const name = nameLine.replace(/^name:\s*/, '').trim();
        expect(name).toBe(basename(file, '.md'));
      });
    });
  }
});

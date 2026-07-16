import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoText(path) {
  return readFileSync(resolve(repoRoot, path), 'utf-8').replace(/\r\n?/g, '\n');
}

const installSh = readRepoText('install.sh');
const installPs1 = readRepoText('install.ps1');
const readme = readRepoText('README.md');

/**
 * Parse the platforms_table() heredoc in install.sh:
 *   id|$HOME/target/dir|style
 */
function parseShPlatforms(source) {
  const heredoc = source.match(/platforms_table\(\)\s*\{\s*\n\s*cat <<EOF\n([\s\S]*?)\nEOF/);
  if (!heredoc) return [];
  const rows = [];
  for (const line of heredoc[1].split('\n')) {
    const m = line.match(/^([a-z0-9][a-z0-9-]*)\|([^|]+)\|(per-skill|folder)$/);
    if (m) rows.push({ id: m[1], target: m[2], style: m[3] });
  }
  return rows;
}

/**
 * Parse the $Platforms ordered hashtable in install.ps1:
 *   id = @{ Target = (Join-Path $HOME 'target\dir'); Style = 'style' }
 */
function parsePs1Platforms(source) {
  const block = source.match(/\$Platforms\s*=\s*\[ordered\]@\{\r?\n([\s\S]*?)\r?\n\}/);
  if (!block) return [];
  const rows = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(
      /^\s*([a-z0-9][a-z0-9-]*)\s*=\s*@\{\s*Target\s*=\s*\(Join-Path \$HOME '([^']+)'\);\s*Style\s*=\s*'(per-skill|folder)'\s*\}/,
    );
    if (m) rows.push({ id: m[1], target: m[2], style: m[3] });
  }
  return rows;
}

/**
 * Normalize a skills target dir for cross-script comparison: drop the
 * home-dir prefix (`$HOME/` in bash; PowerShell targets are already relative
 * to $HOME via Join-Path) and unify path separators.
 */
function normalizeTarget(target) {
  return target.replace(/^\$HOME\//, '').replace(/\\/g, '/');
}

/** Backtick-quoted ids on the "Supported `<platform>` values:" README line. */
function parseReadmeSupportedValues(source) {
  const line = source.match(/^- Supported `<platform>` values: (.+)$/m);
  if (!line) return [];
  return [...line[1].matchAll(/`([a-z0-9][a-z0-9-]*)`/g)].map((m) => m[1]);
}

/** Ids referenced as `install.sh <id>` in the Platform Compatibility table. */
function parseReadmeCompatTableIds(source) {
  const section = source.match(/### Platform Compatibility\n([\s\S]*?)\n#{2,3} /);
  if (!section) return [];
  return [...section[1].matchAll(/`install\.sh ([a-z0-9][a-z0-9-]*)`/g)].map((m) => m[1]);
}

const shRows = parseShPlatforms(installSh);
const ps1Rows = parsePs1Platforms(installPs1);

describe('installer platform table consistency', () => {
  // Guard against the parsers silently matching nothing (e.g. after a
  // formatting change in either script): a regex mismatch must fail loudly
  // here, not let the comparison tests pass vacuously on two empty lists.
  it('parses a plausible number of platforms from both scripts', () => {
    expect(shRows.length).toBeGreaterThanOrEqual(10);
    expect(ps1Rows.length).toBeGreaterThanOrEqual(10);
  });

  it('install.sh and install.ps1 define the same platform ids in the same order', () => {
    // Same order matters, not just the same set: both scripts number their
    // interactive platform menus from the table order, so "3) opencode" must
    // mean the same thing on macOS/Linux and on Windows.
    expect(ps1Rows.map((r) => r.id)).toEqual(shRows.map((r) => r.id));
  });

  it('each platform has the same link style in both scripts', () => {
    const ps1ById = new Map(ps1Rows.map((r) => [r.id, r]));
    for (const row of shRows) {
      expect(ps1ById.get(row.id)?.style, `style for "${row.id}"`).toBe(row.style);
    }
  });

  it('each platform has the same skills target dir in both scripts', () => {
    const ps1ById = new Map(ps1Rows.map((r) => [r.id, r]));
    for (const row of shRows) {
      const ps1Row = ps1ById.get(row.id);
      if (!ps1Row) continue; // id-set mismatch is reported by the test above
      expect(normalizeTarget(ps1Row.target), `target for "${row.id}"`).toBe(
        normalizeTarget(row.target),
      );
    }
  });

  it('README "Supported <platform> values" line matches the installer table', () => {
    const readmeIds = parseReadmeSupportedValues(readme);
    expect(readmeIds.length).toBeGreaterThanOrEqual(10);
    expect([...readmeIds].sort()).toEqual(shRows.map((r) => r.id).sort());
  });

  it('README Platform Compatibility table only references real installer platforms', () => {
    // The table may legitimately document a platform via another install
    // method (e.g. vscode → auto-discovery), so this is a subset check; full
    // coverage of the id list is enforced by the supported-values test above.
    const tableIds = parseReadmeCompatTableIds(readme);
    expect(tableIds.length).toBeGreaterThanOrEqual(10);
    const shIds = new Set(shRows.map((r) => r.id));
    for (const id of tableIds) {
      expect(shIds.has(id), `"install.sh ${id}" in README compatibility table`).toBe(true);
    }
  });
});

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const installSh = join(repoRoot, 'install.sh');

const homes = [];

/**
 * Build a throwaway $HOME that looks like an existing install: a checkout at
 * UA_DIR (a symlink to this repo, so list_skills sees the real skills) and the
 * universal ~/.understand-anything-plugin link. The platform's skills dir is
 * created empty, i.e. the per-platform links are already gone.
 */
function makeHome(skillsDir) {
  const home = mkdtempSync(join(tmpdir(), 'ua-uninstall-'));
  homes.push(home);
  mkdirSync(join(home, skillsDir), { recursive: true });
  mkdirSync(join(home, '.understand-anything'));
  symlinkSync(repoRoot, join(home, '.understand-anything', 'repo'));
  symlinkSync(
    join(repoRoot, 'understand-anything-plugin'),
    join(home, '.understand-anything-plugin'),
  );
  return home;
}

function uninstall(home, platform) {
  const env = { ...process.env, HOME: home };
  delete env.UA_DIR;
  return spawnSync('bash', [installSh, '--uninstall', platform], {
    env,
    encoding: 'utf8',
  });
}

function linkExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  while (homes.length) rmSync(homes.pop(), { recursive: true, force: true });
});

// install.sh is the macOS/Linux installer; Windows uses install.ps1.
describe.skipIf(process.platform === 'win32')('install.sh --uninstall', () => {
  it('finishes cleanup when a folder-style skills link is already gone', () => {
    const home = makeHome('.cline/skills');

    const result = uninstall(home, 'cline');

    expect(result.status, result.stderr).toBe(0);
    expect(linkExists(join(home, '.understand-anything-plugin'))).toBe(false);
    expect(result.stdout).toContain('was kept');
  });

  it('finishes cleanup when per-skill links were already removed by another platform', () => {
    // gemini, codex, opencode, pi and devin all share ~/.agents/skills, so
    // uninstalling a second one finds no skill links left to remove.
    const home = makeHome('.agents/skills');

    const result = uninstall(home, 'gemini');

    expect(result.status, result.stderr).toBe(0);
    expect(linkExists(join(home, '.understand-anything-plugin'))).toBe(false);
    expect(result.stdout).toContain('was kept');
  });

  it('still removes skill links that exist', () => {
    const home = makeHome('.cline/skills');
    const skillsLink = join(home, '.cline', 'skills', 'understand-anything');
    symlinkSync(join(repoRoot, 'understand-anything-plugin', 'skills'), skillsLink);

    const result = uninstall(home, 'cline');

    expect(result.status, result.stderr).toBe(0);
    expect(linkExists(skillsLink)).toBe(false);
    expect(existsSync(join(home, '.understand-anything', 'repo'))).toBe(true);
  });
});

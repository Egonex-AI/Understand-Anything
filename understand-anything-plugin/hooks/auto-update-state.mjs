import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function findDataDir() {
  return existsSync('.understand-anything') ? '.understand-anything' : '.ua';
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function graphNeedsUpdate() {
  const dataDir = findDataDir();
  const config = readJson(`${dataDir}/config.json`);
  if (config?.autoUpdate !== true) return false;
  if (!existsSync(`${dataDir}/knowledge-graph.json`)) return false;

  const meta = readJson(`${dataDir}/meta.json`);
  if (typeof meta?.gitCommitHash !== 'string' || meta.gitCommitHash === '') {
    return false;
  }

  let head;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return false;
  }

  return head !== '' && meta.gitCommitHash !== head;
}

export function autoUpdatePromptPath() {
  return fileURLToPath(new URL('./auto-update-prompt.md', import.meta.url));
}

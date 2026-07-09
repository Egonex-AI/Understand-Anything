import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_DEFAULTS = {
  outputLanguage: 'zh-CN',
  autoUpdate: false,
  excludeServices: [],
  rpcAnnotations: [],
  apiBaseUrl: '',
  protocolType: 'rest',
  businessTermsPath: '',
};

/**
 * Read cascading config.json from Level 1 → Level 2 → Level 3.
 * Later levels override earlier ones. Missing files are skipped.
 * A field present in a config file (even if empty string/array) counts as defined.
 *
 * @param {{ projectRoot: string, facetPath?: string, servicePath?: string }} paths
 * @returns {object} Merged configuration with defaults
 */
export function readConfig({ projectRoot, facetPath, servicePath }) {
  const configPaths = [
    join(projectRoot, '.understand-anything', 'config.json'),
    facetPath ? join(facetPath, '.understand-anything', 'config.json') : null,
    servicePath ? join(servicePath, '.understand-anything', 'config.json') : null,
  ].filter(Boolean);

  let merged = { ...CONFIG_DEFAULTS };

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const [key, value] of Object.entries(parsed)) {
        if (key in CONFIG_DEFAULTS) {
          merged[key] = value;
        }
      }
    } catch {
      // Malformed config file — skip silently, use parent values
    }
  }

  return merged;
}

/**
 * Read system.json from project root. Returns null if not found.
 * Adds default empty facets[] if field is missing (backward compat).
 *
 * @param {string} projectRoot
 * @returns {object|null}
 */
export function readSystemConfig(projectRoot) {
  const systemPath = join(projectRoot, '.understand-anything', 'system.json');
  if (!existsSync(systemPath)) return null;
  try {
    const raw = readFileSync(systemPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.facets) parsed.facets = [];
    return parsed;
  } catch {
    return null;
  }
}

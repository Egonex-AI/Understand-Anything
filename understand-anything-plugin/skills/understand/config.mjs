import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_RELATIVE_PATH = '.understand-anything/config.json';

function normalizeExtension(rawExtension) {
  if (typeof rawExtension !== 'string') {
    throw new Error(
      `treeSitter.extensionLanguageMap key must be a string, got ${typeof rawExtension}`,
    );
  }
  const trimmed = rawExtension.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('treeSitter.extensionLanguageMap key must not be empty');
  }
  const normalized = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  if (normalized === '.') {
    throw new Error('treeSitter.extensionLanguageMap key must not be "."');
  }
  return normalized;
}

function normalizeLanguageId(rawLanguageId) {
  if (typeof rawLanguageId !== 'string') {
    throw new Error(
      `treeSitter.extensionLanguageMap value must be a string, got ${typeof rawLanguageId}`,
    );
  }
  const normalized = rawLanguageId.trim().toLowerCase();
  if (!normalized) {
    throw new Error('treeSitter.extensionLanguageMap value must not be empty');
  }
  return normalized;
}

function asObject(value, fieldPath) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object`);
  }
  return value;
}

/**
 * Read `.understand-anything/config.json` and return normalized tree-sitter
 * extension aliases.
 *
 * Expected JSON shape:
 *   {
 *     "treeSitter": {
 *       "extensionLanguageMap": {
 *         ".foo": "typescript"
 *       }
 *     }
 *   }
 */
export function readTreeSitterExtensionLanguageMap(
  projectRoot,
  options = {},
) {
  const configPath = join(projectRoot, CONFIG_RELATIVE_PATH);
  if (!existsSync(configPath)) return {};

  const raw = readFileSync(configPath, 'utf-8');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in ${CONFIG_RELATIVE_PATH}: ${err.message}`,
    );
  }

  const root = asObject(parsed, 'config');
  const treeSitter = asObject(root.treeSitter, 'treeSitter');
  const extensionLanguageMap = asObject(
    treeSitter.extensionLanguageMap,
    'treeSitter.extensionLanguageMap',
  );

  const validLanguageIds = options.validLanguageIds ?? null;
  const normalized = {};

  for (const [rawExtension, rawLanguageId] of Object.entries(extensionLanguageMap)) {
    const ext = normalizeExtension(rawExtension);
    const languageId = normalizeLanguageId(rawLanguageId);
    if (validLanguageIds && !validLanguageIds.has(languageId)) {
      throw new Error(
        `treeSitter.extensionLanguageMap["${rawExtension}"] points to unknown language "${rawLanguageId}"`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(normalized, ext) && normalized[ext] !== languageId) {
      throw new Error(
        `Conflicting language mappings for extension "${ext}" in treeSitter.extensionLanguageMap`,
      );
    }
    normalized[ext] = languageId;
  }

  return normalized;
}

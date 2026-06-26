#!/usr/bin/env node
/**
 * extract-crossrepo-signals.mjs
 *
 * Deterministic per-repo signal scanner for /understand-crossrepo Phase 1.
 * Emits a machine-readable JSON evidence file consumed by the Task-4 LLM linker.
 *
 * Usage:
 *   node extract-crossrepo-signals.mjs <repoPath> <repoNamespace> <outPath>
 *
 * Output shape (contract for Task 4):
 *   {
 *     "repo": "<basename of repoPath>",
 *     "namespace": "<repoNamespace verbatim>",
 *     "identity": {
 *       "serviceName": "...",
 *       "keycloakClientId": "...|null",
 *       "servedHosts": [...],
 *       "endpoints": [...],
 *       "ownedTopics": [...],
 *       "ownedBuckets": [...]
 *     },
 *     "outbound": [
 *       { "kind": "api|auth|embed|pubsub|bucket|db", "value": "...", "evidence": "relpath:line" }
 *     ]
 *   }
 *
 * Stdlib only. No external dependencies. Node ≥ 22 ESM.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, relative, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build',
  '.understand-anything', 'venv', '.venv', '__pycache__',
]);

// Files whose names match (case-insensitive) are scanned for env/config signals
const ENV_FILE_RE = /^\.env(\.|$)/i;
const CONFIG_FILE_RE = /^config\./i;
const VALUES_YAML_RE = /^values.*\.ya?ml$/i;

// Env key patterns that indicate outbound service URLs
const OUTBOUND_KEY_RE = /_(URL|HOST|ENDPOINT|BASE)$/i;

// Literal URL pattern in source/config
const LITERAL_URL_RE = /https?:\/\/([a-zA-Z0-9._-]+(?:\/[^\s"'`<>]*)?)/g;

// FastAPI / Flask route decorators
const PY_ROUTE_RE = /@(?:app|router)\.(get|post|put|patch|delete|options|head)\(["']([^"']+)["']/g;

// Express routes: router.get('/path') or app.post('/path')
const JS_ROUTE_RE = /(?:router|app)\.(get|post|put|patch|delete|options|head)\(["'`]([^"'`]+)["'`]/g;

// Router prefix in Python: APIRouter(prefix="...")
const PY_ROUTER_PREFIX_RE = /APIRouter\s*\([^)]*prefix\s*=\s*["']([^"']+)["']/g;

// Keycloak realm, client_id / clientId / resource
const KC_REALM_RE = /"?realm"?\s*[:=]\s*["']([^"']+)["']/;
const KC_CLIENT_RE = /"?(?:client_id|clientId|resource)"?\s*[:=]\s*["']([^"']+)["']/;
const KC_AUTH_URL_RE = /"?(?:auth-server-url|authServerUrl|issuer)"?\s*[:=]\s*["']([^"']+)["']/;
const KC_CLIENT_ENV_RE = /KEYCLOAK_CLIENT(?:_ID)?\s*=\s*(.+)/i;
const JWKS_RE = /(?:jwks|\.well-known\/openid)/i;

// Keycloak JSON "resource" field (Keycloak adapter config)
const KC_RESOURCE_RE = /"resource"\s*:\s*"([^"]+)"/;

// iframe embed
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/g;
const CT_TOKEN_RE = /\bct_token\b|\bembedded=/;

// GCS / Pub/Sub
const GCS_BUCKET_RE = /gs:\/\/([a-zA-Z0-9._-]+)/g;
const BUCKET_ENV_RE = /([A-Z][A-Z0-9_]*_BUCKET)\s*=\s*([^\s#]+)/g;
const PUBSUB_TOPIC_RE = /projects\/[^/]+\/topics\/([a-zA-Z0-9._-]+)/g;
const PUBSUB_TOPIC_NAME_RE = /["']([a-zA-Z0-9._-]+-topic[s]?)["']/g;

// DB host patterns in env/config
const DB_HOST_RE = /(?:DB_HOST|DATABASE_HOST|POSTGRES_HOST|MYSQL_HOST)\s*=\s*([^\s#]+)/gi;
const DB_URL_RE = /(?:DATABASE_URL|DB_URL)\s*=\s*((?:postgres|mysql|mongodb|sqlite)[^:\s]*:\/\/[^\s#]+)/gi;

// CORS origins in Python/JS
const CORS_ORIGIN_RE = /(?:allow_origins|allowedOrigins|origins)\s*[=:]\s*\[([^\]]+)\]/;

// Ingress host in helm values YAML
const INGRESS_HOST_RE = /host\s*:\s*(.+)/;

// pyproject.toml / package.json name
const PYPROJECT_NAME_RE = /^name\s*=\s*["']?([^"'\n]+)["']?/m;
const PACKAGE_JSON_NAME_RE = /"name"\s*:\s*"([^"]+)"/;

// Max file size to read (2 MB) — avoids hanging on large generated files
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Binary extension check
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.br', '.wasm',
  '.ttf', '.woff', '.woff2', '.eot', '.otf',
  '.mp3', '.mp4', '.mov', '.avi', '.wav',
  '.pyc', '.pyo', '.so', '.dylib', '.dll', '.exe',
  '.lock',        // package-lock, Cargo.lock — large but rarely signal-bearing
]);

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function walkRepo(repoPath) {
  const files = [];

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Sort for determinism
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;
        let size = 0;
        try { size = statSync(abs).size; } catch { continue; }
        if (size > MAX_FILE_BYTES) continue;
        files.push(abs);
      }
    }
  }

  walk(repoPath);
  return files;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(abs) {
  try { return readFileSync(abs, 'utf-8'); } catch { return null; }
}

/** Return relative path from repoPath, never starting with /. */
function rel(repoPath, abs) {
  return relative(repoPath, abs);
}

function isEnvFile(name) { return ENV_FILE_RE.test(name) || name === '.env.example'; }
function isConfigFile(name) { return CONFIG_FILE_RE.test(name); }
function isValuesYaml(name) { return VALUES_YAML_RE.test(name); }

// ---------------------------------------------------------------------------
// Signal collector
// ---------------------------------------------------------------------------

class Collector {
  constructor(repoPath) {
    this.repoPath = repoPath;
    this.outbound = [];
    this.identity = {
      serviceName: null,
      keycloakClientId: null,
      servedHosts: [],
      endpoints: [],
      ownedTopics: [],
      ownedBuckets: [],
    };
    // Dedup sets
    this._outboundKeys = new Set();
    this._endpointSet = new Set();
    this._hostSet = new Set();
    this._topicSet = new Set();
    this._bucketSet = new Set();
  }

  addOutbound(kind, value, evidence) {
    const key = `${kind}|${value}|${evidence}`;
    if (this._outboundKeys.has(key)) return;
    this._outboundKeys.add(key);
    this.outbound.push({ kind, value, evidence });
  }

  addEndpoint(ep) {
    if (!ep || this._endpointSet.has(ep)) return;
    this._endpointSet.add(ep);
    this.identity.endpoints.push(ep);
  }

  addHost(host) {
    if (!host || this._hostSet.has(host)) return;
    this._hostSet.add(host);
    this.identity.servedHosts.push(host);
  }

  addTopic(topic) {
    if (!topic || this._topicSet.has(topic)) return;
    this._topicSet.add(topic);
    this.identity.ownedTopics.push(topic);
  }

  addBucket(bucket) {
    if (!bucket || this._bucketSet.has(bucket)) return;
    this._bucketSet.add(bucket);
    this.identity.ownedBuckets.push(bucket);
  }
}

// ---------------------------------------------------------------------------
// Per-file scanners
// ---------------------------------------------------------------------------

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

/** Scan .env / config files for outbound API signals and DB signals. */
function scanEnvConfig(content, relPath, collector) {
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const evidence = `${relPath}:${lineNum}`;

    // Outbound API: env key ending in _URL/_HOST/_ENDPOINT/_BASE
    const envMatch = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.+)/);
    if (envMatch) {
      const [, key, value] = envMatch;
      const val = value.trim();
      if (OUTBOUND_KEY_RE.test(key) && val && !val.startsWith('#')) {
        // Exclude local DB host env vars from api signals (they go to db)
        if (/^(?:DB_HOST|DATABASE_HOST|POSTGRES_HOST|MYSQL_HOST)$/i.test(key)) {
          collector.addOutbound('db', `${key}=${val}`, evidence);
        } else {
          collector.addOutbound('api', `${key}=${val}`, evidence);
        }
      }
    }

    // DB via DATABASE_URL
    {
      const re = /^(DATABASE_URL|DB_URL)\s*=\s*(.+)/i;
      const m = line.match(re);
      if (m) {
        collector.addOutbound('db', `${m[1]}=${m[2].trim()}`, evidence);
      }
    }

    // Keycloak env var
    {
      const m = line.match(KC_CLIENT_ENV_RE);
      if (m) {
        const client = m[1].trim();
        collector.addOutbound('auth', `KEYCLOAK_CLIENT=${client}`, evidence);
        if (!collector.identity.keycloakClientId) {
          collector.identity.keycloakClientId = client;
        }
      }
    }

    // GCS bucket env
    {
      let m;
      const re = /([A-Z][A-Z0-9_]*_BUCKET)\s*=\s*([^\s#]+)/gi;
      while ((m = re.exec(line)) !== null) {
        collector.addBucket(m[2].trim());
        collector.addOutbound('bucket', `${m[1]}=${m[2].trim()}`, evidence);
      }
    }

    // GCS gs:// URIs
    {
      let m;
      const re = /gs:\/\/([a-zA-Z0-9._-]+)/g;
      while ((m = re.exec(line)) !== null) {
        collector.addBucket(m[1]);
        collector.addOutbound('bucket', `gs://${m[1]}`, evidence);
      }
    }

    // Pub/Sub topic names
    {
      let m;
      const re = /projects\/[^/]+\/topics\/([a-zA-Z0-9._-]+)/g;
      while ((m = re.exec(line)) !== null) {
        collector.addTopic(m[1]);
        collector.addOutbound('pubsub', m[0], evidence);
      }
    }
  });
}

/** Scan any file for literal https?:// URLs (outbound api).
 *  Skips env/config files — those are already parsed by scanEnvConfig,
 *  which emits structured KEY=value entries. Running here too would
 *  duplicate the same target with a bare-host value. */
function scanLiteralUrls(content, relPath, collector) {
  const name = basename(relPath);
  // ponytail: env/config files emit structured signals via scanEnvConfig; skip here to avoid dup api entries
  if (isEnvFile(name) || isConfigFile(name)) return;

  // Exclude localhost / 127.0.0.1 — internal dev references
  const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)/;
  let m;
  const re = /https?:\/\/([a-zA-Z0-9._-]+(?::\d+)?)/g;
  while ((m = re.exec(content)) !== null) {
    const host = m[1];
    if (LOCAL_HOST_RE.test(host)) continue;
    const line = lineNumber(content, m.index);
    collector.addOutbound('api', `https://${host}`, `${relPath}:${line}`);
  }
}

/** Scan Keycloak adapter JSON or env for auth signals. */
function scanKeycloak(content, relPath, collector) {
  // Try JSON parse first (keycloak.json adapter config)
  try {
    const json = JSON.parse(content);
    const realm = json.realm;
    const client = json.resource || json['client-id'] || json.clientId || json.client_id;
    const authUrl = json['auth-server-url'] || json.authServerUrl || json.issuer;

    if (realm || client) {
      const value = [realm && `realm=${realm}`, client && `client=${client}`].filter(Boolean).join(' ');
      collector.addOutbound('auth', value, relPath);
      // Set identity keycloakClientId from "resource" (Keycloak adapter convention)
      if (client && !collector.identity.keycloakClientId) {
        collector.identity.keycloakClientId = client;
      }
    }
    if (authUrl) {
      collector.addOutbound('auth', `issuer=${authUrl}`, relPath);
    }
    return; // JSON handled — no need for regex pass
  } catch {
    // Not JSON — fall through to regex
  }

  // Regex pass for YAML / Python dicts / .env
  {
    const realmMatch = content.match(KC_REALM_RE);
    const clientMatch = content.match(KC_CLIENT_RE);
    const authUrlMatch = content.match(KC_AUTH_URL_RE);

    if (realmMatch || clientMatch) {
      const realm = realmMatch?.[1];
      const client = clientMatch?.[1];
      const value = [realm && `realm=${realm}`, client && `client=${client}`].filter(Boolean).join(' ');
      if (value) {
        // Find best evidence line
        const lines = content.split('\n');
        let evidenceLine = 1;
        for (let i = 0; i < lines.length; i++) {
          if ((realm && lines[i].includes(realm)) || (client && lines[i].includes(client))) {
            evidenceLine = i + 1;
            break;
          }
        }
        collector.addOutbound('auth', value, `${relPath}:${evidenceLine}`);
        if (client && !collector.identity.keycloakClientId) {
          collector.identity.keycloakClientId = client;
        }
      }
    }
    if (authUrlMatch) {
      collector.addOutbound('auth', `issuer=${authUrlMatch[1]}`, relPath);
    }
  }

  // JWKS reference
  if (JWKS_RE.test(content)) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (JWKS_RE.test(lines[i])) {
        collector.addOutbound('auth', `jwks:${lines[i].trim()}`, `${relPath}:${i + 1}`);
        break;
      }
    }
  }
}

/** Scan Python files for route decorators and router prefixes. */
function scanPythonRoutes(content, relPath, collector) {
  // Collect router prefixes declared in this file
  const prefixes = [];
  {
    let m;
    const re = /APIRouter\s*\([^)]*prefix\s*=\s*["']([^"']+)["']/g;
    while ((m = re.exec(content)) !== null) {
      prefixes.push(m[1]);
    }
  }

  // ponytail: only first APIRouter prefix per file is used; revisit if multi-router files appear in target repos
  const prefix = prefixes[0] || '';

  // Route decorators
  {
    let m;
    const re = /@(?:app|router)\.(get|post|put|patch|delete|options|head)\(\s*["']([^"']+)["']/g;
    while ((m = re.exec(content)) !== null) {
      const path = prefix + m[2];
      const line = lineNumber(content, m.index);
      collector.addEndpoint(path);
    }
  }
}

/** Scan JS/TS files for Express routes. */
function scanJsRoutes(content, relPath, collector) {
  let m;
  const re = /(?:router|app)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  while ((m = re.exec(content)) !== null) {
    collector.addEndpoint(m[2]);
  }
}

/** Scan for iframe embeds and ct_token usage. */
function scanEmbeds(content, relPath, collector) {
  let m;
  const re = /<iframe[^>]+src=["']([^"']+)["']/g;
  while ((m = re.exec(content)) !== null) {
    const line = lineNumber(content, m.index);
    collector.addOutbound('embed', `iframe:${m[1]}`, `${relPath}:${line}`);
  }

  if (CT_TOKEN_RE.test(content)) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (CT_TOKEN_RE.test(lines[i])) {
        collector.addOutbound('embed', `ct_token usage`, `${relPath}:${i + 1}`);
        break;
      }
    }
  }
}

/** Scan for Pub/Sub topic references in code. */
function scanPubSub(content, relPath, collector) {
  let m;
  const re = /projects\/[^/\s"']+\/topics\/([a-zA-Z0-9._-]+)/g;
  while ((m = re.exec(content)) !== null) {
    const line = lineNumber(content, m.index);
    collector.addTopic(m[1]);
    collector.addOutbound('pubsub', m[0], `${relPath}:${line}`);
  }
}

/** Scan CORS origins from Python / JS config. */
function scanCors(content, relPath, collector) {
  const m = CORS_ORIGIN_RE.exec(content);
  if (!m) return;
  // Extract quoted strings from the list
  const list = m[1];
  const originsRe = /["']([^"']+)["']/g;
  let om;
  while ((om = originsRe.exec(list)) !== null) {
    const origin = om[1];
    if (origin !== '*') collector.addHost(origin);
  }
}

/** Scan Helm values YAML for ingress hosts and bucket/topic signals.
 *  Handles both `KEY: value` (Helm) and K8s `- name: KEY` + `value: ...` forms. */
function scanHelmValues(content, relPath, collector) {
  const lines = content.split('\n');
  let inIngress = false;
  let pendingEnvKey = null; // for K8s - name: X_BUCKET / value: gs://...

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const evidence = `${relPath}:${lineNum}`;

    // Ingress host detection
    if (/^\s*ingress\s*:/.test(line)) { inIngress = true; }
    if (inIngress) {
      const m = line.match(/host\s*:\s*(.+)/);
      if (m) {
        const host = m[1].trim().replace(/["']/g, '');
        if (host) collector.addHost(host);
      }
    }

    // GCS gs:// URI anywhere in YAML (bucket identity/outbound)
    {
      let m;
      const re = /gs:\/\/([a-zA-Z0-9._-]+)/g;
      while ((m = re.exec(line)) !== null) {
        const bucket = m[1];
        if (!collector._bucketSet.has(bucket)) {
          collector.addBucket(bucket);
          collector.addOutbound('bucket', `gs://${bucket}`, evidence);
        }
      }
    }

    // K8s env var form: `- name: X_BUCKET` followed by `  value: ...`
    // ponytail: pendingEnvKey can mis-pair if a bare 'value:' appears at document level between name/value stanzas in freeform yaml; acceptable for values.yaml signal extraction
    {
      const nameMatch = line.match(/^\s*-?\s*name\s*:\s*([A-Z][A-Z0-9_]*_(BUCKET|TOPIC))\s*$/);
      if (nameMatch) {
        pendingEnvKey = { key: nameMatch[1], kind: nameMatch[2] };
      } else if (pendingEnvKey) {
        const valMatch = line.match(/^\s*value\s*:\s*(.+)/);
        if (valMatch) {
          const val = valMatch[1].trim().replace(/["']/g, '');
          if (pendingEnvKey.kind === 'BUCKET') {
            collector.addBucket(val);
            collector.addOutbound('bucket', `${pendingEnvKey.key}=${val}`, evidence);
          } else {
            collector.addTopic(val);
            collector.addOutbound('pubsub', `${pendingEnvKey.key}=${val}`, evidence);
          }
          pendingEnvKey = null;
        } else if (!/^\s*#/.test(line) && line.trim() !== '') {
          pendingEnvKey = null; // non-value line resets pending key
        }
      }
    }

    // Helm flat form: `X_BUCKET: value` or `X_TOPIC: value`
    {
      const kvMatch = line.match(/^\s*([A-Z][A-Z0-9_]*_(BUCKET|TOPIC))\s*:\s*(.+)/);
      if (kvMatch) {
        const key = kvMatch[1];
        const kind = kvMatch[2];
        const val = kvMatch[3].trim().replace(/["']/g, '');
        if (val) {
          if (kind === 'BUCKET') {
            collector.addBucket(val);
            collector.addOutbound('bucket', `${key}=${val}`, evidence);
          } else {
            collector.addTopic(val);
            collector.addOutbound('pubsub', `${key}=${val}`, evidence);
          }
        }
      }
    }
  }
}

/** Extract service name from manifest files. */
function extractServiceName(content, fileName) {
  if (fileName === 'pyproject.toml') {
    const m = content.match(PYPROJECT_NAME_RE);
    return m?.[1]?.trim() || null;
  }
  if (fileName === 'package.json') {
    const m = content.match(PACKAGE_JSON_NAME_RE);
    return m?.[1]?.trim() || null;
  }
  if (fileName === 'setup.py') {
    const m = content.match(/name\s*=\s*["']([^"']+)["']/);
    return m?.[1]?.trim() || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

function isKeycloakFile(relPath, content) {
  const name = basename(relPath).toLowerCase();
  if (name.includes('keycloak') || name.includes('auth')) return true;
  // Heuristic: JSON file with "realm" key
  if (relPath.endsWith('.json') && content.includes('"realm"')) return true;
  return false;
}

function scan(repoPath, namespace) {
  const collector = new Collector(repoPath);
  const files = walkRepo(repoPath);

  for (const absPath of files) {
    const relPath = rel(repoPath, absPath);
    const name = basename(absPath);
    const ext = extname(name).toLowerCase();
    const content = readFile(absPath);
    if (content === null) continue;

    // Service name from manifests (first found wins)
    if (!collector.identity.serviceName) {
      const sn = extractServiceName(content, name);
      if (sn) collector.identity.serviceName = sn;
    }

    const isPy = ext === '.py';
    const isJs = ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs';
    const isYaml = ext === '.yaml' || ext === '.yml';
    const isJson = ext === '.json';
    const isHtml = ext === '.html' || ext === '.htm';

    // Env / config files → outbound api + db + bucket signals
    if (isEnvFile(name) || isConfigFile(name)) {
      scanEnvConfig(content, relPath, collector);
    }

    // Helm values YAML → served hosts
    if (isValuesYaml(name) && isYaml) {
      scanHelmValues(content, relPath, collector);
    }

    // Keycloak adapter files → auth signals + identity.keycloakClientId
    if (isKeycloakFile(relPath, content)) {
      scanKeycloak(content, relPath, collector);
    }

    // Python route decorators → identity.endpoints
    if (isPy) {
      scanPythonRoutes(content, relPath, collector);
    }

    // JS/TS Express routes → identity.endpoints
    if (isJs) {
      scanJsRoutes(content, relPath, collector);
    }

    // iframes + ct_token → outbound embed
    if (isJs || isHtml) {
      scanEmbeds(content, relPath, collector);
    }

    // Pub/Sub topics → outbound pubsub + identity.ownedTopics
    scanPubSub(content, relPath, collector);

    // CORS origins → identity.servedHosts
    if (isPy || isJs) {
      scanCors(content, relPath, collector);
    }

    // GCS gs:// in code files → outbound bucket
    if (isPy || isJs || isYaml) {
      let m;
      const re = /gs:\/\/([a-zA-Z0-9._-]+)/g;
      while ((m = re.exec(content)) !== null) {
        const line = lineNumber(content, m.index);
        collector.addBucket(m[1]);
        collector.addOutbound('bucket', `gs://${m[1]}`, `${relPath}:${line}`);
      }
    }

    // Literal URLs in code/config → outbound api
    // Only in select file types to avoid noise
    if (isPy || isJs || isEnvFile(name) || isConfigFile(name) || isYaml || isJson) {
      scanLiteralUrls(content, relPath, collector);
    }
  }

  // Fallback: serviceName = repo basename
  if (!collector.identity.serviceName) {
    collector.identity.serviceName = basename(repoPath);
  }

  // Sort everything for determinism
  collector.outbound.sort((a, b) => {
    const ka = `${a.kind}|${a.value}|${a.evidence}`;
    const kb = `${b.kind}|${b.value}|${b.evidence}`;
    return ka.localeCompare(kb);
  });
  collector.identity.endpoints.sort();
  collector.identity.servedHosts.sort();
  collector.identity.ownedTopics.sort();
  collector.identity.ownedBuckets.sort();

  return {
    repo: basename(repoPath),
    namespace,
    identity: {
      serviceName: collector.identity.serviceName,
      keycloakClientId: collector.identity.keycloakClientId,
      servedHosts: collector.identity.servedHosts,
      endpoints: collector.identity.endpoints,
      ownedTopics: collector.identity.ownedTopics,
      ownedBuckets: collector.identity.ownedBuckets,
    },
    outbound: collector.outbound,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const [,, repoPath, repoNamespace, outPath] = process.argv;

if (!repoPath || !repoNamespace || !outPath) {
  process.stderr.write('Usage: node extract-crossrepo-signals.mjs <repoPath> <repoNamespace> <outPath>\n');
  process.exit(1);
}

const result = scan(repoPath, repoNamespace);
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
process.stderr.write(`[extract-crossrepo-signals] ${result.outbound.length} outbound signals, ${result.identity.endpoints.length} endpoints → ${outPath}\n`);

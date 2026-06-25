#!/usr/bin/env node
/**
 * extract-annotation-index.mjs — Phase 1.25 annotation pre-pass
 *
 * Scans project files for regex-pattern annotations (e.g. RULE-023, BCP-REL-307,
 * PRD-2990, Jira IDs, RFC numbers, ESLint rule refs) and writes a sidecar JSON
 * so the file-analyzer LLM phase can document them as typed edges without
 * discovering them from scratch (~30-50% Phase 2 token reduction for
 * annotation-heavy codebases).
 *
 * Usage:
 *   node extract-annotation-index.mjs [--pattern-file <path>] [--project-dir <path>]
 *   node extract-annotation-index.mjs --help
 *
 * Output:
 *   .understand-anything/intermediate/annotation-index.json
 *   { "src/foo.py": ["RULE-023", "BCP-REL-307", "PRD-2990"], ... }
 *
 * Pattern file format (.understand-anything/annotation-patterns.json):
 *   {
 *     "patterns": [
 *       { "name": "rule-ref",  "regex": "RULE-\\d+",           "edge_type": "enforces-rule"   },
 *       { "name": "bcp-ref",   "regex": "BCP-[A-Z]+-\\d+",     "edge_type": "implements-bcp"  },
 *       { "name": "prd-ref",   "regex": "PRD-\\d+",             "edge_type": "born-from-prd"   }
 *     ]
 *   }
 */

import fs from 'fs';
import path from 'path';

const ARGS = process.argv.slice(2);

if (ARGS.includes('--help') || ARGS.includes('-h')) {
  console.log(`
extract-annotation-index.mjs — annotation pre-pass for Understand-Anything

Usage:
  node extract-annotation-index.mjs [options]

Options:
  --pattern-file <path>   Path to annotation-patterns.json (default: .understand-anything/annotation-patterns.json)
  --project-dir  <path>   Root directory to scan (default: current working directory)
  --output       <path>   Output JSON path (default: .understand-anything/intermediate/annotation-index.json)
  --help                  Show this help

Pattern file format:
  {
    "patterns": [
      { "name": "rule-ref", "regex": "RULE-\\\\d+", "edge_type": "enforces-rule" }
    ]
  }

Exit codes:
  0 — success (index written, even if empty)
  1 — pattern file not found or invalid JSON
  2 — project dir not found
`);
  process.exit(0);
}

function getArg(flag, defaultVal) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : defaultVal;
}

const projectDir  = path.resolve(getArg('--project-dir', process.cwd()));
const outputPath  = path.resolve(getArg('--output', path.join(projectDir, '.understand-anything', 'intermediate', 'annotation-index.json')));
const patternFile = path.resolve(getArg('--pattern-file', path.join(projectDir, '.understand-anything', 'annotation-patterns.json')));

// --- Load pattern file ---
if (!fs.existsSync(patternFile)) {
  console.error(`[annotation-index] No pattern file at ${patternFile} — writing empty index.`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({}, null, 2));
  process.exit(0);
}

let patternConfig;
try {
  patternConfig = JSON.parse(fs.readFileSync(patternFile, 'utf8'));
} catch (e) {
  console.error(`[annotation-index] Invalid JSON in pattern file: ${e.message}`);
  process.exit(1);
}

const patterns = (patternConfig.patterns || []).map(p => ({
  name:      p.name,
  regex:     new RegExp(p.regex, 'g'),
  edge_type: p.edge_type || 'annotation-ref',
}));

if (patterns.length === 0) {
  console.log('[annotation-index] No patterns defined — writing empty index.');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({}, null, 2));
  process.exit(0);
}

// --- File extensions to scan ---
const SCAN_EXTENSIONS = new Set([
  '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.cs',
  '.md', '.yaml', '.yml', '.json', '.toml', '.sh', '.bash',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  '.understand-anything', 'dist', 'build', '.cache',
]);

// --- Walk project directory ---
function walkDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

if (!fs.existsSync(projectDir)) {
  console.error(`[annotation-index] Project dir not found: ${projectDir}`);
  process.exit(2);
}

const files = walkDir(projectDir);
console.log(`[annotation-index] Scanning ${files.length} files with ${patterns.length} pattern(s)...`);

// --- Extract annotations ---
const index = {};
let totalMatches = 0;

for (const filePath of files) {
  const relPath = path.relative(projectDir, filePath);
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    continue; // skip unreadable files (binary, permissions)
  }

  const found = new Set();
  for (const { regex } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      found.add(match[0]);
    }
  }

  if (found.size > 0) {
    index[relPath] = [...found].sort();
    totalMatches += found.size;
  }
}

// --- Write output ---
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));

const fileCount = Object.keys(index).length;
console.log(`[annotation-index] Done. ${fileCount} file(s) with annotations, ${totalMatches} total matches.`);
console.log(`[annotation-index] Output: ${outputPath}`);

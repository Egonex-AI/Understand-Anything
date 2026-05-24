#!/usr/bin/env bash
# harnesses/kiro/run-understand.sh
#
# Standalone orchestrator for Understand-Anything that works outside Claude Code.
# Designed for Kiro, Codex, or any agent that can invoke shell scripts.
#
# This runs the deterministic pipeline (tree-sitter extraction, merge, normalize)
# and optionally calls an LLM for summaries/layers/tours via the LiteLLM adapter.
#
# Usage:
#   ./run-understand.sh [PROJECT_DIR] [OPTIONS]
#
# Options:
#   --full            Force full rebuild
#   --no-llm          Skip LLM-dependent steps (summaries, layers, tours)
#   --local           Use local LLM (LM Studio on localhost:1234)
#   --ollama [MODEL]  Use Ollama (localhost:11434, default model: llama3)
#   --language LANG   Language for generated content (default: en)
#   --model MODEL     Override LITELLM_MODEL
#   --port PORT       Override the local LLM port
#
# Environment:
#   LITELLM_BASE_URL, LITELLM_API_KEY, LITELLM_MODEL (see harnesses/litellm/)
#   PLUGIN_ROOT       Override plugin root detection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$HARNESS_ROOT/.." && pwd)"

# --- Argument parsing ---
PROJECT_DIR=""
FULL_REBUILD=false
NO_LLM=false
LANGUAGE="en"
LOCAL_PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) FULL_REBUILD=true; shift ;;
    --no-llm) NO_LLM=true; shift ;;
    --local)
      export LITELLM_BASE_URL="http://localhost:${LOCAL_PORT:-1234}"
      export LITELLM_API_KEY="${LITELLM_API_KEY:-lm-studio}"
      export LITELLM_MODEL="${LITELLM_MODEL:-local-model}"
      shift ;;
    --ollama)
      export LITELLM_BASE_URL="http://localhost:${LOCAL_PORT:-11434}"
      export LITELLM_API_KEY="${LITELLM_API_KEY:-ollama}"
      # Check if next arg is a model name (not a flag)
      if [[ "${2:-}" != "" && "${2:-}" != --* ]]; then
        export LITELLM_MODEL="$2"; shift
      else
        export LITELLM_MODEL="${LITELLM_MODEL:-llama3}"
      fi
      shift ;;
    --language) LANGUAGE="$2"; shift 2 ;;
    --model) export LITELLM_MODEL="$2"; shift 2 ;;
    --port) LOCAL_PORT="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) PROJECT_DIR="$1"; shift ;;
  esac
done

PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

# --- Resolve PLUGIN_ROOT ---
if [[ -z "${PLUGIN_ROOT:-}" ]]; then
  PLUGIN_ROOT="$REPO_ROOT/understand-anything-plugin"
fi

if [[ ! -f "$PLUGIN_ROOT/package.json" ]]; then
  echo "Error: PLUGIN_ROOT not found at $PLUGIN_ROOT" >&2
  echo "Set PLUGIN_ROOT env var or run from the repo root." >&2
  exit 1
fi

# --- Ensure core is built ---
CORE_DIST="$PLUGIN_ROOT/packages/core/dist"
if [[ ! -d "$CORE_DIST" ]]; then
  echo "→ Building @understand-anything/core..."
  (cd "$PLUGIN_ROOT" && pnpm install --frozen-lockfile 2>/dev/null || npm install)
  (cd "$PLUGIN_ROOT/packages/core" && npx tsc)
fi

# --- Output directory ---
OUTPUT_DIR="$PROJECT_DIR/.understand-anything"
mkdir -p "$OUTPUT_DIR/intermediate"

LLM_CLIENT="$HARNESS_ROOT/litellm/llm-client.mjs"

echo "═══════════════════════════════════════════════"
echo " Understand-Anything (standalone pipeline)"
echo " Project: $PROJECT_DIR"
echo " Output:  $OUTPUT_DIR"
echo " LLM:     $(if $NO_LLM; then echo 'disabled'; else echo "${LITELLM_BASE_URL:-http://localhost:4000} / ${LITELLM_MODEL:-gpt-4o}"; fi)"
echo "═══════════════════════════════════════════════"

# --- Phase 1: Scan project files and extract structure ---
echo ""
echo "▶ Phase 1: Scanning project & extracting structure (tree-sitter)..."

SCAN_INPUT="$OUTPUT_DIR/intermediate/scan-input.json"
EXTRACT_OUT="$OUTPUT_DIR/intermediate/structure.json"

# Generate the input JSON that extract-structure.mjs expects.
# This replaces the project-scanner agent's output.
node --input-type=module -e "
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative, extname } from 'path';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

const projectRoot = process.argv[1];
const outputPath = process.argv[2];

// Extension to language mapping
const EXT_MAP = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python', '.rb': 'ruby',
  '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.c': 'c', '.h': 'c', '.hpp': 'cpp',
  '.php': 'php', '.swift': 'swift', '.lua': 'lua',
  '.sh': 'shell', '.bash': 'shell', '.ps1': 'powershell', '.bat': 'batch',
  '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql', '.proto': 'protobuf',
  '.tf': 'terraform', '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json',
  '.toml': 'toml', '.md': 'markdown', '.rst': 'restructuredtext',
  '.html': 'html', '.css': 'css', '.scss': 'css',
  '.xml': 'xml', '.env': 'env',
};

const EXCLUDE = /node_modules|\.git\/|vendor\/|venv\/|__pycache__|dist\/|build\/|\.next\/|coverage\//;
const BINARY_EXT = /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp3|mp4|pdf|zip|tar|gz|lock)$/;

// Get file list
let files;
try {
  const out = execSync('git ls-files', { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 10*1024*1024 });
  files = out.trim().split('\n').filter(Boolean);
} catch {
  // Fallback: walk directory (simplified)
  files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(projectRoot, full);
      if (EXCLUDE.test(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else files.push(rel);
    }
  }
  walk(projectRoot);
}

// Filter and classify
const batchFiles = [];
for (const f of files) {
  if (EXCLUDE.test(f) || BINARY_EXT.test(f)) continue;
  const ext = extname(f).toLowerCase();
  const language = EXT_MAP[ext] || 'plaintext';
  const isCode = !['yaml','json','toml','markdown','restructuredtext','html','css','xml','env','plaintext'].includes(language);
  let sizeLines = 0;
  try {
    const content = readFileSync(join(projectRoot, f), 'utf-8');
    sizeLines = content.split('\n').length;
  } catch { continue; }
  batchFiles.push({ path: f, language, sizeLines, fileCategory: isCode ? 'code' : 'config' });
}

const output = { projectRoot, batchFiles, batchImportData: null };
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log('  Scanned ' + batchFiles.length + ' files');
" "$PROJECT_DIR" "$SCAN_INPUT"

# Run tree-sitter extraction
node "$PLUGIN_ROOT/skills/understand/extract-structure.mjs" "$SCAN_INPUT" "$EXTRACT_OUT"
echo "  ✓ Structure extracted → $EXTRACT_OUT ($(grep -c '"path"' "$EXTRACT_OUT" 2>/dev/null || echo '?') files)"

# --- Phase 2: Build fingerprints ---
echo ""
echo "▶ Phase 2: Building fingerprints..."
FINGERPRINT_SCRIPT="$PLUGIN_ROOT/skills/understand/build-fingerprints.mjs"
FINGERPRINT_OUT="$OUTPUT_DIR/fingerprints.json"

if [[ -f "$FINGERPRINT_SCRIPT" ]]; then
  node "$FINGERPRINT_SCRIPT" "$PROJECT_DIR" "$FINGERPRINT_OUT" 2>/dev/null && \
    echo "  ✓ Fingerprints → $FINGERPRINT_OUT" || \
    echo "  ⊘ Fingerprint generation skipped (non-fatal)"
else
  echo "  ⊘ Fingerprint script not found, skipping"
fi

# --- Phase 3: LLM analysis (optional) ---
if ! $NO_LLM; then
  echo ""
  echo "▶ Phase 3: LLM analysis (project summary)..."

  # Build a file list summary for the LLM
  FILE_LIST=$(node -e "
    const data = JSON.parse(require('fs').readFileSync('$EXTRACT_OUT','utf-8'));
    const summary = data.results.slice(0, 60).map(r => r.path + ' (' + r.language + ', ' + (r.metrics?.totalLines||'?') + ' lines)').join('\n');
    process.stdout.write(summary);
  " 2>/dev/null || echo "(could not read structure)")

  SUMMARY_PROMPT="You are a code analysis assistant. Given this file list from a project, produce a JSON object with:
- \"description\": 2-3 sentence project description
- \"frameworks\": array of detected frameworks/libraries
- \"layers\": array of {\"name\": string, \"description\": string, \"filePatterns\": string[]}

File list:
$FILE_LIST

Respond ONLY with valid JSON, no markdown fences."

  echo "$SUMMARY_PROMPT" | node "$LLM_CLIENT" > "$OUTPUT_DIR/intermediate/project-summary.json" 2>/dev/null && \
    echo "  ✓ Project summary generated" || \
    echo "  ⚠ Project summary failed (LLM unreachable?)"
else
  echo ""
  echo "▶ Phase 3: Skipped (--no-llm)"
fi

# --- Phase 4: Merge and normalize ---
echo ""
echo "▶ Phase 4: Merging graph..."
MERGE_SCRIPT="$PLUGIN_ROOT/skills/understand/merge-batch-graphs.py"

if [[ -f "$MERGE_SCRIPT" ]]; then
  python3 "$MERGE_SCRIPT" \
    --input "$OUTPUT_DIR/intermediate" \
    --output "$OUTPUT_DIR/knowledge-graph.json" \
    2>/dev/null && \
    echo "  ✓ Knowledge graph → $OUTPUT_DIR/knowledge-graph.json" || \
    echo "  ⚠ Merge script failed — falling back to structure-only graph"
fi

# If merge didn't produce output, build a minimal graph from structure
if [[ ! -f "$OUTPUT_DIR/knowledge-graph.json" ]]; then
  node -e "
    const fs = require('fs');
    const structure = JSON.parse(fs.readFileSync('$EXTRACT_OUT', 'utf-8'));
    const summary = fs.existsSync('$OUTPUT_DIR/intermediate/project-summary.json')
      ? JSON.parse(fs.readFileSync('$OUTPUT_DIR/intermediate/project-summary.json', 'utf-8'))
      : {};
    const graph = {
      project: {
        name: require('path').basename('$PROJECT_DIR'),
        description: summary.description || 'Analyzed project',
        languages: [...new Set(structure.results.map(r => r.language))],
        frameworks: summary.frameworks || [],
        analyzedAt: new Date().toISOString(),
      },
      nodes: structure.results.map(r => ({
        id: 'file:' + r.path,
        type: 'file',
        name: require('path').basename(r.path),
        filePath: r.path,
        summary: '',
        tags: [r.language, r.fileCategory].filter(Boolean),
        complexity: r.metrics?.totalLines > 300 ? 'complex' : r.metrics?.totalLines > 100 ? 'moderate' : 'simple',
      })),
      edges: [],
      layers: summary.layers || [],
      tour: [],
    };
    // Add function/class nodes from structure
    for (const r of structure.results) {
      if (r.functions) {
        for (const fn of r.functions) {
          graph.nodes.push({ id: 'function:' + r.path + ':' + fn.name, type: 'function', name: fn.name, filePath: r.path, summary: '', tags: [], complexity: 'simple' });
          graph.edges.push({ source: 'file:' + r.path, target: 'function:' + r.path + ':' + fn.name, type: 'contains', direction: 'forward', weight: 1 });
        }
      }
      if (r.classes) {
        for (const cls of r.classes) {
          graph.nodes.push({ id: 'class:' + r.path + ':' + cls.name, type: 'class', name: cls.name, filePath: r.path, summary: '', tags: [], complexity: 'moderate' });
          graph.edges.push({ source: 'file:' + r.path, target: 'class:' + r.path + ':' + cls.name, type: 'contains', direction: 'forward', weight: 1 });
        }
      }
      if (r.imports) {
        for (const imp of r.imports) {
          graph.edges.push({ source: 'file:' + r.path, target: 'file:' + imp.resolvedPath, type: 'imports', direction: 'forward', weight: 0.5 });
        }
      }
    }
    fs.writeFileSync('$OUTPUT_DIR/knowledge-graph.json', JSON.stringify(graph, null, 2));
  " 2>/dev/null
  echo "  ✓ Knowledge graph (structure-based) → $OUTPUT_DIR/knowledge-graph.json"
fi

# --- Done ---
NODES=$(grep -c '"id"' "$OUTPUT_DIR/knowledge-graph.json" 2>/dev/null || echo "?")
echo ""
echo "═══════════════════════════════════════════════"
echo " ✓ Done! ($NODES nodes in graph)"
echo ""
echo "   Open the dashboard:"
echo "     cd $PLUGIN_ROOT/packages/dashboard && npx vite --open"
echo ""
echo "   Or from Kiro: /understand-dashboard"
echo "═══════════════════════════════════════════════"

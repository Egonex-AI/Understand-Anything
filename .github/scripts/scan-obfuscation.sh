#!/usr/bin/env bash
# Supply-chain obfuscation scanner
# Scans PR diffs for patterns commonly found in malicious supply-chain attacks:
#   - Obfuscated code (packed, shuffled, base64-encoded, hex-encoded)
#   - Suspicious global/prototype assignments in build config files
#   - Hidden eval / Function constructor calls
#   - Large diffs dominated by non-human-readable strings
#
# Exit 0 = clean. Exit 1 = suspicious patterns found (review required).

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

WARNINGS=0

check_pattern() {
  local label="$1"
  local pattern="$2"
  local severity="${3:-WARN}"

  if grep -n -P "$pattern" /tmp/pr-diff.txt 2>/dev/null; then
    echo -e "${RED}[${severity}]${NC} $label — matches found (see above)"
    WARNINGS=$((WARNINGS + 1))
  fi
}

echo "::group::Obfuscation Scan"

# ---------------------------------------------------------------------------
# 1. OBFUSCATION PATTERNS
# ---------------------------------------------------------------------------

echo "→ Scanning for obfuscation patterns..."

# Packed/obfuscated code blocks (long base64-like strings, hex chains)
check_pattern \
  "Packed/obfuscated JavaScript blob (self-decoding function pattern)" \
  '(\w+),\s*\w+\s*=\s*function\s*\(\w+,\s*\w+,\s*\w+\)' \
  "HIGH"

# Large base64 strings (potential hidden payloads)
check_pattern \
  "Large base64-encoded string (≥100 chars, potential hidden payload)" \
  '['\''"][A-Za-z0-9+/=]{100,}['\''"]' \
  "HIGH"

# Hex-encoded strings
check_pattern \
  "Hex-encoded string ≥40 chars" \
  '\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}' \
  "MEDIUM"

# String-shuffle decoders
check_pattern \
  "String-shuffle / deobfuscation wrapper" \
  '\[\]\s*=\s*\(\w+\[\]\[\w+\]\+"\w+"\)' \
  "HIGH"

# ---------------------------------------------------------------------------
# 2. DANGEROUS RUNTIME PATTERNS IN BUILD FILES
# ---------------------------------------------------------------------------

echo "→ Scanning for suspicious patterns in build-config files..."

for pattern in 'global\['\''[!$]'\''\]' 'global\s*=\s*global'; do
  for match in $(grep -l "$pattern" /tmp/pr-diff.txt 2>/dev/null || true); do
    echo -e "${RED}[HIGH]${NC} Suspicious global assignment in build/config file: $match"
    WARNINGS=$((WARNINGS + 1))
  done
done

# ---------------------------------------------------------------------------
# 3. HIDDEN CODE EXECUTION
# ---------------------------------------------------------------------------

echo "→ Scanning for hidden code execution..."

# eval / Function / setTimeout with long strings (> 80 chars, likely obfuscated)
check_pattern \
  "Hidden eval/Function call with large argument" \
  '(?:eval|Function|setTimeout|setInterval)\s*\(\s*['\''"`][^)]{80,}['\''"`]\s*\)' \
  "HIGH"

# require/module rebinding
check_pattern \
  "require/module rebinding via global" \
  'global\[.*\]\s*=\s*require' \
  "CRITICAL"

# ---------------------------------------------------------------------------
# 4. FILE-TYPE TARGETING
# ---------------------------------------------------------------------------

echo "→ Checking for targeted build-config file modifications..."

# Check if the PR modifies config files that auto-execute
CONFIG_FILES=(
  'astro.config.mjs'
  'astro.config.ts'
  'vite.config.ts'
  'vite.config.js'
  'next.config.js'
  'next.config.mjs'
  'webpack.config.js'
  '.npmrc'
  '.env'
  'package.json'
)

for cf in "${CONFIG_FILES[@]}"; do
  if grep -q "^.*${cf}\$" /tmp/pr-diff.txt 2>/dev/null; then
    echo -e "${YELLOW}[INFO]${NC} PR modifies auto-exec config file: $cf — requires manual review"
    WARNINGS=$((WARNINGS + 1))
  fi
done

echo "::endgroup::"

# ---------------------------------------------------------------------------
# RESULT
# ---------------------------------------------------------------------------

if [ "$WARNINGS" -gt 0 ]; then
  echo ""
  echo "⚠️  $WARNINGS suspicious pattern(s) detected — manual security review required before merging."
  echo "    See https://github.com/Egonex-AI/Understand-Anything/security/advisories for guidance."
  exit 1
else
  echo "✅ No supply-chain obfuscation patterns detected."
  exit 0
fi
#!/usr/bin/env bash
# Activate a locally prepared, independently approved release.
set -euo pipefail

# Compatibility table (also checked by the platform consistency test).
platforms_table() {
  cat <<EOF
gemini|$HOME/.agents/skills|per-skill
codex|$HOME/.agents/skills|per-skill
opencode|$HOME/.agents/skills|per-skill
pi|$HOME/.agents/skills|per-skill
openclaw|$HOME/.openclaw/skills|folder
antigravity|$HOME/.gemini/antigravity/skills|folder
vibe|$HOME/.vibe/skills|per-skill
vscode|$HOME/.copilot/skills|per-skill
hermes|$HOME/.hermes/skills|folder
cline|$HOME/.cline/skills|folder
kimi|$HOME/.kimi-code/skills|folder
trae|$HOME/.trae/skills|per-skill
nanobot|$HOME/.nanobot/workspace/skills|per-skill
kiro|$HOME/.kiro/skills|per-skill
devin|$HOME/.agents/skills|per-skill
EOF
}


ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec python3 "$ROOT/scripts/secure-install.py" "$@"

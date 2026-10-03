#!/usr/bin/env bash
#
# preflight.sh
#
# Verifies that the shell environment has the tools `/understand` depends on
# (Node.js >= 22 and pnpm) before any later phase tries to invoke them.
#
# Why this exists: Phase 7 step 2 runs `node build-fingerprints.mjs` to
# produce the structural-fingerprint baseline. If `node` isn't reachable in
# the current shell, that step silently fails and Phase 7 step 3 advances
# `meta.json` to the new commit hash anyway — leaving the project in a state
# where every subsequent auto-update sees "no stored fingerprint" for every
# file, classifies them all as STRUCTURAL, and escalates to FULL_UPDATE
# permanently (issue #152 family).
#
# Most common cause: Claude Code, Cursor, opencode, and similar agents spawn
# non-interactive Bash subshells when running tool calls. Those shells don't
# source ~/.zshrc or ~/.bashrc. If a user installed Node via nvm / fnm /
# mise / asdf and only hooked the shim into the interactive rc file, the
# subshell sees no `node` on PATH even though `node --version` works in the
# user's regular terminal.
#
# Exit codes:
#   0  — node (>= 22) and pnpm are both reachable
#   1  — at least one prerequisite is missing or incompatible (stderr names which)
#
# Tested by: tests/skill/understand/test_preflight.test.mjs

set -u

# ---- node present ---------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Error: `node` is not on PATH in this shell.

Claude Code (and similar agents) spawn non-interactive shells that may not
source your shell's interactive rc file (~/.zshrc, ~/.bashrc).

If you use nvm / fnm / mise / asdf, source the shim from a file loaded by
non-interactive shells (~/.zshenv on zsh, ~/.bash_profile on bash) rather
than only the interactive rc file. For example, on zsh + mise:

  echo 'eval "$(mise activate zsh)"' >> ~/.zshenv

Then restart Claude Code (or your agent) and re-run /understand.
EOF
  exit 1
fi

# ---- node >= 22 -----------------------------------------------------------

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo "")
if [ -z "$NODE_MAJOR" ]; then
  echo "Error: \`node\` is on PATH but \`node -e\` failed. Reinstall Node.js >= 22." >&2
  exit 1
fi

if [ "$NODE_MAJOR" -lt 22 ]; then
  cat >&2 <<EOF
Error: Node.js >= 22 required, found $(node --version 2>/dev/null || echo unknown).

Upgrade Node (https://nodejs.org/) and re-run /understand.
EOF
  exit 1
fi

# ---- pnpm present ---------------------------------------------------------

if ! command -v pnpm >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Error: `pnpm` is not on PATH (Node.js >= 22 and pnpm >= 10 are both required).

Install pnpm (https://pnpm.io/installation) and re-run /understand.
EOF
  exit 1
fi

# All preflight checks passed. Print a single line so callers (and tests)
# can confirm the script actually ran, since silent success is itself a
# failure mode worth detecting.
echo "preflight: node $(node --version), pnpm $(pnpm --version)"
exit 0

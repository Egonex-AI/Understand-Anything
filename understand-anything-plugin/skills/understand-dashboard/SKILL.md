---
name: understand-dashboard
description: Launch the interactive web dashboard to visualize a codebase's knowledge graph
argument-hint: "[project-path]"
---

# /understand-dashboard

Start the Understand Anything dashboard to visualize the knowledge graph for the current project.

## Instructions

1. Determine the project directory and data directory:
   - If `$ARGUMENTS` contains a path, use that as the project directory
   - Otherwise, use the current working directory
   - Prefer the legacy `.understand-anything/` data directory when it exists, otherwise use `.ua/`

   Use the Bash tool to resolve:
   ```bash
   PROJECT_ARG="$ARGUMENTS"
   if [ -n "$PROJECT_ARG" ]; then
     PROJECT_DIR=$(cd "$PROJECT_ARG" 2>/dev/null && pwd -P)
   else
     PROJECT_DIR=$(pwd -P)
   fi

   if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
     echo "Error: Project directory not found: ${PROJECT_ARG:-$PWD}"
     exit 1
   fi

   if [ -d "$PROJECT_DIR/.understand-anything" ]; then
     UA_DIR="$PROJECT_DIR/.understand-anything"
   else
     UA_DIR="$PROJECT_DIR/.ua"
   fi
   ```

2. Check that `$UA_DIR/knowledge-graph.json` exists in the project directory. If not, tell the user:
   ```
   No knowledge graph found. Run /understand first to analyze this project.
   ```

   Use the Bash tool to check:
   ```bash
   if [ ! -f "$UA_DIR/knowledge-graph.json" ]; then
     echo "No knowledge graph found. Run /understand first to analyze this project."
     exit 1
   fi
   ```

3. Find the dashboard code. The dashboard is at `packages/dashboard/` relative to this plugin's root directory. Check these paths in order and use the first that exists:
   - `${CLAUDE_PLUGIN_ROOT}/packages/dashboard/` (Claude Code runtime root, highest priority)
   - `~/.understand-anything-plugin/packages/dashboard/` (universal symlink, all installs)
   - Two levels up from `~/.agents/skills/understand-dashboard` real path (self-relative fallback)
   - Two levels up from `~/.copilot/skills/understand-dashboard` real path (Copilot personal skills fallback)
   - Common clone-based install roots:
     - `~/.codex/understand-anything/understand-anything-plugin/packages/dashboard/`
     - `~/.opencode/understand-anything/understand-anything-plugin/packages/dashboard/`
     - `~/.pi/understand-anything/understand-anything-plugin/packages/dashboard/`
     - `~/understand-anything/understand-anything-plugin/packages/dashboard/`

   Use the Bash tool to resolve:
   ```bash
   SKILL_REAL=$(realpath ~/.agents/skills/understand-dashboard 2>/dev/null || readlink -f ~/.agents/skills/understand-dashboard 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/understand-dashboard 2>/dev/null || readlink -f ~/.copilot/skills/understand-dashboard 2>/dev/null || echo "")
   COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

   PLUGIN_ROOT=""
   for candidate in \
     "${CLAUDE_PLUGIN_ROOT}" \
     "$HOME/.understand-anything-plugin" \
     "$SELF_RELATIVE" \
     "$COPILOT_SELF_RELATIVE" \
     "$HOME/.codex/understand-anything/understand-anything-plugin" \
     "$HOME/.opencode/understand-anything/understand-anything-plugin" \
     "$HOME/.pi/understand-anything/understand-anything-plugin" \
     "$HOME/understand-anything/understand-anything-plugin"; do
     if [ -n "$candidate" ] && [ -d "$candidate/packages/dashboard" ]; then
       PLUGIN_ROOT="$candidate"; break
     fi
   done

   if [ -z "$PLUGIN_ROOT" ]; then
     echo "Error: Cannot find the understand-anything plugin root."
     echo "Checked:"
     echo "  - ${CLAUDE_PLUGIN_ROOT:-<unset CLAUDE_PLUGIN_ROOT>}"
     echo "  - $HOME/.understand-anything-plugin"
     echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/understand-dashboard>}"
     echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/understand-dashboard>}"
     echo "  - $HOME/.codex/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.opencode/understand-anything/understand-anything-plugin"
     echo "  - $HOME/.pi/understand-anything/understand-anything-plugin"
     echo "  - $HOME/understand-anything/understand-anything-plugin"
     echo "Make sure you followed the installation instructions for your platform."
     exit 1
   fi

   DASHBOARD_DIR="$PLUGIN_ROOT/packages/dashboard"
   ```

4. **Fast path — try the prebuilt viewer first (no install, no build).** Each GitHub release ships a self-contained viewer tarball. Run it pinned to the installed plugin version, and **automatically fall back to the latest published release if that version has no viewer asset** (the plugin's `package.json` version can be ahead of the latest published viewer — e.g. `2.9.4` with no release while the viewer ships under `2.9.0`):
   ```bash
   : "${PLUGIN_ROOT:?Run step 3 first so PLUGIN_ROOT is set}"
   : "${PROJECT_DIR:?Run step 1 first so PROJECT_DIR is set}"
   DASH_LOG=/tmp/ua-dashboard.log
   : > "$DASH_LOG"

   launch_viewer () {
     local ver="$1"
     local url="https://github.com/Egonex-AI/Understand-Anything/releases/download/v${ver}/understand-anything-viewer.tgz"
     echo ">> trying viewer v${ver}" | tee -a "$DASH_LOG"
     npx --yes "$url" "$PROJECT_DIR" >> "$DASH_LOG" 2>&1 &
     local pid=$!
     for i in $(seq 1 40); do
       if grep -q "Dashboard URL" "$DASH_LOG" 2>/dev/null; then
         echo ">> viewer v${ver} started (pid $pid)" | tee -a "$DASH_LOG"
         return 0
       fi
       if ! kill -0 "$pid" 2>/dev/null; then
         echo ">> viewer v${ver} failed/exited (asset likely missing)" | tee -a "$DASH_LOG"
         return 1
       fi
       sleep 1
     done
     echo ">> viewer v${ver} had no Dashboard URL within 40s" | tee -a "$DASH_LOG"
     return 1
   }

   PLUGIN_VERSION=$(node -p "require('$PLUGIN_ROOT/package.json').version")
   LAUNCHED=""
   if launch_viewer "$PLUGIN_VERSION"; then
     LAUNCHED="$PLUGIN_VERSION"
   else
     # Fallback: the pinned version has no published viewer — use the latest release.
     echo ">> version-pinned viewer unavailable, resolving latest release…" | tee -a "$DASH_LOG"
     LATEST=$( (gh release list --repo Egonex-AI/Understand-Anything --limit 1 --json tagName -q '.[0].tagName' 2>/dev/null) \
               || (curl -fsSL https://api.github.com/repos/Egonex-AI/Understand-Anything/releases/latest 2>/dev/null \
                   | grep -o '"tag_name": *"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)".*/\1/') )
     echo ">> latest release: $LATEST" | tee -a "$DASH_LOG"
     if [ -n "$LATEST" ] && launch_viewer "${LATEST#v}"; then
       LAUNCHED="$LATEST"
     fi
   fi

   if [ -n "$LAUNCHED" ]; then
     URL=$(grep -o 'http://127.0.0.1:[0-9]*/?token=[a-f0-9]*' "$DASH_LOG" | head -1)
     echo "LAUNCHED_VERSION=$LAUNCHED"
     [ -n "$URL" ] && echo "DASHBOARD_URL=$URL"
   else
     echo ">> prebuilt viewer unavailable; falling back to local build (steps 5-6)."
   fi
   ```
   Run this in the background (the script backgrounds `npx` internally and polls up to 40s for the `🔑  Dashboard URL` line). Read the result from `/tmp/ua-dashboard.log` — the `DASHBOARD_URL=` line has the full tokenized URL:
   - If a viewer launched, **skip steps 5-6** and continue at step 7.
   - If neither the pinned nor the latest-release viewer launched (no network, or no release assets at all), fall back to the local build in steps 5-6.

5. Fallback: install dependencies and build if needed:
   ```bash
   : "${PLUGIN_ROOT:?Run step 3 first so PLUGIN_ROOT is set}"
   DASHBOARD_DIR="${DASHBOARD_DIR:-$PLUGIN_ROOT/packages/dashboard}"
   cd "$DASHBOARD_DIR" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
   ```
   Then ensure the core package is built (the dashboard depends on it):
   ```bash
   : "${PLUGIN_ROOT:?Run step 3 first so PLUGIN_ROOT is set}"
   cd "$PLUGIN_ROOT" && pnpm --filter @understand-anything/core build
   ```

6. Fallback: start the Vite dev server pointing at the project's knowledge graph:
   ```bash
   : "${PROJECT_DIR:?Run step 1 first so PROJECT_DIR is set}"
   : "${DASHBOARD_DIR:?Run step 5 first so DASHBOARD_DIR is set}"
   cd "$DASHBOARD_DIR" && GRAPH_DIR="$PROJECT_DIR" npx vite --host 127.0.0.1
   ```
   Run this in the background so the user can continue working.

7. **Capture the access token URL from the server output.** The server (viewer or Vite) prints a line like:
   ```
   🔑  Dashboard URL: http://127.0.0.1:<PORT>?token=<TOKEN>
   ```
   Extract the full URL including the `?token=` parameter. The token is required to access the knowledge graph data — without it the dashboard will show an "Access Token Required" gate.

8. Report to the user, including the full tokenized URL:
   ```
   Dashboard started at http://127.0.0.1:<PORT>?token=<TOKEN>
   Viewing: $UA_DIR/knowledge-graph.json

   The dashboard is running in the background. Press Ctrl+C in the terminal to stop it.
   ```
   **Important:** Always include the `?token=` parameter in the URL you share. If you omit it, the user will be blocked by the token gate and have to manually find the token in the terminal output.

## Notes

- The fast path (step 4) downloads a self-contained viewer from the GitHub release — nothing is installed into the plugin directory and no build runs. It first tries the version pinned in the plugin's `package.json`, then **automatically falls back to the latest published release** if that version has no viewer asset (the plugin version can be ahead of the latest published viewer, e.g. `2.9.4` with no release while the viewer ships under `2.9.0`).
- The viewer's tokenized URL is printed to the terminal as `DASHBOARD_URL=...` and also logged to `/tmp/ua-dashboard.log`.
- The dashboard auto-opens in the default browser (both the viewer and Vite's `--open`)
- If port 5173 is already in use, the next available port is picked (both paths)
- In the fallback, the `GRAPH_DIR` environment variable tells the dev server where to find the knowledge graph

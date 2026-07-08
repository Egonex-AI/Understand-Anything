---
name: understand-dashboard
description: Launch the interactive web dashboard to visualize a codebase's knowledge graph
argument-hint: "[project-path]"
---

# /understand-dashboard

Start the Understand Anything dashboard to visualize the knowledge graph for the current project.

## Instructions

1. Determine the project directory:
   - If `$ARGUMENTS` contains a path, use that as the project directory
   - Otherwise, use the current working directory

2. Check that `.understand-anything/knowledge-graph.json` exists in the project directory. If not, tell the user:
   ```
   No knowledge graph found. Run /understand first to analyze this project.
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
   ```

4. Install dependencies and build if needed:
   ```bash
   cd <dashboard-dir> && pnpm install --frozen-lockfile 2>/dev/null || pnpm install
   ```
   Then ensure the core package is built (the dashboard depends on it):
   ```bash
   cd <plugin-root> && pnpm --filter @understand-anything/core build
   ```

5. **Detect whether this is a remote / headless session.** A localhost-only bind
   (the default) cannot be reached from the user's browser when Vite runs on a
   different machine, and Vite rejects domain-name `Host` headers with
   `Blocked request. This host ("…") is not allowed.` Check for a remote session:
   ```bash
   [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_TTY" ] || [ -n "$SSH_CLIENT" ] && echo remote || echo local
   ```
   - If the result is `local`, skip to step 6 and launch with defaults.
   - If the result is `remote`, **ask the user** which host they will open the
     dashboard from, e.g.:
     ```
     It looks like you're running on a remote machine. Which hostname or IP
     will you open the dashboard from in your browser?
     (e.g. mybox.example.com or 203.0.113.5 — press enter to keep localhost-only)
     ```
     Remember their answer as `<remote-host>`. If they skip / press enter, treat
     this as a local session and launch with defaults.

6. Start the Vite dev server pointing at the project's knowledge graph.

   **Local session** (default — binds to localhost only):
   ```bash
   cd <dashboard-dir> && GRAPH_DIR=<project-dir> npx vite --host 127.0.0.1
   ```

   **Remote session** (user provided `<remote-host>` in step 5):
   ```bash
   cd <dashboard-dir> && GRAPH_DIR=<project-dir> \
     UNDERSTAND_HOST=0.0.0.0 \
     UNDERSTAND_ALLOWED_HOSTS=<remote-host> \
     npx vite
   ```
   `UNDERSTAND_HOST=0.0.0.0` accepts connections from outside localhost, and
   `UNDERSTAND_ALLOWED_HOSTS` whitelists the `Host` header so Vite stops blocking
   it. The one-time access token still gates every data endpoint.

   Run this in the background so the user can continue working.

7. **Capture the access token URL from the server output.** The Vite server prints a line like:
   ```
   🔑  Dashboard URL: http://127.0.0.1:<PORT>?token=<TOKEN>
   ```
   Extract the `?token=` value — it is required to access the knowledge graph
   data; without it the dashboard shows an "Access Token Required" gate. The
   printed line always shows `127.0.0.1`; for a remote session substitute
   `<remote-host>` for the host portion when reporting the URL.

8. Report to the user, including the full tokenized URL (use `<remote-host>`
   instead of `127.0.0.1` for a remote session):
   ```
   Dashboard started at http://<host>:<PORT>?token=<TOKEN>
   Viewing: <project-dir>/.understand-anything/knowledge-graph.json

   The dashboard is running in the background. Press Ctrl+C in the terminal to stop it.
   ```
   **Important:** Always include the `?token=` parameter in the URL you share. If you omit it, the user will be blocked by the token gate and have to manually find the token in the terminal output.

## Notes

- The dashboard auto-opens in the default browser via `--open`
- If port 5173 is already in use, Vite will pick the next available port
- The `GRAPH_DIR` environment variable tells the dashboard where to find the knowledge graph

### Serving from a remote VM

By default the dev server binds to `127.0.0.1` and Vite rejects requests whose `Host` header is a domain name with `Blocked request. This host ("example.com") is not allowed.` To serve the dashboard from a remote machine accessed via a domain or public IP, set these environment variables before launching Vite:

```bash
GRAPH_DIR=<project-dir> \
UNDERSTAND_HOST=0.0.0.0 \
UNDERSTAND_ALLOWED_HOSTS=example.com,example1.com \
npx vite
```

- `UNDERSTAND_HOST` — bind address (use `0.0.0.0` to accept connections from outside localhost). Equivalent to `--host`.
- `UNDERSTAND_ALLOWED_HOSTS` — comma-separated list of allowed `Host` headers. Use `all` (or `true`/`*`) to disable the check entirely. Leave unset to keep the strict localhost-only default.

The one-time access token is still required, so only people with the tokenized URL can read the knowledge graph.

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

3. Resolve the local plugin root.

Resolve the physical directory of the loaded skill. Never fall back to another installation.

   ```bash
   PLUGIN_ROOT=$(cd -P "<SKILL_DIR>" && cd ../.. && pwd -P) || exit 1

   if [ ! -f "$PLUGIN_ROOT/package.json" ] ||
      [ ! -d "$PLUGIN_ROOT/skills" ] ||
      [ ! -d "$PLUGIN_ROOT/agents" ]; then
     echo "Error: Invalid local plugin root." >&2
     exit 1
   fi
   ```

4. **Verify the approved local viewer.**

   ```bash
   : "${PLUGIN_ROOT:?Plugin root required}"
   : "${PROJECT_DIR:?Project directory required}"

   VIEWER_DIR="$PLUGIN_ROOT/packages/viewer"

   if [ ! -f "$VIEWER_DIR/bin/viewer.mjs" ] ||
      [ ! -f "$VIEWER_DIR/dist/index.html" ] ||
      [ ! -f "$VIEWER_DIR/bin/dist/staleness.js" ]; then
     echo "Error: Approved local viewer is not built." >&2
     exit 1
   fi
   ```

   Do not download, install, update, or build software
   during dashboard execution.

5. Start the approved local viewer:

   ```bash
   node "$VIEWER_DIR/bin/viewer.mjs" "$PROJECT_DIR" --private
   ```

   Run this in the background.

6. If startup fails, report the error and stop.
   Never fall back to a remote package or automatic installation.

7. Verify that the viewer reports a local readiness URL.

   Expected output: Dashboard ready: http://127.0.0.1:PORT/

   Never capture, request, print, or share access credentials.

8. Report that the dashboard server is running and that
   browser opening was requested locally.

   If the browser does not open, ask the user to launch
   the approved viewer directly from their own terminal.
   Do not capture its credentials through agent tools.

## Notes

- Only the previously prepared local viewer is supported.
- Missing artifacts must be reported without downloading or building software.
- Never fall back to a remote package or development server.

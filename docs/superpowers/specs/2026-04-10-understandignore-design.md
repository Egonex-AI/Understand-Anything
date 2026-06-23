# .understandignore Design Spec

## Overview

Add user-configurable file exclusion via `.understandignore` files, using `.gitignore` syntax. This makes analysis faster by skipping irrelevant files (vendor code, generated output, test fixtures) without modifying hardcoded defaults.

## Goals

- Let users exclude files/directories from analysis via `.understandignore`
- Use `.gitignore` syntax (familiar, no learning curve)
- Keep hardcoded defaults as built-in — `.understandignore` adds patterns on top
- Allow `!` negation to force-include files excluded by defaults
- Auto-generate a commented-out starter file on first run (deterministic code, not LLM)
- Pause before analysis to let user review the ignore file

## Non-Goals

- Replacing `.gitignore` — this is analysis-specific
- Per-directory `.understandignore` files (project root and `.understand-anything/` only)
- GUI for editing ignore patterns

---

## IgnoreFilter Module

New file: `packages/core/src/ignore-filter.ts`

Uses the [`ignore`](https://www.npmjs.com/package/ignore) npm package for gitignore-compatible pattern matching.

### API

```typescript
export interface IgnoreFilter {
  isIgnored(relativePath: string): boolean;
}

export function createIgnoreFilter(projectRoot: string): IgnoreFilter;
```

### Behavior

`createIgnoreFilter` loads patterns in this order (later entries can override earlier ones):

1. **Hardcoded defaults** — the existing exclusion patterns from project-scanner (node_modules/, .git/, dist/, build/, bin/, obj/, *.lock, *.min.js, etc.)
2. **`.understand-anything/.understandignore`** — project-level, lives alongside the output
3. **`.understandignore`** at project root — alternative location for visibility

Patterns merge additively. `!` negation in user files can override hardcoded defaults (e.g., `!dist/` force-includes dist/).

### Hardcoded Default Patterns

These are the built-in defaults (matching current project-scanner behavior, plus bin/obj for .NET):

```
# Dependency directories
node_modules/
.git/
vendor/
venv/
.venv/
__pycache__/

# Build output
dist/
build/
out/
coverage/
.next/
.cache/
.turbo/
target/
bin/
obj/

# Lock files
*.lock
package-lock.json
yarn.lock
pnpm-lock.yaml

# Binary/asset files
*.png
*.jpg
*.jpeg
*.gif
*.svg
*.ico
*.woff
*.woff2
*.ttf
*.eot
*.mp3
*.mp4
*.pdf
*.zip
*.tar
*.gz

# Generated files
*.min.js
*.min.css
*.map
*.generated.*

# IDE/editor
.idea/
.vscode/

# Misc
LICENSE
.gitignore
.editorconfig
.prettierrc
.eslintrc*
*.log
```

---

## Starter File Generator

New file: `packages/core/src/ignore-generator.ts`

### API

```typescript
export function generateStarterIgnoreFile(projectRoot: string): string;
```

### Behavior

- Deterministic code — scans the project directory for common patterns
- Returns the file content as a string (caller writes it to disk)
- All suggestions are **commented out** — user must uncomment to activate
- Header comment explains the file, syntax, and built-in defaults

### Detection Logic

| If exists | Suggest |
|-----------|---------|
| `__tests__/` or `*.test.*` files | `# __tests__/`, `# *.test.*`, `# *.spec.*` |
| `fixtures/` or `testdata/` | `# fixtures/`, `# testdata/` |
| `test/` or `tests/` | `# test/`, `# tests/` |
| `.storybook/` | `# .storybook/` |
| `docs/` | `# docs/` |
| `examples/` | `# examples/` |
| `scripts/` | `# scripts/` |
| `migrations/` | `# migrations/` |
| `*.snap` files | `# *.snap` |
| `bin/` (non-.NET, i.e. shell scripts) | `# bin/` |
| `obj/` | `# obj/` |

### Generated File Format

```
# .understandignore — patterns for files/dirs to exclude from analysis
# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)
# Lines below are suggestions — uncomment to activate.
# Use ! prefix to force-include something excluded by defaults.
#
# Built-in defaults (always excluded unless negated):
#   node_modules/, .git/, dist/, build/, bin/, obj/, *.lock, *.min.js, etc.
#

# --- Suggested exclusions (uncomment to activate) ---

# Test files
# __tests__/
# *.test.*
# *.spec.*

# Test data
# fixtures/
# testdata/

# Documentation
# docs/

# ... (more suggestions based on detection)
```

Only generated if `.understand-anything/.understandignore` doesn't already exist.

---

## Skill Integration

### Phase 0.5: Ignore Setup (new phase in SKILL.md)

Added between Pre-flight (Phase 0) and SCAN (Phase 1):

1. Check if `.understand-anything/.understandignore` exists
2. If not, run `generateStarterIgnoreFile(projectRoot)` and write the result to `.understand-anything/.understandignore`
3. Report to user:
   - **First run:** "Generated `.understand-anything/.understandignore` with suggested exclusions. Please review it and uncomment any patterns you'd like to exclude. When ready, confirm to continue."
   - **Subsequent runs:** "Found `.understand-anything/.understandignore`. Review it if needed, then confirm to continue."
4. Wait for user confirmation before proceeding

### Phase 1: SCAN changes

The `project-scanner` agent's scan script is updated to:

1. Collect files via `git ls-files` (or fallback)
2. Apply agent's hardcoded pattern filter (Layer 1 — existing behavior)
3. Apply `IgnoreFilter` from core (Layer 2 — user patterns)
4. Add `filteredByIgnore` count to scan output
5. Report: "Scanned {totalFiles} files ({filteredByIgnore} excluded by .understandignore)"

Two-layer filtering:
- **Layer 1:** Agent's hardcoded patterns in the prompt (fast, coarse filter)
- **Layer 2:** `IgnoreFilter` from core (deterministic code, user-configurable)

---

## Project Scanner Agent Update

Changes to `understand-anything-plugin/agents/project-scanner.md`:

- After the file list is built and Layer 1 filtering is applied, the agent runs a Node.js script that imports `createIgnoreFilter` from `@understand-anything/core` and filters the remaining paths
- The scan result JSON includes a new `filteredByIgnore: number` field
- Existing hardcoded exclusion patterns in the agent prompt remain for backward compatibility

---

## Testing

### `packages/core/src/__tests__/ignore-filter.test.ts`

- Parses basic glob patterns (`*.log`, `dist/`)
- Handles `#` comments and blank lines
- Handles `!` negation (force-include)
- Handles `**/` recursive matching
- Handles trailing `/` for directory-only patterns
- Merges defaults + user patterns correctly
- `!` in user file overrides hardcoded defaults
- Returns `false` for paths not matching any pattern

### `packages/core/src/__tests__/ignore-generator.test.ts`

- Generates starter file with header comment
- Detects existing directories and suggests relevant patterns
- All suggestions are commented out (prefixed with `# `)
- Doesn't overwrite existing file
- Includes bin/obj suggestions when relevant

---

## File Structure

| File | Purpose |
|------|---------|
| `packages/core/src/ignore-filter.ts` | Parse .understandignore, merge with defaults, filter paths |
| `packages/core/src/ignore-generator.ts` | Generate starter file by scanning project structure |
| `packages/core/src/__tests__/ignore-filter.test.ts` | Filter logic tests |
| `packages/core/src/__tests__/ignore-generator.test.ts` | Generator tests |
| `agents/project-scanner.md` | Add Layer 2 filtering via IgnoreFilter |
| `skills/understand/SKILL.md` | Add Phase 0.5 (generate + pause for review) |
| `packages/core/package.json` | Add `ignore` npm dependency |

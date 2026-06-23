# .understandignore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-configurable file exclusion via `.understandignore` files using `.gitignore` syntax, with auto-generated starter files and a pre-analysis review pause.

**Architecture:** An `IgnoreFilter` module in `packages/core` uses the `ignore` npm package to parse `.understandignore` files and filter paths. A companion `IgnoreGenerator` scans the project for common patterns and produces a commented-out starter file. The `project-scanner` agent applies the filter as a second pass after its existing hardcoded exclusions. The `/understand` skill adds a Phase 0.5 that generates the starter file and pauses for user review.

**Tech Stack:** TypeScript, `ignore` npm package, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-understandignore-design.md`

---

## File Structure

### Core package
- Create: `understand-anything-plugin/packages/core/src/ignore-filter.ts` — parse .understandignore, merge with defaults, filter paths
- Create: `understand-anything-plugin/packages/core/src/ignore-generator.ts` — generate starter .understandignore by scanning project
- Create: `understand-anything-plugin/packages/core/src/__tests__/ignore-filter.test.ts` — filter tests
- Create: `understand-anything-plugin/packages/core/src/__tests__/ignore-generator.test.ts` — generator tests
- Modify: `understand-anything-plugin/packages/core/src/index.ts` — export new modules
- Modify: `understand-anything-plugin/packages/core/package.json` — add `ignore` dependency

### Agents & skills
- Modify: `understand-anything-plugin/agents/project-scanner.md` — add Layer 2 filtering step
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` — add Phase 0.5

---

## Task 1: Add `ignore` dependency

**Files:**
- Modify: `understand-anything-plugin/packages/core/package.json`

- [ ] **Step 1: Install the `ignore` npm package**

Run:
```bash
cd understand-anything-plugin && pnpm add --filter @understand-anything/core ignore
```

- [ ] **Step 2: Verify it was added**

Run: `grep ignore understand-anything-plugin/packages/core/package.json`
Expected: `"ignore": "^7.x.x"` (or similar) in dependencies

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/package.json understand-anything-plugin/pnpm-lock.yaml
git commit -m "chore(core): add ignore package for .understandignore support"
```

---

## Task 2: Create IgnoreFilter module with tests (TDD)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/ignore-filter.ts`
- Create: `understand-anything-plugin/packages/core/src/__tests__/ignore-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `understand-anything-plugin/packages/core/src/__tests__/ignore-filter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIgnoreFilter, DEFAULT_IGNORE_PATTERNS } from "../ignore-filter";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("IgnoreFilter", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ignore-filter-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, ".understand-anything"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("DEFAULT_IGNORE_PATTERNS", () => {
    it("contains node_modules", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain("node_modules/");
    });

    it("contains .git", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain(".git/");
    });

    it("contains bin and obj for .NET", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain("bin/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("obj/");
    });

    it("contains build output directories", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain("dist/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("build/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("out/");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("coverage/");
    });
  });

  describe("createIgnoreFilter with no user file", () => {
    it("ignores files matching default patterns", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("node_modules/foo/bar.js")).toBe(true);
      expect(filter.isIgnored("dist/index.js")).toBe(true);
      expect(filter.isIgnored(".git/config")).toBe(true);
      expect(filter.isIgnored("bin/Debug/app.dll")).toBe(true);
      expect(filter.isIgnored("obj/Release/net8.0/app.dll")).toBe(true);
    });

    it("does not ignore source files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
      expect(filter.isIgnored("README.md")).toBe(false);
      expect(filter.isIgnored("package.json")).toBe(false);
    });

    it("ignores lock files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("pnpm-lock.yaml")).toBe(true);
      expect(filter.isIgnored("package-lock.json")).toBe(true);
      expect(filter.isIgnored("yarn.lock")).toBe(true);
    });

    it("ignores binary/asset files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("logo.png")).toBe(true);
      expect(filter.isIgnored("font.woff2")).toBe(true);
      expect(filter.isIgnored("doc.pdf")).toBe(true);
    });

    it("ignores generated files", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("bundle.min.js")).toBe(true);
      expect(filter.isIgnored("style.min.css")).toBe(true);
      expect(filter.isIgnored("source.map")).toBe(true);
    });

    it("ignores IDE directories", () => {
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored(".idea/workspace.xml")).toBe(true);
      expect(filter.isIgnored(".vscode/settings.json")).toBe(true);
    });
  });

  describe("createIgnoreFilter with user .understandignore", () => {
    it("reads patterns from .understand-anything/.understandignore", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "# Exclude tests\n__tests__/\n*.test.ts\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("__tests__/foo.test.ts")).toBe(true);
      expect(filter.isIgnored("src/utils.test.ts")).toBe(true);
      expect(filter.isIgnored("src/utils.ts")).toBe(false);
    });

    it("reads patterns from project root .understandignore", () => {
      writeFileSync(
        join(testDir, ".understandignore"),
        "docs/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("docs/README.md")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });

    it("handles # comments and blank lines", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "# This is a comment\n\n\nfixtures/\n\n# Another comment\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("fixtures/data.json")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });

    it("supports ! negation to override defaults", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "!dist/\n"
      );
      const filter = createIgnoreFilter(testDir);
      // dist/ is in defaults but negated by user
      expect(filter.isIgnored("dist/index.js")).toBe(false);
    });

    it("supports ** recursive matching", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "**/snapshots/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("src/components/snapshots/Button.snap")).toBe(true);
      expect(filter.isIgnored("snapshots/foo.snap")).toBe(true);
    });

    it("merges .understand-anything/ and root .understandignore", () => {
      writeFileSync(
        join(testDir, ".understand-anything", ".understandignore"),
        "__tests__/\n"
      );
      writeFileSync(
        join(testDir, ".understandignore"),
        "fixtures/\n"
      );
      const filter = createIgnoreFilter(testDir);
      expect(filter.isIgnored("__tests__/foo.ts")).toBe(true);
      expect(filter.isIgnored("fixtures/data.json")).toBe(true);
      expect(filter.isIgnored("src/index.ts")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run src/__tests__/ignore-filter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IgnoreFilter**

Create `understand-anything-plugin/packages/core/src/ignore-filter.ts`:

```typescript
import ignore, { type Ignore } from "ignore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Hardcoded default ignore patterns matching the project-scanner agent's
 * exclusion rules, plus bin/obj for .NET projects.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  // Dependency directories
  "node_modules/",
  ".git/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",

  // Build output
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".cache/",
  ".turbo/",
  "target/",
  "bin/",
  "obj/",

  // Lock files
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",

  // Binary/asset files
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",

  // Generated files
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",

  // IDE/editor
  ".idea/",
  ".vscode/",

  // Misc
  "LICENSE",
  ".gitignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc*",
  "*.log",
];

export interface IgnoreFilter {
  /** Returns true if the given relative path should be excluded from analysis. */
  isIgnored(relativePath: string): boolean;
}

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from .understandignore files.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. .understand-anything/.understandignore (if exists)
 * 3. .understandignore at project root (if exists)
 */
export function createIgnoreFilter(projectRoot: string): IgnoreFilter {
  const ig: Ignore = ignore();

  // Layer 1: hardcoded defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // Layer 2: .understand-anything/.understandignore
  const projectIgnorePath = join(projectRoot, ".understand-anything", ".understandignore");
  if (existsSync(projectIgnorePath)) {
    const content = readFileSync(projectIgnorePath, "utf-8");
    ig.add(content);
  }

  // Layer 3: .understandignore at project root
  const rootIgnorePath = join(projectRoot, ".understandignore");
  if (existsSync(rootIgnorePath)) {
    const content = readFileSync(rootIgnorePath, "utf-8");
    ig.add(content);
  }

  return {
    isIgnored(relativePath: string): boolean {
      return ig.ignores(relativePath);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run src/__tests__/ignore-filter.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Build to verify no type errors**

Run: `pnpm --filter @understand-anything/core build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/ignore-filter.ts understand-anything-plugin/packages/core/src/__tests__/ignore-filter.test.ts
git commit -m "feat(core): add IgnoreFilter module with .understandignore parsing and tests"
```

---

## Task 3: Create IgnoreGenerator module with tests (TDD)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/ignore-generator.ts`
- Create: `understand-anything-plugin/packages/core/src/__tests__/ignore-generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `understand-anything-plugin/packages/core/src/__tests__/ignore-generator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateStarterIgnoreFile } from "../ignore-generator";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("generateStarterIgnoreFile", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `ignore-gen-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("includes a header comment explaining the file", () => {
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain(".understandignore");
    expect(content).toContain("same as .gitignore");
    expect(content).toContain("Built-in defaults");
  });

  it("all suggestions are commented out", () => {
    // Create some directories to trigger suggestions
    mkdirSync(join(testDir, "__tests__"), { recursive: true });
    mkdirSync(join(testDir, "docs"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    // No active (uncommented) patterns
    expect(lines).toHaveLength(0);
  });

  it("suggests __tests__ when __tests__ directory exists", () => {
    mkdirSync(join(testDir, "__tests__"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# __tests__/");
  });

  it("suggests docs when docs directory exists", () => {
    mkdirSync(join(testDir, "docs"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# docs/");
  });

  it("suggests test directories when they exist", () => {
    mkdirSync(join(testDir, "test"), { recursive: true });
    mkdirSync(join(testDir, "tests"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# test/");
    expect(content).toContain("# tests/");
  });

  it("suggests fixtures when fixtures directory exists", () => {
    mkdirSync(join(testDir, "fixtures"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# fixtures/");
  });

  it("suggests examples when examples directory exists", () => {
    mkdirSync(join(testDir, "examples"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# examples/");
  });

  it("suggests .storybook when .storybook directory exists", () => {
    mkdirSync(join(testDir, ".storybook"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# .storybook/");
  });

  it("suggests migrations when migrations directory exists", () => {
    mkdirSync(join(testDir, "migrations"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# migrations/");
  });

  it("suggests scripts when scripts directory exists", () => {
    mkdirSync(join(testDir, "scripts"), { recursive: true });
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# scripts/");
  });

  it("always includes generic suggestions", () => {
    const content = generateStarterIgnoreFile(testDir);
    expect(content).toContain("# *.snap");
    expect(content).toContain("# *.test.*");
    expect(content).toContain("# *.spec.*");
  });

  it("does not suggest directories that don't exist", () => {
    const content = generateStarterIgnoreFile(testDir);
    // __tests__ doesn't exist, so it shouldn't be in directory suggestions
    // (it may still be in generic test file patterns)
    expect(content).not.toContain("# __tests__/");
    expect(content).not.toContain("# .storybook/");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @understand-anything/core test -- --run src/__tests__/ignore-generator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IgnoreGenerator**

Create `understand-anything-plugin/packages/core/src/ignore-generator.ts`:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";

const HEADER = `# .understandignore — patterns for files/dirs to exclude from analysis
# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)
# Lines below are suggestions — uncomment to activate.
# Use ! prefix to force-include something excluded by defaults.
#
# Built-in defaults (always excluded unless negated):
#   node_modules/, .git/, dist/, build/, bin/, obj/, *.lock, *.min.js, etc.
#
`;

/** Directories to check for and suggest excluding. */
const DETECTABLE_DIRS = [
  { dir: "__tests__", pattern: "__tests__/" },
  { dir: "test", pattern: "test/" },
  { dir: "tests", pattern: "tests/" },
  { dir: "fixtures", pattern: "fixtures/" },
  { dir: "testdata", pattern: "testdata/" },
  { dir: "docs", pattern: "docs/" },
  { dir: "examples", pattern: "examples/" },
  { dir: "scripts", pattern: "scripts/" },
  { dir: "migrations", pattern: "migrations/" },
  { dir: ".storybook", pattern: ".storybook/" },
];

/** Always-included generic suggestions. */
const GENERIC_SUGGESTIONS = [
  "*.test.*",
  "*.spec.*",
  "*.snap",
];

/**
 * Generates a starter .understandignore file by scanning the project root
 * for common directories and suggesting them as commented-out exclusions.
 *
 * All suggestions are commented out — the user must uncomment to activate.
 * Returns the file content as a string.
 */
export function generateStarterIgnoreFile(projectRoot: string): string {
  const sections: string[] = [HEADER];

  // Detected directory suggestions
  const detected: string[] = [];
  for (const { dir, pattern } of DETECTABLE_DIRS) {
    if (existsSync(join(projectRoot, dir))) {
      detected.push(pattern);
    }
  }

  if (detected.length > 0) {
    sections.push("# --- Detected directories (uncomment to exclude) ---\n");
    for (const pattern of detected) {
      sections.push(`# ${pattern}`);
    }
    sections.push("");
  }

  // Generic suggestions (always included)
  sections.push("# --- Test file patterns (uncomment to exclude) ---\n");
  for (const pattern of GENERIC_SUGGESTIONS) {
    sections.push(`# ${pattern}`);
  }
  sections.push("");

  return sections.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @understand-anything/core test -- --run src/__tests__/ignore-generator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Build**

Run: `pnpm --filter @understand-anything/core build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/packages/core/src/ignore-generator.ts understand-anything-plugin/packages/core/src/__tests__/ignore-generator.test.ts
git commit -m "feat(core): add IgnoreGenerator for starter .understandignore file creation"
```

---

## Task 4: Export new modules from core

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

Add to the end of `understand-anything-plugin/packages/core/src/index.ts`:

```typescript
export {
  createIgnoreFilter,
  DEFAULT_IGNORE_PATTERNS,
  type IgnoreFilter,
} from "./ignore-filter.js";
export { generateStarterIgnoreFile } from "./ignore-generator.js";
```

- [ ] **Step 2: Build and run all tests**

Run: `pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/core test -- --run`
Expected: Clean build, all tests pass

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/packages/core/src/index.ts
git commit -m "feat(core): export IgnoreFilter and IgnoreGenerator from core index"
```

---

## Task 5: Update project-scanner agent

**Files:**
- Modify: `understand-anything-plugin/agents/project-scanner.md`

- [ ] **Step 1: Read the current project-scanner.md**

Read `understand-anything-plugin/agents/project-scanner.md` to understand the current structure.

- [ ] **Step 2: Add bin/ and obj/ to hardcoded exclusions**

In Step 2 (Exclusion Filtering), add `bin/` and `obj/` to the "Build output" line:

Change:
```
- **Build output:** paths with a directory segment matching `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `.cache/`, `.turbo/`, `target/` (Rust)
```

To:
```
- **Build output:** paths with a directory segment matching `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `.cache/`, `.turbo/`, `target/` (Rust), `bin/` (.NET), `obj/` (.NET)
```

- [ ] **Step 3: Add Layer 2 filtering step**

After Step 2 (Exclusion Filtering), add a new step:

```markdown
**Step 2.5 -- User-Configured Filtering (.understandignore)**

After applying the hardcoded exclusion filters above, apply user-configured patterns from `.understandignore`:

1. Check if `.understand-anything/.understandignore` exists in the project root. If so, read it.
2. Check if `.understandignore` exists in the project root. If so, read it.
3. Parse both files using `.gitignore` syntax (glob patterns, `#` comments, blank lines ignored, `!` prefix for negation, trailing `/` for directories, `**/` for recursive matching).
4. Filter the remaining file list through these patterns. Files matching any pattern are excluded.
5. `!` negation patterns override the hardcoded exclusions from Step 2 (e.g., `!dist/` force-includes dist/).
6. Track the count of files removed by this step as `filteredByIgnore`.

This filtering must be deterministic (not LLM-based). Use a Node.js script with the `ignore` npm package if implementing programmatically, or apply the patterns manually if the file list is small.
```

- [ ] **Step 4: Update scan output schema**

Find the output JSON schema section and add `filteredByIgnore` field:

```json
{
  "name": "...",
  "description": "...",
  "languages": ["..."],
  "frameworks": ["..."],
  "files": [...],
  "totalFiles": 123,
  "filteredByIgnore": 5,
  "estimatedComplexity": "moderate",
  "importMap": {}
}
```

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/agents/project-scanner.md
git commit -m "feat(agent): add .understandignore support and bin/obj exclusions to project-scanner"
```

---

## Task 6: Update /understand skill with Phase 0.5

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Read the current SKILL.md Phase 0 section**

Read `understand-anything-plugin/skills/understand/SKILL.md` lines 22-80 to understand Phase 0.

- [ ] **Step 2: Add Phase 0.5 after Phase 0**

After the Phase 0 section (after the `---` separator before Phase 1), insert:

```markdown
## Phase 0.5 — Ignore Configuration

Set up and verify the `.understandignore` file before scanning.

1. Check if `$PROJECT_ROOT/.understand-anything/.understandignore` exists.
2. **If it does NOT exist**, generate a starter file:
   - Run a Node.js script (or inline logic) that scans `$PROJECT_ROOT` for common directories (`__tests__/`, `test/`, `tests/`, `fixtures/`, `testdata/`, `docs/`, `examples/`, `scripts/`, `migrations/`, `.storybook/`) and generates a `.understandignore` file with commented-out suggestions.
   - Write the generated content to `$PROJECT_ROOT/.understand-anything/.understandignore`.
   - Report to the user:
     > "Generated `.understand-anything/.understandignore` with suggested exclusions based on your project structure. Please review it and uncomment any patterns you'd like to exclude from analysis. When ready, confirm to continue."
   - **Wait for user confirmation before proceeding.**
3. **If it already exists**, report:
   > "Found `.understand-anything/.understandignore`. Review it if needed, then confirm to continue."
   - **Wait for user confirmation before proceeding.**
4. After confirmation, proceed to Phase 1.

**Note:** The `.understandignore` file uses `.gitignore` syntax. The user can add patterns to exclude files from analysis, or use `!` prefix to force-include files excluded by built-in defaults (e.g., `!dist/` to analyze dist/ files).

---
```

- [ ] **Step 3: Update Phase 1 reporting**

In the Phase 1 section, after the gate check (~line 114), add a note about reporting ignore stats:

```markdown
After scanning, if the scan result includes `filteredByIgnore > 0`, report:
> "Scanned {totalFiles} files ({filteredByIgnore} excluded by .understandignore)"
```

- [ ] **Step 4: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(skill): add Phase 0.5 for .understandignore setup and review pause"
```

---

## Task 7: Build, test, and verify end-to-end

**Files:**
- All modified files

- [ ] **Step 1: Build core**

Run: `pnpm --filter @understand-anything/core build`
Expected: Clean build

- [ ] **Step 2: Run all core tests**

Run: `pnpm --filter @understand-anything/core test -- --run`
Expected: All tests pass (existing + new ignore-filter + ignore-generator tests)

- [ ] **Step 3: Build skill package**

Run: `pnpm --filter @understand-anything/skill build`
Expected: Clean build

- [ ] **Step 4: Verify files exist**

Run:
```bash
ls understand-anything-plugin/packages/core/src/ignore-filter.ts understand-anything-plugin/packages/core/src/ignore-generator.ts
```
Expected: Both files listed

- [ ] **Step 5: Verify exports work**

Run:
```bash
node -e "import('@understand-anything/core').then(m => { console.log('IgnoreFilter:', typeof m.createIgnoreFilter); console.log('Generator:', typeof m.generateStarterIgnoreFile); })"
```
Expected: Both show `function`

- [ ] **Step 6: Final commit (if any unstaged changes)**

```bash
git status
# If clean, skip. If changes exist:
git add -A && git commit -m "chore: final verification for .understandignore support"
```

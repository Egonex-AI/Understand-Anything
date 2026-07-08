// Validates the worktree-redirect bash snippet embedded in
// `skills/understand/recipes/worktree-redirect.md` (referenced from `skills/understand/SKILL.md`
// Phase 0 step 1) and `skills/understand-domain/SKILL.md` Phase 0.
//
// If you edit the snippet in either location, mirror the change to RESOLVE_SNIPPET
// below — there is no shared script to source (per-skill convention in this repo).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RESOLVE_SNIPPET = `
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "\${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
echo "$PROJECT_ROOT"
`;

const bashProbe = spawnSync("bash", ["--version"], { encoding: "utf8" });
const hasBash = !bashProbe.error && bashProbe.status === 0;
const describeWithBash = hasBash ? describe : describe.skip;
const itOnWindows = process.platform === "win32" ? it : it.skip;

function runResolve(projectRoot, env = {}) {
  // No `set -e` — the snippet relies on `git ... 2>/dev/null` returning empty
  // strings when not in a git repo; `set -e` would short-circuit instead.
  const script = `PROJECT_ROOT=${JSON.stringify(projectRoot)}\n${RESOLVE_SNIPPET}`;
  return execFileSync("bash", ["-c", script], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).trim();
}

function toNativePath(pathValue) {
  if (process.platform !== "win32") {
    return pathValue;
  }
  const nativePath = execFileSync("bash", ["-lc", 'cygpath -w "$1"', "_", pathValue], {
    encoding: "utf8",
  }).trim();
  return realpathSync.native(nativePath);
}

function expectSamePath(actual, expected) {
  expect(toNativePath(actual)).toBe(toNativePath(expected));
}

let tmpRoot;
let mainRepo;
let worktree;
let subdir;

describeWithBash("worktree-redirect snippet (issue #133)", () => {
  beforeAll(() => {
    tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "ua-wt-")));
    mainRepo = join(tmpRoot, "main");
    worktree = join(tmpRoot, "wt");
    subdir = join(worktree, "src", "deep");

    execFileSync("git", ["init", "-q", "-b", "main", mainRepo]);
    execFileSync("git", ["-C", mainRepo, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", mainRepo, "config", "user.name", "t"]);
    writeFileSync(join(mainRepo, "README.md"), "main\n");
    execFileSync("git", ["-C", mainRepo, "add", "."]);
    execFileSync("git", ["-C", mainRepo, "commit", "-q", "-m", "init"]);
    execFileSync("git", ["-C", mainRepo, "worktree", "add", "-q", worktree]);
    mkdirSync(subdir, { recursive: true });
  });

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  itOnWindows("treats Windows short and long path names as the same directory", () => {
    expectSamePath("C:/PROGRA~1", "C:/Program Files");
  });

  it("leaves PROJECT_ROOT alone in a normal checkout", () => {
    expectSamePath(runResolve(mainRepo), mainRepo);
  });

  it("redirects PROJECT_ROOT to the main repo when started in a worktree", () => {
    expectSamePath(runResolve(worktree), mainRepo);
  });

  it("redirects from a subdirectory inside a worktree", () => {
    expectSamePath(runResolve(subdir), mainRepo);
  });

  it("respects UNDERSTAND_NO_WORKTREE_REDIRECT=1", () => {
    expectSamePath(runResolve(worktree, { UNDERSTAND_NO_WORKTREE_REDIRECT: "1" }), worktree);
  });

  it("leaves PROJECT_ROOT alone when not inside a git repo", () => {
    // Use a path under the resolved tmp root so we never accidentally land
    // inside a parent git repo (e.g. when /tmp is symlinked into one).
    const nonGit = join(tmpRoot, "no-git");
    mkdirSync(nonGit, { recursive: true });
    expectSamePath(runResolve(nonGit), nonGit);
  });
});

import { mkdirSync } from "node:fs";
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateGitRepository } from "./git-preflight.js";
import { createSafeGitEnv } from "./git-env.js";
import {
  getChangedFiles,
  getGraphFreshness,
} from "../staleness.js";

describe("authorized Git worktrees", () => {
  let sandbox: string;
  let project: string;
  let worktree: string;
  let commonDir: string;
  let gitDir: string;

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      env: createSafeGitEnv(),
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  beforeEach(() => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", undefined);

    sandbox = realpathSync(
      mkdtempSync(join(tmpdir(), "ua-worktree-")),
    );

    project = join(sandbox, "project");
    worktree = join(sandbox, "linked");

    git(sandbox, "init", project);
    git(project, "config", "user.name", "Security Test");
    git(project, "config", "user.email", "security@example.com");

    writeFileSync(join(project, "source.ts"), "export const x = 1;");
    git(project, "add", "--all");
    git(project, "commit", "-m", "baseline");
    git(project, "worktree", "add", "--detach", worktree, "HEAD");

    commonDir = join(project, ".git");
    gitDir = realpathSync(
      git(worktree, "rev-parse", "--absolute-git-dir"),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();

    if (sandbox) {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("accepts an explicitly authorized worktree", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    expect(() => validateGitRepository(worktree)).not.toThrow();
  });

  it("rejects a worktree without authorization", () => {
    expect(() => validateGitRepository(worktree)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects an unrelated authorized directory", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", sandbox);

    expect(() => validateGitRepository(worktree)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects an inconsistent backlink", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    writeFileSync(
      join(gitDir, "gitdir"),
      join(project, ".git") + "\n",
    );

    expect(() => validateGitRepository(worktree)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects an inconsistent common directory", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    writeFileSync(join(gitDir, "commondir"), sandbox + "\n");

    expect(() => validateGitRepository(worktree)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects unsafe shared configuration", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    git(project, "config", "--local", "diff.external", "blocked");

    expect(() => validateGitRepository(worktree)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects unsafe worktree-specific configuration", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    git(project, "config", "extensions.worktreeConfig", "true");

    writeFileSync(
      join(gitDir, "config.worktree"),
      "[diff]\n\texternal = blocked\n",
    );

    expect(() => validateGitRepository(worktree)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("reports a fresh graph in an authorized worktree", async () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    const baseline = git(worktree, "rev-parse", "HEAD");

    await expect(
      getGraphFreshness(worktree, {
        graphCommitHash: baseline,
      }),
    ).resolves.toMatchObject({
      status: "fresh",
    });
  });

  it("detects committed changes in an authorized worktree", () => {
    vi.stubEnv("UNDERSTAND_GIT_COMMON_DIR", commonDir);

    const baseline = git(worktree, "rev-parse", "HEAD");

    writeFileSync(
      join(worktree, "source.ts"),
      "export const x = 2;",
    );

    git(worktree, "add", "--all");
    git(worktree, "commit", "-m", "update source");

    expect(getChangedFiles(worktree, baseline)).toEqual([
      "source.ts",
    ]);
  });

  it("returns unknown for an unauthorized worktree", async () => {
    const baseline = git(worktree, "rev-parse", "HEAD");

    await expect(
      getGraphFreshness(worktree, {
        graphCommitHash: baseline,
      }),
    ).resolves.toMatchObject({
      status: "unknown",
    });
  });
});

describe("Git project authorization boundary", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "ua-git-boundary-")));

    execFileSync("git", ["init", root], {
      env: createSafeGitEnv(),
      stdio: "ignore",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a repository inside the authorized boundary", () => {
    vi.stubEnv("UNDERSTAND_PROJECT_ROOT", root);
    expect(() => validateGitRepository(root)).not.toThrow();
  });

  it("rejects a repository above the authorized boundary", () => {
    const boundary = join(root, "project");
    mkdirSync(boundary);

    vi.stubEnv("UNDERSTAND_PROJECT_ROOT", boundary);

    expect(() => validateGitRepository(boundary)).toThrow();
  });

  it("rejects a project outside the authorized boundary", () => {
    const boundary = realpathSync(
      mkdtempSync(join(tmpdir(), "ua-git-other-")),
    );

    try {
      vi.stubEnv("UNDERSTAND_PROJECT_ROOT", boundary);
      expect(() => validateGitRepository(root)).toThrow(
        "Unsafe Git repository configuration",
      );
    } finally {
      rmSync(boundary, { recursive: true, force: true });
    }
  });
});

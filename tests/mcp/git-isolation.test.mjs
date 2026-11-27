import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { changedFiles } from "../../understand-anything-plugin/packages/mcp/lib/changed-files.mjs";

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createRepo(root, filename) {
  mkdirSync(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Security Test");
  git(root, "config", "user.email", "security@example.com");

  writeFileSync(join(root, filename), "original");
  git(root, "add", "--all");
  git(root, "commit", "-m", "baseline");

  writeFileSync(join(root, filename), "modified");
}

describe("MCP Git isolation", () => {
  let sandbox;
  let project;
  let outside;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "ua-git-security-"));
    project = join(sandbox, "project");
    outside = join(sandbox, "outside");

    createRepo(project, "project.txt");
    createRepo(outside, "private.txt");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("ignores inherited GIT_DIR", () => {
    vi.stubEnv("GIT_DIR", join(outside, ".git"));

    expect(changedFiles(project)).toEqual(["project.txt"]);
  });

  it("ignores inherited GIT_WORK_TREE", () => {
    vi.stubEnv("GIT_WORK_TREE", outside);

    expect(changedFiles(project)).toEqual(["project.txt"]);
  });

  it("ignores inherited GIT_INDEX_FILE", () => {
    vi.stubEnv("GIT_INDEX_FILE", join(outside, ".git", "index"));

    expect(changedFiles(project)).toEqual(["project.txt"]);
  });

  it("ignores combined repository redirection", () => {
    vi.stubEnv("GIT_DIR", join(outside, ".git"));
    vi.stubEnv("GIT_WORK_TREE", outside);
    vi.stubEnv("GIT_INDEX_FILE", join(outside, ".git", "index"));

    expect(changedFiles(project)).toEqual(["project.txt"]);
  });

  it("ignores inherited configuration overrides", () => {
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.worktree");
    vi.stubEnv("GIT_CONFIG_VALUE_0", outside);

    expect(changedFiles(project)).toEqual(["project.txt"]);
  });

  it.runIf(process.platform !== "win32")(
    "does not execute a locally configured fsmonitor",
    () => {
      const marker = join(project, ".git", "fsmonitor-executed");
      const script = join(project, ".git", "fsmonitor-test.sh");

      writeFileSync(
        script,
        '#!/bin/sh\ntouch "$(dirname "$0")/fsmonitor-executed"\n',
        { mode: 0o700 },
      );

      git(project, "config", "core.fsmonitor", script);

      expect(changedFiles(project)).toEqual(["project.txt"]);
      expect(existsSync(marker)).toBe(false);
    },
  );

  it.each([
    ["core.worktree", "outside"],
    ["filter.custom.clean", "blocked-command"],
    ["filter.custom.process", "blocked-command"],
    ["include.path", "external-config"],
    ["diff.external", "blocked-command"],
    ["diff.custom.textconv", "blocked-command"],
    ["alias.custom", "!blocked-command"],
  ])("rejects unsafe local configuration %s", (key, value) => {
    git(project, "config", "--local", key, value);

    expect(() => changedFiles(project)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects core.worktree pointing to an existing external directory", () => {
    git(project, "config", "--local", "core.worktree", outside);

    expect(() => changedFiles(project)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it.runIf(process.platform !== "win32")(
    "rejects a symlinked Git configuration",
    () => {
      const config = join(project, ".git", "config");

      rmSync(config);
      symlinkSync(join(outside, ".git", "config"), config);

      expect(() => changedFiles(project)).toThrow(
        "Unsafe Git repository configuration",
      );
    },
  );

  it("rejects a hardlinked Git configuration", () => {
    const config = join(project, ".git", "config");

    rmSync(config);
    linkSync(join(outside, ".git", "config"), config);

    expect(() => changedFiles(project)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects a redirected Git directory", () => {
    const gitDir = join(project, ".git");

    rmSync(gitDir, { recursive: true, force: true });

    symlinkSync(
      join(outside, ".git"),
      gitDir,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => changedFiles(project)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects an unverified Git directory pointer", () => {
    const gitDir = join(project, ".git");

    rmSync(gitDir, { recursive: true, force: true });
    writeFileSync(gitDir, `gitdir: ${join(outside, ".git")}`);

    expect(() => changedFiles(project)).toThrow(
      "Unsafe Git repository configuration",
    );
  });

  it("rejects linked worktrees without explicit authorization", () => {
    const worktree = join(sandbox, "linked-worktree");

    git(project, "worktree", "add", "--detach", worktree, "HEAD");

    try {
      expect(() => changedFiles(worktree)).toThrow(
        "Unsafe Git repository configuration",
      );
    } finally {
      git(project, "worktree", "remove", "--force", worktree);
    }
  });

  it("detects changes in an explicitly authorized worktree", () => {
    const worktree = join(sandbox, "authorized-worktree");
    const previous = process.env.UNDERSTAND_GIT_COMMON_DIR;

    git(project, "worktree", "add", "--detach", worktree, "HEAD");

    try {
      process.env.UNDERSTAND_GIT_COMMON_DIR = join(project, ".git");

      writeFileSync(
        join(worktree, "worktree-change.ts"),
        "export const changed = true;",
      );

      expect(changedFiles(worktree)).toContain(
        "worktree-change.ts",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.UNDERSTAND_GIT_COMMON_DIR;
      } else {
        process.env.UNDERSTAND_GIT_COMMON_DIR = previous;
      }

      git(project, "worktree", "remove", "--force", worktree);
    }
  });
});

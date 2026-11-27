import { describe, it, expect } from "vitest";
import { devNull } from "node:os";
import { createSafeGitEnv } from "./git-env.js";

describe("safe Git environment", () => {
  it.each([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_EXTERNAL_DIFF",
    "GIT_CONFIG_PARAMETERS",
    "GIT_SSH_COMMAND",
    "GIT_ASKPASS",
    "git_dir",
  ])("removes inherited %s", (key) => {
    const env = createSafeGitEnv({
      [key]: "untrusted-value",
    });

    expect(env[key]).toBeUndefined();
  });

  it("enforces controlled Git configuration", () => {
    const env = createSafeGitEnv({
      GIT_CONFIG_NOSYSTEM: "0",
      GIT_CONFIG_GLOBAL: "/untrusted/config",
      GIT_TERMINAL_PROMPT: "1",
      GIT_OPTIONAL_LOCKS: "1",
      GIT_NO_REPLACE_OBJECTS: "0",
      GIT_NO_LAZY_FETCH: "0",
      GIT_PAGER: "untrusted-command",
      GIT_CONFIG_COUNT: "99",
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: "/outside",
      GIT_ALLOW_PROTOCOL: "https:ssh",
    });

    expect(env).toMatchObject({
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_PAGER: "",
      GIT_ALLOW_PROTOCOL: "",
      GIT_CONFIG_COUNT: "4",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: devNull,
      GIT_CONFIG_KEY_2: "credential.helper",
      GIT_CONFIG_VALUE_2: "",
      GIT_CONFIG_KEY_3: "protocol.allow",
      GIT_CONFIG_VALUE_3: "never",
    });
  });

  it("preserves non-Git environment variables", () => {
    const env = createSafeGitEnv({
      PATH: "/usr/bin",
      HOME: "/home/test",
      LANG: "en_US.UTF-8",
    });

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/test",
      LANG: "en_US.UTF-8",
    });
  });

  it("does not mutate the original environment", () => {
    const source = {
      GIT_DIR: "/outside",
      PATH: "/usr/bin",
    };

    createSafeGitEnv(source);

    expect(source.GIT_DIR).toBe("/outside");
  });
});

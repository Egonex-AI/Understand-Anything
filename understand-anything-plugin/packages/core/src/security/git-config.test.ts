import { describe, it, expect } from "vitest";
import { validateGitConfigKeys } from "./git-config.js";

describe("Git configuration security", () => {
  it.each([
    "core.worktree",
    "CORE.WORKTREE",
    "core.sshcommand",
    "core.gitproxy",
    "core.attributesfile",
    "core.excludesfile",
    "diff.external",
    "diff.custom.command",
    "diff.custom.textconv",
    "filter.custom.clean",
    "filter.custom.smudge",
    "filter.custom.process",
    "include.path",
    "includeif.gitdir:/outside.path",
    "alias.custom",
  ])("rejects unsafe configuration %s", (key) => {
    expect(() => {
      validateGitConfigKeys(`${key}\0`);
    }).toThrow("Unsafe Git repository configuration");
  });

  it("accepts ordinary repository configuration", () => {
    const keys = [
      "core.repositoryformatversion",
      "core.filemode",
      "core.bare",
      "core.logallrefupdates",
      "remote.origin.url",
      "remote.origin.fetch",
      "branch.main.remote",
      "branch.main.merge",
    ];

    expect(() => {
      validateGitConfigKeys(keys.join("\0") + "\0");
    }).not.toThrow();
  });

  it("rejects unsafe keys mixed with legitimate keys", () => {
    expect(() => {
      validateGitConfigKeys(
        "core.filemode\0filter.custom.process\0branch.main.remote\0",
      );
    }).toThrow();
  });

  it("accepts empty configuration", () => {
    expect(() => validateGitConfigKeys("")).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getGraphFreshness } from "../staleness.js";

describe("graph freshness security", () => {
  let root: string;
  let baseline: string;

  function git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ua-freshness-security-"));

    git("init");
    git("config", "user.name", "Security Test");
    git("config", "user.email", "security@example.com");

    writeFileSync(join(root, "source.ts"), "export const x = 1;");
    git("add", "--all");
    git("commit", "-m", "baseline");

    baseline = git("rev-parse", "HEAD");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["core.worktree", "/unauthorized"],
    ["filter.custom.process", "blocked-command"],
    ["include.path", "external-config"],
    ["diff.external", "blocked-command"],
  ])("returns unknown for unsafe configuration %s", async (key, value) => {
    git("config", "--local", key, value);

    await expect(
      getGraphFreshness(root, {
        graphCommitHash: baseline,
      }),
    ).resolves.toMatchObject({
      status: "unknown",
      reason: "git-head-unavailable",
    });
  });

  it("preserves freshness for a safe repository", async () => {
    await expect(
      getGraphFreshness(root, {
        graphCommitHash: baseline,
      }),
    ).resolves.toMatchObject({
      status: "fresh",
    });
  });
});

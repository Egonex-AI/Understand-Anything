import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GIT_LOG_FORMAT,
  clearHotspotsCache,
  computeGitHotspots,
  handleGitHotspotsRequest,
  parseGitLog,
  parseHotspotDays,
} from "../git-hotspots.js";

const R = "\x1e";
const F = "\x1f";

describe("parseGitLog", () => {
  it("aggregates commits, last change and distinct authors per file", () => {
    const out = [
      `${R}h3${F}2026-09-03T10:00:00+02:00${F}Bob@x.io\n\nsrc/a.ts\nsrc/b.ts\n`,
      `${R}h2${F}2026-09-02T10:00:00Z${F}alice@x.io\n\nsrc/a.ts\n`,
      `${R}h1${F}2026-09-01T10:00:00Z${F}bob@x.io\n\nsrc/a.ts\nsrc/a.ts\nREADME.md\n`,
    ].join("");
    const { files, commitCount } = parseGitLog(out);
    expect(commitCount).toBe(3);
    expect(files["src/a.ts"]).toEqual({ commits: 3, lastChanged: "2026-09-03T10:00:00+02:00", authors: 2 });
    expect(files["src/b.ts"]).toEqual({ commits: 1, lastChanged: "2026-09-03T10:00:00+02:00", authors: 1 });
    expect(files["README.md"].commits).toBe(1);
  });

  it("keeps only allowed paths and tolerates a truncated tail", () => {
    const out = `${R}h1${F}2026-09-01T10:00:00Z${F}a@x\n\nsrc/a.ts\nsecret.txt\n${R}h2${F}2026`;
    const { files, commitCount } = parseGitLog(out, new Set(["src/a.ts"]));
    expect(Object.keys(files)).toEqual(["src/a.ts"]);
    expect(commitCount).toBe(2);
  });
});

describe("parseHotspotDays", () => {
  it("clamps and defaults", () => {
    expect(parseHotspotDays(null)).toBe(90);
    expect(parseHotspotDays("abc")).toBe(90);
    expect(parseHotspotDays("0")).toBe(1);
    expect(parseHotspotDays("30")).toBe(30);
    expect(parseHotspotDays("99999")).toBe(3650);
  });
});

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasGit())("computeGitHotspots", () => {
  let dir: string;
  beforeEach(() => {
    clearHotspotsCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ua-hotspots-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function git(args: string[], env: Record<string, string> = {}) {
    execFileSync("git", args, {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@example.com",
        ...env,
      },
    });
  }

  function commit(file: string, daysAgo: number, email = "t@example.com") {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.appendFileSync(path.join(dir, file), `${daysAgo}\n`);
    const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    git(["add", "-A"]);
    git(["commit", "-q", "-m", `touch ${file}`], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_EMAIL: email,
    });
  }

  it("reports churn inside the window, relative to a project subdirectory", async () => {
    git(["init", "-q"]);
    commit("app/src/a.ts", 200);
    commit("app/src/a.ts", 20, "other@example.com");
    commit("app/src/a.ts", 5);
    commit("app/src/b.ts", 10);
    commit("outside.txt", 3);

    const report = await computeGitHotspots(path.join(dir, "app"), 30);
    expect(report.available).toBe(true);
    expect(report.files["src/a.ts"]).toMatchObject({ commits: 2, authors: 2 });
    expect(report.files["src/b.ts"]).toMatchObject({ commits: 1, authors: 1 });
    expect(report.files["outside.txt"]).toBeUndefined();
    expect(report.maxCommits).toBe(2);

    const year = await computeGitHotspots(path.join(dir, "app"), 365, new Set(["src/a.ts"]));
    expect(Object.keys(year.files)).toEqual(["src/a.ts"]);
    expect(year.files["src/a.ts"].commits).toBe(3);
  });

  it("returns an empty, unavailable report outside a repository", async () => {
    const res = await handleGitHotspotsRequest(new URL("http://x/git-hotspots.json?days=30"), dir);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ available: false, reason: "not-a-git-repo", files: {} });
  });

  it("treats a repository without commits as empty but available", async () => {
    git(["init", "-q"]);
    const report = await computeGitHotspots(dir, 30);
    expect(report).toMatchObject({ available: true, files: {}, commitCount: 0 });
  });

  it("exposes the format string it parses", () => {
    expect(GIT_LOG_FORMAT.startsWith(R)).toBe(true);
  });
});

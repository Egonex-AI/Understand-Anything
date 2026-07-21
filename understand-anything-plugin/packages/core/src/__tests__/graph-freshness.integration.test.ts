import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getGraphFreshness,
  getGraphFreshnessBatch,
} from "../staleness.js";

const temporaryDirectories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function createTemporaryDirectory(prefix = "ua-freshness-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeProjectFile(
  projectDir: string,
  relativePath: string,
  contents: string,
): void {
  const filePath = join(projectDir, ...relativePath.split("/"));
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function commitAll(repoDir: string, message: string): string {
  git(repoDir, "add", "--all");
  git(repoDir, "commit", "-m", message);
  return git(repoDir, "rev-parse", "HEAD");
}

function createRepository(
  initialFiles: Record<string, string> = {
    "src/index.ts": "export const value = 1;\n",
  },
): { repoDir: string; baseline: string } {
  const repoDir = createTemporaryDirectory();
  git(repoDir, "init");
  git(repoDir, "config", "user.email", "freshness-tests@example.com");
  git(repoDir, "config", "user.name", "Freshness Tests");

  for (const [relativePath, contents] of Object.entries(initialFiles)) {
    writeProjectFile(repoDir, relativePath, contents);
  }

  return {
    repoDir,
    baseline: commitAll(repoDir, "baseline"),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

describe(
  "getGraphFreshness with a real Git repository",
  { timeout: 15_000 },
  () => {
  it("returns fresh for a clean project at the analyzed commit", async () => {
    const { repoDir, baseline } = createRepository();

    await expect(
      getGraphFreshness(repoDir, {
        graphCommitHash: baseline,
        lastAnalyzedAt: "2026-07-10T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      status: "fresh",
      graphCommitHash: baseline,
      headCommitHash: baseline,
      changedFileCount: 0,
      changedFiles: [],
      commitsBehind: 0,
      commitsAhead: 0,
      lastAnalyzedAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it.each([
    {
      name: "unstaged",
      path: "src/index.ts",
      prepare(repoDir: string) {
        writeProjectFile(repoDir, "src/index.ts", "export const value = 2;\n");
      },
    },
    {
      name: "staged",
      path: "src/staged.ts",
      prepare(repoDir: string) {
        writeProjectFile(repoDir, "src/staged.ts", "export const staged = true;\n");
        git(repoDir, "add", "src/staged.ts");
      },
    },
    {
      name: "untracked",
      path: "src/untracked.ts",
      prepare(repoDir: string) {
        writeProjectFile(
          repoDir,
          "src/untracked.ts",
          "export const untracked = true;\n",
        );
      },
    },
  ])("returns dirty for $name project changes", async ({ path, prepare }) => {
    const { repoDir, baseline } = createRepository();
    prepare(repoDir);

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: baseline }),
    ).resolves.toMatchObject({
      status: "dirty",
      graphCommitHash: baseline,
      headCommitHash: baseline,
      changedFileCount: 1,
      changedFiles: [path],
      commitsBehind: 0,
      commitsAhead: 0,
    });
  });

  it("deduplicates paths changed in both the index and working tree", async () => {
    const { repoDir, baseline } = createRepository();
    writeProjectFile(repoDir, "src/index.ts", "export const value = 2;\n");
    git(repoDir, "add", "src/index.ts");
    writeProjectFile(repoDir, "src/index.ts", "export const value = 3;\n");

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: baseline }),
    ).resolves.toMatchObject({
      status: "dirty",
      changedFileCount: 1,
      changedFiles: ["src/index.ts"],
    });
  });

  it.each([".understand-anything", ".ua"])(
    "ignores untracked Understand Anything output files in %s",
    async (dataDir) => {
    const { repoDir, baseline } = createRepository();
    writeProjectFile(
      repoDir,
      `${dataDir}/knowledge-graph.json`,
      "{}\n",
    );
    writeProjectFile(
      repoDir,
      `${dataDir}/intermediate/batch-0.json`,
      "{}\n",
    );

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: baseline }),
    ).resolves.toMatchObject({
      status: "fresh",
      changedFileCount: 0,
      changedFiles: [],
    });
    },
  );

  it.each([".understand-anything", ".ua"])(
    "ignores commits that only change Understand Anything output files in %s",
    async (dataDir) => {
      const { repoDir, baseline } = createRepository();
      writeProjectFile(repoDir, `${dataDir}/knowledge-graph.json`, "{}\n");
      const headCommit = commitAll(repoDir, "persist generated graph");

      await expect(
        getGraphFreshness(repoDir, { graphCommitHash: baseline }),
      ).resolves.toEqual({
        status: "fresh",
        graphCommitHash: baseline,
        headCommitHash: headCommit,
        changedFileCount: 0,
        changedFiles: [],
        commitsBehind: 0,
        commitsAhead: 0,
      });
    },
  );

  it.each([".understand-anything", ".ua"])(
    "still reports source changes beside ignored output files in %s",
    async (dataDir) => {
      const { repoDir, baseline } = createRepository();
      writeProjectFile(repoDir, `${dataDir}/knowledge-graph.json`, "{}\n");
      writeProjectFile(
        repoDir,
        "src/real-change.ts",
        "export const changed = true;\n",
      );

      await expect(
        getGraphFreshness(repoDir, { graphCommitHash: baseline }),
      ).resolves.toMatchObject({
        status: "dirty",
        changedFileCount: 1,
        changedFiles: ["src/real-change.ts"],
      });
    },
  );

  it("resolves an abbreviated graph hash to the full matching commit", async () => {
    const { repoDir, baseline } = createRepository();

    await expect(
      getGraphFreshness(repoDir, {
        graphCommitHash: baseline.slice(0, 8),
      }),
    ).resolves.toMatchObject({
      status: "fresh",
      graphCommitHash: baseline,
      headCommitHash: baseline,
    });
  });

  it("reports a graph behind the current project history", async () => {
    const { repoDir, baseline } = createRepository();
    writeProjectFile(repoDir, "src/index.ts", "export const value = 2;\n");
    const head = commitAll(repoDir, "project change");

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: baseline }),
    ).resolves.toMatchObject({
      status: "stale",
      relation: "behind",
      graphCommitHash: baseline,
      headCommitHash: head,
      changedFileCount: 1,
      changedFiles: ["src/index.ts"],
      commitsBehind: 1,
      commitsAhead: 0,
    });
  });

  it("reports a graph ahead of the checked-out project history", async () => {
    const { repoDir, baseline } = createRepository();
    writeProjectFile(repoDir, "src/future.ts", "export const future = true;\n");
    const graphCommit = commitAll(repoDir, "future graph commit");
    git(repoDir, "checkout", "--detach", baseline);

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: graphCommit }),
    ).resolves.toMatchObject({
      status: "stale",
      relation: "ahead",
      graphCommitHash: graphCommit,
      headCommitHash: baseline,
      changedFileCount: 1,
      changedFiles: ["src/future.ts"],
      commitsBehind: 0,
      commitsAhead: 1,
    });
  });

  it("reports divergent project histories without calling either side behind", async () => {
    const { repoDir, baseline } = createRepository();
    git(repoDir, "checkout", "-b", "graph-history");
    writeProjectFile(repoDir, "src/graph.ts", "export const graph = true;\n");
    const graphCommit = commitAll(repoDir, "graph-side change");

    git(repoDir, "checkout", "-b", "head-history", baseline);
    writeProjectFile(repoDir, "src/head.ts", "export const head = true;\n");
    const headCommit = commitAll(repoDir, "head-side change");

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: graphCommit }),
    ).resolves.toMatchObject({
      status: "stale",
      relation: "diverged",
      graphCommitHash: graphCommit,
      headCommitHash: headCommit,
      changedFileCount: 2,
      changedFiles: ["src/graph.ts", "src/head.ts"],
      commitsBehind: 1,
      commitsAhead: 1,
    });
  });

  it("ignores commits that only touch a sibling monorepo project", async () => {
    const { repoDir, baseline } = createRepository({
      "apps/target/src/index.ts": "export const target = 1;\n",
      "apps/sibling/src/index.ts": "export const sibling = 1;\n",
    });
    writeProjectFile(
      repoDir,
      "apps/sibling/src/index.ts",
      "export const sibling = 2;\n",
    );
    const head = commitAll(repoDir, "sibling-only change");
    const targetProject = join(repoDir, "apps", "target");

    await expect(
      getGraphFreshness(targetProject, { graphCommitHash: baseline }),
    ).resolves.toEqual({
      status: "fresh",
      graphCommitHash: baseline,
      headCommitHash: head,
      changedFileCount: 0,
      changedFiles: [],
      commitsBehind: 0,
      commitsAhead: 0,
    });
  });

  it("ignores staged, unstaged, and untracked changes in a sibling project", async () => {
    const { repoDir, baseline } = createRepository({
      "apps/target/src/index.ts": "export const target = 1;\n",
      "apps/sibling/src/staged.ts": "export const staged = 1;\n",
      "apps/sibling/src/unstaged.ts": "export const unstaged = 1;\n",
    });
    writeProjectFile(
      repoDir,
      "apps/sibling/src/staged.ts",
      "export const staged = 2;\n",
    );
    git(repoDir, "add", "apps/sibling/src/staged.ts");
    writeProjectFile(
      repoDir,
      "apps/sibling/src/unstaged.ts",
      "export const unstaged = 2;\n",
    );
    writeProjectFile(
      repoDir,
      "apps/sibling/src/untracked.ts",
      "export const untracked = true;\n",
    );
    const targetProject = join(repoDir, "apps", "target");

    await expect(
      getGraphFreshness(targetProject, { graphCommitHash: baseline }),
    ).resolves.toEqual({
      status: "fresh",
      graphCommitHash: baseline,
      headCommitHash: baseline,
      changedFileCount: 0,
      changedFiles: [],
      commitsBehind: 0,
      commitsAhead: 0,
    });
  });

  it("counts only selected-project commits and returns project-relative paths", async () => {
    const { repoDir, baseline } = createRepository({
      "apps/target/src/index.ts": "export const target = 1;\n",
      "apps/sibling/src/index.ts": "export const sibling = 1;\n",
    });
    writeProjectFile(
      repoDir,
      "apps/sibling/src/index.ts",
      "export const sibling = 2;\n",
    );
    commitAll(repoDir, "sibling-only change");
    writeProjectFile(
      repoDir,
      "apps/target/src/index.ts",
      "export const target = 2;\n",
    );
    commitAll(repoDir, "target-project change");
    const targetProject = join(repoDir, "apps", "target");

    await expect(
      getGraphFreshness(targetProject, { graphCommitHash: baseline }),
    ).resolves.toMatchObject({
      status: "stale",
      relation: "behind",
      changedFileCount: 1,
      changedFiles: ["src/index.ts"],
      commitsBehind: 1,
      commitsAhead: 0,
    });
  });

  it("preserves spaces and non-ASCII characters in changed paths", async () => {
    const specialPath = "src/space name-文件.ts";
    const { repoDir, baseline } = createRepository({
      [specialPath]: "export const value = 1;\n",
    });
    writeProjectFile(repoDir, specialPath, "export const value = 2;\n");
    commitAll(repoDir, "change special path");

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: baseline }),
    ).resolves.toMatchObject({
      status: "stale",
      changedFileCount: 1,
      changedFiles: [specialPath],
    });
  });

  it("evaluates multiple graph commits in one batch", async () => {
    const { repoDir, baseline } = createRepository();
    writeProjectFile(repoDir, "src/domain.ts", "export const domain = 1;\n");
    const domainCommit = commitAll(repoDir, "domain graph commit");
    writeProjectFile(repoDir, "src/index.ts", "export const value = 2;\n");
    const headCommit = commitAll(repoDir, "knowledge graph drift");

    await expect(
      getGraphFreshnessBatch(repoDir, {
        knowledge: { graphCommitHash: baseline },
        domain: { graphCommitHash: domainCommit },
      }),
    ).resolves.toMatchObject({
      knowledge: {
        status: "stale",
        relation: "behind",
        headCommitHash: headCommit,
        commitsBehind: 2,
      },
      domain: {
        status: "stale",
        relation: "behind",
        headCommitHash: headCommit,
        commitsBehind: 1,
        changedFiles: ["src/index.ts"],
      },
    });
  });

  it("returns missing-graph-commit without consulting Git", async () => {
    const projectDir = createTemporaryDirectory();

    await expect(
      getGraphFreshness(projectDir, {
        graphCommitHash: "  ",
        lastAnalyzedAt: "2026-07-10T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      status: "unknown",
      reason: "missing-graph-commit",
      lastAnalyzedAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("returns git-head-unavailable outside a Git repository", async () => {
    const projectDir = createTemporaryDirectory();

    await expect(
      getGraphFreshness(projectDir, { graphCommitHash: "deadbeef" }),
    ).resolves.toEqual({
      status: "unknown",
      reason: "git-head-unavailable",
      graphCommitHash: "deadbeef",
    });
  });

  it("returns graph-commit-unavailable for an unknown graph commit", async () => {
    const { repoDir, baseline } = createRepository();

    await expect(
      getGraphFreshness(repoDir, { graphCommitHash: "deadbeef" }),
    ).resolves.toEqual({
      status: "unknown",
      reason: "graph-commit-unavailable",
      graphCommitHash: "deadbeef",
      headCommitHash: baseline,
    });
  });
  },
);

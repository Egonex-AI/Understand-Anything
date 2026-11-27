import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve, basename, isAbsolute, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { createSafeGitEnv } from "./git-env.js";
import { validateGitConfigKeys } from "./git-config.js";

function statOptional(target: string) {
  try {
    return lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function readMetadata(filename: string): string {
  const stat = lstatSync(filename);

  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 16 * 1024
  ) {
    throw new Error("Unsafe Git metadata");
  }

  const value = readFileSync(filename, "utf8")
    .replace(/\r?\n$/, "");

  if (!value || /[\r\n\0]/.test(value)) {
    throw new Error("Invalid Git metadata");
  }

  return value;
}

function requireCanonicalDirectory(target: string): string {
  const absolute = resolve(target);
  const stat = lstatSync(absolute);

  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(absolute) !== absolute
  ) {
    throw new Error("Unsafe Git metadata directory");
  }

  return absolute;
}

function resolveLinkedWorktree(marker: string) {
  const authorized = process.env.UNDERSTAND_GIT_COMMON_DIR;

  if (!authorized || !isAbsolute(authorized)) {
    throw new Error("Git common directory is not authorized");
  }

  const commonDir = requireCanonicalDirectory(authorized);
  const pointer = readMetadata(marker);

  if (!pointer.startsWith("gitdir: ")) {
    throw new Error("Invalid Git directory pointer");
  }

  const gitDir = resolve(dirname(marker), pointer.slice(8));

  const worktreesDir = requireCanonicalDirectory(
    join(commonDir, "worktrees"),
  );

  if (
    dirname(gitDir) !== worktreesDir ||
    gitDir !== join(worktreesDir, basename(gitDir))
  ) {
    throw new Error("Git directory outside authorized worktrees");
  }

  requireCanonicalDirectory(gitDir);

  const declaredCommonDir = resolve(
    gitDir,
    readMetadata(join(gitDir, "commondir")),
  );

  if (declaredCommonDir !== commonDir) {
    throw new Error("Git common directory mismatch");
  }

  const backlink = resolve(
    gitDir,
    readMetadata(join(gitDir, "gitdir")),
  );

  if (backlink !== marker) {
    throw new Error("Git worktree backlink mismatch");
  }

  if (statOptional(join(commonDir, "commondir"))) {
    throw new Error("Unexpected nested common directory");
  }

  return { gitDir, commonDir };
}

function findGitDirectory(projectRoot: string): {
  gitDir: string;
  commonDir: string;
} {
  let current = realpathSync(projectRoot);

  const authorizedRoot = process.env.UNDERSTAND_PROJECT_ROOT;
  const boundary = authorizedRoot
    ? requireCanonicalDirectory(authorizedRoot)
    : null;

  if (boundary) {
    const rel = relative(boundary, current);

    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Project outside authorized Git boundary");
    }
  }

  if (!lstatSync(current).isDirectory()) {
    throw new Error("Invalid project directory");
  }

  while (true) {
    const candidate = join(current, ".git");
    const stat = statOptional(candidate);

    if (stat) {
      if (stat.isSymbolicLink()) {
        throw new Error("Unsafe Git directory layout");
      }

      if (stat.isFile()) {
        return resolveLinkedWorktree(candidate);
      }

      if (!stat.isDirectory()) {
        throw new Error("Unsupported Git directory layout");
      }

      const gitDir = requireCanonicalDirectory(candidate);

      if (statOptional(join(gitDir, "commondir"))) {
        throw new Error("Unsupported shared Git directory");
      }

      return { gitDir, commonDir: gitDir };
    }

    if (boundary && current === boundary) {
      throw new Error("Git repository outside authorized boundary");
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error("Git repository not found");
    }

    current = parent;
  }
}

function inspectConfig(filename: string, cwd: string): void {
  const stat = lstatSync(filename);

  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 1024 * 1024
  ) {
    throw new Error("Unsafe Git configuration file");
  }

  const output = execFileSync(
    "git",
    [
      "--no-pager",
      "config",
      "--file",
      filename,
      "--no-includes",
      "--null",
      "--name-only",
      "--list",
    ],
    {
      cwd,
      env: {
        ...createSafeGitEnv(),
        GIT_CEILING_DIRECTORIES: dirname(cwd),
      },
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  validateGitConfigKeys(output);
}

export function validateGitRepository(projectRoot: string): void {
  try {
    const { gitDir, commonDir } = findGitDirectory(projectRoot);

    const isolatedDir = realpathSync(
      mkdtempSync(join(tmpdir(), "ua-git-config-")),
    );

    try {
      inspectConfig(join(commonDir, "config"), isolatedDir);

      const worktreeConfig = join(gitDir, "config.worktree");

      if (statOptional(worktreeConfig)) {
        inspectConfig(worktreeConfig, isolatedDir);
      }
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  } catch (error) {
    throw Object.assign(
      new Error("Unsafe Git repository configuration: validation failed"),
      { cause: error },
    );
  }
}

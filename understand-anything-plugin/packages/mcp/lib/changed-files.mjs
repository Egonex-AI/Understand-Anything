import { execFileSync } from "node:child_process";

// Scope every query to the project directory and exclude generated analysis
// artifacts (mirrors core's PROJECT_PATHSPEC in staleness.ts).
const PROJECT_PATHSPEC = [
  "--",
  ".",
  ":(exclude).understand-anything",
  ":(exclude).understand-anything/**",
  ":(exclude).ua",
  ":(exclude).ua/**",
];

function gitPaths(root, args) {
  const out = execFileSync("git", [...args, ...PROJECT_PATHSPEC], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/**
 * Changed files relative to the project root, which may be a subdirectory of
 * a larger git worktree. `--relative` makes `git diff` report paths relative
 * to the cwd, matching `git ls-files`; `-z` disables C-style quoting so
 * non-ASCII paths match graph nodes verbatim.
 */
export function changedFiles(root, { staged, base } = {}) {
  // Reject option-shaped refs: a leading "-" would make git parse the value
  // as a flag (e.g. --output=<file> writes the diff somewhere unexpected).
  // --end-of-options additionally stops revision parsing of flag-like input.
  if (base && (base.startsWith("-") || base.includes(".."))) {
    throw new Error(
      `Invalid base ref "${base}" — must be a plain ref like 'main' or 'HEAD~3' (no leading '-', and '...' is added by the tool).`,
    );
  }

  const diff = ["diff", "--name-only", "-z", "--relative"];
  const files = gitPaths(
    root,
    base
      ? [...diff, "--end-of-options", `${base}...HEAD`]
      : staged
        ? [...diff, "--cached"]
        : [...diff, "HEAD"],
  );
  if (!base && !staged) {
    files.push(...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  }
  return [...new Set(files)];
}

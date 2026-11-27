export function validateGitConfigKeys(output: string): void {
  const keys = output.split("\0").filter(Boolean);

  for (const key of keys) {
    const normalized = key.toLowerCase();

    const blocked =
      normalized === "core.worktree" ||
      normalized === "core.sshcommand" ||
      normalized === "core.gitproxy" ||
      normalized === "core.attributesfile" ||
      normalized === "core.excludesfile" ||
      normalized === "diff.external" ||
      normalized.startsWith("filter.") ||
      normalized.startsWith("include.") ||
      normalized.startsWith("includeif.") ||
      normalized.startsWith("alias.") ||
      /^diff\..+\.(command|textconv)$/.test(normalized);

    if (blocked) {
      throw new Error(
        "Unsafe Git repository configuration",
      );
    }
  }
}

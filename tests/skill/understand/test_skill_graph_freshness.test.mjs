import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const graphConsumerSkills = [
  "understand-chat",
  "understand-explain",
  "understand-diff",
  "understand-onboard",
  "understand-domain",
];

const requiredFreshnessInstructions = [
  "gitCommitHash",
  "git rev-parse HEAD",
  'git rev-parse --verify --end-of-options "${GRAPH_COMMIT_RAW}^{commit}"',
  "git diff --name-only \"$GRAPH_COMMIT\" HEAD -- .",
  "git diff --cached --name-only -- .",
  "git diff --name-only -- .",
  "git ls-files --others --exclude-standard -- .",
  "working-tree",
  "hash mismatch",
  "project diff is empty",
  "Ignore the selected data directory (`.ua/` or legacy `.understand-anything/`)",
  "warn",
  "continue",
  "Run `/understand`",
];

describe("graph-consuming skills", () => {
  it.each(graphConsumerSkills)(
    "%s checks committed and working-tree freshness before using a graph",
    (skillName) => {
      const skillPath = resolve(
        repoRoot,
        "understand-anything-plugin",
        "skills",
        skillName,
        "SKILL.md",
      );
      const content = readFileSync(skillPath, "utf-8");

      for (const instruction of requiredFreshnessInstructions) {
        expect(content).toContain(instruction);
      }
      expect(content).not.toContain(
        'git diff --name-only "$GRAPH_COMMIT_RAW" HEAD -- .',
      );
    },
  );

  it("understand-domain applies the preflight only to its existing-graph path", () => {
    const content = readFileSync(
      resolve(
        repoRoot,
        "understand-anything-plugin",
        "skills",
        "understand-domain",
        "SKILL.md",
      ),
      "utf-8",
    );

    expect(content).toContain("When `--full` is used, skip this preflight");
    expect(content).toContain("Phase 3: Derive from Existing Graph");
  });
});

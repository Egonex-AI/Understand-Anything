import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

function expectRelativePathExists(manifestPath, relativePath) {
  const target = resolve(repoRoot, relativePath);

  expect(existsSync(target), `${manifestPath} points to missing ${relativePath}`).toBe(true);
}

describe("platform plugin manifests", () => {
  const manifestPaths = [
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".copilot-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "understand-anything-plugin/.claude-plugin/plugin.json",
  ];

  it("keeps every platform manifest version in sync with the package", () => {
    const packageJson = readJson("understand-anything-plugin/package.json");

    for (const manifestPath of manifestPaths) {
      const manifest = readJson(manifestPath);

      expect(manifest.version, manifestPath).toBe(packageJson.version);
    }
  });

  it("ships a native Codex manifest with discoverable skills", () => {
    const manifestPath = ".codex-plugin/plugin.json";
    const manifest = readJson(manifestPath);

    expect(manifest.name).toBe("understand-anything");
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.interface.displayName).toBe("Understand Anything");
    expect(manifest.interface.category).toBe("Developer Tools");
    expect(manifest.interface.defaultPrompt).toContain("Map this codebase with Understand Anything.");

    expectRelativePathExists(manifestPath, manifest.skills);
    expect(statSync(resolve(repoRoot, "understand-anything-plugin/skills/understand/SKILL.md")).isFile()).toBe(true);
  });
});

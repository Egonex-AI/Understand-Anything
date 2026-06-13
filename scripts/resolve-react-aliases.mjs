#!/usr/bin/env node
/**
 * Resolves React alias paths from the pnpm store for vitest.
 * Called by vitest-react-aliases.ts at test startup.
 *
 * Usage: node scripts/resolve-react-aliases.mjs
 *   Prints the resolved paths as JSON (for debugging / CI).
 *   Normally imported directly by vitest-react-aliases.ts.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Resolve a package from the pnpm virtual store by prefix-matching
 * the directory name in node_modules/.pnpm/.
 */
function resolvePkg(versionPrefix, ...subpathParts) {
  const pnpmDir = path.join(REPO_ROOT, "node_modules/.pnpm");
  const entries = readdirSync(pnpmDir);
  const match = entries.find((e) => e.startsWith(versionPrefix));
  if (!match) {
    throw new Error(
      `[resolve-react-aliases] Cannot find ${versionPrefix}* in pnpm store.\n` +
      `  In: ${pnpmDir}\n` +
      `  Run: pnpm install`
    );
  }
  return path.join(pnpmDir, match, "node_modules", ...subpathParts);
}

export function resolveReactAliases() {
  const react = resolvePkg("react@", "react");
  const reactDom = resolvePkg("react-dom@", "react-dom");
  const testingLibraryReact = resolvePkg(
    "@testing-library+react@", "@testing-library", "react",
  );
  const xyflowReact = resolvePkg(
    "@xyflow+react@", "@xyflow", "react",
  );

  return { react, reactDom, testingLibraryReact, xyflowReact };
}

// When run directly, print resolved paths for debugging.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const aliases = resolveReactAliases();
  console.log(JSON.stringify(aliases, null, 2));
}

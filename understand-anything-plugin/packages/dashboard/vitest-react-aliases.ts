/**
 * React alias paths for vitest — resolved dynamically from the pnpm store.
 * Forces a single React instance so pnpm workspace duplicate copies
 * don't cause "Invalid hook call" errors.
 *
 * Paths are resolved at startup; if a package is missing, an error is thrown
 * with a clear fix instruction (run `pnpm install`).
 */
import { existsSync } from "node:fs";
import { resolveReactAliases } from "../../../scripts/resolve-react-aliases.mjs";

const resolved = resolveReactAliases();

export const REACT_ALIAS = resolved.react;
export const REACT_DOM_ALIAS = resolved.reactDom;
export const TESTING_LIBRARY_REACT_ALIAS = resolved.testingLibraryReact;
export const XYFLOW_REACT_ALIAS = resolved.xyflowReact;

const aliases: Record<string, string> = {
  react: REACT_ALIAS,
  "react-dom": REACT_DOM_ALIAS,
  "@testing-library/react": TESTING_LIBRARY_REACT_ALIAS,
  "@xyflow/react": XYFLOW_REACT_ALIAS,
};

for (const [name, resolvedPath] of Object.entries(aliases)) {
  if (!existsSync(resolvedPath)) {
    throw new Error(
      `[vitest-react-aliases] ${name} alias path does not exist: ${resolvedPath}\n` +
      `Cause: pnpm dependency version changed.\n` +
      `Fix: Run pnpm install`,
    );
  }
}

export const VITEST_REACT_ALIASES = aliases;

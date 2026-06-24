import { defineConfig } from 'vitest/config';

// The plugin package no longer ships any test files — they were relocated
// to the repo-root `tests/` tree so they no longer ride along with the
// plugin marketplace bundle. This config exists solely to shadow the
// repo-root vitest.config.ts (which would otherwise be inherited via
// upward config discovery from this cwd) and explicitly resolve no tests.
//
// Run skill tests from the repo root with `pnpm test` instead.
export default defineConfig({
  test: {
    include: [],
  },
});

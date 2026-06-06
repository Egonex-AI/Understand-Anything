import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { readFileSync, existsSync } from 'node:fs';

// Strip shebangs from .mjs files so vitest can import CLI scripts that start
// with `#!/usr/bin/env node` without a SyntaxError. Uses the `load` hook so
// the shebang is removed before Vite ever attempts to parse the file as JS.
function stripShebang(): Plugin {
  return {
    name: 'strip-shebang',
    enforce: 'pre',
    load(id: string) {
      if (!id.endsWith('.mjs') || !existsSync(id)) return null;
      const code = readFileSync(id, 'utf-8');
      if (code.startsWith('#!')) {
        return { code: code.replace(/^#![^\r\n]*\r?\n/, '') };
      }
      return null;
    },
  };
}

// Single-config aggregation for the whole monorepo. Picks up:
//   - tests/**                                          — relocated skill tests (out-of-plugin so they
//                                                         do not ship via the marketplace bundle)
//   - understand-anything-plugin/src/**                 — skill TS source tests
//   - understand-anything-plugin/packages/dashboard/**  — dashboard utils tests
//
// The `@understand-anything/core` package owns its own vitest.config.ts and is
// invoked separately via `pnpm --filter @understand-anything/core test`; its
// files are excluded here to avoid double-counting.
export default defineConfig({
  plugins: [stripShebang()],
  test: {
    include: [
      'tests/**/*.test.{js,mjs,ts}',
      'understand-anything-plugin/src/**/*.test.{js,mjs,ts}',
      'understand-anything-plugin/packages/dashboard/**/*.test.{js,mjs,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'understand-anything-plugin/packages/core/**',
    ],
  },
});

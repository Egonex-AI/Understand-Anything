#!/usr/bin/env node
// Thin dispatch wrapper. Lives in `bin/` (not `dist/bin/`) so `pnpm install`
// can materialize the `ua-fingerprint-check` shim before tsc has run on a
// clean clone. The real CLI lives at `dist/bin/fingerprint-check.js` and is
// produced by `pnpm --filter @understand-anything/core build`.
//
// If the user runs the shim before building, we fail with a clear message
// instead of an opaque "cannot find module" stack trace.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "dist", "bin", "fingerprint-check.js");

if (!existsSync(distEntry)) {
  process.stderr.write(
    `ua-fingerprint-check: dist not built yet.\n` +
      `  Run: pnpm --filter @understand-anything/core build\n`,
  );
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);

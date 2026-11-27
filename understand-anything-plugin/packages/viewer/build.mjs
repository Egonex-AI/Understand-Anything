#!/usr/bin/env node
/**
 * Build the standalone viewer: build the dashboard (and its core dependency),
 * then embed the compiled frontend under this package's dist/ so the packed
 * tarball is fully self-contained (no runtime dependencies).
 *
 * Run from anywhere inside the monorepo:
 *     corepack pnpm --filter understand-anything-viewer build
 */
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardDist = join(here, "..", "dashboard", "dist");
const coreDist = join(here, "..", "core", "dist");
const runtimeFiles = [
  "staleness.js",
  "security/git-env.js",
  "security/git-config.js",
  "security/git-preflight.js",
];
const viewerDist = join(here, "dist");
const viewerServerDist = join(here, "bin", "dist");

const pnpmCli = process.env.npm_execpath;

if (!pnpmCli || !existsSync(pnpmCli) ||
    !/[/\\]pnpm\.(?:c?js|mjs)$/.test(pnpmCli)) {
  console.error("Run the viewer build through the approved pnpm CLI.");
  process.exit(1);
}

for (const pkg of [
  "@understand-anything/core",
  "@understand-anything/dashboard",
]) {
  execFileSync(
    process.execPath,
    [pnpmCli, "--filter", pkg, "build"],
    { stdio: "inherit", cwd: here }
  );
}

if (!existsSync(dashboardDist)) {
  console.error(`Error: dashboard build output not found at ${dashboardDist}`);
  process.exit(1);
}

for (const file of runtimeFiles) {
  if (!existsSync(join(coreDist, file))) {
    throw new Error(`Missing viewer runtime dependency: ${file}`);
  }
}

rmSync(viewerDist, { recursive: true, force: true });
cpSync(dashboardDist, viewerDist, { recursive: true });
rmSync(viewerServerDist, { recursive: true, force: true });
mkdirSync(viewerServerDist, { recursive: true });
for (const file of runtimeFiles) {
  const destination = join(viewerServerDist, file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(coreDist, file), destination);
}

await import(
  new URL("./bin/dist/staleness.js", import.meta.url).href
);

console.log(`Embedded ${runtimeFiles.length} server runtime modules`);
console.log(`Embedded dashboard build into ${viewerDist}`);

#!/usr/bin/env node
/**
 * Build the standalone viewer: build the dashboard (and its core dependency),
 * then embed the compiled frontend under this package's dist/ so the packed
 * tarball is fully self-contained (no runtime dependencies).
 *
 * Run from anywhere inside the monorepo:
 *     pnpm --filter understand-anything-viewer build
 */
import { execSync } from "node:child_process";
import { cpSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardDist = join(here, "..", "dashboard", "dist");
const coreStaleness = join(here, "..", "core", "dist", "staleness.js");
const coreContentSearch = join(here, "..", "core", "dist", "content-search.js");
const coreAnnotations = join(here, "..", "core", "dist", "annotations.js");
const coreArchRules = join(here, "..", "core", "dist", "arch-rules.js");
const coreGitHotspots = join(here, "..", "core", "dist", "git-hotspots.js");
const viewerDist = join(here, "dist");
const viewerServerDist = join(here, "bin", "dist");

execSync("pnpm --filter @understand-anything/core build", { stdio: "inherit", cwd: here });
execSync("pnpm --filter @understand-anything/dashboard build", { stdio: "inherit", cwd: here });

if (!existsSync(dashboardDist)) {
  console.error(`Error: dashboard build output not found at ${dashboardDist}`);
  process.exit(1);
}

rmSync(viewerDist, { recursive: true, force: true });
cpSync(dashboardDist, viewerDist, { recursive: true });
rmSync(viewerServerDist, { recursive: true, force: true });
mkdirSync(viewerServerDist, { recursive: true });
cpSync(coreStaleness, join(viewerServerDist, "staleness.js"));
cpSync(coreContentSearch, join(viewerServerDist, "content-search.js"));
cpSync(coreAnnotations, join(viewerServerDist, "annotations.js"));
cpSync(coreArchRules, join(viewerServerDist, "arch-rules.js"));
cpSync(coreGitHotspots, join(viewerServerDist, "git-hotspots.js"));
console.log(`Embedded dashboard build into ${viewerDist}`);

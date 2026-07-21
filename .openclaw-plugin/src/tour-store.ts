import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TourStep } from "@understand-anything/core";

const TOURS_FILE = "tours.json";
const UA_DIR_CANDIDATES = [".understand-anything", ".ua"];

export type TourKind = "module" | "codeReview" | "custom" | "prWalkthrough";

/** Kinds that accumulate (one project can have many) rather than replace the previous tour of that kind. */
const ACCUMULATING_KINDS: ReadonlySet<TourKind> = new Set(["custom", "prWalkthrough"]);

export interface StoredTour {
  id: string;
  kind: TourKind;
  title: string;
  description: string;
  createdAt: string;
  steps: TourStep[];
  /** The user's free-text request, for kind "custom" tours only. */
  prompt?: string;
  /** Which base branch / PR this was generated from, for kind "prWalkthrough" only. */
  diffSource?: string;
}

/**
 * Resolves the project's data directory the same way @understand-anything/core's
 * persistence module does (legacy `.understand-anything/` first, else `.ua/`),
 * without a fragile deep-import into core's internals for one directory-name check.
 */
function resolveUaDir(projectRoot: string): string {
  for (const dir of UA_DIR_CANDIDATES) {
    const candidate = join(projectRoot, dir);
    if (existsSync(candidate)) return candidate;
  }
  return join(projectRoot, ".ua");
}

function toursFilePath(projectRoot: string): string {
  return join(resolveUaDir(projectRoot), TOURS_FILE);
}

export function loadTours(projectRoot: string): StoredTour[] {
  const file = toursFilePath(projectRoot);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    return Array.isArray(raw?.tours) ? raw.tours : [];
  } catch {
    return [];
  }
}

function saveTours(projectRoot: string, tours: StoredTour[]): void {
  const dir = resolveUaDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(toursFilePath(projectRoot), JSON.stringify({ tours }, null, 2), "utf-8");
}

/** Replaces any existing tour of the same kind (module/codeReview are singletons) or appends (custom/prWalkthrough tours accumulate). */
export function upsertTour(projectRoot: string, tour: StoredTour): void {
  const existing = loadTours(projectRoot);
  const next = ACCUMULATING_KINDS.has(tour.kind) ? [...existing, tour] : [...existing.filter((t) => t.kind !== tour.kind), tour];
  saveTours(projectRoot, next);
}

export function makeTourId(kind: TourKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

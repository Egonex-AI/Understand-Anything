import type { CodeLessonSection, CodeLessons } from "@understand-anything/core/types";

const MAX_SECTIONS_PER_FILE = 10;

function isValidLineRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 1 &&
    value[0] <= value[1]
  );
}

function normalizeSection(value: unknown): CodeLessonSection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const section = value as {
    title?: unknown;
    explanation?: unknown;
    lineRange?: unknown;
    tourOrder?: unknown;
  };
  if (typeof section.title !== "string" || section.title.trim().length === 0) return null;
  if (typeof section.explanation !== "string") return null;
  if (!isValidLineRange(section.lineRange)) return null;
  if (section.tourOrder !== undefined && !Number.isInteger(section.tourOrder)) return null;
  const normalized: CodeLessonSection = {
    title: section.title,
    lineRange: [section.lineRange[0], section.lineRange[1]],
    explanation: section.explanation,
  };
  if (section.tourOrder !== undefined) {
    normalized.tourOrder = section.tourOrder as number;
  }
  return normalized;
}

/**
 * Defense-in-depth for a generated optional artifact. The lessons document is
 * written by an agent, so malformed shapes will happen, and one bad entry must
 * neither crash the viewer nor discard every other file's lessons. Mirrors the
 * SKILL.md normalize rules: drop invalid entries and sections, cap sections
 * per file, keep everything else. Returns null only when the envelope itself
 * is broken (no usable `files` object).
 */
export function normalizeCodeLessons(data: unknown): CodeLessons | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const candidate = data as { version?: unknown; generatedAt?: unknown; files?: unknown };
  const files = candidate.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;

  // Null-prototype dictionary: a lesson keyed "constructor"/"toString" must not
  // resolve to an inherited function (crashes at lesson.sections.length), and
  // a "__proto__" key must become an own entry instead of mutating Object.prototype.
  const normalizedFiles = Object.create(null) as CodeLessons["files"];
  for (const [filePath, entry] of Object.entries(files as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      console.warn(`[code-lessons] dropped malformed entry for "${filePath}"`);
      continue;
    }
    const fileEntry = entry as { overview?: unknown; sections?: unknown };
    if (typeof fileEntry.overview !== "string") {
      console.warn(`[code-lessons] dropped entry for "${filePath}" (overview must be a string)`);
      continue;
    }
    if (!Array.isArray(fileEntry.sections)) {
      console.warn(
        `[code-lessons] "${filePath}": sections missing or not an array — treated as overview-only`,
      );
    }
    const rawSections = Array.isArray(fileEntry.sections) ? fileEntry.sections : [];
    const sections: CodeLessonSection[] = [];
    let droppedSections = 0;
    for (const raw of rawSections) {
      if (sections.length >= MAX_SECTIONS_PER_FILE) break;
      const section = normalizeSection(raw);
      if (section) {
        sections.push(section);
      } else {
        droppedSections += 1;
      }
    }
    if (droppedSections > 0) {
      console.warn(
        `[code-lessons] dropped ${droppedSections} malformed section(s) for "${filePath}"`,
      );
    }
    normalizedFiles[filePath] = { overview: fileEntry.overview, sections };
  }

  return {
    version: typeof candidate.version === "number" ? candidate.version : 1,
    generatedAt: typeof candidate.generatedAt === "string" ? candidate.generatedAt : "",
    files: normalizedFiles,
  };
}

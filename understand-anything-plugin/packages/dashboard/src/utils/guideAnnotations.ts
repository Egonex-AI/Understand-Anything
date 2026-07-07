export interface GuideLine {
  text: string;
  lineNumber: number | null;
  isGuideComment: boolean;
}

export interface GuideAnnotationInput {
  nodeId?: string;
  filePath?: string;
  line: number;
  text: string;
  anchor?: string;
  before?: string;
  after?: string;
  stale?: boolean;
}

interface ResolvedGuideAnnotation {
  text: string;
  requestedLine: number;
  resolvedLine: number;
  stale: boolean;
}

function commentPrefixForLanguage(language: string): string {
  if (["python", "ruby", "bash", "shell", "sh", "yaml"].includes(language)) {
    return "#";
  }
  return "//";
}

function normalizedSnippet(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function lineContainsSnippet(line: string | undefined, snippet: string): boolean {
  if (!snippet) return false;
  return normalizedSnippet(line).includes(snippet);
}

function scoreAnchorCandidate(
  sourceLines: string[],
  lineIndex: number,
  annotation: GuideAnnotationInput,
): number {
  let score = 0;
  const before = normalizedSnippet(annotation.before);
  const after = normalizedSnippet(annotation.after);
  if (before) {
    for (let index = Math.max(0, lineIndex - 3); index < lineIndex; index += 1) {
      if (lineContainsSnippet(sourceLines[index], before)) score += 2;
    }
  }
  if (after) {
    for (let index = lineIndex + 1; index <= Math.min(sourceLines.length - 1, lineIndex + 3); index += 1) {
      if (lineContainsSnippet(sourceLines[index], after)) score += 2;
    }
  }
  score -= Math.abs(lineIndex + 1 - annotation.line) / 1000;
  return score;
}

function resolveGuideAnnotation(
  sourceLines: string[],
  annotation: GuideAnnotationInput,
): ResolvedGuideAnnotation | null {
  const requestedLine = annotation.line;
  const fallbackLine = Math.min(Math.max(requestedLine, 1), Math.max(sourceLines.length, 1));
  const anchor = normalizedSnippet(annotation.anchor);

  if (!anchor) {
    return {
      text: annotation.text,
      requestedLine,
      resolvedLine: fallbackLine,
      stale: Boolean(annotation.stale),
    };
  }

  const requestedIndex = requestedLine - 1;
  if (lineContainsSnippet(sourceLines[requestedIndex], anchor)) {
    return {
      text: annotation.text,
      requestedLine,
      resolvedLine: requestedLine,
      stale: Boolean(annotation.stale),
    };
  }

  const candidates = sourceLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => lineContainsSnippet(line, anchor));

  if (candidates.length === 0) {
    if (fallbackLine < 1 || fallbackLine > sourceLines.length) return null;
    return {
      text: annotation.text,
      requestedLine,
      resolvedLine: fallbackLine,
      stale: true,
    };
  }

  candidates.sort((left, right) => {
    const scoreDelta =
      scoreAnchorCandidate(sourceLines, right.index, annotation) -
      scoreAnchorCandidate(sourceLines, left.index, annotation);
    if (scoreDelta !== 0) return scoreDelta;
    return Math.abs(left.index + 1 - requestedLine) - Math.abs(right.index + 1 - requestedLine);
  });

  return {
    text: annotation.text,
    requestedLine,
    resolvedLine: candidates[0].index + 1,
    stale: Boolean(annotation.stale),
  };
}

export function buildGuideLines(
  sourceContent: string,
  language: string,
  guideAnnotations: GuideAnnotationInput[] | undefined,
): GuideLine[] {
  const prefix = commentPrefixForLanguage(language);
  const lines: GuideLine[] = [];
  const annotationsByLine = new Map<number, string[]>();
  const sourceLines = sourceContent.split(/\r?\n/);
  for (const annotation of guideAnnotations ?? []) {
    const resolved = resolveGuideAnnotation(sourceLines, annotation);
    if (!resolved) continue;
    const list = annotationsByLine.get(resolved.resolvedLine) ?? [];
    const movedSuffix = resolved.resolvedLine !== resolved.requestedLine
      ? ` (moved from line ${resolved.requestedLine})`
      : "";
    const stalePrefix = resolved.stale ? "[stale anchor] " : "";
    list.push(`${stalePrefix}${resolved.text}${movedSuffix}`);
    annotationsByLine.set(resolved.resolvedLine, list);
  }

  for (let lineNumber = 1; lineNumber <= sourceLines.length; lineNumber += 1) {
    for (const annotation of annotationsByLine.get(lineNumber) ?? []) {
      for (const rawLine of annotation.split(/\r?\n/)) {
        lines.push({
          text: rawLine.trim() ? `${prefix} ${rawLine}` : prefix,
          lineNumber: null,
          isGuideComment: true,
        });
      }
    }
    lines.push({
      text: sourceLines[lineNumber - 1] ?? "",
      lineNumber,
      isGuideComment: false,
    });
  }
  return lines;
}

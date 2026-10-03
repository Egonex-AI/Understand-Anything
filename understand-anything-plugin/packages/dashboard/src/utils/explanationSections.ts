import type { Persona } from "../store";

export const EXPLANATION_HEADINGS = [
  "役割",
  "呼ばれる場面",
  "入出力",
  "主な処理",
  "依存・データの流れ",
  "変更時の影響",
  "初心者向けまとめ",
  "根拠",
] as const;

export type ExplanationHeading = typeof EXPLANATION_HEADINGS[number];

const headingSet = new Set<string>(EXPLANATION_HEADINGS);
const personaHeadings: Record<Exclude<Persona, "experienced">, readonly ExplanationHeading[]> = {
  "non-technical": ["初心者向けまとめ"],
  // This order follows the canonical persisted-heading order, not UI preference.
  junior: ["役割", "主な処理", "依存・データの流れ", "初心者向けまとめ"],
};

/**
 * Selects already-persisted Japanese explanation sections without generating or
 * rewording content. Duplicate headings retain their first non-empty section;
 * unknown headings are ignored. `null` means no safe reduced explanation.
 */
export function explanationForPersona(
  explanation: string,
  persona: Persona,
): string | null {
  if (persona === "experienced") return explanation;

  const sections = new Map<ExplanationHeading, string>();
  const lines = explanation.replace(/\r\n?/g, "\n").split("\n");
  let active: ExplanationHeading | null = null;
  let content: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  const commit = () => {
    if (!active || sections.has(active)) return;
    const body = content.join("\n").trim();
    if (body) sections.set(active, body);
  };

  for (const line of lines) {
    if (fence) {
      const closing = new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`);
      if (closing.test(line)) fence = null;
      if (active) content.push(line);
      continue;
    }
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (opening) {
      const marker = opening[1][0] as "`" | "~";
      fence = { marker, length: opening[1].length };
      if (active) content.push(line);
      continue;
    }
    const match = line.match(/^\s*##\s+(.+?)\s*$/);
    if (!match) {
      if (active) content.push(line);
      continue;
    }
    commit();
    const title = match[1].trim();
    active = headingSet.has(title) ? title as ExplanationHeading : null;
    content = [];
  }
  commit();

  const selected = personaHeadings[persona]
    .filter((heading) => sections.has(heading))
    .map((heading) => `## ${heading}\n\n${sections.get(heading)}`);

  return selected.length > 0 ? selected.join("\n\n") : null;
}

import type { GraphNode, GraphEdge } from "../types.js";
import type { LanguageConfig } from "../languages/types.js";

export interface LanguageLessonResult {
  languageNotes: string;
  concepts: Array<{ name: string; explanation: string }>;
}

/**
 * Base concept patterns that apply across all languages.
 * These are merged with language-specific concepts from LanguageConfig.
 */
const BASE_CONCEPT_PATTERNS: Record<string, string[]> = {
  "async/await": ["async", "await", "promise", "asynchronous"],
  "middleware pattern": ["middleware", "interceptor", "pipe"],
  "generics": ["generic", "type parameter", "template"],
  "decorators": ["decorator", "@", "annotation"],
  "dependency injection": ["inject", "provider", "container", "di"],
  "observer pattern": [
    "subscribe",
    "publish",
    "event",
    "observable",
    "listener",
  ],
  "singleton": ["singleton", "instance", "shared client"],
  "type guards": ["type guard", "is", "narrowing", "discriminated union"],
  "higher-order functions": [
    "callback",
    "factory",
    "higher-order",
    "closure",
  ],
  "error handling": [
    "try/catch",
    "error boundary",
    "exception",
    "Result type",
  ],
  "streams": ["stream", "pipe", "transform", "readable", "writable"],
  "concurrency": ["goroutine", "channel", "thread", "worker", "mutex"],
};

/**
 * Build the full concept patterns map by merging base patterns with
 * language-specific concepts from a LanguageConfig (if provided).
 */
function buildConceptPatterns(
  langConfig?: LanguageConfig | null,
): Record<string, string[]> {
  const patterns = { ...BASE_CONCEPT_PATTERNS };

  if (langConfig?.concepts) {
    for (const concept of langConfig.concepts) {
      if (!patterns[concept]) {
        // Use the concept name itself as a keyword for detection
        patterns[concept] = [concept.toLowerCase()];
      }
    }
  }

  return patterns;
}

/**
 * Detects language concepts present in a graph node based on its tags, summary, and languageNotes.
 * When a LanguageConfig is provided, language-specific concepts are also detected.
 */
export function detectLanguageConcepts(
  node: GraphNode,
  language: string,
  langConfig?: LanguageConfig | null,
): string[] {
  const text = [
    ...node.tags,
    node.summary.toLowerCase(),
    node.languageNotes?.toLowerCase() ?? "",
  ].join(" ");

  const patterns = buildConceptPatterns(langConfig);
  const detected: string[] = [];

  for (const [concept, keywords] of Object.entries(patterns)) {
    const found = keywords.some((keyword) =>
      text.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (found) {
      detected.push(concept);
    }
  }

  return detected;
}

/**
 * Get the display name for a language.
 * Uses LanguageConfig if provided, otherwise falls back to capitalization.
 */
export function getLanguageDisplayName(
  language: string,
  langConfig?: LanguageConfig | null,
): string {
  if (langConfig?.displayName) {
    return langConfig.displayName;
  }
  return language.charAt(0).toUpperCase() + language.slice(1);
}

/**
 * Builds a prompt that asks an LLM to produce a language-specific lesson for a given node.
 */
export function buildLanguageLessonPrompt(
  node: GraphNode,
  edges: GraphEdge[],
  language: string,
  langConfig?: LanguageConfig | null,
): string {
  const capitalizedLanguage = getLanguageDisplayName(language, langConfig);

  const concepts = detectLanguageConcepts(node, language, langConfig);

  const relationships = edges
    .map((edge) => {
      const arrow = edge.direction === "forward" ? "->" : "<-";
      const other =
        edge.source === node.id ? edge.target : edge.source;
      return `  ${arrow} ${edge.type} ${other}`;
    })
    .join("\n");

  const conceptSection =
    concepts.length > 0
      ? `\nDetected concepts to explain:\n${concepts.map((c) => `  - ${c}`).join("\n")}`
      : `\nNo specific concepts were pre-detected. Please identify any ${capitalizedLanguage} patterns or idioms present.`;

  return `You are a programming teacher specializing in ${capitalizedLanguage}. Analyze the following code component and create a language-specific lesson.

Component: ${node.name}
Type: ${node.type}
File: ${node.filePath ?? "N/A"}
Summary: ${node.summary}
Tags: ${node.tags.join(", ")}

Relationships:
${relationships}
${conceptSection}

Return a JSON object with the following fields:
- "languageNotes": A concise explanation of the ${capitalizedLanguage}-specific patterns and idioms used in this component.
- "concepts": An array of objects, each with:
  - "name": The concept name (e.g., "async/await", "generics").
  - "explanation": A beginner-friendly explanation of this concept as it applies to this component.

Respond ONLY with the JSON object, no additional text.`;
}

/**
 * Extracts a JSON block from an LLM response, handling markdown fences.
 */
function extractJson(response: string): string {
  const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0].trim();
  }

  return response.trim();
}

/**
 * Parses an LLM response for language lesson content.
 * Returns a safe default on parse failure.
 */
export function parseLanguageLessonResponse(
  response: string,
): LanguageLessonResult {
  try {
    const jsonStr = extractJson(response);
    const parsed = JSON.parse(jsonStr);

    const languageNotes =
      typeof parsed.languageNotes === "string" ? parsed.languageNotes : "";

    const concepts = Array.isArray(parsed.concepts)
      ? parsed.concepts
          .filter(
            (
              c: unknown,
            ): c is { name: string; explanation: string } =>
              typeof c === "object" &&
              c !== null &&
              typeof (c as Record<string, unknown>).name === "string" &&
              typeof (c as Record<string, unknown>).explanation ===
                "string",
          )
          .map((c: { name: string; explanation: string }) => ({
            name: c.name,
            explanation: c.explanation,
          }))
      : [];

    return { languageNotes, concepts };
  } catch {
    return { languageNotes: "", concepts: [] };
  }
}

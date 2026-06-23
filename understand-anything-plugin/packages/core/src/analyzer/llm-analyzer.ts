export interface LLMFileAnalysis {
  fileSummary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  functionSummaries: Record<string, string>;
  classSummaries: Record<string, string>;
  languageNotes?: string;
}

export interface LLMProjectSummary {
  description: string;
  frameworks: string[];
  layers: Array<{ name: string; description: string; filePatterns: string[] }>;
}

/**
 * Generates a prompt for analyzing a single source file with an LLM.
 */
export function buildFileAnalysisPrompt(
  filePath: string,
  content: string,
  projectContext: string,
): string {
  return `You are a code analysis assistant. Analyze the following source file and return a JSON object.

Project context: ${projectContext}

File: ${filePath}

\`\`\`
${content}
\`\`\`

Return a JSON object with the following fields:
- "fileSummary": A concise summary of what this file does (1-2 sentences).
- "tags": An array of relevant tags (e.g., ["utility", "async", "api"]).
- "complexity": One of "simple", "moderate", or "complex".
- "functionSummaries": An object mapping function names to 1-sentence summaries.
- "classSummaries": An object mapping class names to 1-sentence summaries.
- "languageNotes": Optional notes about language-specific patterns or idioms used.

Respond ONLY with the JSON object, no additional text.`;
}

/**
 * Generates a prompt for creating a project-level summary with an LLM.
 */
export function buildProjectSummaryPrompt(
  fileList: string[],
  sampleFiles: Array<{ path: string; content: string }>,
): string {
  const fileListStr = fileList.map((f) => `  - ${f}`).join("\n");

  let samplesStr = "";
  if (sampleFiles.length > 0) {
    samplesStr = "\n\nSample files:\n";
    for (const sample of sampleFiles) {
      samplesStr += `\n--- ${sample.path} ---\n\`\`\`\n${sample.content}\n\`\`\`\n`;
    }
  }

  return `You are a code analysis assistant. Analyze the following project structure and return a JSON object describing the project.

File list:
${fileListStr}${samplesStr}

Return a JSON object with the following fields:
- "description": A concise description of what this project does (2-3 sentences).
- "frameworks": An array of frameworks and major libraries detected (e.g., ["React", "Express", "Vitest"]).
- "layers": An array of logical layers, each with:
  - "name": The layer name (e.g., "API", "Data", "UI").
  - "description": What this layer is responsible for.
  - "filePatterns": Glob patterns or path prefixes that belong to this layer.

Respond ONLY with the JSON object, no additional text.`;
}

/**
 * Extracts a JSON block from an LLM response, handling markdown fences.
 */
function extractJson(response: string): string {
  // Try to extract from markdown code fences
  const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try to find a raw JSON object
  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0].trim();
  }

  return response.trim();
}

const VALID_COMPLEXITIES = new Set(["simple", "moderate", "complex"]);

/**
 * Parses an LLM response for file analysis. Returns null if parsing fails.
 */
export function parseFileAnalysisResponse(
  response: string,
): LLMFileAnalysis | null {
  try {
    const jsonStr = extractJson(response);
    const parsed = JSON.parse(jsonStr);

    // Validate and normalize complexity
    let complexity: "simple" | "moderate" | "complex" = "moderate";
    if (
      typeof parsed.complexity === "string" &&
      VALID_COMPLEXITIES.has(parsed.complexity)
    ) {
      complexity = parsed.complexity as "simple" | "moderate" | "complex";
    }

    return {
      fileSummary:
        typeof parsed.fileSummary === "string" ? parsed.fileSummary : "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t: unknown) => typeof t === "string")
        : [],
      complexity,
      functionSummaries:
        typeof parsed.functionSummaries === "object" &&
        parsed.functionSummaries !== null
          ? parsed.functionSummaries
          : {},
      classSummaries:
        typeof parsed.classSummaries === "object" &&
        parsed.classSummaries !== null
          ? parsed.classSummaries
          : {},
      languageNotes:
        typeof parsed.languageNotes === "string"
          ? parsed.languageNotes
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Parses an LLM response for project summary. Returns null if parsing fails.
 */
export function parseProjectSummaryResponse(
  response: string,
): LLMProjectSummary | null {
  try {
    const jsonStr = extractJson(response);
    const parsed = JSON.parse(jsonStr);

    return {
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      frameworks: Array.isArray(parsed.frameworks)
        ? parsed.frameworks.filter((f: unknown) => typeof f === "string")
        : [],
      layers: Array.isArray(parsed.layers)
        ? parsed.layers
            .filter(
              (l: unknown): l is { name: string; description: string; filePatterns: string[] } =>
                typeof l === "object" &&
                l !== null &&
                typeof (l as Record<string, unknown>).name === "string",
            )
            .map(
              (l: { name: string; description: string; filePatterns: string[] }) => ({
                name: l.name,
                description:
                  typeof l.description === "string" ? l.description : "",
                filePatterns: Array.isArray(l.filePatterns)
                  ? l.filePatterns.filter(
                      (p: unknown) => typeof p === "string",
                    )
                  : [],
              }),
            )
        : [],
    };
  } catch {
    return null;
  }
}

import { builtinLanguageConfigs } from "../languages/configs/index.js";

export interface PluginEntry {
  name: string;
  enabled: boolean;
  languages: string[];
  options?: Record<string, unknown>;
}

export interface PluginConfig {
  plugins: PluginEntry[];
}

export const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  plugins: [
    {
      name: "tree-sitter",
      enabled: true,
      languages: builtinLanguageConfigs
        .filter((c) => c.treeSitter)
        .map((c) => c.id),
    },
  ],
};

/**
 * Parse a plugin config JSON string.
 * Returns DEFAULT_PLUGIN_CONFIG if parsing fails.
 */
export function parsePluginConfig(jsonString: string): PluginConfig {
  if (!jsonString.trim()) return { ...DEFAULT_PLUGIN_CONFIG };

  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || !Array.isArray(parsed.plugins)) {
      return { ...DEFAULT_PLUGIN_CONFIG };
    }

    const plugins = parsed.plugins
      .filter((entry: unknown): entry is Record<string, unknown> => {
        if (typeof entry !== "object" || entry === null) return false;
        const e = entry as Record<string, unknown>;
        return (
          typeof e.name === "string" &&
          e.name.length > 0 &&
          Array.isArray(e.languages) &&
          e.languages.length > 0
        );
      })
      .map((e: Record<string, unknown>): PluginEntry => ({
        name: e.name as string,
        enabled: typeof e.enabled === "boolean" ? e.enabled : true,
        languages: e.languages as string[],
        ...(e.options ? { options: e.options as Record<string, unknown> } : {}),
      }));

    return { plugins };
  } catch {
    return { ...DEFAULT_PLUGIN_CONFIG };
  }
}

/**
 * Serialize a plugin config to JSON for saving.
 */
export function serializePluginConfig(config: PluginConfig): string {
  return JSON.stringify(config, null, 2);
}

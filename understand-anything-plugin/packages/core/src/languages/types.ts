import { z } from "zod";

// Tree-sitter grammar configuration for a language.
// Only wasmPackage and wasmFile are needed for grammar loading.
// The extraction logic in tree-sitter-plugin.ts is currently TS/JS-specific;
// when grammars for other languages are added, language-specific extractors
// should be registered via the customAnalyzer escape hatch.
export const TreeSitterConfigSchema = z.object({
  wasmPackage: z.string(),
  wasmFile: z.string(),
});

export type TreeSitterConfig = z.infer<typeof TreeSitterConfigSchema>;

// File pattern conventions for a language
export const FilePatternConfigSchema = z.object({
  entryPoints: z.array(z.string()),
  barrels: z.array(z.string()),
  tests: z.array(z.string()),
  config: z.array(z.string()),
});

export type FilePatternConfig = z.infer<typeof FilePatternConfigSchema>;

// Complete language configuration (base schema — used by LanguageRegistry.register())
export const LanguageConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  extensions: z.array(z.string()),
  filenames: z.array(z.string()).optional(),
  treeSitter: TreeSitterConfigSchema.optional(),
  concepts: z.array(z.string()),
  filePatterns: FilePatternConfigSchema,
});

export type LanguageConfig = z.infer<typeof LanguageConfigSchema>;

/**
 * Strict schema with refinement: ensures at least one extension or filename
 * is provided so the config can actually be detected by the registry.
 * Use this for validating new/user-supplied configs (some builtin configs like
 * kubernetes/github-actions intentionally lack both and rely on future
 * content-based detection).
 */
export const StrictLanguageConfigSchema = LanguageConfigSchema.refine(
  (c) => c.extensions.length > 0 || (c.filenames !== undefined && c.filenames.length > 0),
  { message: "LanguageConfig must have at least one extension or filename for detection" }
);

// Framework configuration
export const FrameworkConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  languages: z.array(z.string().min(1)).min(1),
  detectionKeywords: z.array(z.string()).min(1),
  manifestFiles: z.array(z.string()).min(1),
  promptSnippetPath: z.string().min(1),
  entryPoints: z.array(z.string()).optional(),
  layerHints: z.record(z.string(), z.string()).optional(),
});

export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>;

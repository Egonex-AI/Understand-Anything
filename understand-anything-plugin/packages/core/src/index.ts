export * from "./types.js";
export * from "./persistence/index.js";
export {
  KnowledgeGraphSchema,
  validateGraph,
  sanitizeGraph,
  autoFixGraph,
  COMPLEXITY_ALIASES,
  DIRECTION_ALIASES,
  type ValidationResult,
  type GraphIssue,
} from "./schema.js";
export { TreeSitterPlugin } from "./plugins/tree-sitter-plugin.js";
export type { LanguageExtractor } from "./plugins/extractors/types.js";
export { builtinExtractors } from "./plugins/extractors/index.js";
export { GraphBuilder } from "./analyzer/graph-builder.js";
export {
  buildFileAnalysisPrompt,
  buildProjectSummaryPrompt,
  parseFileAnalysisResponse,
  parseProjectSummaryResponse,
} from "./analyzer/llm-analyzer.js";
export type { LLMFileAnalysis, LLMProjectSummary } from "./analyzer/llm-analyzer.js";
export {
  normalizeNodeId,
  normalizeComplexity,
  normalizeBatchOutput,
  type DroppedEdge,
  type NormalizationStats,
  type NormalizeBatchResult,
} from "./analyzer/normalize-graph.js";
export { SearchEngine, type SearchResult, type SearchOptions } from "./search.js";
export {
  getChangedFiles,
  isStale,
  mergeGraphUpdate,
  type StalenessResult,
} from "./staleness.js";
export {
  detectLayers,
  buildLayerDetectionPrompt,
  parseLayerDetectionResponse,
  applyLLMLayers,
} from "./analyzer/layer-detector.js";
export type { LLMLayerResponse } from "./analyzer/layer-detector.js";
export {
  buildTourGenerationPrompt,
  parseTourGenerationResponse,
  generateHeuristicTour,
} from "./analyzer/tour-generator.js";
export {
  buildLanguageLessonPrompt,
  parseLanguageLessonResponse,
  detectLanguageConcepts,
  type LanguageLessonResult,
} from "./analyzer/language-lesson.js";
export { PluginRegistry } from "./plugins/registry.js";
export {
  LanguageRegistry,
  FrameworkRegistry,
  builtinLanguageConfigs,
  builtinFrameworkConfigs,
  LanguageConfigSchema,
  FrameworkConfigSchema,
} from "./languages/index.js";
export type {
  LanguageConfig,
  FrameworkConfig,
  TreeSitterConfig,
  FilePatternConfig,
} from "./languages/index.js";
export {
  parsePluginConfig,
  serializePluginConfig,
  DEFAULT_PLUGIN_CONFIG,
  type PluginConfig,
  type PluginEntry,
} from "./plugins/discovery.js";
export {
  SemanticSearchEngine,
  cosineSimilarity,
  type SemanticSearchOptions,
} from "./embedding-search.js";
export {
  extractFileFingerprint,
  compareFingerprints,
  analyzeChanges,
  buildFingerprintStore,
  contentHash,
  type FunctionFingerprint,
  type ClassFingerprint,
  type ImportFingerprint,
  type FileFingerprint,
  type FingerprintStore,
  type ChangeLevel,
  type FileChangeResult,
  type ChangeAnalysis,
} from "./fingerprint.js";
export {
  classifyUpdate,
  type UpdateDecision,
} from "./change-classifier.js";
// Non-code parsers
export {
  MarkdownParser,
  YAMLConfigParser,
  JSONConfigParser,
  TOMLParser,
  EnvParser,
  DockerfileParser,
  SQLParser,
  GraphQLParser,
  ProtobufParser,
  TerraformParser,
  MakefileParser,
  ShellParser,
  registerAllParsers,
} from "./plugins/parsers/index.js";
export {
  createIgnoreFilter,
  DEFAULT_IGNORE_PATTERNS,
  type IgnoreFilter,
} from "./ignore-filter.js";
export { generateStarterIgnoreFile } from "./ignore-generator.js";

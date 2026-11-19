/**
 * Natural-language questions about THIS repository, with the nodes a developer
 * would consider a correct answer. Ground truth was written from knowledge of
 * the code before any search engine was run against it; a node is relevant when
 * its file path ends with `path` and its name equals `name`.
 */
export const QUERIES = [
  ["keep my home directory out of the saved graph", [["persistence/index.ts", "sanitiseFilePaths"]]],
  ["how close are two embeddings", [["embedding-search.ts", "cosineSimilarity"], ["embedding-search.ts", "cosineSimilarityWithQueryMag"]]],
  ["work out which files changed since the last analysis", [["staleness.ts", "getChangedFiles"], ["fingerprint.ts", "analyzeChanges"], ["fingerprint.ts", "compareFingerprints"], ["change-classifier.ts", "classifyUpdate"]]],
  ["decide whether a commit needs a full rebuild or a small update", [["change-classifier.ts", "classifyUpdate"]]],
  ["group nodes into API, service and data tiers", [["layer-detector.ts", "detectLayers"], ["layer-detector.ts", "applyLLMLayers"]]],
  ["order the walkthrough steps for new developers", [["tour-generator.ts", "generateHeuristicTour"], ["tour-generator.ts", "buildTourGenerationPrompt"]]],
  ["read a Dockerfile and list its stages", [["dockerfile-parser.ts", "DockerfileParser"]]],
  ["which rules decide what gets skipped during a scan", [["ignore-filter.ts", "createIgnoreFilter"], ["ignore-generator.ts", "generateStarterIgnoreFile"]]],
  ["typo tolerant lookup of nodes by name", [["core/src/search.ts", "SearchEngine"], ["core/src/search.ts", "SearchEngine.search"]]],
  ["pick the right analyzer for each programming language", [["plugins/registry.ts", "PluginRegistry"], ["language-registry.ts", "LanguageRegistry"]]],
  ["teach the reader about closures and generics found in a file", [["language-lesson.ts", "detectLanguageConcepts"], ["language-lesson.ts", "buildLanguageLessonPrompt"]]],
  ["save the diagram as a picture", [["ExportMenu.tsx", "ExportMenu"]]],
  ["choose a colour scheme for the dashboard", [["ThemePicker.tsx", "ThemePicker"]]],
  ["find the shortest route between two nodes", [["PathFinderModal.tsx", "PathFinderModal"]]],
  ["which optional language plugins are enabled in config", [["discovery.ts", "parsePluginConfig"]]],
  ["detect that a file's text was edited", [["fingerprint.ts", "contentHash"], ["fingerprint.ts", "extractFileFingerprint"]]],
  ["is the saved graph out of date compared to git", [["staleness.ts", "isStale"], ["staleness.ts", "getGraphFreshness"]]],
  ["fix up malformed output from the language model", [["schema.ts", "autoFixGraph"], ["schema.ts", "sanitizeGraph"], ["normalize-graph.ts", "normalizeBatchOutput"]]],
  ["give new teammates an introduction to the project", [["onboard-builder.ts", "buildOnboardingGuide"]]],
  ["shortcut keys help popup", [["KeyboardShortcutsHelp.tsx", "KeyboardShortcutsHelp"]]],
  ["warn when the analysis is old", [["StalenessBanner.tsx", "StalenessBanner"]]],
  ["gate the dashboard behind an access token", [["TokenGate.tsx", "TokenGate"]]],
  ["assemble context for answering questions about the code", [["context-builder.ts", "buildChatContext"]]],
  ["parse source code into functions and classes", [["tree-sitter-plugin.ts", "TreeSitterPlugin"]]],
  ["describe the impact of my uncommitted changes", [["diff-analyzer.ts", "buildDiffContext"]]],
  ["explain a single file in depth", [["explain-builder.ts", "buildExplainContext"]]],
];

/**
 * Held-out set. Written after the engine's first tuning round, from other parts of
 * the codebase, choosing targets from a file/symbol listing (summaries unread).
 * Configuration defaults must not be tuned against these.
 */
export const HELDOUT_QUERIES = [
  ["ask the model to describe a source file", [["llm-analyzer.ts", "buildFileAnalysisPrompt"]]],
  ["turn the model's reply about a file into structured data", [["llm-analyzer.ts", "parseFileAnalysisResponse"], ["llm-analyzer.ts", "extractJson"]]],
  ["convert low medium high into the allowed difficulty values", [["normalize-graph.ts", "normalizeComplexity"]]],
  ["hide nodes of certain kinds from the view", [["filters.ts", "filterNodes"]]],
  ["merge many connections between the same two groups into one line", [["edgeAggregation.ts", "aggregateLayerEdges"], ["edgeAggregation.ts", "aggregateContainerEdges"]]],
  ["find clusters of closely related nodes", [["louvain.ts", "detectCommunities"]]],
  ["spread the nodes out automatically", [["force-layout.ts", "computeForceLayout"], ["elk-layout.ts", "applyElkLayout"]]],
  ["recolour the interface from one accent colour", [["theme-engine.ts", "deriveFromAccent"], ["theme-engine.ts", "applyTheme"]]],
  ["extract methods and decorators from Python", [["python-extractor.ts", "PythonExtractor"]]],
  ["read headings and links from documentation pages", [["markdown-parser.ts", "MarkdownParser"]]],
  ["understand database table definitions", [["sql-parser.ts", "SQLParser"]]],
  ["cloud infrastructure resources", [["terraform-parser.ts", "TerraformParser"]]],
  ["show the contents of the selected source file", [["CodeViewer.tsx", "CodeViewer"]]],
  ["folder tree of project files", [["FileExplorer.tsx", "buildFileTree"], ["FileExplorer.tsx", "FileExplorer"]]],
  ["switch between beginner and expert views", [["PersonaSelector.tsx", "PersonaSelector"]]],
  ["highlight the parts affected by my changes", [["DiffToggle.tsx", "DiffToggle"]]],
  ["where am I in the navigation trail", [["Breadcrumb.tsx", "Breadcrumb"]]],
  ["colour key for architecture layers", [["LayerLegend.tsx", "LayerLegend"]]],
  ["copy the problems found while loading the graph", [["WarningBanner.tsx", "WarningBanner"], ["WarningBanner.tsx", "buildCopyText"]]],
  ["change the interface language", [["I18nContext.tsx", "I18nProvider"], ["I18nContext.tsx", "useI18n"]]],
  ["group files by their folder", [["containers.ts", "groupByFolder"], ["containers.ts", "deriveContainers"]]],
  ["count how many nodes are in each layer", [["layerStats.ts", "computeLayerStats"]]],
  ["mobile navigation menu", [["MobileDrawer.tsx", "MobileDrawer"]]],
  ["who calls whom inside a Python file", [["python-extractor.ts", "PythonExtractor.extractCallGraph"], ["python-extractor.ts", "PythonExtractor"]]],
];

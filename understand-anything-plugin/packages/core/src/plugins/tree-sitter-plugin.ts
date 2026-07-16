import { createRequire } from "node:module";
import { dirname, resolve, extname } from "node:path";
import type {
  AnalyzerPlugin,
  StructuralAnalysis,
  ImportResolution,
  CallGraphEntry,
} from "../types.js";
import type { LanguageConfig } from "../languages/types.js";
import type { LanguageExtractor } from "./extractors/types.js";
import { builtinExtractors } from "./extractors/index.js";

// web-tree-sitter uses CJS internally; we need createRequire for .wasm resolution
const require = createRequire(import.meta.url);

type TreeSitterParser = import("web-tree-sitter").Parser;
type TreeSitterLanguage = import("web-tree-sitter").Language;

/**
 * Config-driven tree-sitter plugin.
 *
 * Accepts LanguageConfig objects to determine which languages to support
 * and how to load their WASM grammars. Provides deep structural analysis
 * (functions, classes, imports, exports, call graphs) for all languages
 * with registered extractors: TypeScript, JavaScript, Python, Go, Rust,
 * Java, Ruby, PHP, C/C++, C#, Dart, Kotlin, Swift, and Scala.
 *
 * Languages without tree-sitter configs are gracefully skipped (the LLM
 * agent handles analysis for those).
 */
export class TreeSitterPlugin implements AnalyzerPlugin {
  readonly name = "tree-sitter";
  readonly languages: string[];

  private configs: LanguageConfig[];

  // Pre-loaded parser constructor and languages (set by init())
  private _ParserClass:
    | (new () => TreeSitterParser)
    | null = null;
  private _languages = new Map<string, TreeSitterLanguage>();
  private _extensionToLang = new Map<string, string>();
  // One reusable parser per language key. web-tree-sitter parsers are reusable
  // across parse() calls (only the Tree is per-parse, and it's still deleted);
  // creating + setLanguage + delete on every call wasted an allocation and a
  // WASM setLanguage on every file. Cached here, created lazily on first use.
  private _parsers = new Map<string, TreeSitterParser>();
  private _initialized = false;

  // Language-specific extractors (keyed by language id)
  private extractors = new Map<string, LanguageExtractor>();

  /**
   * Create a TreeSitterPlugin with the given language configs.
   * Only configs that have a `treeSitter` field will be loaded.
   * If no configs are provided, defaults to TypeScript and JavaScript.
   *
   * @param configs Language configurations to load
   * @param extractors Optional language extractors; if none provided, registers all builtin extractors
   */
  constructor(configs?: LanguageConfig[], extractors?: LanguageExtractor[]) {
    if (configs) {
      this.configs = configs.filter((c) => c.treeSitter);
    } else {
      // Default: TS/JS for backward compatibility
      this.configs = [];
    }

    // Derive supported languages and extension map from configs
    const langs: string[] = [];
    for (const config of this.configs) {
      langs.push(config.id);
      for (const ext of config.extensions) {
        const key = ext.startsWith(".") ? ext : `.${ext}`;
        this._extensionToLang.set(key, config.id);
      }
    }

    // Fallback for backward compat when no configs provided
    if (langs.length === 0) {
      langs.push("typescript", "javascript");
      this._extensionToLang.set(".ts", "typescript");
      this._extensionToLang.set(".tsx", "typescript");
      this._extensionToLang.set(".js", "javascript");
      this._extensionToLang.set(".mjs", "javascript");
      this._extensionToLang.set(".cjs", "javascript");
      this._extensionToLang.set(".jsx", "javascript");
    }

    this.languages = langs;

    // Register extractors (default: all builtin extractors)
    if (extractors && extractors.length > 0) {
      for (const extractor of extractors) {
        this.registerExtractor(extractor);
      }
    } else {
      for (const extractor of builtinExtractors) {
        this.registerExtractor(extractor);
      }
    }
  }

  registerExtractor(extractor: LanguageExtractor): void {
    for (const id of extractor.languageIds) {
      this.extractors.set(id, extractor);
    }
  }

  private getExtractor(langKey: string): LanguageExtractor | null {
    // tsx is a synthetic grammar key — extraction logic is identical to typescript
    const key = langKey === "tsx" ? "typescript" : langKey;
    return this.extractors.get(key) ?? null;
  }

  private languageKeyFromPath(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();

    // Special case: .tsx needs its own grammar
    if (ext === ".tsx") return "tsx";

    return this._extensionToLang.get(ext) ?? null;
  }

  /**
   * Initialize the plugin by loading the WASM module and all language grammars.
   * Must be called (and awaited) before any synchronous methods.
   */
  async init(): Promise<void> {
    if (this._initialized) return;

    const mod = await import("web-tree-sitter");
    const ParserCls = mod.Parser;
    const LanguageCls = mod.Language;

    await ParserCls.init();
    this._ParserClass = ParserCls as unknown as new () => TreeSitterParser;

    if (this.configs.length > 0) {
      // Load grammars from configs
      const loadPromises: Promise<void>[] = [];

      for (const config of this.configs) {
        if (!config.treeSitter) continue;

        const loadGrammar = async () => {
          try {
            const wasmPath = require.resolve(
              `${config.treeSitter!.wasmPackage}/${config.treeSitter!.wasmFile}`,
            );
            const lang = await LanguageCls.load(wasmPath);
            this._languages.set(config.id, lang);

            // Special handling for TypeScript: also load TSX grammar
            if (config.id === "typescript") {
              try {
                const tsxWasm = require.resolve(
                  `${config.treeSitter!.wasmPackage}/tree-sitter-tsx.wasm`,
                );
                const tsxLang = await LanguageCls.load(tsxWasm);
                this._languages.set("tsx", tsxLang);
              } catch {
                // TSX grammar not available; .tsx files will fall back to TS grammar
              }
            }
          } catch {
            // Grammar not available — this language will be skipped gracefully
            console.debug?.(
              `tree-sitter: Could not load grammar for ${config.id}, skipping structural analysis`,
            );
          }
        };

        loadPromises.push(loadGrammar());
      }

      await Promise.all(loadPromises);
    } else {
      // Legacy fallback: load TS/JS grammars directly
      const tsWasm = require.resolve(
        "tree-sitter-typescript/tree-sitter-typescript.wasm",
      );
      const tsxWasm = require.resolve(
        "tree-sitter-typescript/tree-sitter-tsx.wasm",
      );
      const jsWasm = require.resolve(
        "tree-sitter-javascript/tree-sitter-javascript.wasm",
      );

      const [tsLang, tsxLang, jsLang] = await Promise.all([
        LanguageCls.load(tsWasm),
        LanguageCls.load(tsxWasm),
        LanguageCls.load(jsWasm),
      ]);

      this._languages.set("typescript", tsLang);
      this._languages.set("tsx", tsxLang);
      this._languages.set("javascript", jsLang);
    }

    this._initialized = true;
  }

  /**
   * Create a parser set to the appropriate language for the given file.
   * This is synchronous because all languages are pre-loaded during init().
   */
  private getParser(filePath: string): TreeSitterParser | null {
    if (!this._initialized || !this._ParserClass) {
      throw new Error(
        "TreeSitterPlugin.init() must be called before use",
      );
    }
    const langKey = this.languageKeyFromPath(filePath);
    if (!langKey) return null;
    const lang = this._languages.get(langKey);
    if (!lang) {
      // Language grammar not loaded — graceful degradation
      return null;
    }
    let parser = this._parsers.get(langKey);
    if (!parser) {
      parser = new this._ParserClass();
      parser.setLanguage(lang);
      this._parsers.set(langKey, parser);
    }
    return parser;
  }

  // Fresh object AND fresh arrays on every call — a shared static would leak
  // the same array instances to every caller, so one caller mutating its
  // result would corrupt everyone else's.
  private static emptyStructure(): StructuralAnalysis {
    return { functions: [], classes: [], imports: [], exports: [] };
  }

  analyzeFile(
    filePath: string,
    content: string,
  ): StructuralAnalysis {
    const parser = this.getParser(filePath);
    if (!parser) {
      return { functions: [], classes: [], imports: [], exports: [] };
    }

    const tree = parser.parse(content);
    if (!tree) {
      return { functions: [], classes: [], imports: [], exports: [] };
    }

    const langKey = this.languageKeyFromPath(filePath);
    const extractor = langKey ? this.getExtractor(langKey) : null;

    let result: StructuralAnalysis;
    if (extractor) {
      result = extractor.extractStructure(tree.rootNode);
    } else {
      result = { functions: [], classes: [], imports: [], exports: [] };
    }

    tree.delete();

    return result;
  }

  /**
   * Parse the file ONCE and return both structural analysis and the call
   * graph. `extract-structure.mjs` runs `analyzeFile` then `extractCallGraph`
   * on every code file — two full tree-sitter parses of identical content.
   * Both extractors are pure functions of the same rootNode, so a single
   * parse yields byte-identical results (verified) at ~40% less parse work
   * on the indexing hot path. Callers without this method fall back to the
   * two separate calls.
   */
  analyzeFileFull(
    filePath: string,
    content: string,
  ): { structure: StructuralAnalysis; callGraph: CallGraphEntry[] } {
    const parser = this.getParser(filePath);
    if (!parser) {
      return { structure: TreeSitterPlugin.emptyStructure(), callGraph: [] };
    }

    const tree = parser.parse(content);
    if (!tree) {
      return { structure: TreeSitterPlugin.emptyStructure(), callGraph: [] };
    }

    const langKey = this.languageKeyFromPath(filePath);
    const extractor = langKey ? this.getExtractor(langKey) : null;

    const structure = extractor
      ? extractor.extractStructure(tree.rootNode)
      : TreeSitterPlugin.emptyStructure();
    const callGraph = extractor ? extractor.extractCallGraph(tree.rootNode) : [];

    tree.delete();

    return { structure, callGraph };
  }

  resolveImports(
    filePath: string,
    content: string,
  ): ImportResolution[] {
    const analysis = this.analyzeFile(filePath, content);
    const dir = dirname(filePath);

    return analysis.imports.map((imp) => {
      let resolvedPath: string;
      if (
        imp.source.startsWith("./") ||
        imp.source.startsWith("../")
      ) {
        resolvedPath = resolve(dir, imp.source);
      } else {
        resolvedPath = imp.source;
      }
      return {
        source: imp.source,
        resolvedPath,
        specifiers: imp.specifiers,
      };
    });
  }

  extractCallGraph(
    filePath: string,
    content: string,
  ): CallGraphEntry[] {
    const parser = this.getParser(filePath);
    if (!parser) return [];

    const tree = parser.parse(content);
    if (!tree) {
      return [];
    }

    const langKey = this.languageKeyFromPath(filePath);
    const extractor = langKey ? this.getExtractor(langKey) : null;
    const result = extractor ? extractor.extractCallGraph(tree.rootNode) : [];

    tree.delete();

    return result;
  }
}

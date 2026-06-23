import type { AnalyzerPlugin, StructuralAnalysis, ImportResolution, CallGraphEntry } from "../types.js";
import { LanguageRegistry } from "../languages/language-registry.js";

/**
 * Registry for analyzer plugins. Maps languages to plugins and provides
 * a unified interface for analyzing files across languages.
 *
 * Uses LanguageRegistry for extension-to-language mapping instead of
 * a hardcoded lookup table.
 */
export class PluginRegistry {
  private plugins: AnalyzerPlugin[] = [];
  private languageMap = new Map<string, AnalyzerPlugin>();
  private languageRegistry: LanguageRegistry;

  constructor(languageRegistry?: LanguageRegistry) {
    this.languageRegistry = languageRegistry ?? LanguageRegistry.createDefault();
  }

  register(plugin: AnalyzerPlugin): void {
    this.plugins.push(plugin);
    for (const lang of plugin.languages) {
      this.languageMap.set(lang, plugin);
    }
  }

  unregister(name: string): void {
    const plugin = this.plugins.find((p) => p.name === name);
    if (!plugin) return;
    this.plugins = this.plugins.filter((p) => p.name !== name);
    this.languageMap.clear();
    for (const p of this.plugins) {
      for (const lang of p.languages) {
        this.languageMap.set(lang, p);
      }
    }
  }

  getPluginForLanguage(language: string): AnalyzerPlugin | null {
    return this.languageMap.get(language) ?? null;
  }

  getPluginForFile(filePath: string): AnalyzerPlugin | null {
    const langConfig = this.languageRegistry.getForFile(filePath);
    if (!langConfig) return null;
    return this.getPluginForLanguage(langConfig.id);
  }

  /**
   * Get the language id for a file path using the language registry.
   */
  getLanguageForFile(filePath: string): string | null {
    return this.languageRegistry.getForFile(filePath)?.id ?? null;
  }

  analyzeFile(filePath: string, content: string): StructuralAnalysis | null {
    const plugin = this.getPluginForFile(filePath);
    if (!plugin) return null;
    return plugin.analyzeFile(filePath, content);
  }

  resolveImports(filePath: string, content: string): ImportResolution[] | null {
    const plugin = this.getPluginForFile(filePath);
    if (!plugin || !plugin.resolveImports) return null;
    return plugin.resolveImports(filePath, content);
  }

  extractCallGraph(filePath: string, content: string): CallGraphEntry[] | null {
    const plugin = this.getPluginForFile(filePath);
    if (!plugin?.extractCallGraph) return null;
    return plugin.extractCallGraph(filePath, content);
  }

  getPlugins(): AnalyzerPlugin[] {
    return [...this.plugins];
  }

  getSupportedLanguages(): string[] {
    return [...this.languageMap.keys()];
  }
}

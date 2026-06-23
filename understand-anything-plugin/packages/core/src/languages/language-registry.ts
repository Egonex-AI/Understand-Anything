import { LanguageConfigSchema } from "./types.js";
import type { LanguageConfig } from "./types.js";
import { builtinLanguageConfigs } from "./configs/index.js";

/**
 * Registry for language configurations. Maps language ids and file extensions
 * to their corresponding LanguageConfig objects.
 */
export class LanguageRegistry {
  private byId = new Map<string, LanguageConfig>();
  private byExtension = new Map<string, LanguageConfig>();
  private byFilename = new Map<string, LanguageConfig>();

  register(config: LanguageConfig): void {
    const parsed = LanguageConfigSchema.parse(config);
    this.byId.set(parsed.id, parsed);
    for (const ext of parsed.extensions) {
      // Normalize: strip leading dot if present for lookup consistency
      const key = ext.startsWith(".") ? ext : `.${ext}`;
      this.byExtension.set(key, parsed);
    }
    if (parsed.filenames) {
      for (const filename of parsed.filenames) {
        this.byFilename.set(filename.toLowerCase(), parsed);
      }
    }
  }

  getById(id: string): LanguageConfig | null {
    return this.byId.get(id) ?? null;
  }

  getByExtension(ext: string): LanguageConfig | null {
    const key = (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase();
    return this.byExtension.get(key) ?? null;
  }

  getForFile(filePath: string): LanguageConfig | null {
    // Try filename-based lookup first (more specific: docker-compose.yml, Makefile, etc.)
    const basename = filePath.split("/").pop() ?? filePath;
    const filenameMatch = this.byFilename.get(basename.toLowerCase());
    if (filenameMatch) return filenameMatch;
    // Fall back to extension-based lookup
    const lastDot = filePath.lastIndexOf(".");
    if (lastDot === -1) return null;
    const ext = filePath.slice(lastDot).toLowerCase();
    return this.getByExtension(ext);
  }

  getAllLanguages(): LanguageConfig[] {
    return [...this.byId.values()];
  }

  /**
   * Create a registry pre-populated with all built-in language configs.
   */
  static createDefault(): LanguageRegistry {
    const registry = new LanguageRegistry();
    for (const config of builtinLanguageConfigs) {
      registry.register(config);
    }
    return registry;
  }
}

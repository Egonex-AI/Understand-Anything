import { LanguageConfigSchema } from "./types.js";
import type { LanguageConfig } from "./types.js";
import { builtinLanguageConfigs } from "./configs/index.js";

/**
 * Interpreter named by a `#!` first line, e.g. "python3" for
 * `#!/usr/bin/env -S python3 -u` or "bash" for `#!/bin/bash`.
 */
export function interpreterFromShebang(content: string): string | null {
  if (!content.startsWith("#!")) return null;
  const firstLine = content.slice(2, content.indexOf("\n") === -1 ? undefined : content.indexOf("\n"));
  const words = firstLine.trim().split(/\s+/).filter(Boolean);
  let name = words.shift()?.split("/").pop();
  if (name === "env") {
    while (words.length > 0 && (words[0].startsWith("-") || words[0].includes("="))) words.shift();
    name = words.shift()?.split("/").pop();
  }
  return name || null;
}

/**
 * Registry for language configurations. Maps language ids and file extensions
 * to their corresponding LanguageConfig objects.
 */
export class LanguageRegistry {
  private byId = new Map<string, LanguageConfig>();
  private byExtension = new Map<string, LanguageConfig>();
  private byFilename = new Map<string, LanguageConfig>();
  private byInterpreter = new Map<string, LanguageConfig>();

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
    for (const interpreter of parsed.interpreters ?? []) {
      this.byInterpreter.set(interpreter, parsed);
    }
  }

  getById(id: string): LanguageConfig | null {
    return this.byId.get(id) ?? null;
  }

  getByExtension(ext: string): LanguageConfig | null {
    const key = (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase();
    return this.byExtension.get(key) ?? null;
  }

  getByInterpreter(interpreter: string): LanguageConfig | null {
    return this.byInterpreter.get(interpreter)
      ?? this.byInterpreter.get(interpreter.replace(/[\d.]+$/, ""))
      ?? null;
  }

  /**
   * Filename, then extension, then — when `content` is given — the `#!`
   * interpreter, so extensionless scripts like `bin/tool` are recognized.
   */
  getForFile(filePath: string, content?: string): LanguageConfig | null {
    // Try filename-based lookup first (more specific: docker-compose.yml, Makefile, etc.)
    const basename = filePath.split("/").pop() ?? filePath;
    const filenameMatch = this.byFilename.get(basename.toLowerCase());
    if (filenameMatch) return filenameMatch;
    // Fall back to extension-based lookup
    const lastDot = basename.lastIndexOf(".");
    const extensionMatch = lastDot === -1 ? null : this.getByExtension(basename.slice(lastDot));
    if (extensionMatch) return extensionMatch;
    const interpreter = content === undefined ? null : interpreterFromShebang(content);
    return interpreter ? this.getByInterpreter(interpreter) : null;
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

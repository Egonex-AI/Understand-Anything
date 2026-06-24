import { describe, it, expect } from "vitest";
import {
  parsePluginConfig,
  serializePluginConfig,
  type PluginConfig,
  DEFAULT_PLUGIN_CONFIG,
} from "../plugins/discovery.js";

describe("plugin-discovery", () => {
  describe("parsePluginConfig", () => {
    it("parses valid config JSON", () => {
      const json = JSON.stringify({
        plugins: [
          { name: "tree-sitter", enabled: true, languages: ["typescript", "javascript"] },
          { name: "python-ast", enabled: false, languages: ["python"] },
        ],
      });
      const config = parsePluginConfig(json);
      expect(config.plugins).toHaveLength(2);
      expect(config.plugins[0].name).toBe("tree-sitter");
      expect(config.plugins[1].enabled).toBe(false);
    });

    it("returns default config for invalid JSON", () => {
      const config = parsePluginConfig("not json");
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    });

    it("returns default config for empty string", () => {
      const config = parsePluginConfig("");
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    });

    it("filters out entries missing required fields", () => {
      const json = JSON.stringify({
        plugins: [
          { name: "valid", enabled: true, languages: ["typescript"] },
          { enabled: true, languages: ["python"] }, // missing name
          { name: "no-langs", enabled: true }, // missing languages
        ],
      });
      const config = parsePluginConfig(json);
      expect(config.plugins).toHaveLength(1);
      expect(config.plugins[0].name).toBe("valid");
    });

    it("defaults enabled to true when omitted", () => {
      const json = JSON.stringify({
        plugins: [
          { name: "tree-sitter", languages: ["typescript"] },
        ],
      });
      const config = parsePluginConfig(json);
      expect(config.plugins[0].enabled).toBe(true);
    });

    it("returns default config when plugins field is not an array", () => {
      const json = JSON.stringify({
        plugins: "not an array",
      });
      const config = parsePluginConfig(json);
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    });

    it("returns default config when plugins field is missing", () => {
      const json = JSON.stringify({
        someOtherField: "value",
      });
      const config = parsePluginConfig(json);
      expect(config).toEqual(DEFAULT_PLUGIN_CONFIG);
    });
  });

  describe("DEFAULT_PLUGIN_CONFIG", () => {
    it("includes tree-sitter as enabled by default", () => {
      expect(DEFAULT_PLUGIN_CONFIG.plugins).toHaveLength(1);
      expect(DEFAULT_PLUGIN_CONFIG.plugins[0].name).toBe("tree-sitter");
      expect(DEFAULT_PLUGIN_CONFIG.plugins[0].enabled).toBe(true);
    });
  });

  describe("serializePluginConfig", () => {
    it("serializes plugin config to formatted JSON", () => {
      const config: PluginConfig = {
        plugins: [
          {
            name: "tree-sitter",
            enabled: true,
            languages: ["typescript", "javascript"],
          },
        ],
      };
      const json = serializePluginConfig(config);
      expect(json).toContain('"name": "tree-sitter"');
      expect(json).toContain('"enabled": true');
      expect(json).toContain('"languages"');
    });

    it("serializes config with options field", () => {
      const config: PluginConfig = {
        plugins: [
          {
            name: "custom-plugin",
            enabled: true,
            languages: ["python"],
            options: { strict: true, timeout: 5000 },
          },
        ],
      };
      const json = serializePluginConfig(config);
      expect(json).toContain('"options"');
      expect(json).toContain('"strict": true');
    });
  });
});

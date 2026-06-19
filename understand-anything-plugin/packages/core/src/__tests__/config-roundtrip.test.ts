import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../persistence/index.js";

describe("config round-trip with ollama block", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ua-cfg-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the default config when config.json is missing", () => {
    const cfg = loadConfig(dir);
    expect(cfg.autoUpdate).toBe(false);
    expect(cfg.outputLanguage).toBe("en");
    expect(cfg.ollama).toBeUndefined();
  });

  it("round-trips the ollama block", () => {
    saveConfig(dir, {
      autoUpdate: false,
      outputLanguage: "en",
      ollama: { baseUrl: "http://localhost:11434", model: "qwen2.5-coder:7b", concurrency: 4 },
    });
    const cfg = loadConfig(dir);
    expect(cfg.ollama).toEqual({
      baseUrl: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
      concurrency: 4,
    });
  });

  it("preserves existing fields when ollama is added later", () => {
    saveConfig(dir, { autoUpdate: true, outputLanguage: "en" });
    saveConfig(dir, {
      autoUpdate: true,
      outputLanguage: "en",
      ollama: { baseUrl: "http://x", model: "y", concurrency: 1 },
    });
    const cfg = loadConfig(dir);
    expect(cfg.autoUpdate).toBe(true);
    expect(cfg.outputLanguage).toBe("en");
    expect(cfg.ollama?.model).toBe("y");
  });

  it("survives a corrupted config file by returning defaults", () => {
    mkdirSync(join(dir, ".understand-anything"), { recursive: true });
    writeFileSync(join(dir, ".understand-anything/config.json"), "{ not json");
    const cfg = loadConfig(dir);
    expect(cfg.autoUpdate).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  linkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isWithinRoot,
  resolveSafeDataFile,
} from "./safe-path.js";
import {
  loadConfig,
  saveConfig,
  loadGraph,
  resolveUaDir,
} from "./index.js";

describe("secure persistence", () => {
  let sandbox: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "ua-security-"));
    root = join(sandbox, "project");
    outside = join(sandbox, "project-secret");

    mkdirSync(root);
    mkdirSync(outside);
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("rejects sibling paths sharing the project prefix", () => {
    expect(isWithinRoot(root, outside)).toBe(false);
    expect(isWithinRoot(root, join(root, "src"))).toBe(true);
  });

  it.each([".ua", ".understand-anything"])(
    "rejects redirected data directory %s",
    (directory) => {
      symlinkSync(
        outside,
        join(root, directory),
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() => resolveUaDir(root)).toThrow();
      expect(() => loadConfig(root)).toThrow();
      expect(() => saveConfig(root, { autoUpdate: true })).toThrow();
      expect(readdirSync(outside)).toEqual([]);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects external configuration symlinks",
    () => {
      const target = join(outside, "config.json");
      const original = '{"autoUpdate":false}';

      writeFileSync(target, original);
      mkdirSync(join(root, ".ua"));
      symlinkSync(target, join(root, ".ua", "config.json"));

      expect(() => loadConfig(root)).toThrow();
      expect(() => saveConfig(root, { autoUpdate: true })).toThrow();
      expect(readFileSync(target, "utf8")).toBe(original);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects dangling graph symlinks",
    () => {
      mkdirSync(join(root, ".ua"));

      symlinkSync(
        join(outside, "missing.json"),
        join(root, ".ua", "knowledge-graph.json"),
      );

      expect(() => loadGraph(root)).toThrow();
    },
  );

  it("rejects hardlinked persistence files", () => {
    const target = join(outside, "config.json");
    const original = '{"autoUpdate":false}';

    writeFileSync(target, original);
    mkdirSync(join(root, ".ua"));
    linkSync(target, join(root, ".ua", "config.json"));

    expect(() => loadConfig(root)).toThrow();
    expect(() => saveConfig(root, { autoUpdate: true })).toThrow();
    expect(readFileSync(target, "utf8")).toBe(original);
  });

  it("rejects directories masquerading as JSON files", () => {
    mkdirSync(join(root, ".ua", "config.json"), {
      recursive: true,
    });

    expect(() => loadConfig(root)).toThrow();
    expect(() => saveConfig(root, { autoUpdate: true })).toThrow();
  });

  it.each(["../config.json", "..", "/config.json", "a\\b.json"])(
    "rejects unsafe filename %s",
    (filename) => {
      expect(() => resolveSafeDataFile(root, filename)).toThrow();
    },
  );

  it("replaces existing JSON without leaving temporary files", () => {
    saveConfig(root, { autoUpdate: false });
    saveConfig(root, { autoUpdate: true });

    expect(loadConfig(root)).toEqual({ autoUpdate: true });
    expect(readdirSync(join(root, ".ua"))).toEqual(["config.json"]);
  });

  it.runIf(process.platform !== "win32")(
    "creates private persistence files and directories",
    () => {
      saveConfig(root, { autoUpdate: false });

      expect(statSync(join(root, ".ua")).mode & 0o777).toBe(0o700);
      expect(
        statSync(join(root, ".ua", "config.json")).mode & 0o777,
      ).toBe(0o600);
    },
  );
});

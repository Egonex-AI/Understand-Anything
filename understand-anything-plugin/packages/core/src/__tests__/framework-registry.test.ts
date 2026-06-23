import { describe, it, expect } from "vitest";
import { FrameworkRegistry } from "../languages/framework-registry.js";
import { djangoConfig } from "../languages/frameworks/django.js";
import { reactConfig } from "../languages/frameworks/react.js";

describe("FrameworkRegistry", () => {
  it("registers and retrieves a framework config by id", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    expect(registry.getById("django")?.displayName).toBe("Django");
  });

  it("retrieves frameworks for a language", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    registry.register(reactConfig);
    const pythonFrameworks = registry.getForLanguage("python");
    expect(pythonFrameworks).toHaveLength(1);
    expect(pythonFrameworks[0].id).toBe("django");
  });

  it("returns empty array for unknown language", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    expect(registry.getForLanguage("haskell")).toEqual([]);
  });

  describe("detectFrameworks", () => {
    it("detects Django from requirements.txt", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "django==4.2\ncelery==5.3\n",
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("django");
    });

    it("detects React from package.json", () => {
      const registry = new FrameworkRegistry();
      registry.register(reactConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"react": "^18.2.0", "react-dom": "^18.2.0"}}',
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("react");
    });

    it("detection is case-insensitive", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "Django==4.2\n",
      });
      expect(detected).toHaveLength(1);
    });

    it("returns empty array when no frameworks match", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "requests==2.31\n",
      });
      expect(detected).toEqual([]);
    });

    it("returns empty array for empty manifests", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      expect(registry.detectFrameworks({})).toEqual([]);
    });

    it("does not duplicate detected frameworks", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "django==4.2\ndjango==4.2\n",
        "pyproject.toml": '[project]\ndependencies = ["django>=4.0"]',
      });
      expect(detected).toHaveLength(1);
    });
  });

  it("returns frameworks for all listed languages (cross-language)", () => {
    const registry = FrameworkRegistry.createDefault();
    // React lists both typescript and javascript
    const tsFrameworks = registry.getForLanguage("typescript");
    const jsFrameworks = registry.getForLanguage("javascript");
    expect(tsFrameworks.some((f) => f.id === "react")).toBe(true);
    expect(jsFrameworks.some((f) => f.id === "react")).toBe(true);
  });

  it("does not duplicate on re-registration", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    registry.register(djangoConfig);
    expect(registry.getForLanguage("python")).toHaveLength(1);
  });

  it("getForLanguage returns a copy, not the internal array", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    const result = registry.getForLanguage("python");
    result.push(reactConfig);
    expect(registry.getForLanguage("python")).toHaveLength(1);
  });

  describe("createDefault", () => {
    it("registers all 10 built-in framework configs", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getAllFrameworks()).toHaveLength(10);
    });

    it("includes frameworks for multiple languages", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getForLanguage("python").length).toBeGreaterThanOrEqual(3);
      expect(registry.getForLanguage("typescript").length).toBeGreaterThanOrEqual(2);
      expect(registry.getForLanguage("java").length).toBeGreaterThanOrEqual(1);
      expect(registry.getForLanguage("ruby").length).toBeGreaterThanOrEqual(1);
      expect(registry.getForLanguage("go").length).toBeGreaterThanOrEqual(1);
    });
  });
});

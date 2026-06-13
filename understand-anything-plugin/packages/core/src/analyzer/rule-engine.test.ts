import { describe, it, expect } from "vitest";
import { validateRuleConfig, detectFrameworks } from "./rule-engine.js";

describe("validateRuleConfig", () => {
  it("accepts valid config", () => {
    const config = {
      version: 1,
      rules: {
        annotations: {
          MyAnnotation: { edge: "injects", weight: 0.7 },
        },
      },
    };
    expect(() => validateRuleConfig(config)).not.toThrow();
  });

  it("rejects invalid edge type", () => {
    const config = {
      version: 1,
      rules: { annotations: { MyAnnotation: { edge: "invalid_edge_type" } } },
    };
    expect(() => validateRuleConfig(config)).toThrow(/EdgeType/);
  });

  it("rejects weight out of range", () => {
    const config = {
      version: 1,
      rules: { annotations: { MyAnnotation: { edge: "injects", weight: 1.5 } } },
    };
    expect(() => validateRuleConfig(config)).toThrow(/weight/);
  });

  it("rejects missing version", () => {
    const config = { rules: { annotations: {} } };
    expect(() => validateRuleConfig(config)).toThrow(/version/);
  });
});

describe("detectFrameworks", () => {
  it("detects Spring from dependencies", () => {
    const frameworks = detectFrameworks(["spring-boot-starter", "spring-context", "junit"]);
    expect(frameworks).toContain("spring");
  });

  it("detects React from dependencies", () => {
    const frameworks = detectFrameworks(["react", "react-dom", "typescript"]);
    expect(frameworks).toContain("react");
  });

  it("returns empty for unknown dependencies", () => {
    const frameworks = detectFrameworks(["lodash", "express"]);
    expect(frameworks).toEqual([]);
  });
});

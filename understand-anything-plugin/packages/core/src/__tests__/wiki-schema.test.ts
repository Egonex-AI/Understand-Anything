import { describe, it, expect } from "vitest";
import {
  validateWikiMeta,
  validateWikiIndex,
  validateWikiDomainPage,
  validateWikiServiceOverview,
  validateCoverage,
  validateSourceRefs,
  runQualityGateLayer1,
  autoFixDomainPage,
} from "../wiki-schema.js";

describe("validateWikiMeta", () => {
  it("passes for valid meta", () => {
    const meta = {
      gitCommitHash: "abc123",
      generatedAt: "2026-06-03T12:00:00Z",
      version: "1.0.0",
      outputLanguage: "zh",
    };
    const issues = validateWikiMeta(meta, "meta.json");
    expect(issues).toEqual([]);
  });

  it("reports error for null input", () => {
    const issues = validateWikiMeta(null, "meta.json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("reports error for missing gitCommitHash", () => {
    const meta = { generatedAt: "2026-06-03T12:00:00Z", version: "1.0.0", outputLanguage: "zh" };
    const issues = validateWikiMeta(meta, "meta.json");
    expect(issues.some((i) => i.message.includes("gitCommitHash"))).toBe(true);
  });

  it("reports error for missing outputLanguage", () => {
    const meta = { gitCommitHash: "abc", generatedAt: "2026-06-03T12:00:00Z", version: "1.0.0" };
    const issues = validateWikiMeta(meta, "meta.json");
    expect(issues.some((i) => i.message.includes("outputLanguage"))).toBe(true);
  });
});

describe("validateWikiIndex", () => {
  it("passes for valid index", () => {
    const index = {
      entries: [
        { id: "wiki:service-overview", name: "Order Service", type: "service", summary: "Order management" },
        { id: "wiki:domain:order", name: "Order", type: "domain", summary: "Order domain" },
      ],
    };
    const issues = validateWikiIndex(index, "index.json");
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports error for empty entries", () => {
    const issues = validateWikiIndex({ entries: [] }, "index.json");
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("reports error for invalid entry type", () => {
    const index = {
      entries: [{ id: "x", name: "X", type: "invalid_type", summary: "test" }],
    };
    const issues = validateWikiIndex(index, "index.json");
    expect(issues.some((i) => i.message.includes("invalid type"))).toBe(true);
  });

  it("reports error for missing entry id", () => {
    const index = {
      entries: [{ name: "X", type: "domain", summary: "test" }],
    };
    const issues = validateWikiIndex(index, "index.json");
    expect(issues.some((i) => i.message.includes("missing id"))).toBe(true);
  });
});

describe("validateWikiDomainPage", () => {
  const validPage = {
    id: "domain:order-management",
    name: "Order Management",
    summary: "Handles all order-related business logic including creation, updates, and cancellation.",
    entities: ["Order", "OrderItem"],
    flows: [
      {
        id: "flow:create-order",
        name: "Create Order",
        summary: "Creates a new order",
        steps: [
          { order: 1, name: "Validate", description: "Validates input parameters", sourceRef: { file: "src/OrderService.java", lineRange: [10, 20] } },
          { order: 2, name: "Persist", description: "Saves order to database", sourceRef: { file: "src/OrderRepository.java" } },
        ],
      },
    ],
  };

  it("passes for valid domain page", () => {
    const issues = validateWikiDomainPage(validPage, "domains/order-management.json");
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports error for missing id", () => {
    const page = { ...validPage, id: undefined };
    const issues = validateWikiDomainPage(page, "domains/test.json");
    expect(issues.some((i) => i.message.includes("Missing id"))).toBe(true);
  });

  it("reports error for missing flows", () => {
    const page = { ...validPage, flows: undefined };
    const issues = validateWikiDomainPage(page, "domains/test.json");
    expect(issues.some((i) => i.message.includes("Missing flows"))).toBe(true);
  });

  it("reports warning for flow with no steps", () => {
    const page = {
      ...validPage,
      flows: [{ id: "flow:empty", name: "Empty Flow", summary: "test", steps: [] }],
    };
    const issues = validateWikiDomainPage(page, "domains/test.json");
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("no steps"))).toBe(true);
  });

  it("reports error for step missing order", () => {
    const page = {
      ...validPage,
      flows: [{
        id: "flow:x",
        name: "X",
        summary: "test",
        steps: [{ name: "Step1", description: "desc" }],
      }],
    };
    const issues = validateWikiDomainPage(page, "domains/test.json");
    expect(issues.some((i) => i.message.includes("missing order"))).toBe(true);
  });

  it("warns when errorCatalog uses code instead of exception", () => {
    const page = {
      ...validPage,
      errorCatalog: [
        { code: "IM_AUDIT_FAIL", description: "Audit failed", sourceRef: { file: "a.java" } },
      ],
    };
    const issues = validateWikiDomainPage(page, "domains/test.json");
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("code"))).toBe(true);
  });

  it("accepts valid errorCatalog with exception field", () => {
    const page = {
      ...validPage,
      errorCatalog: [
        { exception: "OrderNotFoundException", trigger: "invalid ID", handling: "returns 404", severity: "user_error" },
      ],
    };
    const issues = validateWikiDomainPage(page, "domains/test.json");
    expect(issues.filter((i) => i.message.includes("errorCatalog"))).toHaveLength(0);
  });
});

describe("validateWikiServiceOverview", () => {
  it("passes for valid service overview", () => {
    const svc = {
      name: "order-service",
      description: "Manages order lifecycle from creation to fulfillment",
      techStack: ["Java", "Spring Boot"],
      modules: ["API Layer", "Service Layer"],
      entryPoints: ["POST /api/orders"],
    };
    const issues = validateWikiServiceOverview(svc, "service.json");
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports error for missing name", () => {
    const issues = validateWikiServiceOverview({ description: "test" }, "service.json");
    expect(issues.some((i) => i.message.includes("Missing service name"))).toBe(true);
  });

  it("reports warning for missing techStack", () => {
    const svc = { name: "test", description: "A valid description here" };
    const issues = validateWikiServiceOverview(svc, "service.json");
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("techStack"))).toBe(true);
  });
});

describe("validateCoverage", () => {
  it("returns no issues when all domains covered", () => {
    const domainIds = ["domain:order-mgmt", "domain:payment"];
    const wikiFiles = ["order-mgmt.json", "payment.json"];
    const issues = validateCoverage(domainIds, wikiFiles);
    expect(issues).toEqual([]);
  });

  it("reports error for missing domain wiki page", () => {
    const domainIds = ["domain:order-mgmt", "domain:payment", "domain:inventory"];
    const wikiFiles = ["order-mgmt.json", "payment.json"];
    const issues = validateCoverage(domainIds, wikiFiles);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("inventory");
  });
});

describe("validateSourceRefs", () => {
  it("returns no issues for existing files", () => {
    const refs = [{ file: "src/Main.java" }, { file: "src/Utils.java" }];
    const existing = new Set(["src/Main.java", "src/Utils.java"]);
    const issues = validateSourceRefs(refs, existing);
    expect(issues).toEqual([]);
  });

  it("warns for missing referenced files", () => {
    const refs = [{ file: "src/Missing.java" }];
    const existing = new Set(["src/Other.java"]);
    const issues = validateSourceRefs(refs, existing);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("Missing.java");
  });
});

describe("runQualityGateLayer1", () => {
  it("passes for a complete valid wiki", () => {
    const result = runQualityGateLayer1({
      meta: { gitCommitHash: "abc", generatedAt: "2026-01-01T00:00:00Z", version: "1.0.0", outputLanguage: "en" },
      index: {
        entries: [
          { id: "wiki:svc", name: "Svc", type: "service", summary: "A service" },
          { id: "wiki:d:order", name: "Order", type: "domain", summary: "Order domain" },
        ],
      },
      serviceOverview: { name: "test-svc", description: "A comprehensive service description", techStack: ["Java"] },
      domainPages: [
        {
          filename: "order.json",
          data: {
            id: "domain:order",
            name: "Order",
            summary: "Handles order processing and lifecycle management",
            entities: ["Order"],
            flows: [{ id: "flow:create", name: "Create", summary: "Creates order", steps: [{ order: 1, name: "S1", description: "Does something useful" }] }],
          },
        },
      ],
      domainNodeIds: ["domain:order"],
      sourceFiles: new Set(["src/Order.java"]),
    });

    expect(result.passed).toBe(true);
    expect(result.stats.domainsFound).toBe(1);
    expect(result.stats.coveragePercent).toBe(100);
  });

  it("fails when coverage is incomplete", () => {
    const result = runQualityGateLayer1({
      meta: { gitCommitHash: "abc", generatedAt: "2026-01-01T00:00:00Z", version: "1.0.0", outputLanguage: "en" },
      index: { entries: [{ id: "x", name: "X", type: "service", summary: "desc" }] },
      serviceOverview: { name: "svc", description: "A valid service description text" },
      domainPages: [],
      domainNodeIds: ["domain:order", "domain:payment"],
      sourceFiles: new Set([]),
    });

    expect(result.passed).toBe(false);
    expect(result.stats.coveragePercent).toBe(0);
    expect(result.issues.some((i) => i.severity === "error" && i.message.includes("order"))).toBe(true);
  });

  it("fails when meta is invalid", () => {
    const result = runQualityGateLayer1({
      meta: {},
      index: { entries: [{ id: "x", name: "X", type: "service", summary: "desc" }] },
      serviceOverview: { name: "svc", description: "A valid service description text" },
      domainPages: [],
      domainNodeIds: [],
      sourceFiles: new Set([]),
    });

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("gitCommitHash"))).toBe(true);
  });
});

describe("validateWikiMeta — domainStates extension", () => {
  it("accepts valid domainStates", () => {
    const meta = {
      version: "1.0",
      serviceName: "order-service",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      outputLanguage: "en",
      domainStates: {
        "order-management": { lastGeneratedAt: "2026-06-03T12:00:00Z", nodeCount: 15, flowCount: 3 },
      },
      rpcEdgeHash: "sha256:abc123",
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues).toHaveLength(0);
  });

  it("rejects domainStates with invalid entry (missing nodeCount)", () => {
    const meta = {
      version: "1.0",
      serviceName: "order-service",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      outputLanguage: "en",
      domainStates: {
        "order": { lastGeneratedAt: "2026-06-03T12:00:00Z", flowCount: 3 },
      },
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain("nodeCount");
  });

  it("rejects domainStates with invalid entry (missing flowCount)", () => {
    const meta = {
      version: "1.0",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      outputLanguage: "en",
      domainStates: {
        "payment": { lastGeneratedAt: "2026-06-03T12:00:00Z", nodeCount: 5 },
      },
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues.some((i) => i.message.includes("flowCount"))).toBe(true);
  });

  it("rejects domainStates when it is an array", () => {
    const meta = {
      version: "1.0",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      outputLanguage: "en",
      domainStates: [],
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues.some((i) => i.message.includes("domainStates must be an object"))).toBe(true);
  });

  it("accepts meta without domainStates (backward compatible)", () => {
    const meta = {
      version: "1.0",
      generatedAt: "2026-06-03T12:00:00Z",
      gitCommitHash: "abc1234",
      outputLanguage: "en",
    };
    const issues = validateWikiMeta(meta, "wiki/meta.json");
    expect(issues).toHaveLength(0);
  });
});

describe("autoFixDomainPage", () => {
  it("should convert string entities to objects", () => {
    const page = {
      id: "domain:test",
      name: "Test",
      summary: "Test domain",
      entities: ["Order", "Payment"],
      flows: [],
    };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.entities[0]).toEqual({ name: "Order", description: "" });
    expect(data.entities[1]).toEqual({ name: "Payment", description: "" });
    expect(fixes).toHaveLength(2);
  });

  it("should add missing summary with default", () => {
    const page = { id: "domain:test", name: "Test", entities: [], flows: [] };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.summary).toBe("No summary available");
    expect(fixes).toHaveLength(1);
  });

  it("should auto-number steps missing order", () => {
    const page = {
      id: "domain:test",
      name: "Test",
      summary: "Test domain",
      entities: [],
      flows: [
        {
          id: "flow:a",
          name: "Flow A",
          summary: "test",
          steps: [
            { name: "Step 1", description: "desc" },
            { name: "Step 2", description: "desc" },
          ],
        },
      ],
    };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.flows[0].steps[0].order).toBe(1);
    expect(data.flows[0].steps[1].order).toBe(2);
    expect(fixes.length).toBeGreaterThan(0);
  });

  it("should generate flow id from name when missing", () => {
    const page = {
      id: "domain:test",
      name: "Test",
      summary: "Test domain",
      entities: [],
      flows: [{ name: "Create Order", summary: "test", steps: [] }],
    };
    const { data, fixes } = autoFixDomainPage(page, "domains/test.json");
    expect(data.flows[0].id).toBe("flow:create-order");
    expect(fixes).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import {
  validateParentWikiOverview,
  validateParentWikiArchitecture,
  validateParentWikiCrossDomain,
} from "../wiki-schema";

describe("validateParentWikiOverview", () => {
  it("passes for valid overview", () => {
    const data = {
      name: "My Platform",
      description: "A comprehensive e-commerce platform",
      services: [
        { name: "order-service", description: "Manages orders", domains: ["order-mgmt"] },
        { name: "payment-service", description: "Handles payments", domains: ["payment"] },
      ],
      techStack: ["Java", "Spring Boot", "MySQL"],
    };
    const issues = validateParentWikiOverview(data, "overview.json");
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("reports error for missing name", () => {
    const data = {
      description: "A platform",
      services: [{ name: "svc", description: "test", domains: [] }],
      techStack: [],
    };
    const issues = validateParentWikiOverview(data, "overview.json");
    expect(issues.some((i) => i.message.includes("Missing system name"))).toBe(true);
  });

  it("reports error for empty services array", () => {
    const data = {
      name: "System",
      description: "Test",
      services: [],
      techStack: [],
    };
    const issues = validateParentWikiOverview(data, "overview.json");
    expect(issues.some((i) => i.message.includes("services array is empty"))).toBe(true);
  });

  it("reports error for non-object input", () => {
    const issues = validateParentWikiOverview(null, "overview.json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("reports warning for service missing description", () => {
    const data = {
      name: "Sys",
      description: "Test system",
      services: [{ name: "svc-a", domains: ["d1"] }],
      techStack: [],
    };
    const issues = validateParentWikiOverview(data, "overview.json");
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("missing description"))).toBe(true);
  });
});

describe("validateParentWikiArchitecture", () => {
  it("passes for valid architecture", () => {
    const data = {
      crossServiceCalls: [
        {
          caller: { service: "order-service", node: "fn:create", method: "createOrder()" },
          callee: { service: "payment-service", node: "svc:payment", interface: "PaymentFacade", method: "pay()" },
          type: "moa_rpc",
          evidence: "script-matched",
        },
      ],
      sharedResources: [
        { type: "database", name: "orders_db", services: ["order-service", "report-service"] },
      ],
      eventFlows: [
        { topic: "order.created", publisher: "order-service", subscribers: ["notification-service"] },
      ],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("reports error for missing crossServiceCalls", () => {
    const data = { sharedResources: [], eventFlows: [] };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.message.includes("Missing crossServiceCalls"))).toBe(true);
  });

  it("reports error for call missing caller", () => {
    const data = {
      crossServiceCalls: [{ callee: { service: "a" }, type: "http" }],
      sharedResources: [],
      eventFlows: [],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.message.includes("missing caller"))).toBe(true);
  });

  it("reports warning for missing eventFlows", () => {
    const data = {
      crossServiceCalls: [],
      sharedResources: [],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("eventFlows"))).toBe(true);
  });

  it("reports error for eventFlows entry missing topic", () => {
    const data = {
      crossServiceCalls: [],
      sharedResources: [],
      eventFlows: [{ publisher: "a", subscribers: ["b"] }],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("missing topic"))).toBe(true);
  });

  it("reports error for eventFlows entry missing publisher", () => {
    const data = {
      crossServiceCalls: [],
      sharedResources: [],
      eventFlows: [{ topic: "t", subscribers: ["b"] }],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("missing publisher"))).toBe(true);
  });

  it("reports error for eventFlows entry missing subscribers", () => {
    const data = {
      crossServiceCalls: [],
      sharedResources: [],
      eventFlows: [{ topic: "t", publisher: "a" }],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("subscribers"))).toBe(true);
  });

  it("reports error for eventFlows using caller/callee schema", () => {
    const data = {
      crossServiceCalls: [],
      sharedResources: [],
      eventFlows: [{ caller: { service: "a" }, callee: { service: "b" }, type: "kafka" }],
    };
    const issues = validateParentWikiArchitecture(data, "architecture.json");
    expect(issues.some((i) => i.severity === "error" && i.message.includes("caller/callee"))).toBe(true);
  });
});

describe("validateParentWikiCrossDomain", () => {
  it("passes for valid cross-domain page", () => {
    const data = {
      id: "cross-domain:order-creation",
      name: "Order Creation (E2E)",
      summary: "End-to-end order creation flow across services",
      services: ["order-service", "payment-service", "inventory-service"],
      steps: [
        { order: 1, service: "order-service", description: "Receives order request" },
        { order: 2, service: "order-service", description: "Calls payment service via RPC" },
        { order: 3, service: "payment-service", description: "Processes payment" },
      ],
    };
    const issues = validateParentWikiCrossDomain(data, "domains/order-creation.json");
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("reports error for missing id", () => {
    const data = {
      name: "Test",
      summary: "Test domain",
      services: ["a"],
      steps: [{ order: 1, service: "a", description: "step" }],
    };
    const issues = validateParentWikiCrossDomain(data, "domains/test.json");
    expect(issues.some((i) => i.message.includes("Missing id"))).toBe(true);
  });

  it("reports error for empty services", () => {
    const data = {
      id: "cross:test",
      name: "Test",
      summary: "Test domain",
      services: [],
      steps: [{ order: 1, service: "a", description: "step" }],
    };
    const issues = validateParentWikiCrossDomain(data, "domains/test.json");
    expect(issues.some((i) => i.message.includes("empty services"))).toBe(true);
  });

  it("reports error for step missing service", () => {
    const data = {
      id: "cross:test",
      name: "Test",
      summary: "Test domain",
      services: ["a"],
      steps: [{ order: 1, description: "step without service" }],
    };
    const issues = validateParentWikiCrossDomain(data, "domains/test.json");
    expect(issues.some((i) => i.message.includes("missing service"))).toBe(true);
  });

  it("reports error for non-object input", () => {
    const issues = validateParentWikiCrossDomain("invalid", "domains/x.json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });
});

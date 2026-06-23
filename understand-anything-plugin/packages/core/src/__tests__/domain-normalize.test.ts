import { describe, it, expect } from "vitest";
import { normalizeNodeId } from "../analyzer/normalize-graph.js";

describe("normalizeNodeId — domain types", () => {
  it("normalizes domain node IDs", () => {
    const result = normalizeNodeId("domain:order-management", {
      type: "domain",
      name: "Order Management",
    });
    expect(result).toBe("domain:order-management");
  });

  it("normalizes flow node IDs", () => {
    const result = normalizeNodeId("flow:create-order", {
      type: "flow",
      name: "Create Order",
    });
    expect(result).toBe("flow:create-order");
  });

  it("normalizes step node IDs with filePath", () => {
    const result = normalizeNodeId("step:create-order:validate", {
      type: "step",
      name: "Validate",
      filePath: "src/validators/order.ts",
    });
    expect(result).toBe("step:create-order:src/validators/order.ts:validate");
  });

  it("normalizes step node IDs without filePath", () => {
    const result = normalizeNodeId("step:validate", {
      type: "step",
      name: "Validate",
    });
    expect(result).toBe("step:validate");
  });

  it("normalizes bare step name with filePath", () => {
    const result = normalizeNodeId("validate", {
      type: "step",
      name: "Validate",
      filePath: "src/validators/order.ts",
    });
    expect(result).toBe("step:src/validators/order.ts:validate");
  });
});

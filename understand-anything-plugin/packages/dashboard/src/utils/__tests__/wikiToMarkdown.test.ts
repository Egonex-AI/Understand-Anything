import { describe, it, expect } from "vitest";
import { serviceOverviewToMarkdown, domainPageToMarkdown } from "../wikiToMarkdown";

describe("serviceOverviewToMarkdown", () => {
  it("renders a complete service overview", () => {
    const overview = {
      name: "Order Service",
      description: "Handles order lifecycle management.",
      techStack: ["Java 17", "Spring Boot 3.x"],
      modules: ["order-api", "order-domain"],
      entryPoints: ["/api/orders"],
    };

    const md = serviceOverviewToMarkdown(overview);
    expect(md).toContain("# Order Service");
    expect(md).toContain("Handles order lifecycle management.");
    expect(md).toContain("## Tech Stack");
    expect(md).toContain("- Java 17");
    expect(md).toContain("## Modules");
    expect(md).toContain("- order-api");
    expect(md).toContain("## Entry Points");
    expect(md).toContain("`/api/orders`");
  });

  it("omits empty sections", () => {
    const overview = {
      name: "Minimal Service",
      description: "A minimal service.",
      techStack: [],
      modules: [],
      entryPoints: [],
    };

    const md = serviceOverviewToMarkdown(overview);
    expect(md).toContain("# Minimal Service");
    expect(md).not.toContain("## Tech Stack");
    expect(md).not.toContain("## Modules");
    expect(md).not.toContain("## Entry Points");
  });
});

describe("domainPageToMarkdown", () => {
  it("renders a complete domain page with flows and steps", () => {
    const page = {
      id: "order-management",
      name: "Order Management",
      summary: "Core domain for order processing.",
      entities: ["Order", "OrderItem", "OrderStatus"],
      flows: [
        {
          id: "create-order",
          name: "Create Order",
          summary: "Flow for creating a new order.",
          steps: [
            {
              order: 1,
              name: "Validate Input",
              description: "Check request payload.",
              sourceRef: { file: "src/OrderController.java", lineRange: [45, 60] as [number, number] },
            },
            {
              order: 2,
              name: "Save Order",
              description: "Persist order to database.",
            },
          ],
        },
      ],
    };

    const md = domainPageToMarkdown(page);
    expect(md).toContain("# Order Management");
    expect(md).toContain("Core domain for order processing.");
    expect(md).toContain("## Key Entities");
    expect(md).toContain("- Order");
    expect(md).toContain("- OrderItem");
    expect(md).toContain("## Flows");
    expect(md).toContain("### Create Order");
    expect(md).toContain("Flow for creating a new order.");
    expect(md).toContain("1. **Validate Input** — Check request payload.");
    expect(md).toContain("📎 [src/OrderController.java:45-60](source://src/OrderController.java#L45-L60)");
    expect(md).toContain("2. **Save Order** — Persist order to database.");
    const pinCount = (md.match(/📎/g) || []).length;
    expect(pinCount).toBe(1);
  });

  it("renders cross-service calls", () => {
    const page = {
      id: "payment",
      name: "Payment",
      summary: "Payment processing domain.",
      entities: ["Payment"],
      flows: [],
      crossServiceCalls: [
        {
          caller: { service: "order-service", node: "OrderService", method: "processPayment" },
          callee: { service: "payment-service", node: "PaymentFacade", method: "pay", interface: "PaymentAPI" },
          type: "dubbo_rpc" as const,
          evidence: "script-matched" as const,
        },
      ],
    };

    const md = domainPageToMarkdown(page);
    expect(md).toContain("## Cross-Service Calls");
    expect(md).toContain("`order-service`.processPayment");
    expect(md).toContain("`payment-service`#PaymentAPI");
  });

  it("handles empty entities and flows", () => {
    const page = {
      id: "empty",
      name: "Empty Domain",
      summary: "Nothing here yet.",
      entities: [],
      flows: [],
    };

    const md = domainPageToMarkdown(page);
    expect(md).toContain("# Empty Domain");
    expect(md).toContain("Nothing here yet.");
    expect(md).not.toContain("## Key Entities");
    expect(md).not.toContain("## Flows");
  });
});

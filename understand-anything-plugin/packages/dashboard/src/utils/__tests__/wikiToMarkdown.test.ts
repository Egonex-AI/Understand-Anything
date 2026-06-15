import { describe, it, expect } from "vitest";
import type { ClientGraph } from "@understand-anything/core";
import { serviceOverviewToMarkdown, domainPageToMarkdown, clientGraphToMarkdown } from "../wikiToMarkdown";

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

describe("clientGraphToMarkdown", () => {
  it("renders platform implementation table and domain links", () => {
    const data: ClientGraph = {
      platforms: ["Amar", "ddoversea", "ddoversea_flutter"],
      crossPlatformFrameworks: ["flutter"],
      featureMap: [
        {
          domain: "即时通讯",
          implType: "platform-specific",
          implementations: { Amar: { framework: "native", ref: "mobile/Amar/.understand-anything/wiki/domains/im.json" } },
        },
        {
          domain: "家族运营",
          implType: "cross-platform",
          implementations: { ddoversea_flutter: { framework: "flutter", ref: "mobile/ddoversea_flutter/.understand-anything/wiki/domains/family.json" } },
        },
      ],
      domainLinks: [
        {
          canonicalFeature: "即时通讯",
          mappings: { Amar: "domain:instant-messaging", ddoversea: "domain:im-chat" },
        },
      ],
    };

    const md = clientGraphToMarkdown(data);
    expect(md).toContain("## 平台实现分布");
    expect(md).toContain("| 功能域 | 实现类型 | Amar | ddoversea | ddoversea_flutter |");
    expect(md).toContain("| 即时通讯 | platform-specific | native | - | - |");
    expect(md).toContain("| 家族运营 | cross-platform | - | - | flutter |");
    expect(md).toContain("## 跨平台域映射");
    expect(md).toContain("| 即时通讯 | instant-messaging | im-chat |");
  });

  it("returns empty string when no feature map or domain links", () => {
    expect(clientGraphToMarkdown({ platforms: [], featureMap: [] })).toBe("");
  });
});

describe("businessFeaturesToMarkdown", () => {
  const { businessFeaturesToMarkdown } = require("../wikiToMarkdown");

  it("renders feature overview table with server associations", () => {
    const data = {
      features: [
        {
          id: "feature:即时通讯",
          name: "即时通讯",
          clientLayer: {
            implType: "cross-platform",
            platforms: { Amar: {}, ddoversea: {} },
            deliveryPlatforms: ["Amar", "ddoversea"],
            summary: "IM功能",
          },
          serverLayer: {
            primaryDomain: { name: "Cosmos IM", service: "ultron-group-chat", confidence: 0.95 },
            supportingDomains: [{ name: "用户关系", service: "ultron-relation", relationship: "depends_on", confidence: 0.7 }],
          },
        },
      ],
      serverIndex: { "Cosmos IM": { features: ["即时通讯"], refCount: 1, service: "ultron-group-chat" } },
      stats: { totalFeatures: 1, withServerAssociation: 1, serverDomainsReferenced: 1 },
    };

    const md = businessFeaturesToMarkdown(data);
    expect(md).toContain("# 业务功能全景");
    expect(md).toContain("| 即时通讯 | cross-platform |");
    expect(md).toContain("Cosmos IM");
    expect(md).toContain("95%");
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart LR");
    expect(md).toContain("## 服务端域引用统计");
  });

  it("returns empty string for empty features", () => {
    expect(businessFeaturesToMarkdown({ features: [], serverIndex: {}, stats: { totalFeatures: 0, withServerAssociation: 0, serverDomainsReferenced: 0 } })).toBe("");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { WikiDataService } from "../../wiki-api";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wiki-api-test-"));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

describe("WikiDataService", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("discoverWikis", () => {
    it("returns empty topology when no wikis exist", () => {
      const svc = new WikiDataService(tmpDir);
      const topo = svc.discoverWikis();
      expect(topo.hasParentWiki).toBe(false);
      expect(topo.parentWikiDir).toBeNull();
      expect(topo.services).toHaveLength(0);
    });

    it("discovers parent wiki", () => {
      writeJson(path.join(tmpDir, ".understand-anything/wiki/meta.json"), {
        gitCommitHash: "abc123",
        generatedAt: "2026-06-03T00:00:00Z",
        version: "1.0.0",
        outputLanguage: "en",
        serviceCount: 2,
      });

      const svc = new WikiDataService(tmpDir);
      const topo = svc.discoverWikis();
      expect(topo.hasParentWiki).toBe(true);
      expect(topo.parentWikiDir).toBe(path.join(tmpDir, ".understand-anything/wiki"));
    });

    it("discovers service wikis", () => {
      writeJson(path.join(tmpDir, "order-service/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "abc",
        generatedAt: "2026-06-03T00:00:00Z",
        version: "1.0.0",
        outputLanguage: "zh",
      });
      writeJson(path.join(tmpDir, "payment-service/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "def",
        generatedAt: "2026-06-03T00:00:00Z",
        version: "1.0.0",
        outputLanguage: "zh",
      });

      const svc = new WikiDataService(tmpDir);
      const topo = svc.discoverWikis();
      expect(topo.services).toHaveLength(2);
      expect(topo.services.map((s) => s.name).sort()).toEqual(["order-service", "payment-service"]);
    });
  });

  describe("getGlobalIndex", () => {
    it("aggregates entries from parent and service wikis", () => {
      writeJson(path.join(tmpDir, ".understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, ".understand-anything/wiki/index.json"), {
        entries: [
          { id: "wiki:overview", name: "System Overview", type: "overview", summary: "Top level" },
        ],
      });
      writeJson(path.join(tmpDir, "svc-a/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "b", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, "svc-a/.understand-anything/wiki/index.json"), {
        entries: [
          { id: "wiki:svc-a:service", name: "Svc A", type: "service", summary: "Service A" },
        ],
      });

      const svc = new WikiDataService(tmpDir);
      const result = svc.getGlobalIndex();
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].id).toBe("wiki:overview");
      expect(result.entries[1].service).toBe("svc-a");
    });
  });

  describe("getOverview", () => {
    it("returns null when no parent wiki", () => {
      const svc = new WikiDataService(tmpDir);
      expect(svc.getOverview()).toBeNull();
    });

    it("returns overview data", () => {
      writeJson(path.join(tmpDir, ".understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, ".understand-anything/wiki/overview.json"), {
        name: "My System",
        description: "A test system",
        services: [{ name: "svc-a", description: "Service A", domains: ["order"] }],
        techStack: ["Java", "Spring"],
      });

      const svc = new WikiDataService(tmpDir);
      const result = svc.getOverview();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("My System");
      expect(result!.services).toHaveLength(1);
    });
  });

  describe("getServiceWiki", () => {
    it("returns null for unknown service", () => {
      const svc = new WikiDataService(tmpDir);
      expect(svc.getServiceWiki("nonexistent")).toBeNull();
    });

    it("returns service index and overview", () => {
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/index.json"), {
        entries: [{ id: "wiki:order", name: "Order", type: "domain", summary: "Order domain" }],
      });
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/service.json"), {
        name: "order-svc",
        description: "Manages orders",
        techStack: ["Java"],
        modules: ["controller", "service"],
        entryPoints: ["OrderController"],
      });

      const svc = new WikiDataService(tmpDir);
      const result = svc.getServiceWiki("order-svc");
      expect(result).not.toBeNull();
      expect(result!.overview.name).toBe("order-svc");
      expect(result!.index.entries).toHaveLength(1);
    });
  });

  describe("getServiceDomain", () => {
    it("returns domain page for a specific service", () => {
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/domains/order-mgmt.json"), {
        id: "domain:order-mgmt",
        name: "Order Management",
        summary: "Handles order lifecycle",
        entities: ["Order", "OrderItem"],
        flows: [{ id: "flow:create", name: "Create Order", summary: "Creates a new order", steps: [] }],
      });

      const svc = new WikiDataService(tmpDir);
      const result = svc.getServiceDomain("order-svc", "order-mgmt");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Order Management");
      expect(result!.flows).toHaveLength(1);
    });
  });

  describe("search", () => {
    it("returns empty for blank query", () => {
      const svc = new WikiDataService(tmpDir);
      expect(svc.search("")).toEqual([]);
    });

    it("finds matching wiki pages by name", () => {
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/index.json"), {
        entries: [
          { id: "wiki:order", name: "Order Management", type: "domain", summary: "Manages orders" },
          { id: "wiki:shipping", name: "Shipping", type: "domain", summary: "Handles logistics" },
        ],
      });

      const svc = new WikiDataService(tmpDir);
      const results = svc.search("order");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Order Management");
    });

    it("respects limit parameter", () => {
      writeJson(path.join(tmpDir, "svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      const entries = Array.from({ length: 30 }, (_, i) => ({
        id: `wiki:item-${i}`, name: `Item ${i}`, type: "domain" as const, summary: `Item ${i} description`,
      }));
      writeJson(path.join(tmpDir, "svc/.understand-anything/wiki/index.json"), { entries });

      const svc = new WikiDataService(tmpDir);
      const results = svc.search("Item", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getRelated", () => {
    it("returns source refs from matching domain page", () => {
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/domains/order-mgmt.json"), {
        id: "domain:order-mgmt",
        name: "Order Management",
        summary: "Manages orders",
        entities: [],
        flows: [{
          id: "flow:create",
          name: "Create Order",
          summary: "Creates order",
          steps: [{
            order: 1,
            name: "Validate",
            description: "Validates input",
            sourceRef: { file: "src/OrderService.java", lineRange: [10, 20] },
          }],
        }],
      });

      const svc = new WikiDataService(tmpDir);
      const result = svc.getRelated("domain:order-mgmt");
      expect(result.sourceRefs).toHaveLength(1);
      expect(result.sourceRefs[0].file).toBe("src/OrderService.java");
    });
  });

  describe("invalidateCache", () => {
    it("forces re-discovery on next call", () => {
      const svc = new WikiDataService(tmpDir);
      const topo1 = svc.discoverWikis();
      expect(topo1.services).toHaveLength(0);

      writeJson(path.join(tmpDir, "new-svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "x", generatedAt: "t", version: "1", outputLanguage: "en",
      });

      // Without invalidation, cached result
      const topo2 = svc.discoverWikis();
      expect(topo2.services).toHaveLength(0);

      svc.invalidateCache();
      const topo3 = svc.discoverWikis();
      expect(topo3.services).toHaveLength(1);
    });
  });
});

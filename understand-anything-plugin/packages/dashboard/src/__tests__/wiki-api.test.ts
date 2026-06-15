import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { WikiIndex as WikiSearchIndex } from "../api/handlers/wiki-index";
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
        serviceCount: 1,
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

  describe("getClientGraph", () => {
    it("returns null when client-graph.json is missing", () => {
      const svc = new WikiDataService(tmpDir);
      expect(svc.getClientGraph()).toBeNull();
    });

    it("loads client-graph.json from project root", () => {
      writeJson(path.join(tmpDir, ".understand-anything/client-graph.json"), {
        platforms: ["Amar"],
        featureMap: [{ domain: "IM", implType: "platform-specific", implementations: { Amar: { framework: "native" } } }],
      });

      const svc = new WikiDataService(tmpDir);
      const graph = svc.getClientGraph();
      expect(graph).not.toBeNull();
      expect(graph!.platforms).toEqual(["Amar"]);
      expect(graph!.featureMap).toHaveLength(1);
    });

    it("loads client-graph.json from facet .understand-anything directory", () => {
      writeJson(path.join(tmpDir, "mobile/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "zh",
      });
      writeJson(path.join(tmpDir, "mobile/.understand-anything/client-graph.json"), {
        platforms: ["ddoversea"],
        featureMap: [{ domain: "Chat", implType: "cross-platform", implementations: { ddoversea: { framework: "flutter" } } }],
      });

      const svc = new WikiDataService(tmpDir);
      const graph = svc.getClientGraph("mobile");
      expect(graph).not.toBeNull();
      expect(graph!.platforms).toEqual(["ddoversea"]);
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

    it("resolves domain by Chinese name via index fallback", () => {
      writeJson(path.join(tmpDir, "ultron-relation/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "zh",
      });
      writeJson(path.join(tmpDir, "ultron-relation/.understand-anything/wiki/index.json"), {
        entries: [
          {
            id: "wiki:domain:closed-friend-relation",
            name: "挚友关系管理",
            type: "domain",
            summary: "Closed friend relation management",
          },
        ],
      });
      writeJson(
        path.join(tmpDir, "ultron-relation/.understand-anything/wiki/domains/closed-friend-relation.json"),
        {
          id: "domain:closed-friend-relation",
          name: "挚友关系管理",
          summary: "Manages closed friend relationships",
          entities: ["ClosedFriendRelation"],
          flows: [{ id: "flow:bind", name: "Bind Friend", summary: "Binds a closed friend", steps: [] }],
        },
      );

      const svc = new WikiDataService(tmpDir);
      const result = svc.getServiceDomain("ultron-relation", "挚友关系");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("domain:closed-friend-relation");
      expect(result!.name).toBe("挚友关系管理");
      expect(result!.flows).toHaveLength(1);
    });
  });

  describe("search", () => {
    it("returns empty for blank query", async () => {
      const svc = new WikiDataService(tmpDir);
      await expect(svc.search("")).resolves.toEqual([]);
    });

    it("finds matching wiki pages by name", async () => {
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
      const results = await svc.search("order");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Order Management");
    });

    it("respects limit parameter", async () => {
      writeJson(path.join(tmpDir, "svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      const entries = Array.from({ length: 30 }, (_, i) => ({
        id: `wiki:item-${i}`, name: `Item ${i}`, type: "domain" as const, summary: `Item ${i} description`,
      }));
      writeJson(path.join(tmpDir, "svc/.understand-anything/wiki/index.json"), { entries });

      const svc = new WikiDataService(tmpDir);
      const results = await svc.search("Item", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("json cache", () => {
    function setupParentWiki(): void {
      writeJson(path.join(tmpDir, ".understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, ".understand-anything/wiki/overview.json"), {
        name: "My System",
        description: "A test system",
        services: [],
        techStack: [],
      });
    }

    it("returns same data on repeated reads", () => {
      setupParentWiki();
      const svc = new WikiDataService(tmpDir);
      const first = svc.getOverview();
      const second = svc.getOverview();
      expect(first).toEqual(second);
      expect(first!.name).toBe("My System");
    });

    it("invalidates cache after TTL expires", () => {
      vi.useFakeTimers();
      setupParentWiki();
      const svc = new WikiDataService(tmpDir, { cacheTtlMs: 60_000 });

      expect(svc.getOverview()!.name).toBe("My System");

      const readSpy = vi.spyOn(fs, "readFileSync");
      const readsAfterFirst = readSpy.mock.calls.length;
      svc.getOverview();
      expect(readSpy.mock.calls.length).toBe(readsAfterFirst);

      writeJson(path.join(tmpDir, ".understand-anything/wiki/overview.json"), {
        name: "Updated System",
        description: "Updated",
        services: [],
        techStack: [],
      });

      vi.advanceTimersByTime(61_000);
      expect(svc.getOverview()!.name).toBe("Updated System");

      readSpy.mockRestore();
      vi.useRealTimers();
    });

    it("invalidates cache when file mtime changes", () => {
      setupParentWiki();
      const overviewPath = path.join(tmpDir, ".understand-anything/wiki/overview.json");
      const svc = new WikiDataService(tmpDir);

      expect(svc.getOverview()!.name).toBe("My System");

      writeJson(overviewPath, {
        name: "Mtime Updated",
        description: "Changed on disk",
        services: [],
        techStack: [],
      });
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(overviewPath, future, future);

      expect(svc.getOverview()!.name).toBe("Mtime Updated");
    });

    it("evicts oldest entries when maxCacheSize is exceeded", () => {
      setupParentWiki();
      writeJson(path.join(tmpDir, ".understand-anything/wiki/architecture.json"), {
        name: "Arch A",
        description: "First architecture",
        layers: [],
      });
      writeJson(path.join(tmpDir, ".understand-anything/wiki/index.json"), {
        entries: [{ id: "wiki:overview", name: "Overview", type: "overview", summary: "Index entry" }],
      });

      const svc = new WikiDataService(tmpDir, { maxCacheSize: 2 });

      svc.getOverview();
      svc.getArchitecture();
      svc.getGlobalIndex(); // should evict overview (oldest)

      writeJson(path.join(tmpDir, ".understand-anything/wiki/overview.json"), {
        name: "Evicted And Reloaded",
        description: "After eviction",
        services: [],
        techStack: [],
      });

      expect(svc.getOverview()!.name).toBe("Evicted And Reloaded");
    });
  });

  describe("async search", () => {
    function setupSearchWiki(): void {
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/meta.json"), {
        gitCommitHash: "a", generatedAt: "t", version: "1", outputLanguage: "en",
      });
      writeJson(path.join(tmpDir, "order-svc/.understand-anything/wiki/index.json"), {
        entries: [
          { id: "wiki:order", name: "Order Management", type: "domain", summary: "Manages orders" },
        ],
      });
    }

    it("returns correct results asynchronously", async () => {
      setupSearchWiki();
      const svc = new WikiDataService(tmpDir);
      const results = await svc.search("order");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Order Management");
    });

    it("caches recent search results within TTL", async () => {
      vi.useFakeTimers();
      setupSearchWiki();
      const svc = new WikiDataService(tmpDir);
      const fuseSearch = vi.spyOn(WikiSearchIndex.prototype, "search");

      const first = await svc.search("order");
      const second = await svc.search("order");

      expect(first).toEqual(second);
      expect(fuseSearch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(31_000);
      await svc.search("order");
      expect(fuseSearch).toHaveBeenCalledTimes(2);

      fuseSearch.mockRestore();
      vi.useRealTimers();
    });

    it("clears search cache when wiki cache is invalidated", async () => {
      setupSearchWiki();
      const svc = new WikiDataService(tmpDir);
      const fuseSearch = vi.spyOn(WikiSearchIndex.prototype, "search");

      await svc.search("order");
      svc.invalidateCache();
      await svc.search("order");

      expect(fuseSearch).toHaveBeenCalledTimes(2);
      fuseSearch.mockRestore();
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

import fs from "fs";
import path from "path";
import type {
  WikiMeta,
  WikiIndex,
  WikiIndexEntry,
  WikiServiceOverview,
  WikiDomainPage,
  WikiOverview,
  WikiArchitecture,
  ClientGraph,
  WikiCrossDomain,
  WikiSearchResult,
  WikiTopology,
  WikiTopologyFacet,
  ServiceEndpointDoc,
} from "@understand-anything/core";
import { WikiIndex as WikiSearchIndex } from "./src/api/handlers/wiki-index";
import { sanitizeSlug } from "./src/utils/sanitize";

export interface WikiDataServiceOptions {
  /** TTL for JSON file cache entries (default: 5 minutes). */
  cacheTtlMs?: number;
  /** Maximum number of cached JSON files (default: 100). */
  maxCacheSize?: number;
}

interface JsonCacheEntry {
  data: unknown;
  cachedAt: number;
  lastAccessedAt: number;
  fileMtimeMs: number;
}

interface SearchCacheEntry {
  results: WikiSearchResult[];
  cachedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_SIZE = 100;
const SEARCH_CACHE_TTL_MS = 30 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 10;
const SEARCH_YIELD_CHUNK_SIZE = 10;

export class WikiDataService {
  private projectRoot: string;
  private cacheTtlMs: number;
  private maxCacheSize: number;
  private topology: WikiTopology | null = null;
  private topologyCachedAt: number | null = null;
  private jsonCache = new Map<string, JsonCacheEntry>();
  private searchIndex: WikiSearchIndex | null = null;
  private searchResultCache = new Map<string, SearchCacheEntry>();

  constructor(projectRoot: string, options?: WikiDataServiceOptions) {
    this.projectRoot = projectRoot;
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheSize = options?.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  discoverWikis(): WikiTopology {
    if (
      this.topology &&
      this.topologyCachedAt !== null &&
      this.now() - this.topologyCachedAt <= this.cacheTtlMs
    ) {
      return this.topology;
    }

    const rootWikiDir = path.join(this.projectRoot, ".understand-anything", "wiki");
    const rootMetaExists = fs.existsSync(path.join(rootWikiDir, "meta.json"));

    const services: WikiTopology["services"] = [];

    // Primary: load service paths from system-graph.json serviceIndex (deterministic)
    const systemGraphPath = path.join(this.projectRoot, ".understand-anything", "system-graph.json");
    let resolvedFromRegistry = false;
    const facets: WikiTopologyFacet[] = [];
    if (fs.existsSync(systemGraphPath)) {
      try {
        const sg = JSON.parse(fs.readFileSync(systemGraphPath, "utf-8")) as Record<string, unknown>;
        const serviceIndex = sg.serviceIndex as Record<string, { basePath?: string; hasWiki?: boolean; facet?: string }> | undefined;
        if (serviceIndex && typeof serviceIndex === "object") {
          const facetMap = new Map<string, string[]>();
          const facetPaths = new Set<string>();
          for (const [svcName, svcInfo] of Object.entries(serviceIndex)) {
            const svcRelPath = svcInfo.basePath ?? svcName;
            const wikiDir = path.join(this.projectRoot, svcRelPath, ".understand-anything", "wiki");
            const metaPath = path.join(wikiDir, "meta.json");
            if (!fs.existsSync(metaPath)) continue;
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as WikiMeta;
              const facet = svcInfo.facet as WikiTopology["services"][0]["facet"];
              services.push({ name: svcName, wikiDir, meta, facet });
              if (facet) {
                const list = facetMap.get(facet) ?? [];
                list.push(svcName);
                facetMap.set(facet, list);
                // Track facet parent directory
                const parts = svcRelPath.split("/");
                if (parts.length > 1) facetPaths.add(parts[0]);
              }
            } catch {
              // skip corrupted meta
            }
          }
          // Also load facet-level parent wikis (e.g. backend/, mobile/)
          for (const facetDir of facetPaths) {
            const facetWikiDir = path.join(this.projectRoot, facetDir, ".understand-anything", "wiki");
            const facetMetaPath = path.join(facetWikiDir, "meta.json");
            if (fs.existsSync(facetMetaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(facetMetaPath, "utf-8")) as WikiMeta;
                services.push({ name: facetDir, wikiDir: facetWikiDir, meta });
              } catch {
                // skip
              }
            }
          }
          // Build facet groupings
          const facetNames: Record<string, string> = { server: "后端微服务", mobile: "移动客户端", frontend: "前端应用" };
          for (const [facetType, svcNames] of facetMap) {
            facets.push({ type: facetType as WikiTopologyFacet["type"], name: facetNames[facetType] ?? facetType, services: svcNames });
          }
          resolvedFromRegistry = true;
        }
      } catch {
        // fall through to directory scan
      }
    }

    // Fallback: directory scanning (for single-service or legacy projects without system-graph)
    if (!resolvedFromRegistry) {
      let entries: string[];
      try {
        entries = fs.readdirSync(this.projectRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name);
      } catch {
        entries = [];
      }
      for (const dirName of entries) {
        const wikiDir = path.join(this.projectRoot, dirName, ".understand-anything", "wiki");
        const metaPath = path.join(wikiDir, "meta.json");
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as WikiMeta;
          services.push({ name: dirName, wikiDir, meta });
        } catch {
          // skip corrupted meta
        }
      }
    }

    // Distinguish parent wiki from single-service wiki at project root.
    // A true parent wiki has overview.json or architecture.json (Phase 2 output)
    // or serviceCount in meta. A service.json without these is a single-service wiki.
    let hasParentWiki = false;
    let parentWikiDir: string | null = null;

    if (rootMetaExists) {
      const isParent =
        fs.existsSync(path.join(rootWikiDir, "overview.json")) ||
        fs.existsSync(path.join(rootWikiDir, "architecture.json")) ||
        this.rootMetaHasServiceCount(rootWikiDir);

      if (isParent) {
        hasParentWiki = true;
        parentWikiDir = rootWikiDir;
      } else {
        // Root wiki is a single-service wiki — treat it as a service entry
        try {
          const meta = JSON.parse(
            fs.readFileSync(path.join(rootWikiDir, "meta.json"), "utf-8"),
          ) as WikiMeta;
          const serviceName = this.resolveServiceName(rootWikiDir);
          services.push({ name: serviceName, wikiDir: rootWikiDir, meta });
        } catch {
          // skip corrupted meta
        }
      }
    }

    this.topology = {
      hasParentWiki,
      parentWikiDir,
      services,
      facets: facets.length > 0 ? facets : undefined,
    };
    this.topologyCachedAt = this.now();
    return this.topology;
  }

  private rootMetaHasServiceCount(wikiDir: string): boolean {
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(wikiDir, "meta.json"), "utf-8"),
      ) as Record<string, unknown>;
      return typeof meta.serviceCount === "number" && meta.serviceCount > 0;
    } catch {
      return false;
    }
  }

  private resolveServiceName(wikiDir: string): string {
    try {
      const serviceJson = JSON.parse(
        fs.readFileSync(path.join(wikiDir, "service.json"), "utf-8"),
      ) as Record<string, unknown>;
      if (typeof serviceJson.name === "string" && serviceJson.name) {
        return serviceJson.name;
      }
    } catch {
      // fall through
    }
    return path.basename(this.projectRoot);
  }

  getGlobalIndex(): { entries: WikiIndexEntry[]; topology: WikiTopology } {
    const topo = this.discoverWikis();
    const entries: WikiIndexEntry[] = [];

    if (topo.parentWikiDir) {
      const parentIndex = this.readJson<WikiIndex>(path.join(topo.parentWikiDir, "index.json"));
      if (parentIndex?.entries) entries.push(...parentIndex.entries);
    }

    for (const svc of topo.services) {
      const svcIndex = this.readJson<WikiIndex>(path.join(svc.wikiDir, "index.json"));
      if (svcIndex?.entries) {
        for (const entry of svcIndex.entries) {
          const svcLabel = entry.service === "cross-service" ? svc.name : (entry.service ?? svc.name);
          entries.push({ ...entry, service: svcLabel });
        }
      }
    }

    return { entries, topology: topo };
  }

  getOverview(): WikiOverview | null {
    const topo = this.discoverWikis();
    if (!topo.parentWikiDir) return null;
    return this.readJson<WikiOverview>(path.join(topo.parentWikiDir, "overview.json"));
  }

  getArchitecture(): WikiArchitecture | null {
    const topo = this.discoverWikis();
    if (!topo.parentWikiDir) return null;
    return this.readJson<WikiArchitecture>(path.join(topo.parentWikiDir, "architecture.json"));
  }

  getClientGraph(serviceName?: string): ClientGraph | null {
    if (serviceName) {
      const topo = this.discoverWikis();
      const svc = topo.services.find((s) => s.name === serviceName);
      if (svc) {
        const facetGraph = this.readJson<ClientGraph>(
          path.join(path.dirname(svc.wikiDir), "client-graph.json"),
        );
        if (facetGraph) return facetGraph;
      }
    }
    return this.readJson<ClientGraph>(
      path.join(this.projectRoot, ".understand-anything", "client-graph.json"),
    );
  }

  getServiceArchitecture(serviceName: string): WikiArchitecture | null {
    const topo = this.discoverWikis();
    const svc = topo.services.find((s) => s.name === serviceName);
    if (!svc) return null;
    return this.readJson<WikiArchitecture>(path.join(svc.wikiDir, "architecture.json"));
  }

  getServices(): Array<{ name: string; meta: WikiMeta; overview: WikiServiceOverview | null }> {
    const topo = this.discoverWikis();
    return topo.services.map((svc) => ({
      name: svc.name,
      meta: svc.meta,
      overview: this.readJson<WikiServiceOverview>(path.join(svc.wikiDir, "service.json")),
    }));
  }

  getServiceWiki(serviceName: string): { index: WikiIndex; overview: WikiServiceOverview | WikiOverview; architecture?: WikiArchitecture; crossDomains?: WikiCrossDomain[] } | null {
    const topo = this.discoverWikis();
    const svc = topo.services.find((s) => s.name === serviceName);
    if (!svc) return null;

    const index = this.readJson<WikiIndex>(path.join(svc.wikiDir, "index.json"));
    if (!index) return null;

    const serviceJson = this.readJson<WikiServiceOverview>(path.join(svc.wikiDir, "service.json"));
    if (serviceJson) {
      return { index, overview: serviceJson };
    }

    // Facet/batch wiki: include architecture and cross-domain flows
    const overview = this.readJson<WikiOverview>(path.join(svc.wikiDir, "overview.json"));
    if (!overview) return null;

    const architecture = this.readJson<WikiArchitecture>(path.join(svc.wikiDir, "architecture.json")) ?? undefined;
    const crossDomains: WikiCrossDomain[] = [];
    const domainsDir = path.join(svc.wikiDir, "domains");
    if (fs.existsSync(domainsDir)) {
      try {
        const files = fs.readdirSync(domainsDir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          const domain = this.readJson<WikiCrossDomain>(path.join(domainsDir, file));
          if (domain) crossDomains.push(domain);
        }
      } catch { /* skip */ }
    }

    return { index, overview, architecture: architecture, crossDomains: crossDomains.length > 0 ? crossDomains : undefined };
  }

  getDomain(domainName: string): WikiCrossDomain | null {
    const slug = sanitizeSlug(domainName);
    if (!slug) return null;
    const topo = this.discoverWikis();
    if (!topo.parentWikiDir) return null;
    return this.readJson<WikiCrossDomain>(
      path.join(topo.parentWikiDir, "domains", `${slug}.json`),
    );
  }

  getServiceDomain(serviceName: string, domainId: string): WikiDomainPage | null {
    const topo = this.discoverWikis();

    let svc = topo.services.find((s) => s.name === serviceName);
    if (!svc) {
      const svcSlug = sanitizeSlug(serviceName);
      if (svcSlug) {
        svc = topo.services.find((s) => s.name === svcSlug);
      }
    }
    if (!svc) {
      const query = serviceName.toLowerCase();
      svc = topo.services.find((s) => s.name.toLowerCase().includes(query));
    }
    if (!svc) return null;

    const slug = sanitizeSlug(domainId);
    if (slug) {
      return this.readJson<WikiDomainPage>(path.join(svc.wikiDir, "domains", `${slug}.json`));
    }

    const index = this.readJson<WikiIndex>(path.join(svc.wikiDir, "index.json"));
    if (!index?.entries) return null;

    const domainQuery = domainId.toLowerCase();
    for (const entry of index.entries) {
      if (entry.type !== "domain") continue;

      const entrySlug = sanitizeSlug(entry.id);
      const nameMatch = entry.name.toLowerCase().includes(domainQuery);
      const idMatch = entry.id === domainId;

      if (nameMatch || idMatch) {
        if (!entrySlug) continue;
        return this.readJson<WikiDomainPage>(path.join(svc.wikiDir, "domains", `${entrySlug}.json`));
      }
    }

    return null;
  }

  getEndpointDoc(serviceName: string): ServiceEndpointDoc | null {
    const topo = this.discoverWikis();
    for (const svc of topo.services) {
      if (svc.name === serviceName) {
        const endpointPath = path.join(svc.wikiDir, "endpoints", `${serviceName}.json`);
        return this.readJson<ServiceEndpointDoc>(endpointPath);
      }
    }
    return null;
  }

  getEndpointIndex(): Record<string, unknown> | null {
    const topo = this.discoverWikis();
    if (topo.hasParentWiki && topo.parentWikiDir) {
      const indexPath = path.join(topo.parentWikiDir, "endpoints", "index.json");
      return this.readJson<Record<string, unknown>>(indexPath);
    }
    return null;
  }

  async search(query: string, limit = 20): Promise<WikiSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return Promise.resolve([]);

    const cacheKey = `${trimmed}\0${limit}`;
    const cached = this.searchResultCache.get(cacheKey);
    if (cached && this.now() - cached.cachedAt <= SEARCH_CACHE_TTL_MS) {
      return cached.results;
    }

    await Promise.resolve();
    this.ensureSearchIndex();
    if (!this.searchIndex) return [];

    const searchResult = this.searchIndex.search({ q: trimmed, limit });

    const results: WikiSearchResult[] = [];
    for (let i = 0; i < searchResult.results.length; i++) {
      if (i > 0 && i % SEARCH_YIELD_CHUNK_SIZE === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const r = searchResult.results[i];
      results.push({
        id: r.id,
        name: r.name,
        type: r.type as WikiIndexEntry["type"],
        service: r.service,
        domain: r.domain,
        summary: r.summary,
        score: r.score,
        matchSnippet: r.summary.slice(0, 120),
      });
    }

    this.setSearchCacheEntry(cacheKey, results);
    return results;
  }

  getRelated(pageId: string): { pages: WikiIndexEntry[]; sourceRefs: Array<{ file: string; lineRange?: [number, number] }> } {
    const pages: WikiIndexEntry[] = [];
    const sourceRefs: Array<{ file: string; lineRange?: [number, number] }> = [];
    const topo = this.discoverWikis();

    // Find the page across all wikis and extract relationships
    for (const svc of topo.services) {
      const domainDir = path.join(svc.wikiDir, "domains");
      if (!fs.existsSync(domainDir)) continue;

      let files: string[];
      try {
        files = fs.readdirSync(domainDir).filter((f) => f.endsWith(".json"));
      } catch {
        continue;
      }

      for (const file of files) {
        const page = this.readJson<WikiDomainPage>(path.join(domainDir, file));
        if (!page) continue;

        const domainId = file.replace(".json", "");
        const matchesTarget =
          page.id === pageId || `wiki:${svc.name}:${domainId}` === pageId;

        if (matchesTarget) {
          for (const flow of page.flows ?? []) {
            for (const step of flow.steps ?? []) {
              if (step.sourceRef) sourceRefs.push(step.sourceRef);
            }
          }
          if (page.crossServiceCalls) {
            for (const call of page.crossServiceCalls) {
              pages.push({
                id: `wiki:${call.callee.service}`,
                name: call.callee.service,
                type: "service",
                service: call.callee.service,
                summary: `Called via ${call.type}: ${call.callee.method}`,
              });
            }
          }
        }
      }
    }

    return { pages, sourceRefs };
  }

  invalidateCache(): void {
    this.topology = null;
    this.topologyCachedAt = null;
    this.jsonCache.clear();
    this.searchIndex = null;
    this.searchResultCache.clear();
  }

  private now(): number {
    return Date.now();
  }

  private getFileMtimeMs(filePath: string): number {
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch {
      return 0;
    }
  }

  private isCacheEntryValid(filePath: string, entry: JsonCacheEntry): boolean {
    if (this.now() - entry.cachedAt > this.cacheTtlMs) return false;
    const mtime = this.getFileMtimeMs(filePath);
    return mtime <= entry.fileMtimeMs;
  }

  private evictOldestCacheEntry(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.jsonCache) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) this.jsonCache.delete(oldestKey);
  }

  private setCacheEntry(filePath: string, data: unknown, fileMtimeMs: number): void {
    const now = this.now();
    this.jsonCache.set(filePath, {
      data,
      cachedAt: now,
      lastAccessedAt: now,
      fileMtimeMs,
    });
    while (this.jsonCache.size > this.maxCacheSize) {
      this.evictOldestCacheEntry();
    }
  }

  private setSearchCacheEntry(key: string, results: WikiSearchResult[]): void {
    if (this.searchResultCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, entry] of this.searchResultCache) {
        if (entry.cachedAt < oldestAt) {
          oldestAt = entry.cachedAt;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) this.searchResultCache.delete(oldestKey);
    }
    this.searchResultCache.set(key, { results, cachedAt: this.now() });
  }

  private ensureSearchIndex(): void {
    if (this.searchIndex) return;

    const topo = this.discoverWikis();
    this.searchIndex = new WikiSearchIndex({ entries: [] });

    const extraDocs: Array<{ id: string; name: string; summary: string; content?: string; type: string; service?: string; domain?: string }> = [];

    if (topo.parentWikiDir) {
      const parentIndex = this.readJson<WikiIndex>(path.join(topo.parentWikiDir, "index.json"));
      if (parentIndex?.entries) {
        extraDocs.push(...parentIndex.entries.map((e) => ({
          id: e.id, name: e.name, type: e.type, summary: e.summary,
        })));
      }
    }

    for (const svc of topo.services) {
      const svcIndex = this.readJson<WikiIndex>(path.join(svc.wikiDir, "index.json"));
      if (svcIndex?.entries) {
        extraDocs.push(...svcIndex.entries.map((e) => ({
          id: e.id, name: e.name, type: e.type, service: svc.name, domain: e.domain, summary: e.summary,
        })));
      }

      // Also index domain page content for deeper search
      const domainDir = path.join(svc.wikiDir, "domains");
      if (fs.existsSync(domainDir)) {
        try {
          const files = fs.readdirSync(domainDir).filter((f) => f.endsWith(".json"));
          for (const file of files) {
            const page = this.readJson<WikiDomainPage>(path.join(domainDir, file));
            if (page) {
              const contentParts: string[] = [];
              for (const flow of page.flows ?? []) {
                contentParts.push(flow.name, flow.summary);
                for (const step of flow.steps ?? []) {
                  contentParts.push(step.name, step.description);
                }
              }
              extraDocs.push({
                id: page.id ?? `${svc.name}:${file.replace(".json", "")}`,
                name: page.name,
                type: "domain",
                service: svc.name,
                summary: page.summary,
                content: contentParts.join(" "),
              });
            }
          }
        } catch {
          // skip
        }
      }
    }

    this.searchIndex.addDocs(extraDocs);
  }

  private readJson<T>(filePath: string): T | null {
    try {
      if (!fs.existsSync(filePath)) return null;

      const cached = this.jsonCache.get(filePath);
      if (cached && this.isCacheEntryValid(filePath, cached)) {
        cached.lastAccessedAt = this.now();
        return cached.data as T;
      }

      const fileMtimeMs = this.getFileMtimeMs(filePath);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
      this.setCacheEntry(filePath, data, fileMtimeMs);
      return data;
    } catch {
      return null;
    }
  }
}

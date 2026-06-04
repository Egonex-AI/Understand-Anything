import fs from "fs";
import path from "path";
import Fuse, { type IFuseOptions } from "fuse.js";
import type {
  WikiMeta,
  WikiIndex,
  WikiIndexEntry,
  WikiServiceOverview,
  WikiDomainPage,
  WikiOverview,
  WikiArchitecture,
  WikiCrossDomain,
  WikiSearchResult,
  WikiTopology,
} from "@understand-anything/core";
import { sanitizeSlug } from "./src/utils/sanitize";

interface WikiSearchDocument {
  id: string;
  name: string;
  type: WikiIndexEntry["type"];
  service?: string;
  summary: string;
  content?: string;
}

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

const SEARCH_FUSE_OPTIONS: IFuseOptions<WikiSearchDocument> = {
  keys: [
    { name: "name", weight: 0.35 },
    { name: "summary", weight: 0.35 },
    { name: "content", weight: 0.2 },
    { name: "service", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
};

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
  private searchIndex: Fuse<WikiSearchDocument> | null = null;
  private searchDocs: WikiSearchDocument[] = [];
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
          entries.push({ ...entry, service: entry.service ?? svc.name });
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

  getServices(): Array<{ name: string; meta: WikiMeta; overview: WikiServiceOverview | null }> {
    const topo = this.discoverWikis();
    return topo.services.map((svc) => ({
      name: svc.name,
      meta: svc.meta,
      overview: this.readJson<WikiServiceOverview>(path.join(svc.wikiDir, "service.json")),
    }));
  }

  getServiceWiki(serviceName: string): { index: WikiIndex; overview: WikiServiceOverview } | null {
    const topo = this.discoverWikis();
    const svc = topo.services.find((s) => s.name === serviceName);
    if (!svc) return null;

    const index = this.readJson<WikiIndex>(path.join(svc.wikiDir, "index.json"));
    const overview = this.readJson<WikiServiceOverview>(path.join(svc.wikiDir, "service.json"));
    if (!index || !overview) return null;
    return { index, overview };
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
    const slug = sanitizeSlug(domainId);
    if (!slug) return null;
    const svcSlug = sanitizeSlug(serviceName);
    if (!svcSlug) return null;
    const topo = this.discoverWikis();
    const svc = topo.services.find((s) => s.name === svcSlug);
    if (!svc) return null;
    return this.readJson<WikiDomainPage>(path.join(svc.wikiDir, "domains", `${slug}.json`));
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

    const rawResults = this.searchIndex.search(trimmed);
    const sliced = rawResults.slice(0, limit);

    const results: WikiSearchResult[] = [];
    for (let i = 0; i < sliced.length; i++) {
      if (i > 0 && i % SEARCH_YIELD_CHUNK_SIZE === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const r = sliced[i];
      results.push({
        id: r.item.id,
        name: r.item.name,
        type: r.item.type,
        service: r.item.service,
        summary: r.item.summary,
        score: r.score ?? 0,
        matchSnippet: r.item.summary.slice(0, 120),
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
    this.searchDocs = [];
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
    this.searchDocs = [];

    if (topo.parentWikiDir) {
      const parentIndex = this.readJson<WikiIndex>(path.join(topo.parentWikiDir, "index.json"));
      if (parentIndex?.entries) {
        for (const entry of parentIndex.entries) {
          this.searchDocs.push({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            summary: entry.summary,
          });
        }
      }
    }

    for (const svc of topo.services) {
      const svcIndex = this.readJson<WikiIndex>(path.join(svc.wikiDir, "index.json"));
      if (svcIndex?.entries) {
        for (const entry of svcIndex.entries) {
          this.searchDocs.push({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            service: svc.name,
            summary: entry.summary,
          });
        }
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
              this.searchDocs.push({
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

    this.searchIndex = new Fuse(this.searchDocs, SEARCH_FUSE_OPTIONS);
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

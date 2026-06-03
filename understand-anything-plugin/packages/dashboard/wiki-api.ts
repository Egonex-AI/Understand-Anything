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

interface WikiSearchDocument {
  id: string;
  name: string;
  type: WikiIndexEntry["type"];
  service?: string;
  summary: string;
  content?: string;
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

const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function sanitizeSlug(input: string): string | null {
  const slug = input
    .replace(/^(?:wiki:)?(?:cross-domain|domain):/, "")
    .replace(/\.json$/, "");
  if (!slug || !SAFE_SLUG.test(slug)) return null;
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\") || slug.includes("\0")) {
    return null;
  }
  return slug;
}

export class WikiDataService {
  private projectRoot: string;
  private topology: WikiTopology | null = null;
  private searchIndex: Fuse<WikiSearchDocument> | null = null;
  private searchDocs: WikiSearchDocument[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  discoverWikis(): WikiTopology {
    if (this.topology) return this.topology;

    const parentWikiDir = path.join(this.projectRoot, ".understand-anything", "wiki");
    const hasParentWiki = fs.existsSync(path.join(parentWikiDir, "meta.json"));

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

    this.topology = {
      hasParentWiki,
      parentWikiDir: hasParentWiki ? parentWikiDir : null,
      services,
    };
    return this.topology;
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

  search(query: string, limit = 20): WikiSearchResult[] {
    if (!query.trim()) return [];
    this.ensureSearchIndex();
    if (!this.searchIndex) return [];

    const results = this.searchIndex.search(query.trim());
    return results.slice(0, limit).map((r) => ({
      id: r.item.id,
      name: r.item.name,
      type: r.item.type,
      service: r.item.service,
      summary: r.item.summary,
      score: r.score ?? 0,
      matchSnippet: r.item.summary.slice(0, 120),
    }));
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
    this.searchIndex = null;
    this.searchDocs = [];
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
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
      return null;
    }
  }
}

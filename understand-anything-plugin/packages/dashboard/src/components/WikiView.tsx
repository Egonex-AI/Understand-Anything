import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { useDashboardStore } from "../store";
import {
  serviceOverviewToMarkdown,
  domainPageToMarkdown,
  overviewToMarkdown,
  architectureToMarkdown,
  crossDomainToMarkdown,
} from "../utils/wikiToMarkdown";
import { WikiLinkRenderer, type WikiLinkNavigation } from "./WikiLinkRenderer";
import { WikiSourcePanel } from "./WikiSourcePanel";

function crossDomainSlug(id: string): string {
  return id.replace(/^(?:wiki:)?(?:cross-domain|domain):/, "");
}
import type {
  WikiDomainPage,
  WikiServiceOverview,
  WikiOverview,
  WikiArchitecture,
  WikiCrossDomain,
} from "@understand-anything/core";

type WikiPageType = "service" | "domain" | "overview" | "architecture" | "cross-domain";

interface NavEntry {
  id: string;
  name: string;
  type: WikiPageType;
  service?: string;
  summary: string;
}

function WikiBreadcrumb({
  crumbs,
  onNavigate,
}: {
  crumbs: Array<{ label: string; page: { type: string; id: string; service?: string } | null }>;
  onNavigate: (page: { type: WikiPageType; id: string; service?: string } | null) => void;
}) {
  if (crumbs.length === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] text-text-muted px-4 py-1.5 border-b border-border bg-surface/50">
      {crumbs.map((crumb, idx) => (
        <span key={`${crumb.label}-${idx}`} className="flex items-center gap-1">
          {idx > 0 && <span className="text-text-muted/50">/</span>}
          {crumb.page ? (
            <button
              type="button"
              onClick={() => onNavigate(crumb.page as { type: WikiPageType; id: string; service?: string })}
              className="hover:text-accent transition-colors"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="text-text">{crumb.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function WikiNavTree({
  entries,
  topology,
  activePage,
  viewScope,
  onSelect,
  onScopeChange,
}: {
  entries: NavEntry[];
  topology: { hasParentWiki: boolean; services: Array<{ name: string }> } | null;
  activePage: { type: WikiPageType; id: string; service?: string } | null;
  viewScope: "global" | string;
  onSelect: (page: { type: WikiPageType; id: string; service?: string }) => void;
  onScopeChange: (scope: "global" | string) => void;
}) {
  const isActive = (type: WikiPageType, id: string, service?: string) =>
    activePage?.type === type && activePage?.id === id && activePage?.service === service;

  const parentEntries = entries.filter(
    (e) => !e.service && (e.type === "overview" || e.type === "architecture"),
  );
  const crossDomainEntries = entries.filter((e) => !e.service && e.type === "cross-domain");
  const domainEntries = entries.filter((e) => !e.service && e.type === "domain");

  const services = topology?.services ?? [];
  const serviceEntries = (svcName: string) =>
    entries.filter((e) => e.service === svcName);

  const showGlobalSection = topology?.hasParentWiki && viewScope === "global";
  const showServiceSection = viewScope === "global" || services.length <= 1;

  return (
    <nav className="w-64 min-w-[200px] border-r border-border overflow-y-auto p-3 flex flex-col gap-1">
      {/* Scope switcher */}
      {services.length > 1 && (
        <div className="mb-3">
          <select
            value={viewScope}
            onChange={(e) => onScopeChange(e.target.value)}
            className="w-full px-2 py-1 text-[10px] rounded bg-surface border border-border text-text"
          >
            <option value="global">Global View</option>
            {services.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Global section: Overview + Architecture */}
      {showGlobalSection && parentEntries.length > 0 && (
        <div className="mb-3">
          {parentEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect({ type: entry.type, id: entry.id })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isActive(entry.type, entry.id)
                  ? "bg-accent/20 text-accent"
                  : "hover:bg-surface-hover text-text"
              }`}
            >
              {entry.type === "overview" ? "📖 " : "🏗️ "}
              {entry.name}
            </button>
          ))}
        </div>
      )}

      {/* By Domain section (cross-service domains) */}
      {showGlobalSection && (crossDomainEntries.length > 0 || domainEntries.length > 0) && (
        <div className="mb-3">
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-2">
            By Domain
          </h4>
          {[...crossDomainEntries, ...domainEntries].map((entry) => {
            const navType: WikiPageType = entry.type === "cross-domain" ? "cross-domain" : entry.type;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect({ type: navType, id: entry.id })}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  isActive(navType, entry.id)
                    ? "bg-accent/20 text-accent"
                    : "hover:bg-surface-hover text-text"
                }`}
              >
                🌐 {entry.name}
              </button>
            );
          })}
        </div>
      )}

      {/* By Service section */}
      {showServiceSection && services.length > 0 && (
        <div className="mb-3">
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-2">
            By Service
          </h4>
          {services
            .filter((s) => viewScope === "global" || s.name === viewScope)
            .map((svc) => {
              const svcItems = serviceEntries(svc.name);
              return (
                <div key={svc.name} className="mb-2">
                  <button
                    type="button"
                    onClick={() => onSelect({ type: "service", id: svc.name, service: svc.name })}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      isActive("service", svc.name, svc.name)
                        ? "bg-accent/20 text-accent"
                        : "hover:bg-surface-hover text-text"
                    }`}
                  >
                    📦 {svc.name}
                  </button>
                  {svcItems.length > 0 && (
                    <div className="ml-4 mt-0.5">
                      {svcItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() =>
                            onSelect({ type: "domain", id: item.id, service: svc.name })
                          }
                          className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${
                            isActive("domain", item.id, svc.name)
                              ? "bg-accent/20 text-accent"
                              : "hover:bg-surface-hover text-text-secondary"
                          }`}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Single-service fallback when no topology */}
      {!topology && entries.length > 0 && (
        <div>
          {entries.filter((e) => e.type === "service" || e.type === "overview").map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect({ type: "service", id: entry.id })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isActive("service", entry.id)
                  ? "bg-accent/20 text-accent"
                  : "hover:bg-surface-hover text-text"
              }`}
            >
              {entry.name}
            </button>
          ))}
          {entries.filter((e) => e.type === "domain").map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect({ type: "domain", id: entry.id })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isActive("domain", entry.id)
                  ? "bg-accent/20 text-accent"
                  : "hover:bg-surface-hover text-text"
              }`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

function WikiContent({
  content,
  pageType,
  loading,
  onWikiNavigate,
  onSourceOpen,
}: {
  content: unknown | null;
  pageType: WikiPageType | null;
  loading: boolean;
  onWikiNavigate: (nav: WikiLinkNavigation) => void;
  onSourceOpen: (nav: WikiLinkNavigation) => void;
}) {
  const components = useMemo(
    () => ({
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <WikiLinkRenderer
          {...props}
          onWikiNavigate={onWikiNavigate}
          onSourceOpen={onSourceOpen}
        />
      ),
    }),
    [onWikiNavigate, onSourceOpen],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading...
      </div>
    );
  }

  if (!content || !pageType) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Select a page from the navigation tree.
      </div>
    );
  }

  let markdown = "";
  try {
    switch (pageType) {
      case "overview":
        markdown = overviewToMarkdown(content as WikiOverview);
        break;
      case "architecture":
        markdown = architectureToMarkdown(content as WikiArchitecture);
        break;
      case "cross-domain":
        markdown = crossDomainToMarkdown(content as WikiCrossDomain);
        break;
      case "service":
        markdown = serviceOverviewToMarkdown(content as WikiServiceOverview);
        break;
      case "domain":
        markdown = domainPageToMarkdown(content as WikiDomainPage);
        break;
    }
  } catch (err) {
    console.error(`[wiki] Failed to render ${pageType} page:`, err);
    markdown = `# Render Error\n\nFailed to render this ${pageType} page. The data may be malformed.\n\n\`\`\`\n${err instanceof Error ? err.message : String(err)}\n\`\`\``;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
      <article className="prose prose-sm prose-invert max-w-none wiki-markdown">
        <ReactMarkdown
          urlTransform={(url) =>
            url.startsWith("source://") || url.startsWith("wiki://")
              ? url
              : defaultUrlTransform(url)
          }
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}

export default function WikiView({ accessToken }: { accessToken: string }) {
  const wikiIndex = useDashboardStore((s) => s.wikiIndex);
  const wikiActivePage = useDashboardStore((s) => s.wikiActivePage);
  const wikiPageContent = useDashboardStore((s) => s.wikiPageContent);
  const wikiLoading = useDashboardStore((s) => s.wikiLoading);
  const wikiTopology = useDashboardStore((s) => s.wikiTopology);
  const wikiViewScope = useDashboardStore((s) => s.wikiViewScope);
  const wikiBreadcrumb = useDashboardStore((s) => s.wikiBreadcrumb);
  const setWikiIndex = useDashboardStore((s) => s.setWikiIndex);
  const setWikiActivePage = useDashboardStore((s) => s.setWikiActivePage);
  const setWikiPageContent = useDashboardStore((s) => s.setWikiPageContent);
  const setWikiLoading = useDashboardStore((s) => s.setWikiLoading);
  const setWikiTopology = useDashboardStore((s) => s.setWikiTopology);
  const setWikiViewScope = useDashboardStore((s) => s.setWikiViewScope);
  const setWikiBreadcrumb = useDashboardStore((s) => s.setWikiBreadcrumb);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NavEntry[]>([]);
  const [sourcePanel, setSourcePanel] = useState<{ path: string; lineRange?: [number, number] } | null>(null);

  const apiUrl = useCallback(
    (endpoint: string) => `/api/wiki${endpoint}?token=${encodeURIComponent(accessToken)}`,
    [accessToken],
  );

  // Load global index and topology on mount
  useEffect(() => {
    if (wikiIndex) return;
    fetch(apiUrl(""))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.entries) {
          setWikiIndex(data);
          if (data.topology) setWikiTopology(data.topology);
        }
      })
      .catch(() => {});
  }, [apiUrl, wikiIndex, setWikiIndex, setWikiTopology]);

  // Fetch page content when active page changes
  useEffect(() => {
    if (!wikiActivePage) {
      setWikiPageContent(null);
      return;
    }
    setWikiLoading(true);
    setWikiPageContent(null);
    const controller = new AbortController();

    let endpoint = "";
    switch (wikiActivePage.type) {
      case "overview":
        endpoint = "/overview";
        break;
      case "architecture":
        endpoint = "/architecture";
        break;
      case "cross-domain":
        endpoint = `/domain/${encodeURIComponent(crossDomainSlug(wikiActivePage.id))}`;
        break;
      case "service":
        endpoint = `/service/${encodeURIComponent(wikiActivePage.id)}`;
        break;
      case "domain":
        if (wikiActivePage.service) {
          endpoint = `/service/${encodeURIComponent(wikiActivePage.service)}/domain/${encodeURIComponent(crossDomainSlug(wikiActivePage.id))}`;
        } else {
          endpoint = `/domain/${encodeURIComponent(crossDomainSlug(wikiActivePage.id))}`;
        }
        break;
    }

    fetch(apiUrl(endpoint), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (wikiActivePage.type === "service" && data?.index && data?.overview) {
          setWikiPageContent(data.overview);
        } else {
          setWikiPageContent(data);
        }
        setWikiLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setWikiPageContent(null);
        setWikiLoading(false);
      });

    return () => controller.abort();
  }, [wikiActivePage, apiUrl, setWikiPageContent, setWikiLoading]);

  const handleSelect = useCallback(
    (page: { type: WikiPageType; id: string; service?: string }) => {
      setWikiActivePage(page);
      setWikiPageContent(null);
      setWikiLoading(true);

      // Build breadcrumb
      const crumbs: Array<{ label: string; page: { type: string; id: string; service?: string } | null }> = [];
      if (wikiTopology?.hasParentWiki) {
        crumbs.push({ label: "Wiki", page: null });
      }
      if (page.service) {
        crumbs.push({ label: page.service, page: { type: "service", id: page.service, service: page.service } });
      }
      const entry = wikiIndex?.entries.find((e) => e.id === page.id);
      crumbs.push({ label: entry?.name ?? page.id, page: null });
      setWikiBreadcrumb(crumbs);
    },
    [setWikiActivePage, setWikiPageContent, setWikiLoading, setWikiBreadcrumb, wikiIndex, wikiTopology],
  );

  const handleBreadcrumbNav = useCallback(
    (page: { type: WikiPageType; id: string; service?: string } | null) => {
      if (page) handleSelect(page);
    },
    [handleSelect],
  );

  const handleWikiNavigate = useCallback(
    (nav: WikiLinkNavigation) => {
      if (!nav.service) return;
      const pathParts = nav.path.split("/");
      if (pathParts[0] === "domains" && pathParts[1]) {
        const domainId = pathParts[1].replace(".json", "");
        handleSelect({ type: "domain", id: domainId, service: nav.service });
      } else {
        handleSelect({ type: "service", id: nav.service, service: nav.service });
      }
    },
    [handleSelect],
  );

  const handleSourceOpen = useCallback(
    (nav: WikiLinkNavigation) => {
      setSourcePanel({ path: nav.path, lineRange: nav.lineRange });
    },
    [],
  );

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    fetch(`${apiUrl("/search")}&q=${encodeURIComponent(searchQuery.trim())}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((results) => {
        if (!controller.signal.aborted) setSearchResults(results);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [searchQuery, apiUrl]);

  const displayEntries: NavEntry[] = searchQuery.trim()
    ? searchResults
    : (wikiIndex?.entries ?? []) as NavEntry[];

  if (!wikiIndex) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted text-sm">
        Loading Wiki index...
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-root">
      <WikiBreadcrumb crumbs={wikiBreadcrumb} onNavigate={handleBreadcrumbNav} />
      <div className="flex-1 flex min-h-0">
        <div className="flex flex-col border-r border-border">
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wiki..."
              className="w-full px-2 py-1 text-xs rounded bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <WikiNavTree
            entries={displayEntries}
            topology={wikiTopology}
            activePage={wikiActivePage}
            viewScope={wikiViewScope}
            onSelect={handleSelect}
            onScopeChange={setWikiViewScope}
          />
        </div>
        <WikiContent
          content={wikiPageContent}
          pageType={wikiActivePage?.type ?? null}
          loading={wikiLoading}
          onWikiNavigate={handleWikiNavigate}
          onSourceOpen={handleSourceOpen}
        />
        {sourcePanel && (
          <WikiSourcePanel
            path={sourcePanel.path}
            lineRange={sourcePanel.lineRange}
            accessToken={accessToken}
            onClose={() => setSourcePanel(null)}
          />
        )}
      </div>
    </div>
  );
}

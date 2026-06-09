import { useCallback, useEffect, useMemo, useState, type HTMLAttributes } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { MermaidDiagram } from "./MermaidDiagram";
import { useDashboardStore } from "../store";
import {
  serviceOverviewToMarkdown,
  domainPageToMarkdown,
  overviewToMarkdown,
  architectureToMarkdown,
  crossDomainToMarkdown,
  endpointDocToMarkdown,
  endpointIndexToMarkdown,
} from "../utils/wikiToMarkdown";
import { WikiLinkRenderer, type WikiLinkNavigation } from "./WikiLinkRenderer";
import { WikiSourcePanel } from "./WikiSourcePanel";
import { useI18n } from "../contexts/I18nContext";
import { flowFragmentFromId, isSameWikiPage, isSameWikiTarget, type WikiPageType } from "../utils/wikiFlowNav";

function crossDomainSlug(id: string): string {
  return id.replace(/^(?:wiki:)?(?:cross-domain|domain):/, "");
}
import type {
  WikiDomainPage,
  WikiServiceOverview,
  WikiOverview,
  WikiArchitecture,
  WikiCrossDomain,
  ServiceEndpointDoc,
} from "@understand-anything/core";

interface NavEntry {
  id: string;
  name: string;
  type: WikiPageType | "flow";
  service?: string;
  domain?: string;
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

function ChevronToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onClick(); } }}
      className="w-4 h-4 flex items-center justify-center shrink-0 text-text-muted hover:text-text transition-colors cursor-pointer"
      aria-label={expanded ? "Collapse" : "Expand"}
    >
      <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
    </span>
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
  activePage: { type: WikiPageType; id: string; service?: string; fragment?: string } | null;
  viewScope: "global" | string;
  onSelect: (page: { type: WikiPageType; id: string; service?: string; fragment?: string }) => void;
  onScopeChange: (scope: "global" | string) => void;
}) {
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [globalDomainsExpanded, setGlobalDomainsExpanded] = useState(true);

  const toggleService = useCallback((svcName: string) => {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(svcName)) next.delete(svcName);
      else next.add(svcName);
      return next;
    });
  }, []);

  const toggleDomain = useCallback((domainId: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) next.delete(domainId);
      else next.add(domainId);
      return next;
    });
  }, []);

  const isActive = (type: WikiPageType, id: string, service?: string) =>
    activePage?.type === type && activePage?.id === id && activePage?.service === service;

  const parentEntries = entries.filter(
    (e) => !e.service && (e.type === "overview" || e.type === "architecture"),
  );
  const crossDomainEntries = entries.filter((e) => !e.service && e.type === "cross-domain");
  const domainEntries = entries.filter((e) => !e.service && e.type === "domain");

  const services = topology?.services ?? [];
  const serviceDomainEntries = (svcName: string) =>
    entries.filter((e) => e.service === svcName && e.type === "domain");
  const flowsForDomain = (svcName: string, domainId: string) =>
    entries.filter(
      (e) => e.service === svcName && e.type === "flow" && e.domain === domainId,
    );

  const showGlobalSection = topology?.hasParentWiki && viewScope === "global";
  const showServiceSection = viewScope === "global" || services.length <= 1;

  // Initialize expanded state on first render (all expanded)
  const initializedRef = useState({ current: false })[0];
  if (!initializedRef.current && services.length > 0) {
    initializedRef.current = true;
    const svcSet = new Set(services.map((s) => s.name));
    const domSet = new Set<string>();
    for (const svc of services) {
      for (const e of entries.filter((en) => en.service === svc.name && en.type === "domain")) {
        domSet.add(e.id);
      }
    }
    setExpandedServices(svcSet);
    setExpandedDomains(domSet);
  }

  return (
    <nav className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-1">
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
              onClick={() => onSelect({ type: entry.type as WikiPageType, id: entry.id })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isActive(entry.type as WikiPageType, entry.id)
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
          <button
            type="button"
            onClick={() => setGlobalDomainsExpanded((v) => !v)}
            className="flex items-center gap-1 w-full text-left text-[10px] uppercase tracking-wider text-text-muted mb-1 px-2 hover:text-text transition-colors"
          >
            <span className="w-4 h-4 flex items-center justify-center shrink-0">
              <span className="text-[10px]">{globalDomainsExpanded ? "▼" : "▶"}</span>
            </span>
            By Domain
          </button>
          {globalDomainsExpanded && [...crossDomainEntries, ...domainEntries].map((entry) => {
            const navType = (entry.type === "cross-domain" ? "cross-domain" : entry.type) as WikiPageType;
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

      {/* Global endpoint index */}
      {showGlobalSection && entries.filter((e) => e.type === "endpoint" && !e.service).map((ep) => (
        <button
          key={ep.id}
          type="button"
          onClick={() => onSelect({ type: "endpoint" as WikiPageType, id: ep.id })}
          className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
            activePage?.type === "endpoint" && activePage?.id === ep.id
              ? "bg-accent/10 text-accent font-medium"
              : "hover:bg-surface-hover text-text-muted"
          }`}
        >
          {ep.name}
        </button>
      ))}

      {/* By Service section */}
      {showServiceSection && services.length > 0 && (
        <div className="mb-3">
          <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1 px-2">
            By Service
          </h4>
          {services
            .filter((s) => viewScope === "global" || s.name === viewScope)
            .map((svc) => {
              const domainItems = serviceDomainEntries(svc.name);
              const svcExpanded = expandedServices.has(svc.name);
              return (
                <div key={svc.name} className="mb-1">
                  <div className="flex items-center gap-0.5 group">
                    {domainItems.length > 0 ? (
                      <ChevronToggle expanded={svcExpanded} onClick={() => toggleService(svc.name)} />
                    ) : (
                      <span className="w-4" />
                    )}
                    <button
                      type="button"
                      onClick={() => onSelect({ type: "service", id: svc.name, service: svc.name })}
                      className={`flex-1 text-left px-1 py-1.5 rounded text-xs font-medium transition-colors ${
                        isActive("service", svc.name, svc.name)
                          ? "bg-accent/20 text-accent"
                          : "hover:bg-surface-hover text-text"
                      }`}
                    >
                      📦 {svc.name}
                    </button>
                  </div>
                  {svcExpanded && domainItems.length > 0 && (
                    <div className="ml-4 mt-0.5">
                      {domainItems.map((item) => {
                        const flows = flowsForDomain(svc.name, item.id);
                        const domExpanded = expandedDomains.has(item.id);
                        return (
                          <div key={item.id}>
                            <div className="flex items-center gap-0.5">
                              {flows.length > 0 ? (
                                <ChevronToggle expanded={domExpanded} onClick={() => toggleDomain(item.id)} />
                              ) : (
                                <span className="w-4" />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  onSelect({ type: "domain", id: item.id, service: svc.name })
                                }
                                className={`flex-1 text-left px-1 py-1 rounded text-[11px] transition-colors ${
                                  isActive("domain", item.id, svc.name)
                                    ? "bg-accent/20 text-accent"
                                    : "hover:bg-surface-hover text-text-secondary"
                                }`}
                              >
                                {item.name}
                              </button>
                            </div>
                            {domExpanded && flows.length > 0 && (
                              <div className="ml-5 mt-0.5">
                                {flows.map((flow) => (
                                  <button
                                    key={flow.id}
                                    type="button"
                                    onClick={() =>
                                      onSelect({
                                        type: "domain",
                                        id: item.id,
                                        service: svc.name,
                                        fragment: flowFragmentFromId(flow.id),
                                      })
                                    }
                                    className={`w-full text-left px-2 py-0.5 rounded text-[10px] transition-colors ${
                                      activePage?.fragment === flowFragmentFromId(flow.id)
                                        ? "bg-accent/10 text-accent"
                                        : "hover:bg-surface-hover text-text-muted"
                                    }`}
                                  >
                                    ↳ {flow.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {entries.filter((e) => e.type === "endpoint" && e.service === svc.name).map((ep) => (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => onSelect({ type: "endpoint" as WikiPageType, id: ep.id, service: svc.name })}
                      className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                        activePage?.type === "endpoint" && activePage?.id === ep.id
                          ? "bg-accent/10 text-accent font-medium"
                          : "hover:bg-surface-hover text-text-muted"
                      }`}
                    >
                      {ep.name}
                    </button>
                  ))}
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
  onMermaidNodeClick,
}: {
  content: unknown | null;
  pageType: WikiPageType | null;
  loading: boolean;
  onWikiNavigate: (nav: WikiLinkNavigation) => void;
  onSourceOpen: (nav: WikiLinkNavigation) => void;
  onMermaidNodeClick?: (nodeLabel: string) => void;
}) {
  const { t } = useI18n();
  const wikiLabels = t.wiki;
  const components = useMemo(
    () => ({
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <WikiLinkRenderer
          {...props}
          onWikiNavigate={onWikiNavigate}
          onSourceOpen={onSourceOpen}
        />
      ),
      h1: ({ children, ...rest }: HTMLAttributes<HTMLHeadingElement>) => {
        const text = typeof children === "string" ? children : String(children ?? "");
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return <h1 id={id} {...rest}>{children}</h1>;
      },
      h2: ({ children, ...rest }: HTMLAttributes<HTMLHeadingElement>) => {
        const text = typeof children === "string" ? children : String(children ?? "");
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return <h2 id={id} {...rest}>{children}</h2>;
      },
      h3: ({ children, ...rest }: HTMLAttributes<HTMLHeadingElement>) => {
        const text = typeof children === "string" ? children : String(children ?? "");
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return <h3 id={id} {...rest}>{children}</h3>;
      },
      pre: ({ children, ...rest }: HTMLAttributes<HTMLPreElement>) => {
        const child = Array.isArray(children) ? children[0] : children;
        if (
          child &&
          typeof child === "object" &&
          "props" in child &&
          typeof child.props?.className === "string" &&
          child.props.className.includes("language-mermaid")
        ) {
          const code =
            typeof child.props.children === "string"
              ? child.props.children
              : Array.isArray(child.props.children)
                ? child.props.children.join("")
                : "";
          return <MermaidDiagram content={code} onNodeClick={onMermaidNodeClick} />;
        }
        return <pre {...rest}>{children}</pre>;
      },
    }),
    [onWikiNavigate, onSourceOpen, onMermaidNodeClick],
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
        markdown = overviewToMarkdown(content as WikiOverview, wikiLabels);
        break;
      case "architecture":
        markdown = architectureToMarkdown(content as WikiArchitecture, wikiLabels);
        break;
      case "cross-domain":
        markdown = crossDomainToMarkdown(content as WikiCrossDomain, wikiLabels);
        break;
      case "service":
        markdown = serviceOverviewToMarkdown(content as WikiServiceOverview, wikiLabels);
        break;
      case "domain":
        markdown = domainPageToMarkdown(content as WikiDomainPage, wikiLabels);
        break;
      case "endpoint":
        if ((content as Record<string, unknown>)?.byService) {
          markdown = endpointIndexToMarkdown(content as Record<string, unknown>, wikiLabels);
        } else {
          markdown = endpointDocToMarkdown(content as ServiceEndpointDoc, wikiLabels);
        }
        break;
    }
  } catch (err) {
    console.error(`[wiki] Failed to render ${pageType} page:`, err);
    markdown = `# Render Error\n\nFailed to render this ${pageType} page. The data may be malformed.\n\n\`\`\`\n${err instanceof Error ? err.message : String(err)}\n\`\`\``;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <article className="max-w-4xl mx-auto wiki-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
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

export default function WikiView() {
  const { t } = useI18n();
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
  const [sourcePanel, setSourcePanel] = useState<{ path: string; lineRange?: [number, number]; service?: string } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 900,
  );

  const apiUrl = useCallback(
    (endpoint: string) => `/api/wiki${endpoint}`,
    [],
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

  // Fetch page content when active page changes (type/id/service only, not fragment)
  const fetchPageType = wikiActivePage?.type;
  const fetchPageId = wikiActivePage?.id;
  const fetchPageService = wikiActivePage?.service;
  useEffect(() => {
    if (!fetchPageType || !fetchPageId) {
      setWikiPageContent(null);
      return;
    }
    setWikiLoading(true);
    setWikiPageContent(null);
    const controller = new AbortController();

    let endpoint = "";
    switch (fetchPageType) {
      case "overview":
        endpoint = "/overview";
        break;
      case "architecture":
        endpoint = "/architecture";
        break;
      case "cross-domain":
        endpoint = `/domain/${encodeURIComponent(crossDomainSlug(fetchPageId))}`;
        break;
      case "service":
        endpoint = `/service/${encodeURIComponent(fetchPageId)}`;
        break;
      case "domain":
        if (fetchPageService) {
          endpoint = `/service/${encodeURIComponent(fetchPageService)}/domain/${encodeURIComponent(crossDomainSlug(fetchPageId))}`;
        } else {
          endpoint = `/domain/${encodeURIComponent(crossDomainSlug(fetchPageId))}`;
        }
        break;
      case "endpoint":
        if (fetchPageId === "wiki:endpoints:index") {
          endpoint = "/endpoints/index";
        } else {
          const svcName = fetchPageId.replace(/^wiki:endpoints:/, "");
          endpoint = `/endpoints/${encodeURIComponent(svcName)}`;
        }
        break;
    }

    fetch(apiUrl(endpoint), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (controller.signal.aborted) return;
        if (fetchPageType === "service" && data?.index && data?.overview) {
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
  }, [fetchPageType, fetchPageId, fetchPageService, apiUrl, setWikiPageContent, setWikiLoading]);

  // Scroll to fragment after page content loads
  useEffect(() => {
    const fragment = wikiActivePage?.fragment;
    if (!fragment || wikiLoading || !wikiPageContent) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~500ms at 60fps
    const scroll = () => {
      if (cancelled) return;
      const el = document.getElementById(fragment);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attempts++ < MAX_ATTEMPTS) {
        requestAnimationFrame(scroll);
      } else if (import.meta.env.DEV) {
        console.warn(`[WikiView] Fragment #${fragment} not found after ${MAX_ATTEMPTS} rAF attempts`);
      }
    };

    const rafId = requestAnimationFrame(scroll);
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
  }, [wikiActivePage?.fragment, wikiLoading, wikiPageContent]);

  const handleSelect = useCallback(
    (page: { type: WikiPageType; id: string; service?: string; fragment?: string }) => {
      const isSameTarget = wikiActivePage ? isSameWikiTarget(wikiActivePage, page) : false;

      if (!isSameTarget) {
        const needsFetch = !wikiActivePage || !isSameWikiPage(wikiActivePage, page);

        setWikiActivePage(page);
        if (needsFetch) {
          setWikiPageContent(null);
          setWikiLoading(true);
        }
      } else if (page.fragment) {
        // Same target with same fragment — re-scroll (user may have scrolled away)
        const el = document.getElementById(page.fragment);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }

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
    [setWikiActivePage, setWikiPageContent, setWikiLoading, setWikiBreadcrumb, wikiIndex, wikiTopology, wikiActivePage],
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
      if (pathParts[0] === "endpoints") {
        handleSelect({ type: "endpoint" as WikiPageType, id: `wiki:endpoints:${nav.service}`, service: nav.service });
      } else if (pathParts[0] === "domains" && pathParts[1]) {
        const domainId = pathParts[1].replace(".json", "");
        handleSelect({ type: "domain", id: domainId, service: nav.service, fragment: nav.fragment });
      } else {
        handleSelect({ type: "service", id: nav.service, service: nav.service });
      }
    },
    [handleSelect],
  );

  const handleSourceOpen = useCallback(
    (nav: WikiLinkNavigation) => {
      setSourcePanel({ path: nav.path, lineRange: nav.lineRange, service: wikiActivePage?.service });
    },
    [wikiActivePage?.service],
  );

  const handleMermaidNodeClick = useCallback(
    (label: string) => {
      const services = wikiTopology?.services ?? [];
      const sanitize = (s: string) => s.replace(/["\[\](){}|<>#&]/g, " ").trim();
      const match = services.find((s) => s.name === label || sanitize(s.name) === label);
      if (match) {
        handleSelect({ type: "service", id: match.name, service: match.name });
      }
    },
    [handleSelect, wikiTopology],
  );

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    fetch(`${apiUrl("/search")}?q=${encodeURIComponent(searchQuery.trim())}`, {
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
        <div
          id="wiki-sidebar"
          className={`flex flex-col border-r border-border transition-[width] duration-200 shrink-0 ${
            sidebarCollapsed ? "w-0 overflow-hidden" : "w-60"
          }`}
          {...(sidebarCollapsed ? { inert: true } : {})}
        >
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
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex items-center px-2 py-1 border-b border-border bg-surface/30 shrink-0">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-elevated text-text-muted hover:text-text transition-colors text-xs"
              aria-label={sidebarCollapsed ? t.wiki.showSidebar : t.wiki.hideSidebar}
              aria-expanded={!sidebarCollapsed}
              aria-controls="wiki-sidebar"
            >
              {sidebarCollapsed ? "▶" : "◀"}
            </button>
          </div>
          <div className={`min-h-0 overflow-auto ${sourcePanel ? "h-[50%]" : "flex-1"}`}>
            <WikiContent
              content={wikiPageContent}
              pageType={wikiActivePage?.type ?? null}
              loading={wikiLoading}
              onWikiNavigate={handleWikiNavigate}
              onSourceOpen={handleSourceOpen}
              onMermaidNodeClick={
                wikiActivePage?.type === "architecture" || wikiActivePage?.type === "overview"
                  ? handleMermaidNodeClick
                  : undefined
              }
            />
          </div>
          {sourcePanel && (
            <div className="h-[50%] border-t border-border flex flex-col animate-slide-up">
              <WikiSourcePanel
                path={sourcePanel.path}
                lineRange={sourcePanel.lineRange}
                service={sourcePanel.service}
                onClose={() => setSourcePanel(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

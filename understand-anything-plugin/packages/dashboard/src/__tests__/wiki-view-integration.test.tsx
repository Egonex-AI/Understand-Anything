import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WikiView from "../components/WikiView";
import { useDashboardStore } from "../store";
import { I18nProvider } from "../contexts/I18nContext";

const ACCESS_TOKEN = "test-token";

const mockGlobalIndex = {
  entries: [
    { id: "wiki:overview", name: "System Overview", type: "overview", summary: "Top-level system overview" },
    { id: "wiki:architecture", name: "Architecture", type: "architecture", summary: "System architecture map" },
    {
      id: "wiki:cross-domain:order-mgmt",
      name: "Order Management (E2E)",
      type: "cross-domain",
      summary: "Cross-service order management flow",
    },
    {
      id: "wiki:order-service:service",
      name: "order-service",
      type: "service",
      service: "order-service",
      summary: "Order microservice",
    },
    {
      id: "domain:order-mgmt",
      name: "Order Mgmt",
      type: "domain",
      service: "order-service",
      summary: "Order domain within order-service",
    },
    {
      id: "wiki:payment-service:service",
      name: "payment-service",
      type: "service",
      service: "payment-service",
      summary: "Payment microservice",
    },
  ],
  topology: {
    hasParentWiki: true,
    services: [{ name: "order-service" }, { name: "payment-service" }],
  },
};

const mockOverview = {
  name: "Acme Commerce Platform",
  description: "Multi-service e-commerce platform for orders and payments.",
  services: [
    { name: "order-service", description: "Handles orders", domains: ["order-mgmt"] },
    { name: "payment-service", description: "Handles payments", domains: ["billing"] },
  ],
  techStack: ["Java", "Spring Boot", "Kafka"],
};

const mockCrossDomainOrderMgmt = {
  id: "cross-domain:order-mgmt",
  name: "Order Management (E2E)",
  summary: "End-to-end order lifecycle spanning order and payment services.",
  services: ["order-service", "payment-service"],
  steps: [
    { order: 1, service: "order-service", description: "Receives and validates the order request" },
    { order: 2, service: "payment-service", description: "Authorizes payment for the order" },
  ],
};

const mockServiceDomainWithSourceLink = {
  id: "domain:order-mgmt",
  name: "Order Management",
  summary: "Service-local order management domain.",
  entities: ["Order", "OrderLine"],
  flows: [
    {
      id: "flow:create",
      name: "Create Order",
      summary: "Creates a new order record.",
      steps: [
        {
          order: 1,
          name: "Persist order",
          description: "Saves the order to the database.",
          sourceRef: { file: "src/OrderService.java", lineRange: [10, 20] as [number, number] },
        },
      ],
    },
  ],
};

const mockSearchResults = [
  {
    id: "wiki:cross-domain:order-mgmt",
    name: "Order Management (E2E)",
    type: "cross-domain",
    summary: "Cross-service order management flow",
    score: 0.12,
    matchSnippet: "Cross-service order management flow",
  },
];

const mockServiceWiki = {
  index: {
    entries: mockGlobalIndex.entries.filter((e) => e.service === "order-service"),
  },
  overview: {
    name: "order-service",
    description: "Order microservice overview.",
    techStack: ["Java 17"],
    modules: ["order-api"],
    entryPoints: ["OrderController"],
  },
};

const mockSourceResponse = {
  file: "src/OrderService.java",
  content: "public class OrderService {\n  public void create() {}\n}\n",
  startLine: 10,
  endLine: 20,
  language: "java",
};

function resetWikiStore() {
  useDashboardStore.setState({
    wikiIndex: null,
    wikiActivePage: null,
    wikiPageContent: null,
    wikiLoading: false,
    wikiTopology: null,
    wikiViewScope: "global",
    wikiBreadcrumb: [],
  });
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function createWikiFetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    const url = new URL(raw, "http://localhost");
    const { pathname } = url;

    if (pathname === "/api/wiki") {
      return jsonResponse(mockGlobalIndex);
    }
    if (pathname === "/api/wiki/overview") {
      return jsonResponse(mockOverview);
    }
    if (pathname === "/api/wiki/domain/order-mgmt") {
      return jsonResponse(mockCrossDomainOrderMgmt);
    }
    if (pathname === "/api/wiki/service/order-service/domain/order-mgmt") {
      return jsonResponse(mockServiceDomainWithSourceLink);
    }
    if (pathname === "/api/wiki/service/order-service") {
      return jsonResponse(mockServiceWiki);
    }
    if (pathname === "/api/wiki/search") {
      const q = url.searchParams.get("q") ?? "";
      if (q.toLowerCase().includes("order")) {
        return jsonResponse(mockSearchResults);
      }
      return jsonResponse([]);
    }
    if (pathname === "/api/wiki/source") {
      return jsonResponse(mockSourceResponse);
    }

    return jsonResponse({ error: "not found" }, false);
  });
}

async function renderWikiView() {
  const user = userEvent.setup();
  render(
    <I18nProvider language="en">
      <WikiView accessToken={ACCESS_TOKEN} />
    </I18nProvider>,
  );
  await waitFor(() => {
    expect(screen.queryByText("Loading Wiki index...")).not.toBeInTheDocument();
  });
  return { user };
}

describe("WikiView integration", () => {
  beforeEach(() => {
    resetWikiStore();
    vi.stubGlobal("fetch", createWikiFetchMock());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function getWikiNav() {
    return screen.getByRole("navigation");
  }

  it("loads and displays wiki overview", async () => {
    const { user } = await renderWikiView();

    await user.click(within(getWikiNav()).getByRole("button", { name: /System Overview/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Acme Commerce Platform" })).toBeInTheDocument();
    });
    const article = screen.getByRole("article");
    expect(within(article).getByText(/Multi-service e-commerce platform/)).toBeInTheDocument();
    expect(within(article).getAllByText(/order-service/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders navigation tree with By Domain and By Service sections", async () => {
    await renderWikiView();
    const nav = getWikiNav();

    expect(within(nav).getByText("By Domain")).toBeInTheDocument();
    expect(within(nav).getByText("By Service")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Order Management \(E2E\)/i })).toBeInTheDocument();
    expect(within(nav).getAllByRole("button", { name: /order-service/i }).length).toBeGreaterThanOrEqual(1);
    expect(within(nav).getAllByRole("button", { name: /payment-service/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("navigates to a cross-domain page and updates breadcrumb", async () => {
    const { user } = await renderWikiView();

    await user.click(within(getWikiNav()).getByRole("button", { name: /Order Management \(E2E\)/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Order Management (E2E)" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/End-to-end order lifecycle spanning order and payment services/),
    ).toBeInTheDocument();

    const breadcrumb = screen.getByText("Wiki").closest("div");
    expect(breadcrumb).toBeTruthy();
    expect(within(breadcrumb!).getByText("Order Management (E2E)")).toBeInTheDocument();
  });

  it("searches wiki entries and navigates from a result", async () => {
    const { user } = await renderWikiView();

    const searchInput = screen.getByPlaceholderText("Search wiki...");
    await user.type(searchInput, "order");

    await waitFor(() => {
      expect(within(getWikiNav()).getByRole("button", { name: /Order Management \(E2E\)/i })).toBeInTheDocument();
    });

    await user.click(within(getWikiNav()).getByRole("button", { name: /Order Management \(E2E\)/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/End-to-end order lifecycle spanning order and payment services/),
      ).toBeInTheDocument();
    });
  });

  it("switches view scope between global and a service", async () => {
    const { user } = await renderWikiView();

    const nav = getWikiNav();
    const scopeSelect = within(nav).getByRole("combobox");
    expect(scopeSelect).toHaveValue("global");
    expect(within(nav).getByText("By Domain")).toBeInTheDocument();

    await user.selectOptions(scopeSelect, "order-service");

    expect(scopeSelect).toHaveValue("order-service");
    expect(within(nav).queryByText("By Domain")).not.toBeInTheDocument();

    await user.selectOptions(scopeSelect, "global");
    expect(scopeSelect).toHaveValue("global");
    expect(within(nav).getByText("By Domain")).toBeInTheDocument();
    expect(within(nav).getByText("By Service")).toBeInTheDocument();
  });

  it("navigates back via breadcrumb", async () => {
    const { user } = await renderWikiView();

    await user.click(within(getWikiNav()).getByRole("button", { name: /^Order Mgmt$/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Order Management" })).toBeInTheDocument();
    });

    const breadcrumbBar = screen.getByText("Wiki").closest("div")!;
    await user.click(within(breadcrumbBar).getByRole("button", { name: "order-service" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "order-service" })).toBeInTheDocument();
    });
    expect(screen.getByText(/Order microservice overview/)).toBeInTheDocument();
  });

  it("opens source panel when clicking a source:// link", async () => {
    const { user } = await renderWikiView();

    await user.click(within(getWikiNav()).getByRole("button", { name: /^Order Mgmt$/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Order Management" })).toBeInTheDocument();
    });

    const sourceLink = await screen.findByRole("link", {
      name: /src\/OrderService\.java:10-20/i,
    });
    await user.click(sourceLink);

    const closeButton = await screen.findByLabelText("Close source panel");
    const sourcePanel = closeButton.closest(".border-t") as HTMLElement;
    expect(within(sourcePanel).getByText(/src\/OrderService\.java:10-20/)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/wiki/source"),
        expect.any(Object),
      );
    });
  });
});

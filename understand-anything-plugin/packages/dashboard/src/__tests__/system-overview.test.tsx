import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SystemGraph } from "@understand-anything/core";
import SystemOverview from "../components/SystemOverview";
import { useDashboardStore } from "../store";
import { I18nProvider } from "../contexts/I18nContext";
import { ThemeProvider } from "../themes/index.ts";

// Mock hooks from @xyflow/react — jsdom lacks the DOM APIs these hooks need
// (SVG measurement, ResizeObserver, etc.). Non-hook exports (ReactFlow,
// Handle, Position, etc.) come from the real module via importOriginal.
// The vitest-react-aliases.ts @xyflow/react alias ensures the real module
// uses the same React instance as the test, avoiding "Invalid hook call".
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useNodesState: (init: import("@xyflow/react").Node[]) => [init, () => {}, () => {}],
    useEdgesState: (init: import("@xyflow/react").Edge[]) => [init, () => {}, () => {}],
  };
});

const mockSystemGraph: SystemGraph = {
  version: "1.0.0",
  generatedAt: "2026-06-04T12:00:00Z",
  project: {
    name: "Test System",
    serviceCount: 2,
    totalNodes: 500,
    totalEdges: 800,
  },
  nodes: [
    {
      id: "microservice:order-service",
      type: "microservice",
      name: "Order Service",
      summary: "Handles orders",
      languages: ["Java"],
      frameworks: ["Spring Boot"],
      stats: { nodes: 300, edges: 500, files: 40 },
      kgPath: "order-service/.understand-anything/knowledge-graph.json",
    },
    {
      id: "microservice:payment-service",
      type: "microservice",
      name: "Payment Service",
      summary: "Handles payments",
      languages: ["Java"],
      frameworks: ["Spring Boot"],
      stats: { nodes: 200, edges: 300, files: 25 },
      kgPath: "payment-service/.understand-anything/knowledge-graph.json",
    },
  ],
  edges: [
    {
      source: "microservice:order-service",
      target: "microservice:payment-service",
      type: "rpc_call",
      weight: 0.8,
      detail: { interface: "PaymentFacade", method: "createPayment()", rpcType: "moa" },
    },
  ],
  serviceIndex: {
    "order-service": { hasKg: true, hasWiki: true, hasDomain: false },
    "payment-service": { hasKg: true, hasWiki: false, hasDomain: false },
  },
};

function renderSystemOverview() {
  return render(
    <ThemeProvider>
      <I18nProvider language="en">
        <SystemOverview />
      </I18nProvider>
    </ThemeProvider>,
  );
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("SystemOverview", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    useDashboardStore.setState({ systemGraph: mockSystemGraph });
  });

  afterEach(() => {
    cleanup();
    useDashboardStore.setState({ systemGraph: null });
  });

  it("renders system name and service count when systemGraph is set", () => {
    renderSystemOverview();
    expect(screen.getByText("Test System")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("renders service list in sidebar", () => {
    renderSystemOverview();
    expect(screen.getAllByText("Order Service").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Payment Service").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no system graph", () => {
    useDashboardStore.setState({ systemGraph: null });
    renderSystemOverview();
    expect(screen.getByText(/no system graph/i)).toBeInTheDocument();
  });
});

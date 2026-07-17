import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDashboardFreshnessReport,
  requestFreshnessReport,
  shouldRequestFreshness,
  startFreshnessRefresh,
  type DashboardFreshnessReport,
} from "../freshness";

const freshReport: DashboardFreshnessReport = {
  graphs: {
    knowledge: {
      status: "fresh",
      graphCommitHash: "a".repeat(40),
      headCommitHash: "a".repeat(40),
      changedFileCount: 0,
      changedFiles: [],
      commitsBehind: 0,
      commitsAhead: 0,
    },
  },
};

const staleReport: DashboardFreshnessReport = {
  graphs: {
    knowledge: {
      status: "stale",
      relation: "behind",
      graphCommitHash: "a".repeat(40),
      headCommitHash: "b".repeat(40),
      changedFileCount: 1,
      changedFiles: ["src/index.ts"],
      commitsBehind: 1,
      commitsAhead: 0,
    },
  },
};

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isDashboardFreshnessReport", () => {
  it("accepts complete fresh, dirty, stale, and unknown graph results", () => {
    expect(isDashboardFreshnessReport(freshReport)).toBe(true);
    expect(
      isDashboardFreshnessReport({
        graphs: {
          knowledge: {
            status: "dirty",
            graphCommitHash: "a".repeat(40),
            headCommitHash: "a".repeat(40),
            changedFileCount: 1,
            changedFiles: ["src/dirty.ts"],
            commitsBehind: 0,
            commitsAhead: 0,
          },
          domain: staleReport.graphs.knowledge,
        },
      }),
    ).toBe(true);
    expect(
      isDashboardFreshnessReport({
        graphs: {
          knowledge: {
            status: "unknown",
            reason: "git-command-timeout",
            graphCommitHash: "a".repeat(40),
          },
        },
      }),
    ).toBe(true);
  });

  it.each([
    { graphs: { knowledge: { status: "fresh" } } },
    { graphs: { knowledge: { status: "stale" } } },
    { graphs: { knowledge: { status: "dirty" } } },
    { graphs: { knowledge: { status: "unknown" } } },
    { graphs: {} },
    { graphs: { knowledge: freshReport.graphs.knowledge, domain: null } },
    {
      graphs: {
        knowledge: {
          ...freshReport.graphs.knowledge,
          changedFileCount: 1,
        },
      },
    },
    {
      graphs: {
        knowledge: {
          ...staleReport.graphs.knowledge,
          relation: "sideways",
        },
      },
    },
    {
      graphs: {
        knowledge: {
          ...staleReport.graphs.knowledge,
          changedFiles: [42],
        },
      },
    },
    {
      graphs: {
        knowledge: {
          status: "unknown",
          reason: "unexpected-reason",
        },
      },
    },
  ])("rejects malformed payload %#", (payload) => {
    expect(isDashboardFreshnessReport(payload)).toBe(false);
  });
});

describe("requestFreshnessReport", () => {
  it("returns only a fully validated response", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => freshReport,
    })) as unknown as typeof fetch;

    await expect(
      requestFreshnessReport("/staleness.json", signal, fetcher),
    ).resolves.toEqual(freshReport);
    expect(fetcher).toHaveBeenCalledWith("/staleness.json", {
      signal,
      cache: "no-store",
    });
  });

  it.each([
    { ok: false, json: async () => freshReport },
    { ok: true, json: async () => ({ graphs: { knowledge: { status: "fresh" } } }) },
  ])("rejects an unusable endpoint response %#", async (response) => {
    const fetcher = vi.fn(async () => response) as unknown as typeof fetch;

    await expect(
      requestFreshnessReport("/staleness.json", new AbortController().signal, fetcher),
    ).rejects.toThrow();
  });
});

describe("shouldRequestFreshness", () => {
  it("checks local dashboards and demos with an explicit freshness URL", () => {
    expect(shouldRequestFreshness(false, undefined)).toBe(true);
    expect(
      shouldRequestFreshness(true, "https://example.test/staleness.json"),
    ).toBe(true);
  });

  it("skips static demos that cannot verify a live Git checkout", () => {
    expect(shouldRequestFreshness(true, undefined)).toBe(false);
    expect(shouldRequestFreshness(true, "")).toBe(false);
  });
});

describe("startFreshnessRefresh", () => {
  it("loads initially and only reloads when the target receives focus", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const load = vi.fn(async () => freshReport);
    const onResult = vi.fn();

    const stop = startFreshnessRefresh({ target, load, onResult });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith(freshReport);

    stop();
    vi.useRealTimers();
  });

  it("aborts an in-flight request before replacing it on focus", async () => {
    const target = new EventTarget();
    const pending: Array<{
      signal: AbortSignal;
      resolve: (report: DashboardFreshnessReport) => void;
    }> = [];
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<DashboardFreshnessReport>((resolve) => {
          pending.push({ signal, resolve });
        }),
    );
    const onResult = vi.fn();

    const stop = startFreshnessRefresh({ target, load, onResult });
    expect(pending).toHaveLength(1);
    target.dispatchEvent(new Event("focus"));
    expect(pending).toHaveLength(2);
    expect(pending[0].signal.aborted).toBe(true);

    pending[0].resolve(staleReport);
    pending[1].resolve(freshReport);
    await flushPromises();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(freshReport);

    stop();
  });

  it("replaces stale and fresh states after successive focus events", async () => {
    const target = new EventTarget();
    const load = vi
      .fn<(signal: AbortSignal) => Promise<DashboardFreshnessReport>>()
      .mockResolvedValueOnce(staleReport)
      .mockResolvedValueOnce(freshReport)
      .mockResolvedValueOnce(staleReport);
    const onResult = vi.fn();

    const stop = startFreshnessRefresh({ target, load, onResult });
    await flushPromises();
    expect(onResult).toHaveBeenLastCalledWith(staleReport);

    target.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(onResult).toHaveBeenLastCalledWith(freshReport);

    target.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(onResult).toHaveBeenLastCalledWith(staleReport);
    expect(onResult).toHaveBeenCalledTimes(3);

    stop();
  });

  it("publishes an explicit unknown result when loading fails", async () => {
    const onResult = vi.fn();

    const stop = startFreshnessRefresh({
      target: new EventTarget(),
      load: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      onResult,
    });
    await flushPromises();

    expect(onResult).toHaveBeenCalledWith({
      graphs: {
        knowledge: {
          status: "unknown",
          reason: "freshness-request-failed",
        },
      },
    });
    stop();
  });

  it("removes the focus listener and aborts on cleanup", async () => {
    const target = new EventTarget();
    let initialSignal: AbortSignal | undefined;
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<DashboardFreshnessReport>(() => {
          initialSignal = signal;
        }),
    );

    const stop = startFreshnessRefresh({
      target,
      load,
      onResult: vi.fn(),
    });
    stop();

    expect(initialSignal?.aborted).toBe(true);
    target.dispatchEvent(new Event("focus"));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch, subscribeAuthRejected } from "../utils/authFetch";

const ORIGIN = "http://127.0.0.1:5173";
const TOKEN = "a".repeat(64);

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

  vi.stubGlobal("window", {
    location: { origin: ORIGIN },
    dispatchEvent: vi.fn(),
  });

  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authFetch security", () => {
  it("sends credentials through the Authorization header", async () => {
    await authFetch("/knowledge-graph.json", TOKEN);

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe(`${ORIGIN}/knowledge-graph.json`);
    expect(options.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
  });

  it.each([
    "https://example.test/data",
    "//example.test/data",
    "http://127.0.0.1:9999/data",
    "http://localhost:5173/data",
    "https://127.0.0.1:5173/data",
  ])("rejects cross-origin requests: %s", async (url) => {
    await expect(authFetch(url, TOKEN)).rejects.toThrow(
      "same-origin",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces defensive fetch options", async () => {
    await authFetch("/meta.json", TOKEN, {
      credentials: "include",
      redirect: "follow",
      cache: "force-cache",
      referrerPolicy: "unsafe-url",
    });

    const [, options] = fetchMock.mock.calls[0];

    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    expect(options.referrerPolicy).toBe("no-referrer");
  });

  it("preserves custom headers and cancellation signals", async () => {
    const controller = new AbortController();

    await authFetch("/staleness.json", TOKEN, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const [, options] = fetchMock.mock.calls[0];

    expect(options.headers.get("Accept")).toBe("application/json");
    expect(options.signal).toBe(controller.signal);
  });

  it("replaces caller-supplied authorization credentials", async () => {
    await authFetch("/meta.json", TOKEN, {
      headers: { Authorization: "Bearer unexpected" },
    });

    const [, options] = fetchMock.mock.calls[0];

    expect(options.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("supports same-origin URL objects", async () => {
    await authFetch(new URL(`${ORIGIN}/meta.json`), TOKEN);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin Request objects", async () => {
    const request = new Request("https://example.test/data");

    await expect(authFetch(request, TOKEN)).rejects.toThrow(
      "same-origin",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe("authentication session recovery", () => {
  function rejectedResponse() {
    return new Response(null, {
      status: 403,
      headers: {
        "X-UA-Auth-Status": "invalid-token",
      },
    });
  }

  it("notifies subscribers when credentials are rejected", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthRejected(TOKEN, listener);

    try {
      fetchMock.mockResolvedValue(rejectedResponse());
      await authFetch("/meta.json", TOKEN);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith();
    } finally {
      unsubscribe();
    }
  });

  it("ignores generic forbidden responses", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthRejected(TOKEN, listener);

    try {
      fetchMock.mockResolvedValue(
        new Response(null, { status: 403 }),
      );

      await authFetch("/meta.json", TOKEN);

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("isolates rejection notifications between tokens", async () => {
    const previous = vi.fn();
    const current = vi.fn();
    const currentToken = "b".repeat(64);

    const unsubscribePrevious =
      subscribeAuthRejected(TOKEN, previous);

    const unsubscribeCurrent =
      subscribeAuthRejected(currentToken, current);

    try {
      fetchMock.mockResolvedValue(rejectedResponse());

      await authFetch("/meta.json", TOKEN);

      expect(previous).toHaveBeenCalledOnce();
      expect(current).not.toHaveBeenCalled();
    } finally {
      unsubscribePrevious();
      unsubscribeCurrent();
    }
  });

  it("does not notify removed subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthRejected(TOKEN, listener);

    unsubscribe();

    fetchMock.mockResolvedValue(rejectedResponse());
    await authFetch("/meta.json", TOKEN);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not invalidate sessions on server errors", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthRejected(TOKEN, listener);

    try {
      fetchMock.mockResolvedValue(
        new Response(null, { status: 500 }),
      );

      await authFetch("/meta.json", TOKEN);

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

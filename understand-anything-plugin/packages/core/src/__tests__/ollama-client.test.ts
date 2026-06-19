import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OllamaClient,
  OllamaConnectionError,
  OllamaModelMissingError,
  OllamaResponseError,
  OllamaTimeoutError,
} from "../ollama-client.js";

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Wrap a per-call response with a recorder so every fetch (mocked or default)
 * is captured into `calls`. Tests then build their per-call responses with
 * `recording(...)` so the call args land in `calls` regardless of how many
 * `mockImplementationOnce` responses they queue.
 */
function recording(
  calls: FetchCall[],
  response: Response | Promise<Response>,
  index?: number,
): (url: string, init: RequestInit) => Promise<Response> {
  return (url: string, init: RequestInit) => {
    if (index === undefined || calls.length === index) {
      calls.push({ url, init });
    }
    return Promise.resolve(response);
  };
}

describe("OllamaClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    fetchMock = vi.fn();
  });

  describe("isHealthy", () => {
    it("returns ok with version on 200", async () => {
      fetchMock.mockImplementationOnce(
        recording(calls, makeJsonResponse({ version: "0.5.7" })),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const result = await client.isHealthy();
      expect(result.ok).toBe(true);
      expect(result.version).toBe("0.5.7");
    });

    it("returns not-ok without throwing on connection refused", async () => {
      fetchMock.mockImplementationOnce((_url: string, _init: RequestInit) =>
        Promise.reject(new TypeError("fetch failed")),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const result = await client.isHealthy();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/fetch failed/);
    });
  });

  describe("chat", () => {
    it("sends a chat request with the expected shape", async () => {
      fetchMock.mockImplementationOnce(
        recording(
          calls,
          makeJsonResponse({
            model: "qwen2.5-coder:7b",
            message: { role: "assistant", content: "hello" },
            done: true,
          }),
          0,
        ),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const out = await client.chat({
        messages: [
          { role: "system", content: "You are a code analyzer." },
          { role: "user", content: "Summarize foo.ts" },
        ],
      });
      expect(out.content).toBe("hello");
      expect(out.model).toBe("qwen2.5-coder:7b");
      expect(calls[0].url).toBe("http://localhost:11434/api/chat");
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.model).toBe("qwen2.5-coder:7b");
      expect(body.messages).toHaveLength(2);
      expect(body.stream).toBe(false);
    });

    it("passes format:'json' through to the request body", async () => {
      fetchMock.mockImplementationOnce(
        recording(
          calls,
          makeJsonResponse({
            message: { role: "assistant", content: "{}" },
            done: true,
          }),
          0,
        ),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await client.chat({
        messages: [{ role: "user", content: "x" }],
        format: "json",
      });
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.format).toBe("json");
    });

    it("retries on 5xx and eventually throws OllamaResponseError", async () => {
      fetchMock
        .mockImplementationOnce(() =>
          Promise.resolve(new Response("upstream gone", { status: 503 })),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response("upstream gone", { status: 503 })),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response("upstream gone", { status: 503 })),
        );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        retries: 2,
        retryBackoffMs: 1,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await expect(
        client.chat({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeInstanceOf(OllamaResponseError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry on 4xx (model missing)", async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(new Response("not found", { status: 404 })),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        retries: 2,
        retryBackoffMs: 1,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await expect(
        client.chat({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeInstanceOf(OllamaModelMissingError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws OllamaTimeoutError when the request times out", async () => {
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit = {}) => {
          const { promise, reject } = Promise.withResolvers<Response>();
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          return promise;
        },
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        timeoutMs: 10,
        retries: 0,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await expect(
        client.chat({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toBeInstanceOf(OllamaTimeoutError);
    });

    it("honors caller-supplied AbortSignal", async () => {
      const controller = new AbortController();
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit = {}) => {
          const { promise, reject } = Promise.withResolvers<Response>();
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          return promise;
        },
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        signal: controller.signal,
        retries: 0,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const promise = client.chat({ messages: [{ role: "user", content: "x" }] });
      controller.abort();
      await expect(promise).rejects.toBeInstanceOf(OllamaTimeoutError);
    });
  });

  describe("generate", () => {
    it("sends a generate request with stream:false", async () => {
      fetchMock.mockImplementationOnce(
        recording(calls, makeJsonResponse({ response: "ok", done: true }), 0),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const out = await client.generate("Summarize this repo");
      expect(out.content).toBe("ok");
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.prompt).toBe("Summarize this repo");
      expect(body.stream).toBe(false);
    });
  });

  describe("listModels", () => {
    it("returns the list of model names", async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          makeJsonResponse({
            models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3.1:8b" }],
          }),
        ),
      );
      const client = new OllamaClient({
        baseUrl: "http://localhost:11434",
        model: "qwen2.5-coder:7b",
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      const names = await client.listModels();
      expect(names).toEqual(["qwen2.5-coder:7b", "llama3.1:8b"]);
    });
  });
});

void OllamaConnectionError;

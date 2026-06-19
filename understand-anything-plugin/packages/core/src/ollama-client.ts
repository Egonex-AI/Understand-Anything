/**
 * Ollama HTTP client.
 *
 * Thin wrapper around the Ollama REST API used to drive the Understand
 * Anything pipeline against a locally-running Ollama server. Provides chat
 * and generate helpers, exponential-backoff retries on 5xx, AbortSignal-aware
 * timeouts, and a soft `isHealthy` check for pre-flight use.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_NUM_CTX = 8192;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_NUM_PREDICT = 1024;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 500;

export interface OllamaClientOptions {
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
  numCtx?: number;
  temperature?: number;
  numPredict?: number;
  retries?: number;
  retryBackoffMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: Error;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  format?: "json" | Record<string, unknown>;
  options?: Partial<OllamaClientOptions>;
}

export interface ChatResponse {
  content: string;
  model: string;
  promptEvalCount?: number;
  evalCount?: number;
  totalDurationNs?: number;
}

export interface GenerateOptions {
  format?: "json" | object;
}

export interface HealthResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface OllamaChatPayload {
  model: string;
  messages: ChatMessage[];
  stream: false;
  options: {
    num_ctx: number;
    temperature: number;
    num_predict: number;
  };
  format?: "json" | Record<string, unknown>;
}

export interface OllamaGeneratePayload {
  model: string;
  prompt: string;
  stream: false;
  options: {
    num_ctx: number;
    temperature: number;
    num_predict: number;
  };
  format?: "json" | object;
}

export interface OllamaChatResponseBody {
  model: string;
  message?: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

export interface OllamaGenerateResponseBody {
  model: string;
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

export interface OllamaTagsResponseBody {
  models?: Array<{ name: string }>;
}

export interface OllamaVersionResponseBody {
  version?: string;
}

export class OllamaConnectionError extends Error {
  constructor(public readonly baseUrl: string, cause: unknown) {
    super(`Ollama not reachable at ${baseUrl}: ${(cause as Error).message ?? cause}`);
    this.name = "OllamaConnectionError";
  }
}

export class OllamaModelMissingError extends Error {
  constructor(public readonly model: string) {
    super(`Ollama model not found: ${model}. Run: ollama pull ${model}`);
    this.name = "OllamaModelMissingError";
  }
}

export class OllamaResponseError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Ollama returned HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "OllamaResponseError";
  }
}

export class OllamaTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Ollama request timed out after ${timeoutMs}ms`);
    this.name = "OllamaTimeoutError";
  }
}

export interface OllamaClientInternals {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  numCtx: number;
  temperature: number;
  numPredict: number;
  retries: number;
  retryBackoffMs: number;
  signal: AbortSignal | undefined;
  fetchImpl: typeof fetch;
  onRetry: ((info: RetryInfo) => void) | undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    reject(new DOMException("aborted", "AbortError"));
    return promise;
  }
  const id = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(id);
    reject(new DOMException("aborted", "AbortError"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  return promise;
}

export class OllamaClient {
  private readonly internals: OllamaClientInternals;

  constructor(opts: OllamaClientOptions) {
    this.internals = {
      baseUrl: (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      model: opts.model,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      numCtx: opts.numCtx ?? DEFAULT_NUM_CTX,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      numPredict: opts.numPredict ?? DEFAULT_NUM_PREDICT,
      retries: opts.retries ?? DEFAULT_RETRIES,
      retryBackoffMs: opts.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl ?? globalThis.fetch.bind(globalThis),
      onRetry: opts.onRetry,
    };
  }

  async isHealthy(): Promise<HealthResult> {
    try {
      const res = await this.internals.fetchImpl(`${this.internals.baseUrl}/api/version`, {
        method: "GET",
        signal: this.combinedSignal(),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const body = (await res.json()) as OllamaVersionResponseBody;
      return { ok: true, version: body.version };
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? String(err) };
    }
  }

  async listModels(): Promise<string[]> {
    const res = await this.request("/api/tags", { method: "GET" });
    const body = (await res.json()) as OllamaTagsResponseBody;
    return (body.models ?? []).map((m) => m.name);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const payload: OllamaChatPayload = {
      model: this.internals.model,
      messages: req.messages,
      stream: false,
      options: {
        num_ctx: this.internals.numCtx,
        temperature: this.internals.temperature,
        num_predict: this.internals.numPredict,
      },
      ...(req.format ? { format: req.format } : {}),
    };
    const res = await this.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as OllamaChatResponseBody;
    return {
      content: data.message?.content ?? "",
      model: data.model,
      promptEvalCount: data.prompt_eval_count,
      evalCount: data.eval_count,
      totalDurationNs: data.total_duration,
    };
  }

  async generate(prompt: string, opts?: GenerateOptions): Promise<ChatResponse> {
    const payload: OllamaGeneratePayload = {
      model: this.internals.model,
      prompt,
      stream: false,
      options: {
        num_ctx: this.internals.numCtx,
        temperature: this.internals.temperature,
        num_predict: this.internals.numPredict,
      },
      ...(opts?.format ? { format: opts.format } : {}),
    };
    const res = await this.request("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as OllamaGenerateResponseBody;
    return {
      content: data.response ?? "",
      model: data.model,
      promptEvalCount: data.prompt_eval_count,
      evalCount: data.eval_count,
      totalDurationNs: data.total_duration,
    };
  }

  private combinedSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.internals.timeoutMs);
    if (this.internals.signal) {
      return AbortSignal.any([timeout, this.internals.signal]);
    }
    return timeout;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.internals.baseUrl}${path}`;
    const maxAttempts = this.internals.retries + 1;
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const signal = this.combinedSignal();
      try {
        const res = await this.internals.fetchImpl(url, { ...init, signal });
        if (res.status === 404) {
          throw new OllamaModelMissingError(this.internals.model);
        }
        if (res.status >= 500) {
          const body = await res.text();
          throw new OllamaResponseError(res.status, body);
        }
        if (!res.ok) {
          const body = await res.text();
          throw new OllamaResponseError(res.status, body);
        }
        return res;
      } catch (err) {
        if (err instanceof OllamaModelMissingError) {
          throw err;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          lastError = new OllamaTimeoutError(this.internals.timeoutMs);
        } else {
          lastError = err as Error;
        }
        if (attempt < maxAttempts) {
          const delayMs = this.internals.retryBackoffMs * 2 ** (attempt - 1);
          this.internals.onRetry?.({ attempt, delayMs, error: lastError });
          await sleep(delayMs, this.internals.signal);
          continue;
        }
        break;
      }
    }
    if (
      lastError instanceof OllamaTimeoutError ||
      lastError instanceof OllamaResponseError
    ) {
      throw lastError;
    }
    throw new OllamaConnectionError(this.internals.baseUrl, lastError);
  }
}

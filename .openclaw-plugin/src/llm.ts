import https from "node:https";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface LlmCaller {
  (systemPrompt: string, userContent: string, maxTokens?: number): Promise<string>;
}

/**
 * Resolves an Anthropic API key the same way as other OpenClaw plugins that
 * need a one-off completion outside the chat harness (see
 * openclaw-cortex/hooks/reflection/handler.ts's callClaude): explicit plugin
 * config first, then the calling agent's own auth profile, then the
 * environment.
 *
 * Deliberately does NOT default OPENCLAW_AGENT_DIR to any particular agent
 * (e.g. "main") — a gateway can host multiple agents with separate homes, and
 * silently reading a different agent's auth profile would mean billing/using
 * the wrong account's key. The auth-profile fallback only applies when the
 * host has actually told us which agent this is via OPENCLAW_AGENT_DIR.
 */
export function resolveAnthropicApiKey(configuredKey?: string): string | null {
  if (configuredKey?.trim()) return configuredKey.trim();

  const agentDir = process.env.OPENCLAW_AGENT_DIR;
  if (agentDir) {
    try {
      const profiles = JSON.parse(readFileSync(join(agentDir, "auth-profiles.json"), "utf-8"));
      const key = profiles?.profiles?.["anthropic:default"]?.key;
      if (typeof key === "string" && key.trim()) return key.trim();
    } catch {
      // fall through
    }
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) return process.env.ANTHROPIC_API_KEY.trim();
  return null;
}

/** Hard deadline on a single Anthropic call — without this, one stalled TCP connection (network
 * partition, proxy hang) never settles, permanently consuming a mapWithConcurrency worker slot
 * and wedging the analysis job in "running" state with no recovery short of a gateway restart. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Single-turn structured-JSON completion against the Anthropic Messages API.
 * Used for the deterministic-per-call phases of the pipeline (file analysis,
 * project summary, layer detection, tour generation) — each call is
 * independent, so a raw HTTPS request is simpler and cheaper than pulling the
 * full Claude Agent SDK into the gateway process for what is not a chat
 * session.
 */
export function createLlmCaller(apiKey: string, model: string, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): LlmCaller {
  return function callModel(systemPrompt: string, userContent: string, maxTokens = 2000): Promise<string> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      let settled = false;
      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const settleResolve = (text: string) => {
        if (settled) return;
        settled = true;
        resolve(text);
      };

      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: requestTimeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed?.error) {
                settleReject(new Error(`Anthropic API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`));
                return;
              }
              const text = parsed?.content?.[0]?.text;
              if (typeof text !== "string") {
                settleReject(new Error(`Unexpected Anthropic response shape: ${data.slice(0, 300)}`));
                return;
              }
              settleResolve(text);
            } catch (err) {
              settleReject(err instanceof Error ? err : new Error(String(err)));
            }
          });
          res.on("error", (err) => settleReject(err));
        },
      );
      req.on("error", (err) => settleReject(err));
      req.on("timeout", () => {
        req.destroy();
        settleReject(new Error(`Anthropic request timed out after ${requestTimeoutMs}ms`));
      });
      req.write(body);
      req.end();
    });
  };
}

/** Bounded concurrency map — avoids hammering the API with hundreds of files at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

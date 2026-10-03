/**
 * Browser side of the dashboard's AI proxy (server/ai.ts). The API key is
 * only ever sent *to* the server; responses carry a masked hint.
 */
export type AiProtocol = "openai" | "anthropic";

export interface PublicAiConfig {
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  maxTokens?: number;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  configured: boolean;
  apiKeyHint: string;
  embeddingApiKeyHint: string;
  embeddingsConfigured: boolean;
}

export interface AiConfigUpdate {
  protocol?: AiProtocol;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  clearApiKey?: boolean;
  clearEmbeddingApiKey?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  protocol: AiProtocol;
  baseUrl: string;
  modelHint: string;
  embeddingModelHint?: string;
}

/** Starting points only — every field stays editable, so any vendor works. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "anthropic", label: "Anthropic (Claude)", protocol: "anthropic", baseUrl: "https://api.anthropic.com", modelHint: "claude-opus-5-5" },
  { id: "openai", label: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", modelHint: "gpt-4.1", embeddingModelHint: "text-embedding-3-small" },
  { id: "deepseek", label: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com/v1", modelHint: "deepseek-chat" },
  { id: "glm", label: "智谱 GLM", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", modelHint: "glm-4-plus", embeddingModelHint: "embedding-3" },
  { id: "qwen", label: "通义千问 Qwen", protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelHint: "qwen-plus", embeddingModelHint: "text-embedding-v3" },
  { id: "moonshot", label: "Moonshot (Kimi)", protocol: "openai", baseUrl: "https://api.moonshot.cn/v1", modelHint: "moonshot-v1-32k" },
  { id: "openrouter", label: "OpenRouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", modelHint: "anthropic/claude-opus-5-5" },
  { id: "ollama", label: "Ollama (local)", protocol: "openai", baseUrl: "http://localhost:11434/v1", modelHint: "qwen2.5-coder", embeddingModelHint: "nomic-embed-text" },
  { id: "custom", label: "Custom", protocol: "openai", baseUrl: "", modelHint: "" },
];

const DEMO_TOKEN = "__demo__";

function url(path: string, token: string): string {
  return `${path}?token=${encodeURIComponent(token)}`;
}

/** null = no AI backend here (static demo build or the read-only viewer). */
export async function fetchAiConfig(token: string): Promise<PublicAiConfig | null> {
  if (token === DEMO_TOKEN) return null;
  try {
    const res = await fetch(url("/ai/config", token));
    if (!res.ok) return null;
    return (await res.json()) as PublicAiConfig;
  } catch {
    return null;
  }
}

export async function saveAiConfig(token: string, update: AiConfigUpdate): Promise<PublicAiConfig> {
  const res = await fetch(url("/ai/config", token), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  const data = (await res.json()) as PublicAiConfig | { error?: string };
  if (!res.ok) throw new Error("error" in data && data.error ? data.error : `HTTP ${res.status}`);
  return data as PublicAiConfig;
}

export interface ChatDone {
  stopReason: string | null;
  servedBy?: string;
}

/** Stream a reply; resolves when the provider finishes, rejects on error or abort. */
export async function streamAiChat(
  token: string,
  input: { system?: string; messages: ChatMessage[] },
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<ChatDone> {
  const res = await fetch(url("/ai/chat", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep the status */
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = event.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = JSON.parse(line.slice(5)) as { delta?: string; done?: boolean; error?: string } & ChatDone;
      if (payload.error) throw new Error(payload.error);
      if (payload.delta) onDelta(payload.delta);
      if (payload.done) return { stopReason: payload.stopReason ?? null, servedBy: payload.servedBy };
    }
  }
  throw new Error("The connection closed before the reply finished");
}

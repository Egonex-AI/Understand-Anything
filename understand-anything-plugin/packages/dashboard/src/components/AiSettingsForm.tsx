import { useState } from "react";
import { useI18n } from "../contexts/I18nContext";
import { fmt } from "../locales";
import {
  PROVIDER_PRESETS,
  saveAiConfig,
  type AiConfigUpdate,
  type AiProtocol,
  type PublicAiConfig,
} from "../ai/aiClient";

const inputClass =
  "w-full bg-elevated border border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/50";
const labelClass = "block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1";

function presetFor(config: PublicAiConfig | null): string {
  if (!config?.baseUrl) return config?.model ? "custom" : PROVIDER_PRESETS[0].id;
  const match = PROVIDER_PRESETS.find((p) => p.baseUrl && p.baseUrl === config.baseUrl.replace(/\/+$/, ""));
  return match?.id ?? "custom";
}

/**
 * Provider settings for the Ask-AI dialog. Presets only pre-fill the fields —
 * any OpenAI-compatible or Anthropic-compatible endpoint works.
 */
export default function AiSettingsForm({
  accessToken,
  config,
  expandEmbeddings = false,
  onSaved,
  onCancel,
}: {
  accessToken: string;
  config: PublicAiConfig | null;
  expandEmbeddings?: boolean;
  onSaved: (config: PublicAiConfig) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const a = t.ai;
  const [preset, setPreset] = useState(() => presetFor(config));
  // A blank config starts from the first preset instead of a mismatched default.
  const initial = !config?.baseUrl && !config?.model ? PROVIDER_PRESETS[0] : null;
  const [protocol, setProtocol] = useState<AiProtocol>(initial?.protocol ?? config?.protocol ?? "openai");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? config?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [model, setModel] = useState(initial?.modelHint ?? config?.model ?? "");
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ? String(config.maxTokens) : "");
  const [embeddingModel, setEmbeddingModel] = useState(config?.embeddingModel ?? "");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(config?.embeddingBaseUrl ?? "");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  const presetInfo = PROVIDER_PRESETS.find((p) => p.id === preset);

  const choosePreset = (id: string) => {
    setPreset(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (!p || p.id === "custom") return;
    setProtocol(p.protocol);
    setBaseUrl(p.baseUrl);
    setModel(p.modelHint);
    if (p.embeddingModelHint && !embeddingModel) setEmbeddingModel(p.embeddingModelHint);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ kind: "saving" });
    const update: AiConfigUpdate = {
      protocol,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      maxTokens: maxTokens.trim() ? Number(maxTokens) : 0,
      embeddingModel: embeddingModel.trim(),
      embeddingBaseUrl: embeddingBaseUrl.trim(),
    };
    if (apiKey.trim()) update.apiKey = apiKey.trim();
    if (clearApiKey) update.clearApiKey = true;
    if (embeddingApiKey.trim()) update.embeddingApiKey = embeddingApiKey.trim();
    try {
      const saved = await saveAiConfig(accessToken, update);
      setApiKey("");
      setEmbeddingApiKey("");
      setClearApiKey(false);
      setStatus({ kind: "saved" });
      onSaved(saved);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="ai-settings-form">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="ai-preset">{a.preset}</label>
          <select id="ai-preset" className={inputClass} value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="ai-protocol">{a.protocol}</label>
          <select
            id="ai-protocol"
            className={inputClass}
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as AiProtocol)}
          >
            <option value="openai">{a.protocolOpenai}</option>
            <option value="anthropic">{a.protocolAnthropic}</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="ai-base-url">{a.baseUrl}</label>
        <input
          id="ai-base-url"
          className={`${inputClass} font-mono`}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={protocol === "anthropic" ? "https://api.anthropic.com" : "https://…/v1"}
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="ai-api-key">{a.apiKey}</label>
          <input
            id="ai-api-key"
            type="password"
            autoComplete="off"
            className={`${inputClass} font-mono`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.apiKeyHint ? fmt(a.apiKeyStored, { hint: config.apiKeyHint }) : a.apiKeyOptional}
          />
          {config?.apiKeyHint && (
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
              <input type="checkbox" checked={clearApiKey} onChange={(e) => setClearApiKey(e.target.checked)} />
              {a.clearKey}
            </label>
          )}
        </div>
        <div>
          <label className={labelClass} htmlFor="ai-model">{a.model}</label>
          <input
            id="ai-model"
            className={`${inputClass} font-mono`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={presetInfo?.modelHint || "model-id"}
            spellCheck={false}
          />
        </div>
      </div>

      <div className="w-1/2 pr-1.5">
        <label className={labelClass} htmlFor="ai-max-tokens">{a.maxTokens}</label>
        <input
          id="ai-max-tokens"
          type="number"
          min={1}
          className={inputClass}
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
          placeholder={a.maxTokensAuto}
        />
      </div>

      <details className="rounded-md border border-border-subtle px-3 py-2" open={expandEmbeddings || Boolean(config?.embeddingModel)}>
        <summary className="cursor-pointer text-xs text-text-secondary">{a.embeddings}</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="ai-embedding-model">{a.embeddingModel}</label>
              <input
                id="ai-embedding-model"
                className={`${inputClass} font-mono`}
                value={embeddingModel}
                onChange={(e) => setEmbeddingModel(e.target.value)}
                placeholder={presetInfo?.embeddingModelHint ?? "text-embedding-3-small"}
                spellCheck={false}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-embedding-key">{a.embeddingApiKey}</label>
              <input
                id="ai-embedding-key"
                type="password"
                autoComplete="off"
                className={`${inputClass} font-mono`}
                value={embeddingApiKey}
                onChange={(e) => setEmbeddingApiKey(e.target.value)}
                placeholder={
                  config?.embeddingApiKeyHint
                    ? fmt(a.apiKeyStored, { hint: config.embeddingApiKeyHint })
                    : a.embeddingBaseUrlHint
                }
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="ai-embedding-url">{a.embeddingBaseUrl}</label>
            <input
              id="ai-embedding-url"
              className={`${inputClass} font-mono`}
              value={embeddingBaseUrl}
              onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
              placeholder={a.embeddingBaseUrlHint}
              spellCheck={false}
            />
          </div>
        </div>
      </details>

      <p className="text-[11px] text-text-muted leading-relaxed">{a.privacy}</p>

      {status.kind === "error" && <p className="text-xs text-red-400">{status.message}</p>}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-text-primary"
          >
            {a.backToChat}
          </button>
        )}
        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 disabled:opacity-50"
        >
          {status.kind === "saving" ? a.saving : status.kind === "saved" ? a.saved : a.save}
        </button>
      </div>
    </form>
  );
}

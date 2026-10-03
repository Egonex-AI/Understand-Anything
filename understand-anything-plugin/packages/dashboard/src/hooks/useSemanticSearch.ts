import { useEffect, useState } from "react";
import { useDashboardStore } from "../store";
import { fetchAiConfig } from "../ai/aiClient";

export type SemanticSearchState =
  /** No embedding model: the store's fuzzy results stand in. `canConfigure` = an AI backend exists. */
  | { status: "unavailable"; canConfigure: boolean }
  | { status: "idle" | "loading" }
  | { status: "done"; count: number; embedded: number }
  | { status: "error"; error: string };

const DEBOUNCE_MS = 350;

interface SemanticResponse {
  hits: Array<{ nodeId: string; similarity: number }>;
  embedded: number;
  indexed: number;
}

/**
 * Embedding search for the "Semantic" mode. While a request is in flight (or
 * when no embedding model is configured) the store's fuzzy results show;
 * server hits replace them when they arrive.
 */
export function useSemanticSearch(query: string, accessToken: string, enabled: boolean): SemanticSearchState {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [canConfigure, setCanConfigure] = useState(false);
  const [state, setState] = useState<SemanticSearchState>({ status: "idle" });
  const aiDialogOpen = useDashboardStore((s) => s.aiDialog !== null);
  const trimmed = query.trim();

  // Re-check after the AI settings dialog closes — the user may have just added a model.
  useEffect(() => {
    if (!enabled || aiDialogOpen) return;
    let cancelled = false;
    void fetchAiConfig(accessToken).then((config) => {
      if (cancelled) return;
      setCanConfigure(config !== null);
      setAvailable(Boolean(config?.embeddingsConfigured));
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, enabled, aiDialogOpen]);

  useEffect(() => {
    if (!enabled || !available || !trimmed) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: "loading" });
      const params = new URLSearchParams({ token: accessToken, q: trimmed });
      fetch(`/ai/semantic-search?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          const data = (await res.json()) as SemanticResponse | { error?: string };
          if (!res.ok || !("hits" in data)) throw new Error(("error" in data && data.error) || `HTTP ${res.status}`);
          return data;
        })
        .then((data) => {
          const st = useDashboardStore.getState();
          if (st.searchQuery.trim() !== trimmed || st.searchMode !== "semantic") return;
          const results = data.hits
            .filter((h) => st.nodesById.has(h.nodeId))
            .map((h) => ({ nodeId: h.nodeId, score: Math.max(0, 1 - h.similarity) }));
          st.setSearchResults(results);
          setState({ status: "done", count: results.length, embedded: data.embedded });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, accessToken, enabled, available]);

  if (enabled && available === false) return { status: "unavailable", canConfigure };
  return state;
}

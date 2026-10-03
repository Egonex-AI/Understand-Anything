import { useEffect, useState } from "react";

// Mirrors the response of core's content-search.ts (served at
// /search-content.json). Redeclared here because the dashboard may only
// import core's browser-safe subpaths.
export interface ContentSearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
  previewColumn: number;
}

export interface ContentSearchFileResult {
  path: string;
  matches: ContentSearchMatch[];
  matchCount: number;
}

export interface ContentSearchResult {
  files: ContentSearchFileResult[];
  totalMatches: number;
  searchedFiles: number;
  truncated: boolean;
}

export interface ContentSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export type ContentSearchState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: ContentSearchResult | null; error: null }
  | { status: "done"; result: ContentSearchResult; error: null }
  | { status: "error"; result: null; error: string };

export const MIN_CONTENT_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const IDLE: ContentSearchState = { status: "idle", result: null, error: null };

/** Sentinel token App uses when there is no local server (static demo build). */
export const DEMO_TOKEN = "__demo__";

/**
 * Debounced full-text search against the dashboard server. Disabled (idle)
 * unless `enabled` and the query is at least MIN_CONTENT_QUERY_LENGTH chars.
 */
export function useContentSearch(
  query: string,
  options: ContentSearchOptions,
  accessToken: string,
  enabled: boolean,
): ContentSearchState {
  const [state, setState] = useState<ContentSearchState>(IDLE);
  const { caseSensitive, wholeWord, regex } = options;
  const trimmed = query.trim();
  const active = enabled && trimmed.length >= MIN_CONTENT_QUERY_LENGTH;

  useEffect(() => {
    if (!active) {
      setState(IDLE);
      return;
    }
    if (accessToken === DEMO_TOKEN) {
      setState({ status: "error", result: null, error: "unavailable" });
      return;
    }
    setState((prev) => ({ status: "loading", result: prev.result, error: null }));
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ token: accessToken, q: query });
      if (caseSensitive) params.set("case", "1");
      if (wholeWord) params.set("word", "1");
      if (regex) params.set("regex", "1");
      fetch(`/search-content.json?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          const data = (await res.json()) as ContentSearchResult | { error?: string };
          if (!res.ok) {
            throw new Error("error" in data && data.error ? data.error : `HTTP ${res.status}`);
          }
          setState({ status: "done", result: data as ContentSearchResult, error: null });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, query, caseSensitive, wholeWord, regex, accessToken]);

  return state;
}

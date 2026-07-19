import type { FigmaSource, FigmaDocument, FigmaStyles } from "./types.js";

const FIGMA_API = "https://api.figma.com/v1";

export function parseFileKey(urlOrKey: string): string {
  const m = urlOrKey.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]+$/.test(urlOrKey.trim())) return urlOrKey.trim();
  throw new Error(`Could not parse a Figma file key from: ${urlOrKey}`);
}

export class FigmaApiSource implements FigmaSource {
  private readonly token: string;

  constructor(private readonly fileKey: string, token: string | undefined = process.env.FIGMA_TOKEN) {
    if (!token) {
      throw new Error(
        "FIGMA_TOKEN is not set. Create a personal access token at " +
        "https://www.figma.com/settings, then run: export FIGMA_TOKEN=<token>",
      );
    }
    this.token = token;
  }

  private async get<T>(path: string): Promise<T> {
    // Token travels only in the header — never in the URL, never logged.
    const res = await fetch(`${FIGMA_API}${path}`, { headers: { "X-Figma-Token": this.token } });
    if (!res.ok) {
      throw new Error(`Figma API ${path} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  fetchDocument(): Promise<FigmaDocument> {
    return this.get<FigmaDocument>(`/files/${this.fileKey}`);
  }

  fetchStyles(): Promise<FigmaStyles> {
    return this.get<FigmaStyles>(`/files/${this.fileKey}/styles`);
  }

  async renderImages(nodeIds: string[]): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};
    const ids = encodeURIComponent(nodeIds.join(","));
    const data = await this.get<{ images: Record<string, string> }>(
      `/images/${this.fileKey}?ids=${ids}&format=png&scale=1`,
    );
    return data.images ?? {};
  }
}

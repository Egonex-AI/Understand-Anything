import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function readThemeVariables() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim();
  const accent = get("--color-accent") || "#d4a574";
  const accentMatch = accent.replace("#", "").match(/.{2}/g);
  const r = parseInt(accentMatch?.[0] ?? "d4", 16);
  const g = parseInt(accentMatch?.[1] ?? "a5", 16);
  const b = parseInt(accentMatch?.[2] ?? "74", 16);

  return {
    primaryColor: accent,
    primaryTextColor: get("--color-text-primary") || "#f5f0eb",
    primaryBorderColor: `rgba(${r}, ${g}, ${b}, 0.25)`,
    lineColor: `rgba(${r}, ${g}, ${b}, 0.3)`,
    secondaryColor: get("--color-elevated") || "#1a1a1a",
    tertiaryColor: get("--color-surface") || "#111111",
    background: get("--color-root") || "#0a0a0a",
    mainBkg: get("--color-elevated") || "#1a1a1a",
    nodeBorder: `rgba(${r}, ${g}, ${b}, 0.25)`,
    clusterBkg: get("--color-panel") || "#141414",
    titleColor: get("--color-accent-bright") || "#e8c49a",
    edgeLabelBackground: get("--color-elevated") || "#1a1a1a",
  };
}

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: readThemeVariables(),
      });
      return mod;
    });
  }
  return mermaidPromise;
}

function getThemeKey(): string {
  const cs = getComputedStyle(document.documentElement);
  return `${cs.getPropertyValue("--color-root")}|${cs.getPropertyValue("--color-accent")}`;
}

let renderCounter = 0;

export function MermaidDiagram({ content, onNodeClick }: { content: string; onNodeClick?: (nodeLabel: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [themeKey, setThemeKey] = useState(getThemeKey);

  // Watch for theme changes via MutationObserver on data-theme attribute
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            mermaidPromise = null;
            setThemeKey(getThemeKey());
          }, 50);
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      observer.disconnect();
      if (debounce) clearTimeout(debounce);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++renderCounter}`;
    setError("");
    setLoading(true);

    loadMermaid()
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: readThemeVariables(),
        });
        return mermaid.render(id, content.trim());
      })
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          if (onNodeClickRef.current) {
            containerRef.current.querySelectorAll<SVGGElement>(".node").forEach((node) => {
              const label = node.querySelector(".nodeLabel")?.textContent?.trim();
              if (!label) return;
              node.style.cursor = "pointer";
              node.addEventListener("click", () => onNodeClickRef.current?.(label));
            });
          }
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content, themeKey]);

  if (error) {
    return (
      <div className="mermaid-container">
        <div className="mermaid-error">Diagram render failed: {error}</div>
        <pre>
          <code>{content}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="mermaid-container">
      {loading && <div className="mermaid-loading">Loading diagram…</div>}
      <div ref={containerRef} />
    </div>
  );
}

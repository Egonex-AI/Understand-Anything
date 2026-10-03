import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "ua-code-viewer-height";
const MIN_HEIGHT = 140;
/** Space always left for the graph above the panel. */
const MIN_REMAINING = 120;

function loadHeight(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= MIN_HEIGHT ? n : null;
  } catch {
    return null;
  }
}

/**
 * Bottom-docked panel whose top edge can be dragged to resize it. The
 * height is remembered per browser; until the user drags, it defaults to
 * 40% of the viewport like the original fixed panel.
 */
export default function ResizableBottomPanel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(loadHeight);
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback((h: number) => {
    const parent = panelRef.current?.parentElement;
    const max = parent ? parent.clientHeight - MIN_REMAINING : window.innerHeight * 0.8;
    return Math.round(Math.min(Math.max(h, MIN_HEIGHT), Math.max(max, MIN_HEIGHT)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const parent = panelRef.current?.parentElement;
      if (!parent) return;
      setHeight(clamp(parent.getBoundingClientRect().bottom - e.clientY));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, clamp]);

  // Persist once a drag ends rather than on every pointer move.
  useEffect(() => {
    if (dragging) return;
    try {
      if (height === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, String(height));
    } catch {
      // Storage unavailable — the height just won't be remembered.
    }
  }, [dragging, height]);

  return (
    <div
      ref={panelRef}
      className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border-subtle animate-slide-up z-20 overflow-hidden"
      style={{ height: height ?? "40vh" }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        title={label}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setHeight(null)}
        className={`absolute top-0 left-0 right-0 h-1.5 -mt-0.5 z-10 cursor-row-resize transition-colors ${
          dragging ? "bg-accent/40" : "hover:bg-accent/25"
        }`}
      />
      {children}
    </div>
  );
}

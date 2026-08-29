import { useState, useCallback } from "react";
import type { GraphIssue } from "@understand-anything/core/schema";

interface WarningBannerProps {
  issues: GraphIssue[];
}

function buildCopyText(issues: GraphIssue[]): string {
  const hasFatal = issues.some((i) => i.level === "fatal");
  // Fatal issues are dashboard rendering bugs (e.g. ELK layout failures), not
  // LLM generation errors — route the user to file a bug report instead of
  // asking their agent to "fix" the knowledge-graph.json.
  const lines = hasFatal
    ? [
        "Some of these issues look like dashboard rendering bugs.",
        "Please file an issue at github.com/Egonex-AI/Understand-Anything/issues with the text below.",
        "",
      ]
    : [
        "The following issues were found in your knowledge-graph.json.",
        "These are LLM generation errors — not a system bug.",
        "You can ask your agent to fix these specific issues in the knowledge-graph.json file:",
        "",
      ];

  // Show fatal first (most actionable for bug reports), then dropped, then auto-corrected.
  const sorted = [...issues].sort((a, b) => {
    const order: Record<string, number> = { fatal: 0, dropped: 1, "auto-corrected": 2 };
    return (order[a.level] ?? 3) - (order[b.level] ?? 3);
  });

  for (const issue of sorted) {
    const label =
      issue.level === "auto-corrected"
        ? "Auto-corrected"
        : issue.level === "dropped"
          ? "Dropped"
          : "Fatal";
    lines.push(`[${label}] ${issue.message}`);
  }

  return lines.join("\n");
}

export default function WarningBanner({ issues }: WarningBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const fatal = issues.filter((i) => i.level === "fatal");
  const autoCorrected = issues.filter((i) => i.level === "auto-corrected");
  const dropped = issues.filter((i) => i.level === "dropped");
  const hasFatal = fatal.length > 0;

  // Build summary text — only mention counts > 0
  const parts: string[] = [];
  if (fatal.length > 0) {
    parts.push(`${fatal.length} fatal error${fatal.length !== 1 ? "s" : ""}`);
  }
  if (autoCorrected.length > 0) {
    parts.push(`${autoCorrected.length} auto-correction${autoCorrected.length !== 1 ? "s" : ""}`);
  }
  if (dropped.length > 0) {
    parts.push(`${dropped.length} dropped item${dropped.length !== 1 ? "s" : ""}`);
  }
  const summary = hasFatal
    ? `Dashboard hit ${parts.join(", ")}`
    : `Knowledge graph loaded with ${parts.join(" and ")}`;

  const handleCopy = useCallback(async () => {
    const text = buildCopyText(issues);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn("Clipboard write failed — copy text manually from the expanded issue list");
    }
  }, [issues]);

  if (issues.length === 0) return null;

  // Fatal issues escalate the banner from amber (warning) to red (error).
  const containerClasses = hasFatal
    ? "bg-red-900/25 border-b border-red-700 text-red-200 text-sm"
    : "bg-amber-900/20 border-b border-amber-700 text-amber-200 text-sm";
  const hoverClasses = hasFatal
    ? "hover:bg-red-900/15"
    : "hover:bg-amber-900/10";
  const iconClasses = hasFatal ? "text-red-400" : "text-amber-400";
  const hintClasses = hasFatal ? "text-red-400/60" : "text-amber-400/60";
  const dividerClasses = hasFatal ? "border-red-700/50" : "border-amber-700/50";
  const footerTextClasses = hasFatal ? "text-red-200/70" : "text-amber-200/60";
  const buttonClasses = hasFatal
    ? "bg-red-800/40 text-red-200 hover:bg-red-800/60"
    : "bg-amber-800/40 text-amber-200 hover:bg-amber-800/60";
  const footerCopy = hasFatal
    ? "Copy these issues and file a bug report on GitHub"
    : "Copy these issues and ask your agent to fix them in knowledge-graph.json";

  return (
    <div className={containerClasses}>
      {/* Collapsed summary row */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className={`w-full flex items-center gap-2 px-5 py-3 text-left transition-colors ${hoverClasses}`}
      >
        {/* Chevron icon */}
        <svg
          className={`w-4 h-4 shrink-0 ${iconClasses} transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>

        {/* Warning icon */}
        <svg
          className={`w-4 h-4 shrink-0 ${iconClasses}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>

        <span className="flex-1">{summary}</span>

        <span className={`text-xs shrink-0 ${hintClasses}`}>
          {expanded ? "click to collapse" : "click to expand"}
        </span>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="px-5 pb-4">
          {/* Issue list */}
          <div className="space-y-1 mb-3">
            {/* Fatal issues — top of list, red, most prominent */}
            {fatal.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
                  Fatal ({fatal.length})
                </h4>
                {fatal.map((issue, i) => (
                  <div
                    key={`ft-${i}`}
                    className="flex items-start gap-2 py-0.5 pl-2 text-red-200"
                  >
                    <span className="text-red-400 shrink-0 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                        />
                      </svg>
                    </span>
                    <span className="text-xs">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Auto-corrected issues */}
            {autoCorrected.length > 0 && (
              <div className={fatal.length > 0 ? "mt-2" : ""}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-1">
                  Auto-corrected ({autoCorrected.length})
                </h4>
                {autoCorrected.map((issue, i) => (
                  <div key={`ac-${i}`} className="flex items-start gap-2 py-0.5 pl-2 text-amber-200/80">
                    <span className="text-amber-400 shrink-0 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-xs">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Dropped issues */}
            {dropped.length > 0 && (
              <div className={fatal.length > 0 || autoCorrected.length > 0 ? "mt-2" : ""}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-orange-400 mb-1">
                  Dropped ({dropped.length})
                </h4>
                {dropped.map((issue, i) => (
                  <div key={`dr-${i}`} className="flex items-start gap-2 py-0.5 pl-2 text-orange-300/80">
                    <span className="text-orange-400 shrink-0 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                    <span className="text-xs">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer with copy button and actionable message */}
          <div className={`flex items-center justify-between pt-2 border-t ${dividerClasses}`}>
            <p className={`text-xs ${footerTextClasses}`}>{footerCopy}</p>
            <button
              type="button"
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors shrink-0 ml-4 ${buttonClasses}`}
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Copy Issues
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

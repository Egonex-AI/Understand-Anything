import { useState } from "react";
import type {
  DashboardFreshnessReport,
  GraphFreshnessResult,
  GraphFreshnessUnknownReason,
} from "../freshness";
import { useI18n } from "../contexts/I18nContext";
import { en, type Locale } from "../locales";

interface StalenessBannerProps {
  freshness: DashboardFreshnessReport | null;
}

interface FreshnessBannerContent {
  title: string;
  summary: string;
  action: string;
  changedFiles: string[];
}

type GraphName = "knowledge" | "domain";
type GraphEntry = { name: GraphName; result: GraphFreshnessResult };

const RISK_RANK: Record<GraphFreshnessResult["status"], number> = {
  fresh: 0,
  unknown: 1,
  dirty: 2,
  stale: 3,
};

function titleSubject(t: Locale, entries: GraphEntry[]): string {
  if (entries.length === 2) return t.staleness.subjectBoth;
  return entries[0].name === "knowledge"
    ? t.staleness.subjectKnowledge
    : t.staleness.subjectDomain;
}

function staleSummary(t: Locale, entry: GraphEntry): string {
  if (entry.result.status !== "stale") return "";
  const files = entry.result.changedFileCount;

  if (entry.result.relation === "behind") {
    return t.staleness.staleBehind(entry.name, entry.result.commitsBehind, files);
  }
  if (entry.result.relation === "ahead") {
    return t.staleness.staleAhead(entry.name, files);
  }
  return t.staleness.staleDiverged(entry.name, files);
}

function dirtySummary(t: Locale, entry: GraphEntry): string {
  if (entry.result.status !== "dirty") return "";
  return t.staleness.dirty(entry.name, entry.result.changedFileCount);
}

function unknownEntrySummary(t: Locale, entry: GraphEntry): string {
  if (entry.result.status !== "unknown") return "";
  const reason: GraphFreshnessUnknownReason = entry.result.reason;
  switch (reason) {
    case "freshness-request-failed":
      return t.staleness.unknownRequestFailed;
    case "missing-graph-commit":
      return t.staleness.unknownMissingGraphCommit(entry.name);
    case "git-head-unavailable":
      return t.staleness.unknownGitHeadUnavailable(entry.name);
    case "graph-commit-unavailable":
      return t.staleness.unknownGraphCommitUnavailable(entry.name);
    case "git-command-timeout":
      return t.staleness.unknownGitCommandTimeout(entry.name);
  }
}

function refreshAction(t: Locale, entries: GraphEntry[]): string {
  const hasKnowledge = entries.some((entry) => entry.name === "knowledge");
  const hasDomain = entries.some((entry) => entry.name === "domain");
  const commands = hasKnowledge && hasDomain
    ? ["/understand", "/understand-domain"]
    : hasDomain
      ? ["/understand-domain"]
      : ["/understand"];
  return t.staleness.refresh(commands, entries.length !== 1);
}

export function buildFreshnessBanner(
  freshness: DashboardFreshnessReport | null,
  t: Locale = en,
): FreshnessBannerContent | null {
  if (!freshness) return null;
  const entries: GraphEntry[] = [
    { name: "knowledge", result: freshness.graphs.knowledge },
  ];
  if (freshness.graphs.domain) {
    entries.push({ name: "domain", result: freshness.graphs.domain });
  }

  const highestRisk = Math.max(
    ...entries.map((entry) => RISK_RANK[entry.result.status]),
  );
  if (highestRisk === RISK_RANK.fresh) return null;

  const affected = entries.filter(
    (entry) => RISK_RANK[entry.result.status] === highestRisk,
  );
  const status = affected[0].result.status;
  const multiple = affected.length !== 1;
  const subject = titleSubject(t, affected);
  const changedFiles = [
    ...new Set(
      affected.flatMap((entry) =>
        "changedFiles" in entry.result ? entry.result.changedFiles : [],
      ),
    ),
  ].sort();

  if (status === "stale") {
    return {
      title: t.staleness.titleStale(subject, multiple),
      summary: affected.map((entry) => staleSummary(t, entry)).join(" "),
      action: refreshAction(t, affected),
      changedFiles,
    };
  }

  if (status === "dirty") {
    return {
      title: t.staleness.titleDirty(subject, multiple),
      summary: affected.map((entry) => dirtySummary(t, entry)).join(" "),
      action: refreshAction(t, affected),
      changedFiles,
    };
  }

  const requestFailed = affected.some(
    (entry) =>
      entry.result.status === "unknown" &&
      entry.result.reason === "freshness-request-failed",
  );

  return {
    title: t.staleness.titleUnknown(subject, multiple),
    summary: [...new Set(affected.map((entry) => unknownEntrySummary(t, entry)))].join(" "),
    action: requestFailed ? t.staleness.retry : refreshAction(t, affected),
    changedFiles: [],
  };
}

export default function StalenessBanner({ freshness }: StalenessBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const content = buildFreshnessBanner(freshness, t);

  if (!content) return null;

  const hasFiles = content.changedFiles.length > 0;
  const visibleFiles = content.changedFiles.slice(0, 8);
  const hiddenFileCount = content.changedFiles.length - visibleFiles.length;

  return (
    <div className="bg-amber-950/30 border-b border-amber-700 text-amber-100 text-sm">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-amber-900/10 transition-colors"
      >
        <svg
          className="w-4 h-4 shrink-0 mt-0.5 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          />
        </svg>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold">{content.title}</span>
          <span className="block text-amber-100/80">{content.summary}</span>
          <span className="block text-amber-100/70">{content.action}</span>
        </span>
        {hasFiles && (
          <span className="text-xs text-amber-300/70 shrink-0">
            {expanded ? t.staleness.hideFiles : t.staleness.showFiles}
          </span>
        )}
      </button>

      {expanded && hasFiles && (
        <div className="px-5 pb-3">
          <div className="border-t border-amber-700/40 pt-2 flex flex-wrap gap-1.5">
            {visibleFiles.map((file) => (
              <code
                key={file}
                className="px-1.5 py-0.5 rounded bg-amber-900/30 text-[11px] text-amber-100"
              >
                {file}
              </code>
            ))}
            {hiddenFileCount > 0 && (
              <span className="text-xs text-amber-200/60">
                {t.staleness.moreFiles(hiddenFileCount)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

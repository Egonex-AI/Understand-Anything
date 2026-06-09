import type { AnchorHTMLAttributes } from "react";

export interface WikiLinkNavigation {
  type: "wiki" | "source";
  service?: string;
  path: string;
  fragment?: string;
  lineRange?: [number, number];
}

export function parseWikiLink(href: string): WikiLinkNavigation | null {
  // wiki://service-name/domains/domain-id#flow:create-order
  if (href.startsWith("wiki://")) {
    const rest = href.slice("wiki://".length);
    const [pathPart, fragment] = rest.split("#", 2);
    const segments = pathPart.split("/");
    const service = segments[0];
    return {
      type: "wiki",
      service,
      path: segments.slice(1).join("/"),
      fragment,
    };
  }

  // source://relative/path/to/file.java#L10-L20
  if (href.startsWith("source://")) {
    const rest = href.slice("source://".length);
    const [pathPart, fragment] = rest.split("#", 2);
    let lineRange: [number, number] | undefined;
    if (fragment) {
      const match = fragment.match(/^L(\d+)(?:-L(\d+))?$/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : start;
        lineRange = [start, end];
      }
    }
    return {
      type: "source",
      path: pathPart,
      lineRange,
    };
  }

  return null;
}

const SAFE_EXTERNAL_HREF = /^(https?:|mailto:|#)/i;

export function WikiLinkRenderer({
  onWikiNavigate,
  onSourceOpen,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  onWikiNavigate?: (nav: WikiLinkNavigation) => void;
  onSourceOpen?: (nav: WikiLinkNavigation) => void;
}) {
  const href = props.href ?? "";
  const parsed = parseWikiLink(href);

  if (!parsed) {
    if (!SAFE_EXTERNAL_HREF.test(href)) {
      return <span className="text-text-muted">{props.children}</span>;
    }
    if (href.startsWith("#")) {
      const handleAnchorClick = (e: React.MouseEvent) => {
        e.preventDefault();
        const target = document.getElementById(href.slice(1));
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      return (
        <a
          {...props}
          href={href}
          onClick={handleAnchorClick}
          className="text-accent hover:text-accent/80 cursor-pointer underline decoration-accent/40 transition-colors"
        />
      );
    }
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (parsed.type === "wiki" && onWikiNavigate) {
      onWikiNavigate(parsed);
    } else if (parsed.type === "source" && onSourceOpen) {
      onSourceOpen(parsed);
    }
  };

  const icon = parsed.type === "wiki" ? "🔗" : "📎";
  const title =
    parsed.type === "wiki"
      ? `Navigate to ${parsed.service}/${parsed.path}`
      : `View source: ${parsed.path}`;

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      title={title}
      className="text-accent hover:text-accent/80 cursor-pointer underline decoration-accent/40 transition-colors"
    >
      <span className="mr-0.5">{icon}</span>
      {props.children}
    </a>
  );
}

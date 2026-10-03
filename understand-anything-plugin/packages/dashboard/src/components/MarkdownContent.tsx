import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** GitHub-flavoured Markdown styled for the dashboard theme (docs, AI answers). */
export default function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-xl font-heading text-text-primary mt-6 mb-3 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-heading text-text-primary mt-5 mb-2 first:mt-0 border-b border-border-subtle pb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-heading text-text-primary mt-4 mb-2 first:mt-0">{children}</h3>,
        h4: ({ children }) => <h4 className="text-sm font-heading text-text-primary mt-3 mb-1.5 first:mt-0">{children}</h4>,
        h5: ({ children }) => <h5 className="text-sm font-heading text-text-primary mt-3 mb-1.5 first:mt-0">{children}</h5>,
        h6: ({ children }) => <h6 className="text-xs font-heading text-text-primary mt-3 mb-1.5 first:mt-0 uppercase tracking-wider">{children}</h6>,
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/40 pl-3 text-text-muted italic mb-3">{children}</blockquote>
        ),
        hr: () => <hr className="border-border-subtle my-4" />,
        pre: ({ children }) => (
          <pre className="bg-elevated border border-border-subtle rounded-lg p-3 mb-3 overflow-x-auto text-xs font-mono">
            {children}
          </pre>
        ),
        code: ({ className, children }) => {
          const isInline = !className && !String(children).includes("\n");
          return isInline ? (
            <code className="bg-elevated px-1.5 py-0.5 rounded text-[0.85em] font-mono text-accent">{children}</code>
          ) : (
            <code className={className}>{children}</code>
          );
        },
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="text-xs border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border-subtle bg-elevated px-2.5 py-1.5 text-left text-text-primary font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="border border-border-subtle px-2.5 py-1.5">{children}</td>,
        img: ({ src, alt }) => (
          <img src={src} alt={alt} className="max-w-full rounded-lg border border-border-subtle my-2" />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

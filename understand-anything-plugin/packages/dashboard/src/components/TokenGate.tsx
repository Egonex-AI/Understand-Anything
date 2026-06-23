import { useState } from "react";

interface TokenGateProps {
  onTokenValid: (token: string) => void;
}

export default function TokenGate({ onTokenValid }: TokenGateProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = input.trim();
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/knowledge-graph.json?token=${encodeURIComponent(token)}`);
      if (res.ok) {
        onTokenValid(token);
      } else if (res.status === 403) {
        setError("Invalid token. Please check and try again.");
      } else {
        setError(`Unexpected response (${res.status}). Is the dashboard server running?`);
      }
    } catch (err) {
      setError(
        `Could not reach the server: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-root noise-overlay">
      <div className="w-full max-w-md px-8 py-10 bg-surface border border-border-subtle rounded-lg shadow-2xl">
        {/* Heading */}
        <h1 className="font-heading text-2xl text-text-primary tracking-wide text-center mb-2">
          Access Token Required
        </h1>
        <p className="text-text-muted text-sm text-center mb-8">
          Paste the access token from your terminal. Look for the{" "}
          <span role="img" aria-label="key">&#x1F511;</span> line.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste token here..."
            autoFocus
            className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded text-text-primary placeholder:text-text-muted/50 font-mono text-sm focus:outline-none focus:border-accent transition-colors"
          />

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full py-3 bg-accent text-root font-semibold rounded transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Validating..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

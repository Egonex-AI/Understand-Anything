import { stem, tokenize } from "./text.js";

/**
 * Curated software-concept lexicon.
 *
 * Each cluster groups words that developers use interchangeably when talking
 * about the same capability. A node whose summary says "issues a JWT after the
 * password check" and a query that says "login" share no literal word, but
 * both land in the `auth` cluster, so they match.
 *
 * This is a lexicon, not a neural model: it is deterministic, offline, free,
 * and explainable (the dashboard can say *which* concept matched). It is
 * complemented by corpus-driven pseudo-relevance feedback in the engine,
 * which adapts to each project's own vocabulary.
 */
export const CONCEPT_CLUSTERS: Readonly<Record<string, readonly string[]>> = {
  auth: [
    "auth", "authentication", "authenticate", "login", "logout", "signin", "signout",
    "sign in", "sign out", "password", "credential", "token", "jwt", "session", "oauth",
    "sso", "identity", "bearer", "cookie", "2fa", "mfa", "passkey",
  ],
  authorization: [
    "authorization", "authorize", "permission", "role", "rbac", "acl", "policy",
    "access control", "privilege", "scope", "grant", "forbidden", "allow", "deny",
  ],
  security: [
    "security", "encrypt", "encryption", "decrypt", "hash", "hashing", "salt", "crypto",
    "cryptography", "sanitize", "sanitise", "escape", "xss", "csrf", "injection", "secret",
    "certificate", "tls", "ssl", "signature", "sign", "verify", "leak", "vulnerability",
  ],
  database: [
    "database", "db", "sql", "query", "table", "schema", "migration", "orm", "transaction",
    "postgres", "mysql", "sqlite", "mongo", "record", "row", "column", "index", "persist",
    "repository", "crud", "insert", "select",
  ],
  persistence: [
    "save", "load", "persist", "persistence", "store", "storage", "write", "read", "disk",
    "serialize", "deserialize", "serialise", "file system", "filesystem", "fs", "path",
    "directory", "folder", "cache file", "checkpoint",
  ],
  cache: [
    "cache", "caching", "memoize", "memoise", "memo", "ttl", "invalidate", "evict",
    "eviction", "lru", "redis", "memcached", "prefetch",
  ],
  http: [
    "http", "https", "request", "response", "endpoint", "route", "router", "rest", "api",
    "controller", "handler", "middleware", "server", "client", "fetch", "get", "post",
    "put", "delete", "status code", "header", "webhook", "graphql", "rpc",
  ],
  network: [
    "network", "socket", "websocket", "tcp", "udp", "dns", "proxy", "port", "host",
    "connection", "connect", "stream", "packet", "download", "upload", "url",
  ],
  config: [
    "config", "configuration", "configure", "setting", "option", "environment", "env",
    "flag", "preference", "default", "toml", "yaml", "dotenv", "feature flag",
  ],
  error: [
    "error", "exception", "throw", "catch", "fail", "failure", "fallback", "retry",
    "recover", "recovery", "crash", "panic", "bug", "invalid", "malformed", "corrupt",
    "warning", "timeout",
  ],
  logging: [
    "log", "logger", "logging", "trace", "tracing", "debug", "print", "console", "audit",
    "telemetry", "diagnostic", "report",
  ],
  monitoring: [
    "metric", "monitor", "monitoring", "health", "alert", "observability", "profile",
    "profiling", "benchmark", "latency", "throughput", "performance", "slow", "perf",
  ],
  testing: [
    "test", "testing", "spec", "mock", "stub", "fixture", "assert", "assertion", "unit",
    "integration", "e2e", "coverage", "vitest", "jest", "pytest", "snapshot", "verify",
  ],
  build: [
    "build", "compile", "bundle", "bundler", "transpile", "webpack", "vite", "rollup",
    "tsc", "lint", "linter", "package", "release", "version", "publish", "install",
  ],
  deploy: [
    "deploy", "deployment", "docker", "container", "kubernetes", "k8s", "helm", "ci",
    "cd", "pipeline", "terraform", "infrastructure", "provision", "cloud", "serverless",
  ],
  ui: [
    "ui", "component", "render", "view", "page", "screen", "layout", "style", "css",
    "theme", "button", "modal", "dialog", "widget", "react", "dom", "html", "display",
    "visual", "visualize", "draw", "canvas", "animation", "responsive", "sidebar",
  ],
  state: [
    "state", "store", "reducer", "action", "selector", "context", "zustand", "redux",
    "signal", "observable", "subscribe", "subscription", "event", "emit", "listener",
  ],
  validation: [
    "validate", "validation", "validator", "schema", "check", "constraint", "assert",
    "verify", "sanitize", "sanitise", "normalize", "normalise", "coerce", "zod", "ensure",
  ],
  parsing: [
    "parse", "parser", "parsing", "ast", "syntax", "grammar", "lexer", "tokenizer",
    "tokenize", "tree sitter", "treesitter", "extract", "extractor", "analyze", "analyse",
    "analysis", "scan", "scanner", "regex", "pattern",
  ],
  serialization: [
    "json", "xml", "csv", "protobuf", "serialize", "deserialize", "encode", "decode",
    "marshal", "unmarshal", "format", "convert", "transform", "stringify",
  ],
  search: [
    "search", "find", "lookup", "match", "matching", "fuzzy", "rank", "ranking", "relevance",
    "index", "query", "filter", "retrieve", "retrieval", "embedding", "similarity",
    "semantic", "autocomplete", "suggest",
  ],
  queue: [
    "queue", "job", "worker", "task", "background", "cron", "schedule", "scheduler",
    "scheduling", "batch", "broker", "kafka", "rabbitmq", "pubsub", "publish", "consumer",
    "producer", "message", "async",
  ],
  notification: [
    "notify", "notification", "email", "mail", "sms", "push", "alert", "toast", "message",
    "send", "template", "newsletter",
  ],
  payment: [
    "payment", "pay", "billing", "invoice", "checkout", "charge", "refund", "stripe",
    "subscription", "price", "pricing", "cart", "order", "currency", "tax", "wallet",
  ],
  user: [
    "user", "account", "profile", "member", "customer", "person", "signup", "register",
    "registration", "onboarding", "tenant", "organization", "team",
  ],
  graph: [
    "graph", "node", "edge", "vertex", "dependency", "dependencies", "traversal",
    "neighbor", "neighbour", "path", "cluster", "community", "layer", "tour", "hierarchy",
    "tree", "topology", "route", "shortest", "pathfinding", "finder", "navigate",
  ],
  concurrency: [
    "concurrent", "concurrency", "parallel", "thread", "worker", "lock", "mutex",
    "semaphore", "race", "async", "await", "promise", "debounce", "throttle",
  ],
  i18n: [
    "i18n", "locale", "translation", "translate", "language", "localization",
    "localisation", "l10n", "internationalization",
  ],
  ml: [
    "model", "train", "training", "inference", "predict", "prediction", "neural",
    "classifier", "llm", "prompt", "agent", "embedding", "vector", "dataset",
  ],
  incremental: [
    "incremental", "diff", "delta", "change", "changed", "stale", "staleness", "fresh",
    "freshness", "fingerprint", "hash", "update", "sync", "watch", "invalidate",
    "old", "outdated", "obsolete", "expired",
  ],
  file: [
    "file", "path", "directory", "folder", "glob", "ignore", "gitignore", "extension",
    "filename", "walk", "enumerate", "scan",
  ],
  export: [
    "export", "download", "save as", "image", "picture", "png", "svg", "pdf", "print",
    "screenshot", "share", "copy", "clipboard", "snapshot", "diagram", "render to",
  ],
  theme: [
    "theme", "color", "colour", "palette", "scheme", "dark", "light", "appearance",
    "accent", "skin", "style", "styling", "font", "typography", "brand",
  ],
  explain: [
    "explain", "explanation", "teach", "lesson", "tutorial", "learn", "learning", "guide",
    "walkthrough", "onboarding", "introduction", "intro", "overview", "documentation",
    "docs", "summary", "summarize", "describe", "description", "readme", "concept",
  ],
  language: [
    "language", "programming", "closure", "generic", "decorator", "lambda", "iterator",
    "generator", "polymorphism", "inheritance", "interface", "idiom", "syntax", "typing",
    "type", "typed", "typescript", "python", "java", "rust", "go",
  ],
  privacy: [
    "privacy", "pii", "anonymize", "anonymise", "redact", "mask", "leak", "expose",
    "sensitive", "confidential", "gdpr", "consent",
  ],
};

/** stem → concept ids. Multi-word entries are tokenised and each word registered. */
const STEM_TO_CONCEPTS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const [concept, words] of Object.entries(CONCEPT_CLUSTERS)) {
    for (const entry of words) {
      for (const tok of tokenize(entry)) {
        let set = map.get(tok);
        if (!set) map.set(tok, (set = new Set()));
        set.add(concept);
      }
    }
  }
  return map;
})();

/** Concepts a (stemmed) term belongs to. Empty when the term is not in the lexicon. */
export function conceptsForTerm(stemmed: string): string[] {
  const set = STEM_TO_CONCEPTS.get(stemmed);
  return set ? [...set] : [];
}

/**
 * Concepts that dominate a list of terms. A concept is returned when it is
 * supported by at least `minSupport` distinct terms, or when the term list is a
 * single term (queries are short; a lone "login" should still activate `auth`).
 */
export function conceptsForTerms(terms: readonly string[], minSupport = 1): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const t of terms) {
    if (seen.has(t)) continue;
    seen.add(t);
    for (const c of conceptsForTerm(t)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [c, n] of counts) if (n < minSupport) counts.delete(c);
  return counts;
}

/** All stemmed terms belonging to a concept (for query expansion). */
export function termsForConcept(concept: string): string[] {
  const words = CONCEPT_CLUSTERS[concept];
  if (!words) return [];
  const out = new Set<string>();
  for (const w of words) for (const t of tokenize(w)) out.add(t);
  return [...out];
}

export { stem };

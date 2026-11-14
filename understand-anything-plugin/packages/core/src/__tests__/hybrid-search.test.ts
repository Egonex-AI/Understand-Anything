import { describe, it, expect } from "vitest";
import type { GraphEdge, GraphNode } from "../types.js";
import { HybridSearchEngine } from "../semantic/index.js";

let counter = 0;
function node(partial: Partial<GraphNode> & { name: string }): GraphNode {
  counter++;
  return {
    id: partial.id ?? `${partial.type ?? "function"}:src/${partial.name}:${counter}`,
    type: partial.type ?? "function",
    name: partial.name,
    filePath: partial.filePath,
    summary: partial.summary ?? "",
    tags: partial.tags ?? [],
    complexity: "simple",
  };
}
const edge = (source: string, target: string, type: GraphEdge["type"] = "contains"): GraphEdge => ({
  source,
  target,
  type,
  direction: "forward",
  weight: 1,
});

// A small, realistic e-commerce graph: summaries are written the way the analysis
// pipeline writes them, with no attempt to repeat the query words.
const issueToken = node({
  name: "issueSessionToken",
  filePath: "src/auth/session.ts",
  summary: "Creates a signed JWT for the authenticated user and stores the session cookie.",
  tags: ["security"],
});
const hashPw = node({
  name: "hashPassword",
  filePath: "src/auth/password.ts",
  summary: "Salts and hashes a plaintext password using bcrypt before it is stored.",
});
const charge = node({
  name: "chargeCard",
  filePath: "src/billing/charge.ts",
  summary: "Bills the customer through Stripe and records the invoice.",
  tags: ["payment"],
});
const runMigration = node({
  name: "runMigrations",
  filePath: "src/db/migrate.ts",
  summary: "Applies pending SQL schema changes to the Postgres database.",
});
const renderChart = node({
  name: "renderBarChart",
  filePath: "src/ui/chart.tsx",
  summary: "Draws a bar chart with axis labels on a canvas.",
});
const sendMail = node({
  name: "sendWelcomeEmail",
  filePath: "src/notify/mail.ts",
  summary: "Sends the onboarding email to a newly registered customer.",
});
const authFile = node({
  id: "file:src/auth/session.ts",
  type: "file",
  name: "session.ts",
  filePath: "src/auth/session.ts",
  summary: "Module for request handling helpers.",
});
const configFile = node({
  type: "config",
  name: "settings.yaml",
  filePath: "config/settings.yaml",
  summary: "Application settings and environment defaults.",
});

const nodes = [issueToken, hashPw, charge, runMigration, renderChart, sendMail, authFile, configFile];
const edges = [edge(authFile.id, issueToken.id)];

const engine = () => new HybridSearchEngine(nodes, edges);
const ids = (rs: { nodeId: string }[]) => rs.map((r) => r.nodeId);

describe("HybridSearchEngine", () => {
  it("finds a node by concept when the query shares no literal word with it", () => {
    // "login" never appears in the summary or name of the token issuer.
    const results = engine().search("login", { limit: 5 });
    expect(ids(results.slice(0, 3))).toContain(issueToken.id);
    expect(ids(results.slice(0, 3))).toContain(hashPw.id);
  });

  it("explains a concept-only match", () => {
    const r = engine().search("login", { limit: 5 }).find((x) => x.nodeId === issueToken.id)!;
    expect(r.reasons.some((x) => x.startsWith("concept:"))).toBe(true);
  });

  it("explains literal matches by field", () => {
    const r = engine().search("password hashing", { limit: 5 }).find((x) => x.nodeId === hashPw.id)!;
    expect(r.reasons.some((x) => x.startsWith("name:") || x.startsWith("summary:"))).toBe(true);
  });

  it("ranks the paraphrase target first for a natural-language question", () => {
    const top = engine().search("how do we bill a customer", { limit: 3 });
    expect(top[0].nodeId).toBe(charge.id);
  });

  it("tolerates typos", () => {
    const top = engine().search("paymnt", { limit: 3 });
    expect(ids(top)).toContain(charge.id);
  });

  it("ranks an exact name match first", () => {
    expect(engine().search("renderBarChart")[0].nodeId).toBe(renderChart.id);
    expect(engine().search("hashpassword")[0].nodeId).toBe(hashPw.id);
  });

  it("returns scores in [0,1], best first, and is deterministic", () => {
    const a = engine().search("database schema");
    const b = engine().search("database schema");
    expect(a).toEqual(b);
    for (const r of a) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < a.length; i++) expect(a[i].score).toBeGreaterThanOrEqual(a[i - 1].score);
  });

  it("respects limit and type filters", () => {
    expect(engine().search("customer", { limit: 1 })).toHaveLength(1);
    const onlyConfig = engine().search("settings", { types: ["config"] });
    expect(onlyConfig.length).toBeGreaterThan(0);
    for (const r of onlyConfig) expect(nodes.find((n) => n.id === r.nodeId)!.type).toBe("config");
  });

  it("handles empty input, empty corpus, and stopword-only queries", () => {
    expect(engine().search("")).toEqual([]);
    expect(engine().search("   ")).toEqual([]);
    expect(new HybridSearchEngine([], []).search("anything")).toEqual([]);
    expect(() => engine().search("the of and")).not.toThrow();
  });

  it("does not crash on edges that reference unknown nodes", () => {
    const e = new HybridSearchEngine(nodes, [edge("nope", "nada"), edge(authFile.id, "ghost")]);
    expect(e.search("session").length).toBeGreaterThan(0);
  });

  describe("graph awareness (opt-in)", () => {
    it("is off by default", () => {
      const results = engine().search("jwt session token", { limit: 10 });
      for (const r of results) expect(r.reasons.some((x) => x.startsWith("near:"))).toBe(false);
    });

    it("surfaces a container whose child matches, and says why", () => {
      // The file's own summary says nothing about auth; only its child does.
      const withGraph = engine().search("jwt session token", { limit: 10, graphBoost: true });
      const hit = withGraph.find((r) => r.nodeId === authFile.id)!;
      expect(hit).toBeDefined();
      expect(hit.reasons.some((x) => x.startsWith("near:"))).toBe(true);
    });

    it("can be explicitly disabled", () => {
      const without = engine().search("jwt session token", { limit: 10, graphBoost: false });
      const hit = without.find((r) => r.nodeId === authFile.id);
      // It may still match lexically through its path ("session"), but never via "near:".
      expect(hit?.reasons.some((x) => x.startsWith("near:")) ?? false).toBe(false);
    });
  });

  describe("concept fallback", () => {
    it("only kicks in when the query has few lexical hits", () => {
      // "login" has zero lexical matches → concepts answer it.
      expect(ids(engine().search("login", { limit: 5 }))).toContain(issueToken.id);

      // With many lexical matches the concept channel stays out of the way: a corpus
      // where 6 nodes literally contain "token" must not drag in unrelated auth nodes
      // just because they share the `auth` concept.
      const literal = Array.from({ length: 6 }, (_, i) =>
        node({ name: `parseToken${i}`, summary: "Splits a lexer token stream." }),
      );
      const e = new HybridSearchEngine([...literal, hashPw], []);
      expect(ids(e.search("token", { limit: 10 }))).not.toContain(hashPw.id);
    });
  });

  describe("modes", () => {
    it("keyword mode does not use the concept channel; vector mode does", () => {
      const keyword = ids(engine().search("login", { mode: "keyword", graphBoost: false }));
      const vector = ids(engine().search("login", { mode: "vector", graphBoost: false }));
      expect(keyword).not.toContain(issueToken.id);
      expect(vector).toContain(issueToken.id);
    });
  });

  describe("similarTo", () => {
    it("returns related nodes and never the node itself", () => {
      const r = engine().similarTo(issueToken.id, { limit: 5 });
      expect(ids(r)).not.toContain(issueToken.id);
      expect(ids(r)).toContain(hashPw.id);
    });

    it("returns [] for an unknown id", () => {
      expect(engine().similarTo("nope")).toEqual([]);
    });
  });

  describe("update", () => {
    it("rebuilds the index for a new corpus", () => {
      const e = engine();
      const fresh = node({ name: "retryWithBackoff", summary: "Retries a failing request with exponential delay." });
      e.update([fresh], []);
      expect(e.size).toBe(1);
      expect(ids(e.search("retry"))).toEqual([fresh.id]);
      expect(e.search("password")).toEqual([]);
    });
  });

  describe("pseudo-relevance feedback (opt-in)", () => {
    it("runs without error and still returns the top hit", () => {
      const r = engine().search("password", { feedback: true, limit: 3 });
      expect(r[0].nodeId).toBe(hashPw.id);
    });
  });

  describe("scale", () => {
    it("indexes and searches a few thousand nodes quickly", () => {
      const words = ["parse", "render", "cache", "token", "graph", "layout", "export", "theme", "queue", "route"];
      const many: GraphNode[] = [];
      for (let i = 0; i < 3000; i++) {
        many.push(
          node({
            name: `${words[i % 10]}Item${i}`,
            filePath: `src/mod${i % 50}/file${i}.ts`,
            summary: `Handles ${words[(i * 3) % 10]} work for module ${i % 50} and ${words[(i * 7) % 10]} data.`,
          }),
        );
      }
      const t0 = performance.now();
      const e = new HybridSearchEngine(many, []);
      const build = performance.now() - t0;
      const t1 = performance.now();
      const r = e.search("cache token", { limit: 20 });
      const query = performance.now() - t1;
      expect(r.length).toBeGreaterThan(0);
      expect(build).toBeLessThan(5000);
      expect(query).toBeLessThan(1000);
    });
  });
});

describe("hash-collision robustness", () => {
  it("does not return unrelated nodes for a query that matches only by concept", () => {
    const mk = (name: string, filePath: string, summary: string) => node({ name, filePath, summary });
    const e = new HybridSearchEngine(
      [
        mk("issueSessionToken", "src/auth/session.ts", "Creates a signed JWT for the authenticated user."),
        mk("renderBarChart", "src/ui/chart.tsx", "Draws a bar chart with axis labels."),
        mk("sendWelcomeEmail", "src/notify/mail.ts", "Sends the onboarding email to a new customer."),
      ],
      [],
    );
    const r = e.search("where is login handled?", { limit: 5 });
    expect(r.map((x) => x.nodeId.split(":")[1].replace(/^src\//, "").replace(/:\d+$/, ""))).toEqual(["issueSessionToken"]);
  });
});

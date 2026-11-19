import { describe, it, expect } from "vitest";
import {
  splitIdentifier,
  stem,
  tokenize,
  conceptsForTerm,
  conceptsForTerms,
  extractFeatures,
  toSparseVector,
  sparseDot,
} from "../semantic/index.js";

describe("splitIdentifier", () => {
  it("splits camelCase, snake_case, kebab-case and digits", () => {
    expect(splitIdentifier("getUserByID")).toEqual(["get", "user", "by", "id"]);
    expect(splitIdentifier("parse_file-path")).toEqual(["parse", "file", "path"]);
    expect(splitIdentifier("HTTPServer2")).toEqual(["http", "server", "2"]);
  });
});

describe("stem", () => {
  it("collapses inflections of the same word to one stem", () => {
    for (const group of [
      ["save", "saved", "saving", "saves"],
      ["cache", "cached", "caching", "caches"],
      ["file", "files"],
      ["parse", "parsed", "parsing", "parses"],
      ["query", "queries"],
      ["authenticate", "authentication", "authenticating"],
      ["normalize", "normalization", "normalizing"],
      ["run", "running"],
    ]) {
      const stems = new Set(group.map(stem));
      expect(stems.size, group.join("/")).toBe(1);
    }
  });

  it("leaves short words alone", () => {
    expect(stem("api")).toBe("api");
    expect(stem("db")).toBe("db");
  });
});

describe("tokenize", () => {
  it("drops stopwords and splits identifiers inside free text", () => {
    const tokens = tokenize("How do we authenticateUser() in the API?");
    expect(tokens).toEqual(tokenize("authenticate user api"));
    expect(tokens).not.toContain("how");
    expect(tokens).not.toContain("the");
  });

  it("drops path noise only in path mode", () => {
    expect(tokenize("src/auth/login.ts", { path: true })).toEqual(["auth", "login"]);
    expect(tokenize("src/auth/login.ts")).toContain("src");
  });

  it("returns [] for empty / stopword-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("the of and")).toEqual([]);
  });
});

describe("concept lexicon", () => {
  it("maps different surface words to the same concept", () => {
    expect(conceptsForTerm(stem("login"))).toContain("auth");
    expect(conceptsForTerm(stem("jwt"))).toContain("auth");
    expect(conceptsForTerm(stem("zzzunknownzzz"))).toEqual([]);
  });

  it("counts supporting terms per concept", () => {
    const m = conceptsForTerms(["login", "password", "cache"].map(stem));
    expect(m.get("auth")).toBe(2);
    expect(m.get("cache")).toBe(1);
  });
});

describe("hashing embedder", () => {
  const idf = () => 1;

  it("is deterministic and L2-normalised with ascending indices", () => {
    const f = extractFeatures({ name: "authenticateUser", summary: "Checks the password and issues a token" });
    const a = toSparseVector(f, idf, 4096);
    const b = toSparseVector(f, idf, 4096);
    expect([...a.idx]).toEqual([...b.idx]);
    expect([...a.val]).toEqual([...b.val]);
    const norm = Math.sqrt([...a.val].reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
    for (let i = 1; i < a.idx.length; i++) expect(a.idx[i]).toBeGreaterThan(a.idx[i - 1]);
  });

  it("scores related text above unrelated text", () => {
    const vec = (s: string) => toSparseVector(extractFeatures({ summary: s }), idf, 4096);
    const base = vec("verify the user password and issue a session token");
    const related = vec("login flow that checks credentials");
    const unrelated = vec("render a bar chart with axis labels");
    expect(sparseDot(base, related)).toBeGreaterThan(sparseDot(base, unrelated));
    expect(sparseDot(base, base)).toBeCloseTo(1, 5);
  });
});

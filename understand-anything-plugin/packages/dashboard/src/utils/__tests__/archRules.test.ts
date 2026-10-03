import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { edgeKey } from "../dependencies";
import { evaluateRules, formatRule, globToRegExp, parseRuleText, type ArchRule } from "../archRules";

function node(id: string, filePath?: string, type: GraphNode["type"] = "file"): GraphNode {
  return { id, type, name: id.split(":").pop() ?? id, filePath, summary: "", tags: [], complexity: "simple" };
}

function edge(source: string, target: string, type: GraphEdge["type"] = "imports"): GraphEdge {
  return { source, target, type, direction: "forward", weight: 1 };
}

type G = Pick<KnowledgeGraph, "nodes" | "edges" | "layers">;

// ui → service → db, plus a function inside db called from a ui function.
const graph: G = {
  nodes: [
    node("ui", "src/ui/App.tsx"),
    node("ui-fn", "src/ui/App.tsx", "function"),
    node("svc", "src/service/users.ts"),
    node("db", "src/db/client.ts"),
    node("db-fn", "src/db/client.ts", "function"),
    node("test", "tests/db.test.ts"),
    node("cfg", "config/db.toml", "config"),
    node("doc", "README.md", "document"),
  ],
  edges: [
    edge("ui", "ui-fn", "contains"),
    edge("db", "db-fn", "contains"),
    edge("ui", "svc"),
    edge("svc", "db"),
    edge("ui-fn", "db-fn", "calls"),
    edge("db", "test", "tested_by"),
    edge("cfg", "db", "configures"),
    edge("doc", "ui", "related"),
  ],
  layers: [
    { id: "layer:ui", name: "UI", description: "", nodeIds: ["ui"] },
    { id: "layer:data", name: "Data Access", description: "", nodeIds: ["db"] },
    { id: "layer:service", name: "Service", description: "", nodeIds: ["svc"] },
  ],
};

describe("globToRegExp", () => {
  it("handles **, *, ?, braces and plain prefixes", () => {
    expect(globToRegExp("src/ui/**").test("src/ui/a/b.tsx")).toBe(true);
    expect(globToRegExp("src/ui/**").test("src/uix/a.tsx")).toBe(false);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/x/a.ts")).toBe(false);
    expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/x/y/a.ts")).toBe(true);
    expect(globToRegExp("**/*.test.ts").test("tests/db.test.ts")).toBe(true);
    expect(globToRegExp("src/?.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/{ui,db}/**").test("src/db/x.ts")).toBe(true);
    expect(globToRegExp("src/{ui,db}/**").test("src/svc/x.ts")).toBe(false);
    expect(globToRegExp("src/ui").test("src/ui/App.tsx")).toBe(true);
    expect(globToRegExp("./src/ui/").test("src/ui/App.tsx")).toBe(true);
    expect(globToRegExp("src/ui").test("src/uix.ts")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
    expect(() => globToRegExp("src/{a,b")).toThrow();
  });
});

describe("parseRuleText / formatRule", () => {
  it("round-trips the arrow syntax", () => {
    expect(parseRuleText("src/ui/** -/-> src/db/**")).toEqual({ from: "src/ui/**", to: "src/db/**" });
    expect(parseRuleText("layer:ui !-> layer:data")).toEqual({ from: "layer:ui", to: "layer:data" });
    expect(parseRuleText("src/ui/** src/db/**")).toBeNull();
    expect(formatRule({ from: "a", to: "b" })).toBe("a -/-> b");
  });
});

describe("evaluateRules", () => {
  const rule = (id: string, from: string, to: string, enabled = true): ArchRule => ({
    id,
    from,
    to,
    description: "",
    enabled,
  });

  it("flags edges matching path globs, including function-level calls", () => {
    const r = evaluateRules(graph, [rule("r1", "src/ui/**", "src/db/**")]);
    expect(r.violations.map((v) => `${v.dependent}->${v.dependency}`)).toEqual(["ui-fn->db-fn"]);
    expect([...r.nodeIds].sort()).toEqual(["db", "db-fn", "ui", "ui-fn"]);
    expect(r.edgeKeys.has(edgeKey("ui-fn", "db-fn"))).toBe(true);
    expect(r.edgeKeys.has(edgeKey("ui", "db"))).toBe(true);
  });

  it("matches layers by id, bare id or name", () => {
    for (const [from, to] of [
      ["layer:layer:ui", "layer:layer:service"],
      ["layer:ui", "layer:service"],
      ["layer:UI", "layer:Service"],
    ]) {
      const r = evaluateRules(graph, [rule("r", from, to)]);
      expect(r.violations.map((v) => `${v.dependent}->${v.dependency}`)).toEqual(["ui->svc"]);
    }
    // Functions inherit their file's layer.
    const fn = evaluateRules(graph, [rule("r", "layer:ui", "layer:Data Access")]);
    expect(fn.violations.map((v) => `${v.dependent}->${v.dependency}`)).toEqual(["ui-fn->db-fn"]);
  });

  it("respects reversed edge types, disabled rules and bad selectors", () => {
    const r = evaluateRules(graph, [
      rule("tests", "tests/**", "src/**"),
      rule("cfg", "src/db/**", "config/**"),
      rule("off", "src/**", "src/**", false),
      rule("bad", "src/{x", "src/**"),
    ]);
    expect(r.byRule.get("tests")?.map((v) => v.dependent)).toEqual(["test"]);
    expect(r.byRule.get("cfg")?.map((v) => v.dependency)).toEqual(["cfg"]);
    expect(r.byRule.has("off")).toBe(false);
    expect(r.invalid.has("bad")).toBe(true);
  });
});

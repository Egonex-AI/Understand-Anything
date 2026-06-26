// src/utils/__tests__/visibleTree.test.ts
import { it, expect } from "vitest";
import { buildVisibleTree } from "../visibleTree";

const N = (id: string, filePath: string, type = "file") => ({ id, name: id, type, filePath } as any);
const nodes = [
  N("f1", "repo/src/pages/New.tsx"),
  N("f2", "repo/src/pages/List.tsx"),
  N("f3", "repo/src/api/client.ts"),
];

it("function nodes (in scope) never become folder leaves; map to file's atom", () => {
  // +Classes mode: a function node shares its file's path. Expanding the folder
  // must NOT render the function as a sibling of its file.
  const fileId = "file:repo/src/api/client.ts";
  const fn = { id: "function:repo/src/api/client.ts:doThing", name: "doThing", type: "function", filePath: "repo/src/api/client.ts" } as any;
  const withFn = [N("f3", "repo/src/api/client.ts"), { ...N("f3b", "repo/src/api/client.ts"), id: fileId }, fn];
  // expand the api folder but NOT the file
  const t = buildVisibleTree({
    scopeNodes: withFn, edges: [], rootPrefix: "repo",
    expanded: new Set(["container:repo/src/api"]),
    fileChildrenOf: () => [],
  });
  // the function must NOT be a rendered node
  expect(t.nodes.find((n) => n.id === fn.id)).toBeUndefined();
  // but it must still resolve to its file's visible atom (the file box) for edges
  expect(t.visibleAtomOf.get(fn.id)).toBe(fileId);
});

it("collapsed: clusters are boxes, descendants map to the box", () => {
  const t = buildVisibleTree({ scopeNodes: nodes, edges: [], rootPrefix: "repo", expanded: new Set(), fileChildrenOf: () => [] });
  const ids = t.nodes.filter(n => n.kind === "cluster").map(n => n.id).sort();
  expect(ids).toEqual(["container:repo/src/api", "container:repo/src/pages"]);
  expect(t.visibleAtomOf.get("f1")).toBe("container:repo/src/pages");
  expect(t.visibleAtomOf.get("f3")).toBe("container:repo/src/api");
});

it("expanded cluster: files become visible nodes parented to it", () => {
  const t = buildVisibleTree({ scopeNodes: nodes, edges: [], rootPrefix: "repo", expanded: new Set(["container:repo/src/pages"]), fileChildrenOf: () => [] });
  const f1 = t.nodes.find(n => n.id === "f1");
  expect(f1?.kind).toBe("node");
  expect(f1?.parentId).toBe("container:repo/src/pages");
  expect(t.visibleAtomOf.get("f1")).toBe("f1");
  expect(t.visibleAtomOf.get("f3")).toBe("container:repo/src/api");
});

it("expanded file: functions nest under the file", () => {
  const fn = N("fn1", "repo/src/pages/New.tsx", "function");
  const t = buildVisibleTree({
    scopeNodes: nodes, edges: [], rootPrefix: "repo",
    expanded: new Set(["container:repo/src/pages", "file:repo/src/pages/New.tsx"]),
    fileChildrenOf: (id) => id === "f1" ? [fn] : [],
  });
  const fnNode = t.nodes.find(n => n.id === "fn1");
  expect(fnNode?.parentId).toBe("f1");
  expect(t.visibleAtomOf.get("fn1")).toBe("fn1");
});

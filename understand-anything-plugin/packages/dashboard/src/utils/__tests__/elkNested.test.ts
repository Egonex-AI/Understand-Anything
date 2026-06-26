// src/utils/__tests__/elkNested.test.ts
import { it, expect } from "vitest";
import { layoutNestedTree } from "../elkNested";

const vnode = (o: any) => ({ childCount: 0, expanded: false, ...o });

it("nests children inside parents, sizes parent to fit, no sibling overlap", async () => {
  const nodes = [
    vnode({ id:"container:pages", kind:"cluster", name:"pages", parentId:null, expanded:true }),
    vnode({ id:"f1", kind:"node", name:"New.tsx", parentId:"container:pages" }),
    vnode({ id:"f2", kind:"node", name:"List.tsx", parentId:"container:pages" }),
    vnode({ id:"container:api", kind:"cluster", name:"api", parentId:null }),
  ];
  const { positioned } = await layoutNestedTree(nodes, []);
  const byId = Object.fromEntries(positioned.map(n => [n.id, n]));
  const pages = byId["container:pages"], f1 = byId["f1"], api = byId["container:api"];
  expect(pages && f1 && api).toBeTruthy();
  // child inside parent bounds (absolute coords)
  expect(f1.x).toBeGreaterThanOrEqual(pages.x);
  expect(f1.y).toBeGreaterThanOrEqual(pages.y);
  expect(f1.x + f1.width).toBeLessThanOrEqual(pages.x + pages.width + 1);
  // parent grew beyond the collapsed header size
  expect(pages.width).toBeGreaterThan(220);
  // siblings (pages vs api) do not overlap
  const overlap = !(pages.x+pages.width<=api.x || api.x+api.width<=pages.x || pages.y+pages.height<=api.y || api.y+api.height<=pages.y);
  expect(overlap).toBe(false);
});

it("returns parentId for nested nodes and null for roots", async () => {
  const nodes = [
    vnode({ id:"container:pages", kind:"cluster", name:"pages", parentId:null, expanded:true }),
    vnode({ id:"f1", kind:"node", name:"New.tsx", parentId:"container:pages" }),
  ];
  const { positioned } = await layoutNestedTree(nodes, []);
  expect(positioned.find(n=>n.id==="container:pages")!.parentId).toBeNull();
  expect(positioned.find(n=>n.id==="f1")!.parentId).toBe("container:pages");
});

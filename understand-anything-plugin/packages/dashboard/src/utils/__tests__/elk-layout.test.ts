import { describe, it, expect } from "vitest";
import { applyElkLayout, repairElkInput, type ElkInput } from "../elk-layout";

describe("repairElkInput", () => {
  it("ensures node dimensions when missing", () => {
    const input: ElkInput = {
      id: "root",
      children: [{ id: "a" }, { id: "b", width: 100, height: 50 }] as ElkInput["children"],
      edges: [],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.children![0].width).toBeGreaterThan(0);
    expect(out.children![0].height).toBeGreaterThan(0);
    expect(out.children![1]).toEqual({ id: "b", width: 100, height: 50 });
    expect(issues.some((i) => i.level === "auto-corrected" && /dimensions/.test(i.message))).toBe(true);
  });

  it("dedupes duplicate child ids and reports auto-corrected", () => {
    const input: ElkInput = {
      id: "root",
      children: [
        { id: "a", width: 1, height: 1 },
        { id: "a", width: 1, height: 1 },
      ],
      edges: [],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.children).toHaveLength(1);
    expect(issues.some((i) => i.level === "auto-corrected" && /duplicate/.test(i.message))).toBe(true);
  });

  it("drops orphan edges referencing nonexistent nodes", () => {
    const input: ElkInput = {
      id: "root",
      children: [{ id: "a", width: 1, height: 1 }],
      edges: [
        { id: "e1", sources: ["a"], targets: ["ghost"] },
      ],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.edges).toHaveLength(0);
    expect(issues.some((i) => i.level === "dropped" && /edge/.test(i.message))).toBe(true);
  });

  it("drops edges pointing at children removed by the orphan-child pass", () => {
    const input: ElkInput = {
      id: "root",
      children: [
        { id: "a", width: 1, height: 1 },
        { id: "orphan", width: 1, height: 1, parentId: "ghost" } as ElkInput["children"][0] & { parentId: string },
      ],
      edges: [{ id: "e1", sources: ["a"], targets: ["orphan"] }],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.children!.find((c) => c.id === "orphan")).toBeUndefined();
    expect(out.edges).toHaveLength(0);
    expect(issues.some((i) => i.level === "dropped" && i.category === "elk-orphan-edge")).toBe(true);
  });

  it("drops edges pointing at a node removed by the containment-cycle pass", () => {
    // x and y mutually contain each other (via shared ids at different levels),
    // so fillParents records parentOf(x)=y and parentOf(y)=x and the cycle pass
    // removes both. An edge targeting x must then be reconciled away by step 5.
    const input: ElkInput = {
      id: "root",
      children: [
        { id: "x", width: 1, height: 1, children: [{ id: "y", width: 1, height: 1 }] },
        { id: "y", width: 1, height: 1, children: [{ id: "x", width: 1, height: 1 }] },
        { id: "a", width: 1, height: 1 },
      ] as ElkInput["children"],
      edges: [{ id: "e1", sources: ["a"], targets: ["x"] }],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.children!.find((c) => c.id === "x")).toBeUndefined();
    expect(out.children!.find((c) => c.id === "y")).toBeUndefined();
    expect(out.edges).toHaveLength(0);
    expect(
      issues.some((i) => i.level === "dropped" && i.category === "elk-containment-cycle"),
    ).toBe(true);
    expect(
      issues.some(
        (i) =>
          i.level === "dropped" &&
          i.category === "elk-orphan-edge" &&
          /\be1\b/.test(i.message),
      ),
    ).toBe(true);
  });

  it("drops edges pointing at a nested grandchild carried out by an orphan-child parent drop", () => {
    // Parent `p` has a missing parentId, so the orphan-child pass (step 3) drops
    // it AND its whole subtree, including the nested grandchild `gc`. An edge
    // targeting `gc` must be reconciled away by step 5 even though no pass
    // explicitly tracked `gc` being removed.
    const input: ElkInput = {
      id: "root",
      children: [
        { id: "a", width: 1, height: 1 },
        {
          id: "p",
          width: 1,
          height: 1,
          parentId: "ghost",
          children: [{ id: "gc", width: 1, height: 1 }],
        } as ElkInput["children"][0] & { parentId: string },
      ],
      edges: [{ id: "e1", sources: ["a"], targets: ["gc"] }],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.children!.find((c) => c.id === "p")).toBeUndefined();
    expect(out.edges).toHaveLength(0);
    expect(
      issues.some(
        (i) =>
          i.level === "dropped" &&
          i.category === "elk-orphan-edge" &&
          /\be1\b/.test(i.message),
      ),
    ).toBe(true);
  });

  it("includes dropped edge ids in the orphan-edge message so distinct losses survive level|message dedupe", () => {
    const runOne: ElkInput = {
      id: "root",
      children: [{ id: "a", width: 1, height: 1 }],
      edges: [{ id: "e1", sources: ["a"], targets: ["ghost"] }],
    };
    const runTwo: ElkInput = {
      id: "root",
      children: [{ id: "a", width: 1, height: 1 }],
      edges: [{ id: "e2", sources: ["a"], targets: ["ghost"] }],
    };
    const msgOne = repairElkInput(runOne).issues.find(
      (i) => i.category === "elk-orphan-edge",
    )!.message;
    const msgTwo = repairElkInput(runTwo).issues.find(
      (i) => i.category === "elk-orphan-edge",
    )!.message;
    expect(msgOne).toContain("e1");
    expect(msgTwo).toContain("e2");
    // Distinct dropped edges must yield distinct messages, otherwise store.ts
    // appendLayoutIssues (dedupe by `level|message`) swallows the second loss.
    expect(msgOne).not.toEqual(msgTwo);
  });

  it("drops children referencing nonexistent parents", () => {
    const input: ElkInput = {
      id: "root",
      children: [
        {
          id: "p",
          width: 100,
          height: 100,
          children: [{ id: "c1", width: 1, height: 1 }],
        },
        { id: "orphan", width: 1, height: 1, parentId: "ghost" } as ElkInput["children"][0] & { parentId: string },
      ],
      edges: [],
    };
    const { input: out, issues } = repairElkInput(input);
    expect(out.children!.find((c) => c.id === "orphan")).toBeUndefined();
    expect(issues.some((i) => i.level === "dropped" && /parent/.test(i.message))).toBe(true);
  });

  it("strict mode throws on any issue", () => {
    const input: ElkInput = {
      id: "root",
      children: [{ id: "a" }] as ElkInput["children"],
      edges: [],
    };
    expect(() => repairElkInput(input, { strict: true })).toThrow(/dimensions/);
  });
});

describe("applyElkLayout", () => {
  it("lays out a small graph and returns positions", async () => {
    const result = await applyElkLayout({
      id: "root",
      children: [
        { id: "a", width: 100, height: 50 },
        { id: "b", width: 100, height: 50 },
      ],
      edges: [{ id: "e1", sources: ["a"], targets: ["b"] }],
      layoutOptions: { algorithm: "layered", "elk.direction": "DOWN" },
    });
    expect(result.issues).toEqual([]);
    expect(result.positioned.children).toHaveLength(2);
    for (const c of result.positioned.children) {
      expect(typeof c.x).toBe("number");
      expect(typeof c.y).toBe("number");
    }
  });

  it("returns fatal issue when ELK rejects (without throwing in non-strict)", async () => {
    // Force ELK rejection by giving an invalid algorithm
    const result = await applyElkLayout(
      {
        id: "root",
        children: [{ id: "a", width: 1, height: 1 }],
        edges: [],
        layoutOptions: { algorithm: "this-algorithm-does-not-exist" },
      },
      { strict: false },
    );
    expect(result.issues.some((i) => i.level === "fatal")).toBe(true);
  });
});

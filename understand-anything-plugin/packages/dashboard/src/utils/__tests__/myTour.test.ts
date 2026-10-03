import { describe, it, expect } from "vitest";
import { buildMyTourSteps } from "../myTour";
import { orderAnnotatedNodes } from "../annotatedNodes";
import { notesAnnotations, notesGraph } from "./notesFixture";

describe("buildMyTourSteps", () => {
  const graph = notesGraph();
  const annotations = notesAnnotations();
  const steps = buildMyTourSteps(graph, orderAnnotatedNodes(graph, annotations), annotations);

  it("makes one ordered step per annotated node", () => {
    expect(steps.map((s) => [s.order, s.title])).toEqual([
      [1, "util.ts"],
      [2, "api.ts"],
      [3, "handler"],
      [4, "handler"],
      [5, "db.ts"],
    ]);
  });

  it("uses the note as description, then line notes and tags", () => {
    expect(steps[1].description).toBe("Starts **here**.\n\n`#entry point`");
    expect(steps[2].description).toBe(
      "Main handler.\n\n**Line notes**\n\n- **Line 12:** auth check\n- **Line 15:** validate input here\n\n`#Entry Point`",
    );
    expect(steps[0].description).toBe("_No note yet._\n\n`#helpers`");
  });

  it("puts the containing file first for nodes outside any layer", () => {
    expect(steps[1].nodeIds).toEqual(["file:src/api.ts"]);
    expect(steps[2].nodeIds).toEqual(["file:src/api.ts", "fn:src/api.ts:handler"]);
    expect(steps[3].nodeIds).toEqual(["file:src/other.ts", "fn:src/other.ts:handler"]);
  });

  it("skips ids without a node or annotation and accepts labels", () => {
    const out = buildMyTourSteps(graph, ["file:gone.ts", "file:src/util.ts", "file:src/other.ts"], annotations, {
      lineNotes: "行注释",
      line: "第 {line} 行",
      noNote: "暂无笔记",
    });
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("_暂无笔记_\n\n`#helpers`");
  });
});

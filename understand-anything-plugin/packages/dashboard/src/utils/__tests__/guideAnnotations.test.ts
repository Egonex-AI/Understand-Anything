import { describe, expect, it } from "vitest";
import { buildGuideLines } from "../guideAnnotations";

describe("buildGuideLines", () => {
  it("reattaches annotations when an anchor moves to a different line", () => {
    const lines = buildGuideLines(
      ["const intro = true;", "const target = run();", "const outro = true;"].join("\n"),
      "typescript",
      [
        {
          line: 1,
          anchor: "const target = run();",
          text: "Target explanation.",
        },
      ],
    );

    const guideIndex = lines.findIndex((line) => line.isGuideComment);
    expect(guideIndex).toBeGreaterThan(0);
    expect(lines[guideIndex].text).toContain("Target explanation. (moved from line 1)");
    expect(lines[guideIndex + 1]).toMatchObject({
      text: "const target = run();",
      lineNumber: 2,
      isGuideComment: false,
    });
  });

  it("marks an annotation stale when its anchor cannot be found", () => {
    const lines = buildGuideLines(
      ["const intro = true;", "const target = run();"].join("\n"),
      "typescript",
      [
        {
          line: 2,
          anchor: "missingAnchor()",
          text: "Old explanation.",
        },
      ],
    );

    const guideLine = lines.find((line) => line.isGuideComment);
    expect(guideLine?.text).toContain("[stale anchor] Old explanation.");
  });
});

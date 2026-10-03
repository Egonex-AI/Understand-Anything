import { describe, expect, it } from "vitest";
import { explanationForPersona } from "../explanationSections";

const full = [
  "## 役割", "役割の説明。",
  "## 呼ばれる場面", "呼び出しの説明。",
  "## 入出力", "入出力の説明。",
  "## 主な処理", "処理の説明。",
  "## 依存・データの流れ", "依存の説明。",
  "## 変更時の影響", "影響の説明。",
  "## 初心者向けまとめ", "初心者向けの説明。",
  "## 根拠", "根拠の説明。",
].join("\n\n");

describe("explanationForPersona", () => {
  it("keeps the full persisted Markdown for experienced readers", () => {
    expect(explanationForPersona(full, "experienced")).toBe(full);
  });

  it("selects only the beginner summary for non-technical readers", () => {
    expect(explanationForPersona(full, "non-technical")).toBe("## 初心者向けまとめ\n\n初心者向けの説明。");
  });

  it("selects junior sections in canonical source order", () => {
    expect(explanationForPersona(full, "junior")).toBe([
      "## 役割\n\n役割の説明。",
      "## 主な処理\n\n処理の説明。",
      "## 依存・データの流れ\n\n依存の説明。",
      "## 初心者向けまとめ\n\n初心者向けの説明。",
    ].join("\n\n"));
  });

  it("handles CRLF and heading whitespace", () => {
    expect(explanationForPersona("  ## 初心者向けまとめ  \r\n\r\n読みやすい説明。", "non-technical"))
      .toBe("## 初心者向けまとめ\n\n読みやすい説明。");
  });

  it("uses the first non-empty duplicate and ignores unknown headings", () => {
    const source = "## 未知\n秘密\n\n## 初心者向けまとめ\n最初\n\n## 初心者向けまとめ\n次\n";
    expect(explanationForPersona(source, "non-technical")).toBe("## 初心者向けまとめ\n\n最初");
  });

  it("allows a valid duplicate after an empty duplicate", () => {
    const source = "## 初心者向けまとめ\n\n## 初心者向けまとめ\n有効な説明。";
    expect(explanationForPersona(source, "non-technical")).toBe("## 初心者向けまとめ\n\n有効な説明。");
  });

  it("treats headings inside backtick and tilde fences as body content", () => {
    const source = [
      "## 役割", "実際の役割。", "```md", "## 初心者向けまとめ", "```",
      "~~~text", "## 初心者向けまとめ", "~~~",
    ].join("\n");
    expect(explanationForPersona(source, "non-technical")).toBeNull();
    expect(explanationForPersona(source, "junior")).toBe("## 役割\n\n実際の役割。\n```md\n## 初心者向けまとめ\n```\n~~~text\n## 初心者向けまとめ\n~~~");
  });

  it("does not leak a full explanation when expected headings are absent", () => {
    expect(explanationForPersona("## Overview\nOnly English headings.", "junior")).toBeNull();
  });
});

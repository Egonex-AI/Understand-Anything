import { describe, expect, it } from "vitest";
import { toMessages, type Turn } from "../conversation";

const done = (question: string, answer: string): Turn => ({ question, answer, status: "done" });

describe("toMessages", () => {
  it("puts the node context on the first question only", () => {
    const msgs = toMessages("CTX", [done("q1", "a1"), { question: "q2", answer: "", status: "streaming" }]);
    expect(msgs).toEqual([
      { role: "user", content: "CTX\n\n# Question\nq1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
  });

  it("drops failed turns but keeps the context on the first kept question", () => {
    const msgs = toMessages("CTX", [
      { question: "q1", answer: "", status: "error", error: "boom" },
      { question: "q2", answer: "", status: "streaming" },
    ]);
    expect(msgs).toEqual([{ role: "user", content: "CTX\n\n# Question\nq2" }]);
  });

  it("keeps a stopped turn's partial answer so roles alternate", () => {
    const msgs = toMessages("CTX", [
      { question: "q1", answer: "partial", status: "stopped" },
      { question: "q2", answer: "", status: "streaming" },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

import type { ChatMessage } from "./aiClient";

export interface Turn {
  question: string;
  answer: string;
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
  stopReason?: string | null;
  servedBy?: string;
}

/**
 * Provider messages for a conversation: turns without an answer (failed) are
 * dropped so roles keep alternating, and the node context rides on the first
 * question that is sent.
 */
export function toMessages(context: string, turns: Turn[]): ChatMessage[] {
  const last = turns.length - 1;
  const kept = turns.filter((turn, i) => i === last || (turn.status !== "streaming" && turn.answer));
  return kept.flatMap((turn, i) => {
    const question: ChatMessage = {
      role: "user",
      content: i === 0 ? `${context}\n\n# Question\n${turn.question}` : turn.question,
    };
    return i === kept.length - 1 ? [question] : [question, { role: "assistant" as const, content: turn.answer }];
  });
}

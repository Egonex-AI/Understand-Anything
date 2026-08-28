import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const requestCalls: Array<{ options: unknown; response: FakeResponse }> = [];

class FakeResponse extends EventEmitter {
  respond(body: string): void {
    // setImmediate (a macrotask), not queueMicrotask — the response callback
    // itself is scheduled via queueMicrotask below, and its "data"/"end"
    // listeners are only attached once that callback runs. Emitting on a
    // microtask here could still race ahead of it; a macrotask guarantees
    // the callback (and its listener registration) has already run.
    setImmediate(() => {
      this.emit("data", Buffer.from(body));
      this.emit("end");
    });
  }
}

class FakeRequest extends EventEmitter {
  write(): void {}
  end(): void {}
  destroy(): void {}
  setTimeout(): void {}
}

vi.mock("node:https", () => ({
  default: {
    request: (options: unknown, callback: (res: FakeResponse) => void) => {
      const res = new FakeResponse();
      const req = new FakeRequest();
      requestCalls.push({ options, response: res });
      // Defer so the caller can attach its own listeners first, matching real https.request timing.
      queueMicrotask(() => callback(res));
      return req;
    },
  },
}));

const { createLlmCaller } = await import("../llm.js");

describe("createLlmCaller", () => {
  it("extracts the text block when it's the first content block (the common case)", async () => {
    const call = createLlmCaller("fake-key", "claude-sonnet-5");
    const promise = call("system", "user content");

    requestCalls[requestCalls.length - 1].response.respond(
      JSON.stringify({ content: [{ type: "text", text: "the answer" }] }),
    );

    expect(await promise).toBe("the answer");
  });

  it("finds the text block even when a thinking block comes first (regression: extended thinking puts content[0] as type=thinking, not text)", async () => {
    const call = createLlmCaller("fake-key", "claude-sonnet-5");
    const promise = call("system", "user content");

    requestCalls[requestCalls.length - 1].response.respond(
      JSON.stringify({
        content: [
          { type: "thinking", thinking: "internal reasoning...", signature: "abc" },
          { type: "text", text: "the real answer" },
        ],
      }),
    );

    expect(await promise).toBe("the real answer");
  });

  it("rejects when no content block is actually type text", async () => {
    const call = createLlmCaller("fake-key", "claude-sonnet-5");
    const promise = call("system", "user content");

    requestCalls[requestCalls.length - 1].response.respond(
      JSON.stringify({ content: [{ type: "thinking", thinking: "only thinking, no answer" }] }),
    );

    await expect(promise).rejects.toThrow(/no text block found/i);
  });

  it("rejects with the Anthropic API error message when the response is an error", async () => {
    const call = createLlmCaller("fake-key", "claude-sonnet-5");
    const promise = call("system", "user content");

    requestCalls[requestCalls.length - 1].response.respond(
      JSON.stringify({ error: { message: "overloaded_error: try again" } }),
    );

    await expect(promise).rejects.toThrow(/overloaded_error/);
  });
});

import { describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>(
    "child_process",
  );
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import { getGraphFreshness } from "../staleness.js";

describe("getGraphFreshness timeout handling", () => {
  it("returns an explicit unknown result when Git times out", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (
          error: Error & {
            code: number | null;
            killed: boolean;
            signal: string;
          },
          stdout: Buffer,
          stderr: Buffer,
        ) => void,
      ) => {
        callback(
          Object.assign(new Error("timed out"), {
            code: null,
            killed: true,
            signal: "SIGTERM",
          }),
          Buffer.alloc(0),
          Buffer.alloc(0),
        );
      },
    );

    await expect(
      getGraphFreshness("/project", { graphCommitHash: "abc123" }),
    ).resolves.toEqual({
      status: "unknown",
      reason: "git-command-timeout",
      graphCommitHash: "abc123",
    });
  });
});

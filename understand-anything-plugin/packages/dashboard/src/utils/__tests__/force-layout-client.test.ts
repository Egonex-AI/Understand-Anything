import { describe, expect, it, vi } from "vitest";
import type {
  ForceLayoutRequest,
  ForceLayoutResponse,
} from "../force-layout";
import {
  ForceLayoutCancelledError,
  startForceLayoutTask,
  type ForceLayoutWorker,
} from "../force-layout-client";

function makeWorker() {
  const worker = {
    onmessage: null,
    onmessageerror: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as ForceLayoutWorker;
  return worker;
}

function emitMessage(worker: ForceLayoutWorker, data: ForceLayoutResponse) {
  worker.onmessage?.call(
    worker as unknown as Worker,
    { data } as MessageEvent<ForceLayoutResponse>,
  );
}

const request: ForceLayoutRequest = {
  requestId: 491,
  nodes: [{ id: "node", width: 280, height: 120 }],
  edges: [],
};

describe("startForceLayoutTask", () => {
  it("posts the request, resolves the matching response, and terminates", async () => {
    const worker = makeWorker();
    const task = startForceLayoutTask(request, () => worker);
    const positions = [{ id: "node", x: 10, y: 20 }];

    expect(worker.postMessage).toHaveBeenCalledWith(request);
    emitMessage(worker, { requestId: request.requestId, positions });

    await expect(task.promise).resolves.toEqual(positions);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects a response belonging to another request", async () => {
    const worker = makeWorker();
    const task = startForceLayoutTask(request, () => worker);

    emitMessage(worker, { requestId: request.requestId - 1, positions: [] });

    await expect(task.promise).rejects.toThrow(
      `returned request ${request.requestId - 1}; expected ${request.requestId}`,
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and rejects when cancelled", async () => {
    const worker = makeWorker();
    const task = startForceLayoutTask(request, () => worker);
    const rejection = expect(task.promise).rejects.toBeInstanceOf(
      ForceLayoutCancelledError,
    );

    task.cancel();

    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects an error response from the worker", async () => {
    const worker = makeWorker();
    const task = startForceLayoutTask(request, () => worker);

    emitMessage(worker, {
      requestId: request.requestId,
      error: "simulation exploded",
    });

    await expect(task.promise).rejects.toThrow(
      "Force layout worker failed: simulation exploded",
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects when the Worker cannot be created", async () => {
    const task = startForceLayoutTask(request, () => {
      throw new Error("Workers are blocked by policy");
    });

    await expect(task.promise).rejects.toThrow("Workers are blocked by policy");
    expect(() => task.cancel()).not.toThrow();
  });
});

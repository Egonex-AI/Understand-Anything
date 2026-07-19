import type {
  ForceLayoutNode,
  ForceLayoutPosition,
  ForceLayoutRequest,
  ForceLayoutResponse,
} from "./force-layout";

export type ForceLayoutWorker = Pick<
  Worker,
  "onmessage" | "onmessageerror" | "onerror" | "postMessage" | "terminate"
>;

export class ForceLayoutCancelledError extends Error {
  constructor() {
    super("Force layout request was cancelled");
    this.name = "ForceLayoutCancelledError";
  }
}

export interface ForceLayoutTask {
  promise: Promise<ForceLayoutPosition[]>;
  cancel: () => void;
}

/**
 * Manage one worker request. Each graph revision gets a fresh worker so
 * cancellation can interrupt a long-running synchronous simulation rather
 * than merely queueing behind it.
 */
export function startForceLayoutTask(
  request: ForceLayoutRequest,
  createWorker: () => ForceLayoutWorker,
): ForceLayoutTask {
  let worker: ForceLayoutWorker;
  try {
    worker = createWorker();
  } catch (error) {
    return {
      promise: Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      ),
      cancel: () => {},
    };
  }
  let settled = false;
  let rejectTask: ((reason: unknown) => void) | undefined;

  const cleanup = () => {
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
  };

  const promise = new Promise<ForceLayoutPosition[]>((resolve, reject) => {
    rejectTask = reject;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    worker.onmessage = (event: MessageEvent<ForceLayoutResponse>) => {
      const response = event.data;
      if (settled) return;
      if (response.requestId !== request.requestId) {
        fail(
          new Error(
            `Force layout worker returned request ${response.requestId}; expected ${request.requestId}`,
          ),
        );
        return;
      }

      if ("error" in response) {
        fail(new Error(`Force layout worker failed: ${response.error}`));
        return;
      }

      settled = true;
      cleanup();
      resolve(response.positions);
    };

    worker.onmessageerror = () => {
      fail(new Error("Force layout worker returned an unreadable response"));
    };

    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      fail(new Error(event.message || "Force layout worker failed"));
    };

    try {
      worker.postMessage(request);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectTask?.(new ForceLayoutCancelledError());
    },
  };
}

/** Cheap, non-blocking fallback used only if Worker startup/execution fails. */
export function createFallbackGrid(
  nodes: ForceLayoutNode[],
): ForceLayoutPosition[] {
  if (nodes.length === 0) return [];

  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const cellWidth = nodes.reduce(
    (maximum, node) => Math.max(maximum, node.width),
    0,
  ) + 40;
  const cellHeight = nodes.reduce(
    (maximum, node) => Math.max(maximum, node.height),
    0,
  ) + 40;

  return nodes.map((node, index) => ({
    id: node.id,
    x: (index % columns) * cellWidth,
    y: Math.floor(index / columns) * cellHeight,
  }));
}

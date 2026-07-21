import {
  computeForceLayout,
  type ForceLayoutRequest,
  type ForceLayoutResponse,
} from "./force-layout";

self.onmessage = (event: MessageEvent<ForceLayoutRequest>) => {
  const { requestId, nodes, edges } = event.data;

  let response: ForceLayoutResponse;
  try {
    response = {
      requestId,
      positions: computeForceLayout(nodes, edges),
    };
  } catch (error) {
    response = {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  self.postMessage(response);
};

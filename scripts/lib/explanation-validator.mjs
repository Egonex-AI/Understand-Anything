/**
 * Required section headings for a persisted file explanation.
 *
 * Keep these exact strings in one place so the validator and its callers do
 * not accidentally drift from the file-analyzer contract.
 */
export const REQUIRED_EXPLANATION_HEADINGS = Object.freeze([
  "## 役割",
  "## 呼ばれる場面",
  "## 入出力",
  "## 主な処理",
  "## 依存・データの流れ",
  "## 変更時の影響",
  "## 初心者向けまとめ",
  "## 根拠",
]);

const VALID_EXPLANATION_STATUSES = new Set(["ready", "failed"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

/**
 * Validate persisted explanations and the basic graph references they rely
 * on.
 *
 * @param {unknown} graph A parsed knowledge graph.
 * @param {object} [options]
 * @param {number|null} [options.expectedFileNodes=null] Optional exact number
 *   of type=file nodes. Leave null for a general-purpose graph where the
 *   number of files is discovered from the graph.
 * @param {number} [options.minimumReadyRatio=0.8] Minimum ready/total file
 *   ratio, inclusive.
 * @param {boolean} [options.checkGraphIntegrity=true] Check node IDs and edge
 *   endpoints in addition to explanation fields.
 * @returns {{valid: boolean, totalFileNodes: number, expectedFileNodes: number|null,
 *   readyCount: number, failedCount: number, readyRatio: number,
 *   statusCounts: Record<string, number>, issues: Array<object>}}
 */
export function validateExplanations(graph, options = {}) {
  const expectedFileNodes = Object.hasOwn(options, "expectedFileNodes")
    ? options.expectedFileNodes
    : null;
  const minimumReadyRatio = options.minimumReadyRatio ?? 0.8;
  const checkGraphIntegrity = options.checkGraphIntegrity ?? true;
  const issues = [];

  if (!isRecord(graph)) {
    return {
      valid: false,
      totalFileNodes: 0,
      expectedFileNodes,
      readyCount: 0,
      failedCount: 0,
      readyRatio: 0,
      statusCounts: {},
      issues: [issue("graph.invalid", "Graph must be a JSON object")],
    };
  }

  const nodes = graph.nodes;
  const edges = graph.edges;
  if (!Array.isArray(nodes)) {
    issues.push(issue("nodes.invalid", "graph.nodes must be an array"));
  }
  if (!Array.isArray(edges)) {
    issues.push(issue("edges.invalid", "graph.edges must be an array"));
  }

  const graphNodes = Array.isArray(nodes) ? nodes : [];
  const fileNodes = graphNodes.filter(
    (node) => isRecord(node) && node.type === "file",
  );
  const statusCounts = {};
  let readyCount = 0;
  let failedCount = 0;

  if (fileNodes.length === 0) {
    issues.push(issue("file-nodes-empty", "Graph must contain at least one type=file node"));
  }

  if (expectedFileNodes !== null && fileNodes.length !== expectedFileNodes) {
    issues.push(
      issue(
        "file-node-count",
        `Expected ${expectedFileNodes} type=file nodes, found ${fileNodes.length}`,
        { expected: expectedFileNodes, actual: fileNodes.length },
      ),
    );
  }

  fileNodes.forEach((node, index) => {
    const status = node.explanationStatus;
    statusCounts[status ?? "missing"] = (statusCounts[status ?? "missing"] ?? 0) + 1;

    if (!VALID_EXPLANATION_STATUSES.has(status)) {
      issues.push(
        issue(
          "explanation-status",
          `File node '${node.id ?? index}' must have explanationStatus 'ready' or 'failed'`,
          { nodeId: node.id, status: status ?? "missing" },
        ),
      );
      return;
    }

    if (status === "ready") {
      readyCount += 1;
      if (!nonEmptyString(node.explanation)) {
        issues.push(
          issue(
            "explanation-empty",
            `Ready file node '${node.id ?? index}' must have a non-empty explanation`,
            { nodeId: node.id },
          ),
        );
      } else {
        const lines = node.explanation.split(/\r?\n/);
        for (const heading of REQUIRED_EXPLANATION_HEADINGS) {
          if (!lines.some((line) => line.trim() === heading)) {
            issues.push(
              issue(
                "explanation-heading",
                `Ready file node '${node.id ?? index}' is missing heading '${heading}'`,
                { nodeId: node.id, heading },
              ),
            );
          }
        }
      }
    } else {
      failedCount += 1;
      if (!nonEmptyString(node.explanationError)) {
        issues.push(
          issue(
            "explanation-error-empty",
            `Failed file node '${node.id ?? index}' must have a non-empty explanationError`,
            { nodeId: node.id },
          ),
        );
      }
    }
  });

  const readyRatio = fileNodes.length === 0 ? 0 : readyCount / fileNodes.length;
  if (readyRatio < minimumReadyRatio) {
    issues.push(
      issue(
        "ready-ratio",
        `Ready explanation ratio ${(readyRatio * 100).toFixed(1)}% is below the required ${(minimumReadyRatio * 100).toFixed(1)}%`,
        { minimum: minimumReadyRatio, actual: readyRatio },
      ),
    );
  }

  if (checkGraphIntegrity) {
    const nodeIds = new Set();
    graphNodes.forEach((node, index) => {
      if (!isRecord(node) || !nonEmptyString(node.id)) {
        issues.push(
          issue("node-id", `Node[${index}] must have a non-empty string id`, {
            index,
          }),
        );
        return;
      }
      if (nodeIds.has(node.id)) {
        issues.push(
          issue("duplicate-node-id", `Duplicate node id '${node.id}'`, {
            nodeId: node.id,
            index,
          }),
        );
      }
      nodeIds.add(node.id);
    });

    if (Array.isArray(edges)) {
      edges.forEach((edge, index) => {
        if (!isRecord(edge)) {
          issues.push(issue("edge-invalid", `Edge[${index}] must be an object`, { index }));
          return;
        }
        for (const endpoint of ["source", "target"]) {
          if (!nonEmptyString(edge[endpoint]) || !nodeIds.has(edge[endpoint])) {
            issues.push(
              issue(
                "dangling-edge",
                `Edge[${index}] ${endpoint} '${edge[endpoint] ?? "missing"}' does not reference an existing node`,
                { index, endpoint, nodeId: edge[endpoint] },
              ),
            );
          }
        }
      });
    }
  }

  return {
    valid: issues.length === 0,
    totalFileNodes: fileNodes.length,
    expectedFileNodes,
    readyCount,
    failedCount,
    readyRatio,
    statusCounts,
    issues,
  };
}

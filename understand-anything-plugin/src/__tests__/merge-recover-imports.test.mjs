import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MERGE_SCRIPT = resolve(__dirname, "../../skills/understand/merge-batch-graphs.py");

let projectRoot;
let intermediateDir;

function runMerge() {
  const result = spawnSync("python3", [MERGE_SCRIPT, projectRoot], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`merge script failed: status=${result.status}\nstderr:\n${result.stderr}`);
  }
  const assembled = JSON.parse(
    readFileSync(join(intermediateDir, "assembled-graph.json"), "utf-8"),
  );
  return { assembled, stderr: result.stderr };
}

function fileNode(path) {
  return {
    id: `file:${path}`,
    type: "file",
    name: path.split("/").pop(),
    filePath: path,
    summary: "",
    tags: [],
    complexity: "simple",
  };
}

function importsEdge(src, tgt) {
  return {
    source: `file:${src}`,
    target: `file:${tgt}`,
    type: "imports",
    direction: "forward",
    weight: 0.7,
  };
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "ua-merge-test-"));
  intermediateDir = join(projectRoot, ".understand-anything", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("merge-batch-graphs.py imports recovery", () => {
  it("recovers imports edges that batches dropped despite importMap having them", () => {
    // Batch contains all the file nodes but only emits ONE of three imports edges.
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py"), fileNode("src/b.py"), fileNode("src/c.py"), fileNode("src/d.py")],
        edges: [importsEdge("src/a.py", "src/b.py")],
      }),
    );
    // scan-result.json has the full importMap — agent dropped 2/3 of these.
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: {
          "src/a.py": ["src/b.py", "src/c.py", "src/d.py"],
          "src/b.py": [],
        },
      }),
    );

    const { assembled, stderr } = runMerge();
    const importsEdges = assembled.edges.filter((e) => e.type === "imports");
    expect(importsEdges).toHaveLength(3);
    const targets = new Set(importsEdges.map((e) => e.target));
    expect(targets).toEqual(new Set(["file:src/b.py", "file:src/c.py", "file:src/d.py"]));
    // Recovered edges are tagged so downstream consumers can audit.
    const recovered = importsEdges.filter((e) => e.recoveredFromImportMap);
    expect(recovered).toHaveLength(2);
    expect(stderr).toContain("Recovered 2 `imports` edges");
  });

  it("does not duplicate edges the batch already emitted", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py"), fileNode("src/b.py")],
        edges: [importsEdge("src/a.py", "src/b.py")],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/a.py": ["src/b.py"], "src/b.py": [] },
      }),
    );

    const { assembled, stderr } = runMerge();
    const importsEdges = assembled.edges.filter((e) => e.type === "imports");
    expect(importsEdges).toHaveLength(1);
    expect(stderr).toContain("Recovered 0 `imports` edges");
  });

  it("skips importMap entries whose source file is missing from the graph", () => {
    // src/missing.py is in importMap but has no file: node — must not produce a dangling edge.
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/b.py")],
        edges: [],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/missing.py": ["src/b.py"] },
      }),
    );

    const { assembled, stderr } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(0);
    expect(stderr).toContain("Skipped 1 importMap source files with no `file:` node");
  });

  it("skips importMap targets that don't have a file: node", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py")],
        edges: [],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/a.py": ["src/dropped.py", "src/also-missing.py"] },
      }),
    );

    const { assembled, stderr } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(0);
    expect(stderr).toContain("Skipped 2 importMap target paths with no `file:` node");
  });

  it("works when scan-result.json is missing (incremental update path)", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py"), fileNode("src/b.py")],
        edges: [importsEdge("src/a.py", "src/b.py")],
      }),
    );
    // No scan-result.json written.

    const { assembled, stderr } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(1);
    expect(stderr).toContain("importMap recovery skipped — scan-result.json not found");
  });

  it("never produces self-import edges", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py")],
        edges: [],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/a.py": ["src/a.py"] }, // pathological self-reference
      }),
    );

    const { assembled } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(0);
  });
});

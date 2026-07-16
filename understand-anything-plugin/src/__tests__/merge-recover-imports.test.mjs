import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MERGE_SCRIPT = resolve(__dirname, "../../skills/understand/merge-batch-graphs.py");
const PYTHON = findPython();

let projectRoot;
let intermediateDir;

function findPython() {
  const candidates = [
    { command: "python3", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
  ];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf-8",
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("Python 3 is required to run merge-batch-graphs.py tests");
}

function runMerge() {
  const result = spawnSync(PYTHON.command, [...PYTHON.args, MERGE_SCRIPT, projectRoot], {
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
    expect(stderr).toContain("importMap recovery skipped");
    expect(stderr).toContain("scan-result.json not found");
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

describe("merge-batch-graphs.py data-dir resolution (.ua vs legacy)", () => {
  // Self-contained: uses its own temp roots rather than the module-global
  // .understand-anything projectRoot wired up in the top-level beforeEach.
  function runIn(root) {
    const result = spawnSync(PYTHON.command, [...PYTHON.args, MERGE_SCRIPT, root], {
      encoding: "utf-8",
    });
    return result;
  }

  it("fresh project reads/writes under .ua/", () => {
    const root = mkdtempSync(join(tmpdir(), "ua-merge-uadir-"));
    try {
      const inter = join(root, ".ua", "intermediate");
      mkdirSync(inter, { recursive: true });
      writeFileSync(
        join(inter, "batch-0.json"),
        JSON.stringify({ nodes: [fileNode("src/a.py")], edges: [] }),
      );
      const result = runIn(root);
      expect(result.status).toBe(0);
      // Output landed in .ua/, legacy dir never created.
      const out = JSON.parse(
        readFileSync(join(inter, "assembled-graph.json"), "utf-8"),
      );
      expect(out.nodes.map((n) => n.id)).toContain("file:src/a.py");
      expect(existsSync(join(root, ".understand-anything"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("legacy .understand-anything/ wins even when .ua/ also exists", () => {
    const root = mkdtempSync(join(tmpdir(), "ua-merge-legacy-"));
    try {
      const legacyInter = join(root, ".understand-anything", "intermediate");
      mkdirSync(legacyInter, { recursive: true });
      mkdirSync(join(root, ".ua", "intermediate"), { recursive: true });
      writeFileSync(
        join(legacyInter, "batch-0.json"),
        JSON.stringify({ nodes: [fileNode("src/a.py")], edges: [] }),
      );
      const result = runIn(root);
      expect(result.status).toBe(0);
      expect(existsSync(join(legacyInter, "assembled-graph.json"))).toBe(true);
      expect(existsSync(join(root, ".ua", "intermediate", "assembled-graph.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

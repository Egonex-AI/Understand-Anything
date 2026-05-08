import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseGitRemote,
  stampMetadata,
  dispatchSync,
  publish,
} from "./index.js";

describe("parseGitRemote", () => {
  it("parses HTTPS remotes", () => {
    expect(parseGitRemote("https://github.com/foo/bar.git")).toEqual({ owner: "foo", repo: "bar" });
    expect(parseGitRemote("https://github.com/foo/bar")).toEqual({ owner: "foo", repo: "bar" });
    expect(parseGitRemote("https://github.com/foo/bar/")).toEqual({ owner: "foo", repo: "bar" });
  });

  it("parses HTTPS remotes with embedded user", () => {
    expect(parseGitRemote("https://x-access-token:ghp_abc@github.com/foo/bar.git"))
      .toEqual({ owner: "foo", repo: "bar" });
  });

  it("parses SSH remotes", () => {
    expect(parseGitRemote("git@github.com:foo/bar.git")).toEqual({ owner: "foo", repo: "bar" });
    expect(parseGitRemote("git@github.com:foo/bar")).toEqual({ owner: "foo", repo: "bar" });
  });

  it("parses git:// remotes", () => {
    expect(parseGitRemote("git://github.com/foo/bar.git")).toEqual({ owner: "foo", repo: "bar" });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitRemote("https://gitlab.com/foo/bar.git")).toBeNull();
    expect(parseGitRemote("not a url")).toBeNull();
    expect(parseGitRemote("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseGitRemote("  https://github.com/foo/bar.git\n")).toEqual({ owner: "foo", repo: "bar" });
  });
});

describe("stampMetadata", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "uq-publish-test-"));
    mkdirSync(join(tempDir, ".understand-anything"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when the graph file does not exist", () => {
    expect(stampMetadata(tempDir, "1.2.3")).toBeNull();
  });

  it("stamps metadata onto an existing graph", () => {
    const graph = { version: "1.0.0", nodes: [], edges: [] };
    writeFileSync(
      join(tempDir, ".understand-anything", "knowledge-graph.json"),
      JSON.stringify(graph),
      "utf-8",
    );

    const stamp = stampMetadata(tempDir, "9.9.9");
    expect(stamp).not.toBeNull();
    expect(stamp?.tool).toBe("understand-anything");
    expect(stamp?.tool_version).toBe("9.9.9");
    expect(stamp?.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const written = JSON.parse(
      readFileSync(join(tempDir, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(written.metadata.tool).toBe("understand-anything");
    expect(written.metadata.tool_version).toBe("9.9.9");
    // Pre-existing fields preserved.
    expect(written.version).toBe("1.0.0");
    expect(written.nodes).toEqual([]);
  });

  it("preserves unknown fields in an existing metadata block", () => {
    const graph = {
      version: "1.0.0",
      metadata: { custom: "value", tool: "old" },
    };
    writeFileSync(
      join(tempDir, ".understand-anything", "knowledge-graph.json"),
      JSON.stringify(graph),
      "utf-8",
    );

    stampMetadata(tempDir, "1.0.0");
    const written = JSON.parse(
      readFileSync(join(tempDir, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(written.metadata.custom).toBe("value");
    expect(written.metadata.tool).toBe("understand-anything"); // overwritten
  });

  it("returns null when the graph file is unparseable", () => {
    writeFileSync(
      join(tempDir, ".understand-anything", "knowledge-graph.json"),
      "{not json",
      "utf-8",
    );
    expect(stampMetadata(tempDir, "1.0.0")).toBeNull();
  });
});

describe("dispatchSync", () => {
  it("posts to the registry dispatch URL with the right payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);

    const result = await dispatchSync({
      token: "ghp_test_abc",
      id: "amacsmith/Understand-Anything",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ status: "ok", httpStatus: 204 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/looptech-ai/understand-quickly/dispatches");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ghp_test_abc");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
    expect(JSON.parse(init.body)).toEqual({
      event_type: "sync-entry",
      client_payload: { id: "amacsmith/Understand-Anything" },
    });
  });

  it("reports a dispatch-failed status on non-2xx responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    const result = await dispatchSync({
      token: "t",
      id: "owner/repo",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: "dispatch-failed", httpStatus: 404 });
  });

  it("never throws on network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await dispatchSync({
      token: "t",
      id: "owner/repo",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe("dispatch-failed");
    expect(result.error).toBe("boom");
  });
});

describe("publish", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "uq-publish-flow-"));
    mkdirSync(join(tempDir, ".understand-anything"), { recursive: true });
    writeFileSync(
      join(tempDir, ".understand-anything", "knowledge-graph.json"),
      JSON.stringify({ version: "1.0.0", nodes: [], edges: [] }),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns no-graph when there is no on-disk graph", async () => {
    const empty = mkdtempSync(join(tmpdir(), "uq-publish-empty-"));
    try {
      const result = await publish({
        projectRoot: empty,
        toolVersion: "1.0.0",
        env: { UNDERSTAND_QUICKLY_TOKEN: "t" },
        resolveSlug: () => "owner/repo",
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });
      expect(result.status).toBe("no-graph");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("returns no-token when the env var is unset and never calls fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await publish({
      projectRoot: tempDir,
      toolVersion: "1.0.0",
      env: {}, // no UNDERSTAND_QUICKLY_TOKEN
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveSlug: () => "owner/repo",
    });

    expect(result.status).toBe("no-token");
    expect(result.metadata?.tool).toBe("understand-anything");
    expect(fetchImpl).not.toHaveBeenCalled();

    // Metadata is still stamped so the graph is registry-ready for the
    // next CI publish, even when the local user has no PAT.
    const written = JSON.parse(
      readFileSync(join(tempDir, ".understand-anything", "knowledge-graph.json"), "utf-8"),
    );
    expect(written.metadata.tool).toBe("understand-anything");
  });

  it("returns no-remote when origin is not a GitHub URL", async () => {
    const fetchImpl = vi.fn();
    const result = await publish({
      projectRoot: tempDir,
      toolVersion: "1.0.0",
      env: { UNDERSTAND_QUICKLY_TOKEN: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveSlug: () => null,
    });

    expect(result.status).toBe("no-remote");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dispatches when token + remote + graph are all present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    const result = await publish({
      projectRoot: tempDir,
      toolVersion: "2.6.2",
      env: { UNDERSTAND_QUICKLY_TOKEN: "ghp_test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveSlug: () => "amacsmith/Understand-Anything",
    });

    expect(result.status).toBe("ok");
    expect(result.id).toBe("amacsmith/Understand-Anything");
    expect(result.httpStatus).toBe(204);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(JSON.parse(init.body as string).client_payload.id).toBe("amacsmith/Understand-Anything");
  });

  it("returns dispatch-failed without throwing when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await publish({
      projectRoot: tempDir,
      toolVersion: "1.0.0",
      env: { UNDERSTAND_QUICKLY_TOKEN: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveSlug: () => "owner/repo",
    });

    expect(result.status).toBe("dispatch-failed");
    expect(result.error).toBe("network down");
    // Metadata still got stamped — drift detection is the priority.
    expect(result.metadata?.tool).toBe("understand-anything");
  });
});

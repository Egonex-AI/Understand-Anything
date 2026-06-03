import path from "path";
import { describe, expect, it } from "vitest";
import {
  resolvePathWithinRoot,
  sanitizeFilePath,
  sanitizeSlug,
} from "../sanitize";

describe("sanitizeSlug", () => {
  it("accepts a plain slug", () => {
    expect(sanitizeSlug("order-mgmt")).toBe("order-mgmt");
  });

  it("strips wiki:domain: prefix and .json suffix", () => {
    expect(sanitizeSlug("wiki:domain:order-mgmt.json")).toBe("order-mgmt");
    expect(sanitizeSlug("cross-domain:checkout-flow")).toBe("checkout-flow");
  });

  it("rejects empty or unsafe slugs", () => {
    expect(sanitizeSlug("")).toBeNull();
    expect(sanitizeSlug("../evil")).toBeNull();
    expect(sanitizeSlug("a/b")).toBeNull();
    expect(sanitizeSlug("a\\b")).toBeNull();
    expect(sanitizeSlug("a\0b")).toBeNull();
    expect(sanitizeSlug("-bad")).toBeNull();
  });
});

describe("sanitizeFilePath", () => {
  it("accepts a normal relative path", () => {
    expect(sanitizeFilePath("src/main/java/Foo.java")).toBe("src/main/java/Foo.java");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(sanitizeFilePath("src\\main\\Foo.java")).toBe("src/main/Foo.java");
  });

  it("rejects empty paths", () => {
    expect(sanitizeFilePath("")).toBeNull();
    expect(sanitizeFilePath("   ")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(sanitizeFilePath("/etc/passwd")).toBeNull();
    if (process.platform === "win32") {
      expect(sanitizeFilePath("C:\\Windows\\system.ini")).toBeNull();
    }
  });

  it("rejects parent-directory traversal", () => {
    expect(sanitizeFilePath("../secret.txt")).toBeNull();
    expect(sanitizeFilePath("src/../../etc/passwd")).toBeNull();
    expect(sanitizeFilePath("..")).toBeNull();
    expect(sanitizeFilePath(".")).toBeNull();
  });

  it("rejects null bytes", () => {
    expect(sanitizeFilePath("src\0/evil.java")).toBeNull();
  });

  it("rejects tilde home expansion", () => {
    expect(sanitizeFilePath("~/secret.txt")).toBeNull();
  });
});

describe("resolvePathWithinRoot", () => {
  const root = path.resolve("/tmp/wiki-project");

  it("resolves safe paths inside the project root", () => {
    const resolved = resolvePathWithinRoot(root, "src/App.java");
    expect(resolved).toBe(path.resolve(root, "src/App.java"));
  });

  it("rejects paths that escape the project root after resolution", () => {
    expect(resolvePathWithinRoot(root, "../outside.txt")).toBeNull();
  });
});

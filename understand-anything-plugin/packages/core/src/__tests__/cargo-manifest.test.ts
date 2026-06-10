import { describe, it, expect } from "vitest";
import { parseCargoManifest } from "../manifests/cargo.js";

describe("parseCargoManifest", () => {
  it("reads [package].name", () => {
    const r = parseCargoManifest(`[package]\nname = "my-crate"\nversion = "0.1.0"\n`);
    expect(r).toEqual({ packageName: "my-crate", libName: null, libPath: null });
  });

  it("reads [lib].name and [lib].path overrides", () => {
    const r = parseCargoManifest(
      `[package]\nname = "df-common"\n[lib]\nname = "datafusion_common"\npath = "src/mod.rs"\n`,
    );
    expect(r).toEqual({
      packageName: "df-common",
      libName: "datafusion_common",
      libPath: "src/mod.rs",
    });
  });

  it("does not mistake [[bin]].name for the crate name", () => {
    const r = parseCargoManifest(
      `[package]\nname = "real-pkg"\n[[bin]]\nname = "some_bin"\npath = "src/bin/x.rs"\n`,
    );
    expect(r?.packageName).toBe("real-pkg");
    expect(r?.libName).toBeNull();
  });

  it("returns null for a virtual workspace manifest", () => {
    const r = parseCargoManifest(`[workspace]\nmembers = ["crates/*"]\n`);
    expect(r).toBeNull();
  });

  it("throws on malformed TOML", () => {
    expect(() => parseCargoManifest(`[package\nname = `)).toThrow();
  });
});

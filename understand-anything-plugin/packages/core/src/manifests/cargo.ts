import { parse } from "smol-toml";

export interface CargoManifestInfo {
  /** `[package].name` (hyphenated), or null if absent. */
  packageName: string | null;
  /** `[lib].name` override (the crate identifier used in `use ...`), or null. */
  libName: string | null;
  /** `[lib].path` crate-root override (e.g. "src/mod.rs"), or null. */
  libPath: string | null;
}

/**
 * Parse a Cargo.toml's content and extract the fields needed to map a crate
 * identifier to its source directory.
 *
 * Returns null for a virtual manifest (neither [package] nor [lib] present, as
 * in a workspace root). When non-null, `packageName` may still be null on a
 * rare [lib]-only manifest, so callers must handle a null `packageName` (e.g.
 * derive the crate identifier from `libName` first). Throws if the TOML is
 * malformed — callers catch and skip the manifest.
 */
export function parseCargoManifest(content: string): CargoManifestInfo | null {
  const parsed: Record<string, unknown> = parse(content);

  const pkg =
    parsed.package && typeof parsed.package === "object"
      ? (parsed.package as Record<string, unknown>)
      : undefined;
  const lib =
    parsed.lib && typeof parsed.lib === "object"
      ? (parsed.lib as Record<string, unknown>)
      : undefined;

  const packageName = pkg && typeof pkg.name === "string" ? pkg.name : null;
  const libName = lib && typeof lib.name === "string" ? lib.name : null;
  const libPath = lib && typeof lib.path === "string" ? lib.path : null;

  if (packageName === null && libName === null) return null;
  return { packageName, libName, libPath };
}

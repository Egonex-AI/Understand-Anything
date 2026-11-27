import {
  lstatSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import {
  join,
  relative,
  isAbsolute,
  sep,
  dirname,
  basename,
} from "node:path";
import { randomUUID } from "node:crypto";

export function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);

  return (
    rel === "" ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith(`..${sep}`))
  );
}

function lstatOptional(target: string) {
  try {
    return lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function resolveSafeDataDir(
  projectRoot: string,
  create = false,
): string {
  const root = realpathSync(projectRoot);

  if (!lstatSync(root).isDirectory()) {
    throw new Error("Invalid project root");
  }

  const legacy = join(root, ".understand-anything");
  const current = join(root, ".ua");

  const legacyStat = lstatOptional(legacy);
  const target = legacyStat ? legacy : current;

  let stat = lstatOptional(target);

  if (!stat && create) {
    try {
      mkdirSync(target, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    stat = lstatOptional(target);
  }

  if (!stat) {
    if (create) {
      throw new Error("Data directory unavailable");
    }
    return target;
  }

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Unsafe data directory");
  }

  if (!isWithinRoot(root, realpathSync(target))) {
    throw new Error("Data directory escapes project root");
  }

  return target;
}

export function resolveSafeDataFile(
  projectRoot: string,
  filename: string,
  createDirectory = false,
): string {
  if (
    !filename ||
    filename !== basename(filename) ||
    filename === "." ||
    filename === ".." ||
    /[\\/:]/.test(filename) ||
    filename.includes("\0")
  ) {
    throw new Error("Invalid persistence filename");
  }

  const dir = resolveSafeDataDir(projectRoot, createDirectory);
  const target = join(dir, filename);
  const stat = lstatOptional(target);

  if (!stat) return target;

  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1
  ) {
    throw new Error("Unsafe persistence file");
  }

  if (!isWithinRoot(dir, realpathSync(target))) {
    throw new Error("Persistence file escapes data directory");
  }

  return target;
}

export function atomicWriteDataJson(
  projectRoot: string,
  filename: string,
  value: unknown,
): void {
  const content = JSON.stringify(value, null, 2);

  if (content === undefined) {
    throw new Error("Invalid JSON value");
  }

  const target = resolveSafeDataFile(
    projectRoot,
    filename,
    true,
  );

  const temp = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  );

  let created = false;

  try {
    writeFileSync(temp, content, {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });

    created = true;

    if (resolveSafeDataFile(projectRoot, filename) !== target) {
      throw new Error("Persistence directory changed");
    }

    renameSync(temp, target);
    created = false;
  } finally {
    if (created) {
      unlinkSync(temp);
    }
  }
}

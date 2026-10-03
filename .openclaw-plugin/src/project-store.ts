import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const CLONE_TIMEOUT_MS = 3 * 60_000;

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function defaultStateDir(): string {
  return join(homedir(), ".local", "share", "understand-anything-plugin");
}

export interface ProjectStoreOptions {
  /** Absolute paths from plugin config — always present, never persisted (config is the source of truth for these). */
  configProjects: string[];
  /** Whether runtime project addition (GitHub clone or local path) is enabled at all. */
  allowAddProject: boolean;
  /** Where dynamically-added projects persist across restarts and where GitHub repos get cloned. Defaults under ~/.local/share. */
  stateDir?: string;
}

/**
 * Combined project list: config-declared projects (fixed, always first) plus
 * dynamically-added ones (GitHub clone or local path, persisted to disk so
 * they survive a gateway restart). Indices only ever grow — existing entries
 * never move — so tool/dashboard references by index stay stable.
 */
export class ProjectStore {
  private readonly allowAddProject: boolean;
  private readonly stateDir: string;
  private readonly stateFile: string;
  private readonly cloneDir: string;
  private projects: string[];
  private dynamicProjects: string[];

  constructor(opts: ProjectStoreOptions) {
    this.allowAddProject = opts.allowAddProject;
    this.stateDir = opts.stateDir ?? defaultStateDir();
    this.stateFile = join(this.stateDir, "dynamic-projects.json");
    this.cloneDir = join(this.stateDir, "clones");
    this.dynamicProjects = this.loadPersisted();
    this.projects = [...opts.configProjects, ...this.dynamicProjects];
  }

  private loadPersisted(): string[] {
    if (!this.allowAddProject || !existsSync(this.stateFile)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, "utf-8"));
      return Array.isArray(raw)
        ? raw.filter((p): p is string => typeof p === "string" && existsSync(p) && statSync(p).isDirectory())
        : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    mkdirSync(this.stateDir, { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(this.dynamicProjects, null, 2), "utf-8");
  }

  list(): string[] {
    return this.projects;
  }

  canAddProject(): boolean {
    return this.allowAddProject;
  }

  /**
   * Adds a project by GitHub URL (shallow-cloned into a dedicated directory)
   * or an existing local path. Idempotent for GitHub URLs already cloned, and
   * for a path/clone already in the list.
   */
  async addProject(input: string): Promise<{ root: string } | { error: string }> {
    if (!this.allowAddProject) return { error: "Adding projects at runtime is disabled (set allowAddProject: true in plugin config)." };

    const trimmed = input.trim();
    if (!trimmed) return { error: "Input is empty." };

    const githubRef = parseGithubRef(trimmed);
    const resolved = githubRef ? await this.resolveGithubProject(githubRef) : this.resolveLocalPath(trimmed);
    if ("error" in resolved) return resolved;

    if (!this.projects.includes(resolved.root)) {
      this.projects.push(resolved.root);
      this.dynamicProjects.push(resolved.root);
      this.persist();
    }
    return resolved;
  }

  private resolveLocalPath(input: string): { root: string } | { error: string } {
    const abs = resolve(expandHome(input));
    if (!isAbsolute(abs) || !existsSync(abs) || !statSync(abs).isDirectory()) {
      return { error: `"${input}" is not an existing local directory.` };
    }
    return { root: abs };
  }

  private async resolveGithubProject(ref: GithubRef): Promise<{ root: string } | { error: string }> {
    const destDir = join(this.cloneDir, `${sanitize(ref.owner)}-${sanitize(ref.repo)}`);
    if (existsSync(join(destDir, ".git"))) {
      return { root: destDir }; // already cloned — reuse
    }
    mkdirSync(this.cloneDir, { recursive: true });
    try {
      await cloneRepo(ref.url, destDir);
    } catch (err) {
      return { error: `Failed to clone ${ref.url}: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { root: destDir };
  }
}

interface GithubRef {
  url: string;
  owner: string;
  repo: string;
}

/**
 * Only recognizes an actual github.com https/ssh URL — not a bare
 * "owner/repo" shorthand (ambiguous with a genuine relative local path), and
 * not arbitrary git/file:// URLs (a file:// or local-path "clone" could be
 * abused to copy arbitrary host paths into the clone dir, defeating the
 * projects allowlist this whole feature sits inside).
 */
function parseGithubRef(input: string): GithubRef | null {
  const httpsMatch = input.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (httpsMatch) return { url: `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git`, owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = input.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (sshMatch) return { url: `git@github.com:${sshMatch[1]}/${sshMatch[2]}.git`, owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

function sanitize(s: string): string {
  return s.replace(/[^\w.-]/g, "_");
}

function cloneRepo(url: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["clone", "--depth", "1", url, destDir], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`clone timed out after ${CLONE_TIMEOUT_MS}ms`));
    }, CLONE_TIMEOUT_MS);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `git clone exited with code ${code}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

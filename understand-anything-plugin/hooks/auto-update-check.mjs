import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const GRAPH_DIR = ".understand-anything";
const CONFIG_PATH = `${GRAPH_DIR}/config.json`;
const GRAPH_PATH = `${GRAPH_DIR}/knowledge-graph.json`;
const META_PATH = `${GRAPH_DIR}/meta.json`;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function autoUpdateEnabled() {
  const config = readJson(CONFIG_PATH);
  return config?.autoUpdate === true;
}

function graphExists() {
  return existsSync(GRAPH_PATH);
}

function promptPath() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.UA_PLUGIN_ROOT || "";
  return pluginRoot ? `${pluginRoot.replace(/[\\/]$/, "")}/hooks/auto-update-prompt.md` : "hooks/auto-update-prompt.md";
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function emit(reason) {
  console.log(
    `[understand-anything] ${reason}. You MUST read the file at ${promptPath()} and execute its instructions to incrementally update the knowledge graph. Do not ask the user for confirmation — just do it.`,
  );
}

const mode = process.argv[2];

if (!autoUpdateEnabled() || !graphExists()) {
  process.exit(0);
}

if (mode === "post-tool-use") {
  const toolInput = process.env.TOOL_INPUT || "";
  if (/\bgit\s+(commit|merge|cherry-pick|rebase)\b/.test(toolInput)) {
    emit("Commit detected with auto-update enabled");
  }
  process.exit(0);
}

if (mode === "session-start") {
  if (!existsSync(META_PATH)) {
    process.exit(0);
  }

  const meta = readJson(META_PATH);
  const previousCommit = meta?.gitCommitHash || "";
  const head = currentCommit();

  if (previousCommit && head && previousCommit !== head) {
    emit("Knowledge graph is stale");
  }
}

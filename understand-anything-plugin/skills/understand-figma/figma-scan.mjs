#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFileKey, FigmaApiSource, parseDocument, extractTokens, applyScreenThumbnails } from "@understand-anything/core/figma";

// Mirror core's resolveUaDir: the legacy `.understand-anything/` dir wins for
// both reads and writes when it already exists; otherwise use `.ua/`.
const uaDir = (root) => { const legacy = join(root, ".understand-anything"); return existsSync(legacy) ? legacy : join(root, ".ua"); };

const [, , projectRoot, urlOrKey] = process.argv;
if (!projectRoot || !urlOrKey) {
  console.error("usage: figma-scan.mjs <projectRoot> <figmaUrlOrKey>");
  process.exit(1);
}

const fileKey = parseFileKey(urlOrKey);
const source = new FigmaApiSource(fileKey); // reads FIGMA_TOKEN from env; throws a friendly error if missing
const doc = await source.fetchDocument();

const metaPath = join(uaDir(projectRoot), "meta.json");
let prevVersion = null;
if (existsSync(metaPath)) {
  try {
    prevVersion = JSON.parse(readFileSync(metaPath, "utf8")).figmaVersion ?? null;
  } catch {
    prevVersion = null; // malformed/partial meta.json → fall through to a full rebuild
  }
}
if (doc.version && prevVersion === doc.version && process.env.UNDERSTAND_FIGMA_FORCE !== "1") {
  // Content is unchanged, but the stored screen thumbnail URLs are pre-signed
  // and expire after a few hours. Refresh them in the existing graph so a later
  // re-run doesn't leave the dashboard with broken sidebar thumbnails, then
  // skip the expensive re-parse + LLM re-analysis.
  await refreshThumbnailsInPlace(projectRoot, source);
  console.error("UP_TO_DATE");
  process.exit(0);
}

const styles = await source.fetchStyles().catch(() => ({ meta: { styles: [] } }));

const structural = parseDocument(doc, fileKey);
const tokens = extractTokens(doc, styles, structural.nodes, fileKey);
const nodes = [...structural.nodes, ...tokens.nodes];
const edges = [...structural.edges, ...tokens.edges];

// Pre-fetch thumbnails for screens only (bounded). URLs are pre-signed and
// may expire after a few hours — fine for view-after-generate; re-run to refresh.
const screens = structural.nodes.filter((n) => n.type === "screen");
try {
  const images = await source.renderImages(screens.map((n) => n.figmaMeta.nodeId));
  applyScreenThumbnails(structural.nodes, images);
} catch {
  // thumbnails are optional — never fail the scan on image render
}

const manifest = {
  project: {
    name: doc.name,
    languages: ["figma"],
    frameworks: [],
    description: `Figma design file: ${doc.name}`,
    analyzedAt: new Date().toISOString(),
    gitCommitHash: "",
  },
  fileKey,
  figmaVersion: doc.version ?? "",
  nodes,
  edges,
};

const interDir = join(uaDir(projectRoot), "intermediate");
mkdirSync(interDir, { recursive: true });
writeFileSync(join(interDir, "scan-manifest.json"), JSON.stringify(manifest, null, 2));

const count = (t) => nodes.filter((n) => n.type === t).length;
console.error(
  `Figma scan: ${count("page")} pages, ${count("screen")} screens, ` +
  `${count("component")} components, ${count("componentSet")} sets, ` +
  `${count("instance")} instances, ${count("token")} tokens`,
);

/**
 * On the incremental UP_TO_DATE path we skip the full re-scan, but the screen
 * thumbnail URLs already stored in knowledge-graph.json are pre-signed and
 * expire after a few hours. Re-render them and patch the existing graph in
 * place so the dashboard sidebar doesn't show broken images on a later re-run.
 * Best-effort: never throw (thumbnails are optional).
 */
async function refreshThumbnailsInPlace(projectRoot, source) {
  const graphPath = join(uaDir(projectRoot), "knowledge-graph.json");
  if (!existsSync(graphPath)) return;
  try {
    const graph = JSON.parse(readFileSync(graphPath, "utf8"));
    const screens = (graph.nodes ?? []).filter(
      (n) => n.type === "screen" && n.figmaMeta?.nodeId,
    );
    if (screens.length === 0) return;
    const images = await source.renderImages(screens.map((n) => n.figmaMeta.nodeId));
    if (applyScreenThumbnails(graph.nodes, images) > 0) {
      writeFileSync(graphPath, JSON.stringify(graph, null, 2));
    }
  } catch {
    // thumbnails are optional — never fail the up-to-date path on refresh
  }
}

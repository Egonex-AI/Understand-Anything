#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_GRAPH_PATH = ".understand-anything/knowledge-graph.json";
const DEFAULT_LIMIT = 20;
const DEFAULT_DEPTH = 1;

const USAGE = `ugraph - query an Understand Anything knowledge graph

Usage:
  ugraph <command> [arguments] [options]

Commands:
  overview                  Print project metadata, counts, layers, and freshness
  find <query>              Search nodes by name, path, tags, and summary
  node <id|file|name>       Show one node with its direct relationships
  neighbors <id|file|name>  Expand a node neighborhood
  impact <id|file|name>     Show reverse dependencies likely affected by a change
  context <query>           Build a compact agent context for a question
  layers [query]            List layers, optionally filtered by a node search
  tour                      Print guided tour steps
  stale                     Compare graph commit with current git HEAD

Options:
  --graph <path>            Graph path (default: ${DEFAULT_GRAPH_PATH})
  --format <json|text|md>   Output format (default: json)
  --pretty                  Pretty-print JSON
  --limit <n>               Max nodes/results (default: ${DEFAULT_LIMIT})
  --depth <n>               Traversal depth for neighbors/impact (default: ${DEFAULT_DEPTH})
  --direction <in|out|both> Edge direction for neighbors (default: both)
  --type <type[,type...]>   Filter find/context by node type
  --nodes                   Include tour step nodes
  --no-edges                Omit direct node relationships in node command
  -h, --help                Show this help

Examples:
  ugraph overview --pretty
  ugraph find auth --limit 10
  ugraph node file:src/auth/login.ts
  ugraph neighbors src/auth/login.ts --depth 2 --format md
  ugraph impact src/auth/login.ts --pretty
  ugraph context "payment flow" --limit 30
`;

function main(argv) {
  const { command, positional, options } = parseArgs(argv);

  if (!command || options.help) {
    writeOutput(USAGE.trimEnd(), "text");
    return;
  }

  const graphPath = path.resolve(process.cwd(), options.graph ?? DEFAULT_GRAPH_PATH);
  const graph = loadGraph(graphPath);
  const indexes = buildIndexes(graph);

  let result;
  switch (command) {
    case "overview":
      result = commandOverview(graph, indexes, options);
      break;
    case "find":
      result = commandFind(graph, indexes, positional.join(" "), options);
      break;
    case "node":
      result = commandNode(graph, indexes, requireOne(positional, "node"), options);
      break;
    case "neighbors":
      result = commandNeighbors(graph, indexes, requireOne(positional, "neighbors"), options);
      break;
    case "impact":
      result = commandImpact(graph, indexes, requireOne(positional, "impact"), options);
      break;
    case "context":
      result = commandContext(graph, indexes, positional.join(" "), options);
      break;
    case "layers":
      result = commandLayers(graph, indexes, positional.join(" "), options);
      break;
    case "tour":
      result = commandTour(graph, indexes, options);
      break;
    case "stale":
      result = getFreshness(graph, options);
      break;
    default:
      fail(`Unknown command: ${command}\n\n${USAGE.trimEnd()}`, 1);
  }

  writeOutput(result, options.format ?? "json", options);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  let command;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      const key = camelCase(rawKey);

      if (["pretty", "nodes", "noEdges"].includes(key)) {
        options[key] = true;
        continue;
      }

      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`Missing value for --${rawKey}`, 1);
      }
      index += inlineValue === undefined ? 1 : 0;
      options[key] = value;
      continue;
    }

    if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  if (options.limit !== undefined) options.limit = positiveInt(options.limit, "--limit");
  if (options.depth !== undefined) options.depth = positiveInt(options.depth, "--depth");
  if (options.type !== undefined) options.types = splitList(options.type);
  if (options.format && !["json", "text", "md"].includes(options.format)) {
    fail("--format must be one of: json, text, md", 1);
  }
  if (options.direction && !["in", "out", "both"].includes(options.direction)) {
    fail("--direction must be one of: in, out, both", 1);
  }

  return { command, positional, options };
}

function loadGraph(graphPath) {
  if (!existsSync(graphPath)) {
    fail(`Knowledge graph not found: ${graphPath}\nRun /understand first or pass --graph <path>.`, 2);
  }

  try {
    return JSON.parse(readFileSync(graphPath, "utf8"));
  } catch (error) {
    fail(`Could not parse knowledge graph: ${error.message}`, 2);
  }
}

function buildIndexes(graph) {
  const nodeById = new Map();
  const nodesByFile = new Map();
  const edgesBySource = new Map();
  const edgesByTarget = new Map();
  const layersByNode = new Map();

  for (const node of graph.nodes ?? []) {
    nodeById.set(node.id, node);
    if (node.filePath) {
      const normalized = normalizePath(node.filePath);
      pushMap(nodesByFile, normalized, node);
    }
  }

  for (const edge of graph.edges ?? []) {
    pushMap(edgesBySource, edge.source, edge);
    pushMap(edgesByTarget, edge.target, edge);
  }

  for (const layer of graph.layers ?? []) {
    for (const nodeId of layer.nodeIds ?? []) {
      pushMap(layersByNode, nodeId, layer);
    }
  }

  return { nodeById, nodesByFile, edgesBySource, edgesByTarget, layersByNode };
}

function commandOverview(graph, indexes, options) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const limit = options.limit ?? DEFAULT_LIMIT;

  return {
    command: "overview",
    project: graph.project,
    graph: {
      version: graph.version,
      kind: graph.kind,
      nodes: nodes.length,
      edges: edges.length,
      layers: (graph.layers ?? []).length,
      tourSteps: (graph.tour ?? []).length,
    },
    nodeTypes: countBy(nodes, "type"),
    edgeTypes: countBy(edges, "type"),
    topTags: topTags(nodes, limit),
    layers: (graph.layers ?? []).map((layer) => summarizeLayer(layer)),
    freshness: getFreshness(graph, options),
  };
}

function commandFind(graph, indexes, query, options) {
  if (!query.trim()) fail("find requires a query", 1);
  const results = searchNodes(graph.nodes ?? [], query, options);

  return {
    command: "find",
    query,
    count: results.length,
    results: results.map(({ node, score }) => ({
      score,
      node: summarizeNode(node, indexes),
    })),
  };
}

function commandNode(graph, indexes, ref, options) {
  const node = resolveNode(ref, graph, indexes);
  const includeEdges = !options.noEdges;

  return {
    command: "node",
    ref,
    node: summarizeNode(node, indexes, { full: true }),
    relationships: includeEdges ? directRelationships(node.id, indexes, options.limit ?? DEFAULT_LIMIT) : undefined,
  };
}

function commandNeighbors(graph, indexes, ref, options) {
  const seed = resolveNode(ref, graph, indexes);
  const depth = options.depth ?? DEFAULT_DEPTH;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const direction = options.direction ?? "both";
  const subgraph = traverse(indexes, [seed.id], { depth, direction, limit });

  return {
    command: "neighbors",
    ref,
    seed: summarizeNode(seed, indexes),
    depth,
    direction,
    nodes: subgraph.nodeIds.map((id) => summarizeNode(indexes.nodeById.get(id), indexes)).filter(Boolean),
    edges: subgraph.edges.map((edge) => summarizeEdge(edge, indexes)),
    truncated: subgraph.truncated,
  };
}

function commandImpact(graph, indexes, ref, options) {
  const seeds = resolveSeedSet(ref, graph, indexes);
  const depth = options.depth ?? 2;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const subgraph = traverse(indexes, seeds.map((node) => node.id), {
    depth,
    direction: "in",
    limit,
  });
  const seedIds = new Set(seeds.map((node) => node.id));
  const impactedIds = subgraph.nodeIds.filter((id) => !seedIds.has(id));

  return {
    command: "impact",
    ref,
    depth,
    seeds: seeds.map((node) => summarizeNode(node, indexes)),
    impactedNodes: impactedIds.map((id) => summarizeNode(indexes.nodeById.get(id), indexes)).filter(Boolean),
    impactEdges: subgraph.edges.map((edge) => summarizeEdge(edge, indexes)),
    truncated: subgraph.truncated,
    note: "Impact follows incoming graph edges, which approximates callers, importers, dependents, and related tests.",
  };
}

function commandContext(graph, indexes, query, options) {
  if (!query.trim()) fail("context requires a query", 1);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const matches = searchNodes(graph.nodes ?? [], query, options).slice(0, limit);
  const matchedIds = matches.map((result) => result.node.id);
  const subgraph = traverse(indexes, matchedIds, {
    depth: options.depth ?? 1,
    direction: "both",
    limit: Math.max(limit, matchedIds.length),
  });
  const matchedSet = new Set(matchedIds);
  const nodeIds = subgraph.nodeIds;
  const layerIds = new Set();
  for (const nodeId of nodeIds) {
    for (const layer of indexes.layersByNode.get(nodeId) ?? []) {
      layerIds.add(layer.id);
    }
  }

  return {
    command: "context",
    query,
    project: {
      name: graph.project?.name,
      description: graph.project?.description,
      languages: graph.project?.languages ?? [],
      frameworks: graph.project?.frameworks ?? [],
    },
    matchedNodes: nodeIds
      .filter((id) => matchedSet.has(id))
      .map((id) => summarizeNode(indexes.nodeById.get(id), indexes))
      .filter(Boolean),
    relatedNodes: nodeIds
      .filter((id) => !matchedSet.has(id))
      .map((id) => summarizeNode(indexes.nodeById.get(id), indexes))
      .filter(Boolean),
    relationships: subgraph.edges.map((edge) => summarizeEdge(edge, indexes)),
    layers: (graph.layers ?? []).filter((layer) => layerIds.has(layer.id)).map((layer) => summarizeLayer(layer)),
    freshness: getFreshness(graph, options),
    truncated: subgraph.truncated,
  };
}

function commandLayers(graph, indexes, query, options) {
  const layers = graph.layers ?? [];

  if (!query.trim()) {
    return {
      command: "layers",
      count: layers.length,
      layers: layers.map((layer) => summarizeLayer(layer)),
    };
  }

  const matches = searchNodes(graph.nodes ?? [], query, options);
  const matchedIds = new Set(matches.map((result) => result.node.id));
  const filtered = layers.filter((layer) => (layer.nodeIds ?? []).some((id) => matchedIds.has(id)));

  return {
    command: "layers",
    query,
    count: filtered.length,
    layers: filtered.map((layer) => summarizeLayer(layer)),
  };
}

function commandTour(graph, indexes, options) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const steps = (graph.tour ?? []).slice(0, limit).map((step) => {
    const result = {
      order: step.order,
      title: step.title,
      description: step.description,
      nodeIds: step.nodeIds ?? [],
      languageLesson: step.languageLesson,
    };
    if (options.nodes) {
      result.nodes = (step.nodeIds ?? []).map((id) => summarizeNode(indexes.nodeById.get(id), indexes)).filter(Boolean);
    }
    return result;
  });

  return {
    command: "tour",
    count: steps.length,
    total: (graph.tour ?? []).length,
    steps,
  };
}

function searchNodes(nodes, query, options) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const allowedTypes = options.types ? new Set(options.types) : null;
  const limit = options.limit ?? DEFAULT_LIMIT;

  return nodes
    .filter((node) => !allowedTypes || allowedTypes.has(node.type))
    .map((node) => ({ node, score: scoreNode(node, terms) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .slice(0, limit);
}

function scoreNode(node, terms) {
  if (terms.length === 0) return 0;

  const fields = [
    [node.name, 4],
    [node.tags?.join(" "), 3],
    [node.id, 2.5],
    [node.filePath, 2.5],
    [node.summary, 1.5],
    [node.languageNotes, 1],
  ];

  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const [raw, weight] of fields) {
      const value = String(raw ?? "").toLowerCase();
      if (!value) continue;
      if (value === term) best = Math.max(best, weight * 1.5);
      else if (value.includes(term)) best = Math.max(best, weight);
      else if (looseIncludes(value, term)) best = Math.max(best, weight * 0.55);
    }
    score += best;
  }

  return Number(score.toFixed(3));
}

function looseIncludes(value, term) {
  if (term.length < 4) return false;
  let valueIndex = 0;
  for (const char of term) {
    valueIndex = value.indexOf(char, valueIndex);
    if (valueIndex === -1) return false;
    valueIndex += 1;
  }
  return true;
}

function resolveNode(ref, graph, indexes) {
  const normalizedRef = normalizePath(ref);
  const direct = indexes.nodeById.get(ref)
    ?? indexes.nodeById.get(`file:${normalizedRef}`)
    ?? indexes.nodeById.get(`config:${normalizedRef}`)
    ?? indexes.nodeById.get(`document:${normalizedRef}`);
  if (direct) return direct;

  const fileMatches = indexes.nodesByFile.get(normalizedRef);
  if (fileMatches?.length) {
    const fileNode = fileMatches.find((node) => node.type === "file") ?? fileMatches[0];
    return fileNode;
  }

  const suffixMatches = [...indexes.nodesByFile.entries()]
    .filter(([filePath]) => normalizedRef.endsWith(filePath) || filePath.endsWith(normalizedRef))
    .flatMap(([, nodes]) => nodes);
  if (suffixMatches.length) {
    const fileNode = suffixMatches.find((node) => node.type === "file") ?? suffixMatches[0];
    return fileNode;
  }

  const lower = ref.toLowerCase();
  const nameMatches = (graph.nodes ?? []).filter((node) => node.name?.toLowerCase() === lower);
  if (nameMatches.length === 1) return nameMatches[0];

  const fuzzy = searchNodes(graph.nodes ?? [], ref, { limit: 1 });
  if (fuzzy.length > 0) return fuzzy[0].node;

  fail(`No node found for: ${ref}`, 2);
}

function resolveSeedSet(ref, graph, indexes) {
  const node = resolveNode(ref, graph, indexes);
  const seeds = new Map([[node.id, node]]);

  if (node.filePath) {
    for (const related of indexes.nodesByFile.get(normalizePath(node.filePath)) ?? []) {
      seeds.set(related.id, related);
    }
  } else if (node.type === "file" && node.id.startsWith("file:")) {
    const filePath = node.id.slice("file:".length);
    for (const related of indexes.nodesByFile.get(normalizePath(filePath)) ?? []) {
      seeds.set(related.id, related);
    }
  }

  for (const edge of indexes.edgesBySource.get(node.id) ?? []) {
    if (edge.type === "contains") {
      const contained = indexes.nodeById.get(edge.target);
      if (contained) seeds.set(contained.id, contained);
    }
  }

  return [...seeds.values()];
}

function traverse(indexes, seedIds, options) {
  const maxDepth = options.depth ?? DEFAULT_DEPTH;
  const maxNodes = options.limit ?? DEFAULT_LIMIT;
  const direction = options.direction ?? "both";
  const seen = new Set(seedIds);
  const edgeMap = new Map();
  const queue = seedIds.map((id) => ({ id, depth: 0 }));
  let truncated = false;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor];
    if (item.depth >= maxDepth) continue;

    const edges = [];
    if (direction === "out" || direction === "both") {
      edges.push(...(indexes.edgesBySource.get(item.id) ?? []));
    }
    if (direction === "in" || direction === "both") {
      edges.push(...(indexes.edgesByTarget.get(item.id) ?? []));
    }

    for (const edge of edges) {
      edgeMap.set(edgeKey(edge), edge);
      const nextId = edge.source === item.id ? edge.target : edge.source;
      if (!indexes.nodeById.has(nextId) || seen.has(nextId)) continue;

      if (seen.size >= maxNodes) {
        truncated = true;
        continue;
      }

      seen.add(nextId);
      queue.push({ id: nextId, depth: item.depth + 1 });
    }
  }

  return {
    nodeIds: [...seen],
    edges: [...edgeMap.values()].filter((edge) => seen.has(edge.source) && seen.has(edge.target)),
    truncated,
  };
}

function directRelationships(nodeId, indexes, limit) {
  const outgoing = (indexes.edgesBySource.get(nodeId) ?? []).slice(0, limit);
  const incoming = (indexes.edgesByTarget.get(nodeId) ?? []).slice(0, limit);

  return {
    outgoing: outgoing.map((edge) => summarizeEdge(edge, indexes)),
    incoming: incoming.map((edge) => summarizeEdge(edge, indexes)),
    outgoingTruncated: (indexes.edgesBySource.get(nodeId) ?? []).length > outgoing.length,
    incomingTruncated: (indexes.edgesByTarget.get(nodeId) ?? []).length > incoming.length,
  };
}

function summarizeNode(node, indexes, options = {}) {
  if (!node) return undefined;
  const summary = {
    id: node.id,
    type: node.type,
    name: node.name,
    filePath: node.filePath,
    lineRange: node.lineRange,
    summary: node.summary,
    tags: node.tags ?? [],
    complexity: node.complexity,
    layers: (indexes.layersByNode.get(node.id) ?? []).map((layer) => layer.name),
  };

  if (options.full) {
    summary.languageNotes = node.languageNotes;
    summary.domainMeta = node.domainMeta;
    summary.knowledgeMeta = node.knowledgeMeta;
  }

  return prune(summary);
}

function summarizeEdge(edge, indexes) {
  return prune({
    source: edge.source,
    sourceName: indexes.nodeById.get(edge.source)?.name,
    target: edge.target,
    targetName: indexes.nodeById.get(edge.target)?.name,
    type: edge.type,
    direction: edge.direction,
    weight: edge.weight,
    description: edge.description,
  });
}

function summarizeLayer(layer) {
  return {
    id: layer.id,
    name: layer.name,
    description: layer.description,
    nodeCount: (layer.nodeIds ?? []).length,
  };
}

function getFreshness(graph, options) {
  const graphCommitHash = graph.project?.gitCommitHash;
  const headCommitHash = git(["rev-parse", "HEAD"]);
  let changedFiles = [];

  if (graphCommitHash && headCommitHash && graphCommitHash !== headCommitHash) {
    const diff = git(["diff", "--name-only", `${graphCommitHash}..HEAD`]);
    changedFiles = diff ? diff.split("\n").filter(Boolean) : [];
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  return {
    graphCommitHash,
    headCommitHash,
    isStale: Boolean(graphCommitHash && headCommitHash && graphCommitHash !== headCommitHash),
    changedFileCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, limit),
    changedFilesTruncated: changedFiles.length > limit,
  };
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function writeOutput(value, format, options = {}) {
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(prune(value), null, options.pretty ? 2 : 0)}\n`);
    return;
  }

  if (format === "md") {
    process.stdout.write(`${toMarkdown(value)}\n`);
    return;
  }

  process.stdout.write(`${toText(value)}\n`);
}

function toMarkdown(value) {
  if (value.command === "find") {
    return [
      `# ugraph find: ${value.query}`,
      "",
      ...value.results.map((result) => `- ${result.node.name} (${result.node.type}) - ${result.node.filePath ?? result.node.id}: ${result.node.summary}`),
    ].join("\n");
  }

  if (value.nodes && value.edges) {
    return [
      `# ugraph ${value.command}`,
      "",
      "## Nodes",
      ...value.nodes.map((node) => `- ${node.name} (${node.type}) - ${node.filePath ?? node.id}: ${node.summary}`),
      "",
      "## Relationships",
      ...value.edges.map((edge) => `- ${edge.sourceName ?? edge.source} --[${edge.type}]--> ${edge.targetName ?? edge.target}`),
    ].join("\n");
  }

  return `\`\`\`json\n${JSON.stringify(prune(value), null, 2)}\n\`\`\``;
}

function toText(value) {
  if (value.command === "overview") {
    return [
      `${value.project?.name ?? "Project"}: ${value.project?.description ?? ""}`,
      `nodes=${value.graph.nodes} edges=${value.graph.edges} layers=${value.graph.layers} stale=${value.freshness.isStale}`,
      `languages=${(value.project?.languages ?? []).join(", ")}`,
      `frameworks=${(value.project?.frameworks ?? []).join(", ")}`,
    ].join("\n");
  }

  if (value.command === "find") {
    return value.results.map((result) => `${result.node.id}\t${result.node.type}\t${result.node.filePath ?? ""}\t${result.node.summary ?? ""}`).join("\n");
  }

  return JSON.stringify(prune(value), null, 2);
}

function countBy(items, key) {
  return Object.fromEntries(
    [...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map()).entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))),
  );
}

function topTags(nodes, limit) {
  const counts = new Map();
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function pushMap(map, key, value) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function edgeKey(edge) {
  return `${edge.source}\0${edge.type}\0${edge.target}`;
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function splitList(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`${label} must be a positive integer`, 1);
  }
  return parsed;
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function requireOne(values, command) {
  if (!values[0]) fail(`${command} requires a node id, file path, or name`, 1);
  return values.join(" ");
}

function prune(value) {
  if (Array.isArray(value)) {
    return value.map((item) => prune(item)).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null)
        .map(([key, item]) => [key, prune(item)]),
    );
  }

  return value;
}

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

main(process.argv.slice(2));

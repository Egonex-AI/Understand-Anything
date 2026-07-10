import { z } from "zod";

// Edge types (36 values across 8 categories)
export const EdgeTypeSchema = z.enum([
  "imports", "exports", "contains", "inherits", "implements",  // Structural
  "calls", "subscribes", "publishes", "middleware",             // Behavioral
  "reads_from", "writes_to", "transforms", "validates",        // Data flow
  "depends_on", "tested_by", "configures", "specifies",        // Dependencies
  "related", "similar_to",                                      // Semantic
  "deploys", "serves", "provisions", "triggers",               // Infrastructure
  "migrates", "documents", "routes", "defines_schema",         // Schema/Data
  "contains_flow", "flow_step", "cross_domain",                // Domain
  "cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by", // Knowledge
]);

// Aliases that LLMs commonly generate instead of canonical node types
export const NODE_TYPE_ALIASES: Record<string, string> = {
  func: "function",
  fn: "function",
  method: "function",
  interface: "class",
  struct: "class",
  mod: "module",
  pkg: "module",
  package: "module",
  // Non-code aliases
  container: "service",
  deployment: "service",
  pod: "service",
  doc: "document",
  readme: "document",
  docs: "document",
  job: "pipeline",
  ci: "pipeline",
  route: "endpoint",
  api: "endpoint",
  query: "endpoint",
  mutation: "endpoint",
  setting: "config",
  env: "config",
  configuration: "config",
  infra: "resource",
  infrastructure: "resource",
  terraform: "resource",
  migration: "table",
  database: "table",
  db: "table",
  view: "table",
  proto: "schema",
  protobuf: "schema",
  definition: "schema",
  typedef: "schema",
  // Domain aliases — "process" intentionally excluded (ambiguous with OS/Node.js process)
  business_domain: "domain",
  business_flow: "flow",
  business_process: "flow",
  task: "step",
  business_step: "step",
  // Knowledge aliases
  note: "article",
  page: "article",
  wiki_page: "article",
  person: "entity",
  actor: "entity",
  organization: "entity",
  tag: "topic",
  category: "topic",
  theme: "topic",
  assertion: "claim",
  decision: "claim",
  thesis: "claim",
  reference: "source",
  raw: "source",
  paper: "source",
};

// Aliases that LLMs commonly generate instead of canonical edge types
export const EDGE_TYPE_ALIASES: Record<string, string> = {
  extends: "inherits",
  invokes: "calls",
  invoke: "calls",
  uses: "depends_on",
  requires: "depends_on",
  relates_to: "related",
  related_to: "related",
  similar: "similar_to",
  import: "imports",
  export: "exports",
  contain: "contains",
  publish: "publishes",
  subscribe: "subscribes",
  // Non-code aliases
  describes: "documents",
  documented_by: "documents",
  // Note: `specified_by` inverts direction (code → spec); the merge-step spec
  // linker rewrites it to canonical `specifies` (spec → code). Aliasing the
  // type here keeps validator-side normalization consistent.
  specified_by: "specifies",
  specification_of: "specifies",
  creates: "provisions",
  exposes: "serves",
  listens: "serves",
  deploys_to: "deploys",
  migrates_to: "migrates",
  routes_to: "routes",
  triggers_on: "triggers",
  fires: "triggers",
  defines: "defines_schema",
  // Domain aliases
  has_flow: "contains_flow",
  next_step: "flow_step",
  interacts_with: "cross_domain",
  // Knowledge aliases
  references: "cites",
  cites_source: "cites",
  conflicts_with: "contradicts",
  disagrees_with: "contradicts",
  refines: "builds_on",
  elaborates: "builds_on",
  illustrates: "exemplifies",
  instance_of: "exemplifies",
  example_of: "exemplifies",
  belongs_to: "categorized_under",
  tagged_with: "categorized_under",
  written_by: "authored_by",
  created_by: "authored_by",
  // Note: "implemented_by" is intentionally NOT aliased to "implements" —
  // it inverts edge direction (see commit fd0df15). The LLM should use
  // "implements" with correct source/target instead.
};

// Aliases for complexity values LLMs commonly generate
export const COMPLEXITY_ALIASES: Record<string, string> = {
  low: "simple",
  easy: "simple",
  medium: "moderate",
  intermediate: "moderate",
  high: "complex",
  hard: "complex",
  difficult: "complex",
};

// Aliases for direction values LLMs commonly generate
export const DIRECTION_ALIASES: Record<string, string> = {
  to: "forward",
  outbound: "forward",
  from: "backward",
  inbound: "backward",
  both: "bidirectional",
  mutual: "bidirectional",
};

export function sanitizeGraph(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };

  // Null → empty array for top-level collections
  if (data.tour === null || data.tour === undefined) result.tour = [];
  if (data.layers === null || data.layers === undefined) result.layers = [];

  // Sanitize nodes
  if (Array.isArray(data.nodes)) {
    result.nodes = (data.nodes as Record<string, unknown>[]).map((node) => {
      if (typeof node !== "object" || node === null) return node;
      const n = { ...node };
      // Null → undefined for optional fields
      if (n.filePath === null) delete n.filePath;
      if (n.lineRange === null) delete n.lineRange;
      if (n.languageNotes === null) delete n.languageNotes;
      // Lowercase enum-like strings
      if (typeof n.type === "string") n.type = n.type.toLowerCase();
      if (typeof n.complexity === "string") n.complexity = n.complexity.toLowerCase();
      return n;
    });
  }

  // Sanitize edges
  if (Array.isArray(data.edges)) {
    result.edges = (data.edges as Record<string, unknown>[]).map((edge) => {
      if (typeof edge !== "object" || edge === null) return edge;
      const e = { ...edge };
      if (e.description === null) delete e.description;
      if (typeof e.type === "string") e.type = e.type.toLowerCase();
      if (typeof e.direction === "string") e.direction = e.direction.toLowerCase();
      return e;
    });
  }

  // Sanitize tour steps
  if (Array.isArray(result.tour)) {
    result.tour = (result.tour as Record<string, unknown>[]).map((step) => {
      if (typeof step !== "object" || step === null) return step;
      const s = { ...step };
      if (s.languageLesson === null) delete s.languageLesson;
      return s;
    });
  }

  return result;
}

export function autoFixGraph(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  issues: GraphIssue[];
} {
  const issues: GraphIssue[] = [];
  const result = { ...data };

  if (Array.isArray(data.nodes)) {
    result.nodes = (data.nodes as Record<string, unknown>[]).map((node, i) => {
      if (typeof node !== "object" || node === null) return node;
      const n = { ...node };
      const name = (n.name as string) || (n.id as string) || `index ${i}`;

      // Missing or empty type
      if (!n.type || typeof n.type !== "string") {
        n.type = "file";
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `nodes[${i}] ("${name}"): missing "type" — defaulted to "file"`,
          path: `nodes[${i}].type`,
        });
      }

      // Missing or empty complexity
      if (!n.complexity || n.complexity === "") {
        n.complexity = "moderate";
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `nodes[${i}] ("${name}"): missing "complexity" — defaulted to "moderate"`,
          path: `nodes[${i}].complexity`,
        });
      } else if (typeof n.complexity === "string" && n.complexity in COMPLEXITY_ALIASES) {
        const original = n.complexity;
        n.complexity = COMPLEXITY_ALIASES[n.complexity];
        issues.push({
          level: "auto-corrected",
          category: "alias",
          message: `nodes[${i}] ("${name}"): complexity "${original}" — mapped to "${n.complexity}"`,
          path: `nodes[${i}].complexity`,
        });
      }

      // Missing tags
      if (!Array.isArray(n.tags)) {
        n.tags = [];
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `nodes[${i}] ("${name}"): missing "tags" — defaulted to []`,
          path: `nodes[${i}].tags`,
        });
      }

      // Missing summary
      if (!n.summary || typeof n.summary !== "string") {
        n.summary = (n.name as string) || "No summary";
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `nodes[${i}] ("${name}"): missing "summary" — defaulted to name`,
          path: `nodes[${i}].summary`,
        });
      }

      return n;
    });
  }

  if (Array.isArray(data.edges)) {
    result.edges = (data.edges as Record<string, unknown>[]).map((edge, i) => {
      if (typeof edge !== "object" || edge === null) return edge;
      const e = { ...edge };

      // Missing type
      if (!e.type || typeof e.type !== "string") {
        e.type = "depends_on";
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `edges[${i}]: missing "type" — defaulted to "depends_on"`,
          path: `edges[${i}].type`,
        });
      }

      // Missing direction
      if (!e.direction || typeof e.direction !== "string") {
        e.direction = "forward";
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `edges[${i}]: missing "direction" — defaulted to "forward"`,
          path: `edges[${i}].direction`,
        });
      } else if (e.direction in DIRECTION_ALIASES) {
        const original = e.direction;
        e.direction = DIRECTION_ALIASES[e.direction as string];
        issues.push({
          level: "auto-corrected",
          category: "alias",
          message: `edges[${i}]: direction "${original}" — mapped to "${e.direction}"`,
          path: `edges[${i}].direction`,
        });
      }

      // Missing weight
      if (e.weight === undefined || e.weight === null) {
        e.weight = 0.5;
        issues.push({
          level: "auto-corrected",
          category: "missing-field",
          message: `edges[${i}]: missing "weight" — defaulted to 0.5`,
          path: `edges[${i}].weight`,
        });
      } else if (typeof e.weight === "string") {
        const parsed = parseFloat(e.weight as string);
        if (!isNaN(parsed)) {
          const original = e.weight;
          e.weight = parsed;
          issues.push({
            level: "auto-corrected",
            category: "type-coercion",
            message: `edges[${i}]: weight was string "${original}" — coerced to number`,
            path: `edges[${i}].weight`,
          });
        } else {
          const original = e.weight;
          e.weight = 0.5;
          issues.push({
            level: "auto-corrected",
            category: "type-coercion",
            message: `edges[${i}]: weight "${original}" is not a valid number — defaulted to 0.5`,
            path: `edges[${i}].weight`,
          });
        }
      }

      // Clamp weight to [0, 1]
      if (typeof e.weight === "number" && (e.weight < 0 || e.weight > 1)) {
        const original = e.weight;
        e.weight = Math.max(0, Math.min(1, e.weight));
        issues.push({
          level: "auto-corrected",
          category: "out-of-range",
          message: `edges[${i}]: weight ${original} clamped to ${e.weight}`,
          path: `edges[${i}].weight`,
        });
      }

      return e;
    });
  }

  return { data: result, issues };
}

const DomainMetaSchema = z.object({
  entities: z.array(z.string()).optional(),
  businessRules: z.array(z.string()).optional(),
  crossDomainInteractions: z.array(z.string()).optional(),
  entryPoint: z.string().optional(),
  entryType: z.enum(["http", "cli", "event", "cron", "manual"]).optional(),
}).passthrough();

const KnowledgeMetaSchema = z.object({
  wikilinks: z.array(z.string()).optional(),
  backlinks: z.array(z.string()).optional(),
  category: z.string().optional(),
  content: z.string().optional(),
}).passthrough();

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    "file", "function", "class", "module", "concept",
    "config", "document", "service", "table", "endpoint",
    "pipeline", "schema", "resource",
    "domain", "flow", "step",
    "article", "entity", "topic", "claim", "source",
  ]),
  name: z.string(),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  summary: z.string(),
  tags: z.array(z.string()),
  complexity: z.enum(["simple", "moderate", "complex"]),
  languageNotes: z.string().optional(),
  domainMeta: DomainMetaSchema.optional(),
  knowledgeMeta: KnowledgeMetaSchema.optional(),
}).passthrough();

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  direction: z.enum(["forward", "backward", "bidirectional"]),
  description: z.string().optional(),
  weight: z.number().min(0).max(1),
});

export const LayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodeIds: z.array(z.string()),
});

export const TourStepSchema = z.object({
  order: z.number(),
  title: z.string(),
  description: z.string(),
  nodeIds: z.array(z.string()),
  languageLesson: z.string().optional(),
});

export const ProjectMetaSchema = z.object({
  name: z.string(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  description: z.string(),
  analyzedAt: z.string(),
  gitCommitHash: z.string(),
});

export const KnowledgeGraphSchema = z.object({
  version: z.string(),
  kind: z.enum(["codebase", "knowledge"]).optional(),
  project: ProjectMetaSchema,
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  layers: z.array(LayerSchema),
  tour: z.array(TourStepSchema),
});

export interface GraphIssue {
  level: "auto-corrected" | "dropped" | "fatal";
  category: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  success: boolean;
  data?: z.infer<typeof KnowledgeGraphSchema>;
  /** @deprecated Use issues/fatal instead */
  errors?: string[];
  issues: GraphIssue[];
  fatal?: string;
}

function buildInvalidCollectionIssue(name: string): GraphIssue {
  return {
    level: "fatal",
    category: "invalid-collection",
    message: `"${name}" must be an array when present`,
    path: name,
  };
}

function buildErrors(issues: GraphIssue[], fatal?: string): string[] | undefined {
  const messages = issues.map((issue) => issue.message);
  if (fatal && !messages.includes(fatal)) messages.unshift(fatal);
  return messages.length > 0 ? messages : undefined;
}

export function normalizeGraph(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;

  const d = data as Record<string, unknown>;
  const result = { ...d };

  if (Array.isArray(d.nodes)) {
    result.nodes = (d.nodes as Array<Record<string, unknown>>).map((node) => {
      if (
        typeof node === "object" &&
        node !== null &&
        typeof node.type === "string" &&
        node.type in NODE_TYPE_ALIASES
      ) {
        return { ...node, type: NODE_TYPE_ALIASES[node.type] };
      }
      return node;
    });
  }

  if (Array.isArray(d.edges)) {
    result.edges = (d.edges as Array<Record<string, unknown>>).map((edge) => {
      if (
        typeof edge === "object" &&
        edge !== null &&
        typeof edge.type === "string" &&
        edge.type in EDGE_TYPE_ALIASES
      ) {
        return { ...edge, type: EDGE_TYPE_ALIASES[edge.type] };
      }
      return edge;
    });
  }

  return result;
}

export function validateGraph(data: unknown): ValidationResult {
  // Tier 4: Fatal — not even an object
  if (typeof data !== "object" || data === null) {
    const fatal = "Invalid input: not an object";
    return { success: false, issues: [], fatal, errors: buildErrors([], fatal) };
  }

  const raw = data as Record<string, unknown>;

  // Tier 1: Sanitize
  const sanitized = sanitizeGraph(raw);

  // Existing: Normalize type aliases
  const normalized = normalizeGraph(sanitized) as Record<string, unknown>;

  // Tier 2: Auto-fix defaults and coercion
  const { data: fixed, issues } = autoFixGraph(normalized);

  // Tier 4: Fatal — malformed top-level collections
  const requiredCollections = ["nodes", "edges", "layers", "tour"] as const;
  for (const collection of requiredCollections) {
    if (collection in fixed && fixed[collection] !== undefined && !Array.isArray(fixed[collection])) {
      const issue = buildInvalidCollectionIssue(collection);
      issues.push(issue);
      return {
        success: false,
        errors: buildErrors(issues, issue.message),
        issues,
        fatal: issue.message,
      };
    }
  }

  // Tier 4: Fatal — missing project metadata
  const projectResult = ProjectMetaSchema.safeParse(fixed.project);
  if (!projectResult.success) {
    return {
      success: false,
      errors: buildErrors(issues, "Missing or invalid project metadata"),
      issues,
      fatal: "Missing or invalid project metadata",
    };
  }

  // Tier 3: Validate nodes individually, drop broken
  const validNodes: z.infer<typeof GraphNodeSchema>[] = [];
  if (Array.isArray(fixed.nodes)) {
    for (let i = 0; i < fixed.nodes.length; i++) {
      const node = fixed.nodes[i] as Record<string, unknown>;
      const result = GraphNodeSchema.safeParse(node);
      if (result.success) {
        validNodes.push(result.data);
      } else {
        const name = node?.name || node?.id || `index ${i}`;
        issues.push({
          level: "dropped",
          category: "invalid-node",
          message: `nodes[${i}] ("${name}"): ${result.error.issues[0]?.message ?? "validation failed"} — removed`,
          path: `nodes[${i}]`,
        });
      }
    }
  }

  // Tier 4: Fatal — no valid nodes
  if (validNodes.length === 0) {
    return {
      success: false,
      errors: buildErrors(issues, "No valid nodes found in knowledge graph"),
      issues,
      fatal: "No valid nodes found in knowledge graph",
    };
  }

  // Tier 3: Validate edges + referential integrity
  const nodeIds = new Set(validNodes.map((n) => n.id));
  const validEdges: z.infer<typeof GraphEdgeSchema>[] = [];
  if (Array.isArray(fixed.edges)) {
    for (let i = 0; i < fixed.edges.length; i++) {
      const edge = fixed.edges[i] as Record<string, unknown>;
      const result = GraphEdgeSchema.safeParse(edge);
      if (!result.success) {
        issues.push({
          level: "dropped",
          category: "invalid-edge",
          message: `edges[${i}]: ${result.error.issues[0]?.message ?? "validation failed"} — removed`,
          path: `edges[${i}]`,
        });
        continue;
      }
      if (!nodeIds.has(result.data.source)) {
        issues.push({
          level: "dropped",
          category: "invalid-reference",
          message: `edges[${i}]: source "${result.data.source}" does not exist in nodes — removed`,
          path: `edges[${i}].source`,
        });
        continue;
      }
      if (!nodeIds.has(result.data.target)) {
        issues.push({
          level: "dropped",
          category: "invalid-reference",
          message: `edges[${i}]: target "${result.data.target}" does not exist in nodes — removed`,
          path: `edges[${i}].target`,
        });
        continue;
      }
      validEdges.push(result.data);
    }
  }

  // Validate layers (drop broken, filter dangling nodeIds)
  const validLayers: z.infer<typeof LayerSchema>[] = [];
  if (Array.isArray(fixed.layers)) {
    for (let i = 0; i < (fixed.layers as unknown[]).length; i++) {
      const result = LayerSchema.safeParse((fixed.layers as unknown[])[i]);
      if (result.success) {
        validLayers.push({
          ...result.data,
          nodeIds: result.data.nodeIds.filter((id) => nodeIds.has(id)),
        });
      } else {
        issues.push({
          level: "dropped",
          category: "invalid-layer",
          message: `layers[${i}]: ${result.error.issues[0]?.message ?? "validation failed"} — removed`,
          path: `layers[${i}]`,
        });
      }
    }
  }

  // Validate tour steps (drop broken, filter dangling nodeIds)
  const validTour: z.infer<typeof TourStepSchema>[] = [];
  if (Array.isArray(fixed.tour)) {
    for (let i = 0; i < (fixed.tour as unknown[]).length; i++) {
      const result = TourStepSchema.safeParse((fixed.tour as unknown[])[i]);
      if (result.success) {
        validTour.push({
          ...result.data,
          nodeIds: result.data.nodeIds.filter((id) => nodeIds.has(id)),
        });
      } else {
        issues.push({
          level: "dropped",
          category: "invalid-tour-step",
          message: `tour[${i}]: ${result.error.issues[0]?.message ?? "validation failed"} — removed`,
          path: `tour[${i}]`,
        });
      }
    }
  }

  const graph = {
    version: typeof fixed.version === "string" ? fixed.version : "1.0.0",
    project: projectResult.data,
    nodes: validNodes,
    edges: validEdges,
    layers: validLayers,
    tour: validTour,
  };

  return { success: true, data: graph, issues, errors: buildErrors(issues) };
}

import type { EdgeType } from "../types.js";

// --- Type definitions ---

export interface EdgeMapping {
  edge: EdgeType;
  weight: number;
  role?: "source" | "target";
  extractPath?: string;
}

export interface FrameworkRule {
  id: string;
  displayName: string;
  detectionKeywords: string[];
  annotations: Record<string, EdgeMapping>;
  metaAnnotations?: Record<string, string[]>;
}

export interface RuleConfig {
  version: number;
  rules: {
    annotations: Record<string, EdgeMapping>;
    metaAnnotations?: Record<string, string[]>;
  };
}

// --- Known EdgeType set (for validation) ---
const KNOWN_EDGE_TYPES = new Set<string>([
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "subscribes", "publishes", "middleware",
  "provides_rpc", "consumes_rpc",
  "provides_route", "consumes_route",
  "consumes_api", "injects",
  "reads_from", "writes_to", "transforms", "validates",
  "depends_on", "tested_by", "configures",
  "related", "similar_to",
  "deploys", "serves", "provisions", "triggers",
  "migrates", "documents", "routes", "defines_schema",
  "contains_flow", "flow_step", "cross_domain",
  "cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by",
]);

// --- Built-in framework rules ---
export const BUILTIN_RULES: FrameworkRule[] = [
  {
    id: "spring",
    displayName: "Spring Framework",
    detectionKeywords: ["spring-boot-starter", "spring-context", "springframework"],
    annotations: {
      "Autowired": { edge: "injects", weight: 0.9, role: "target" },
      "Resource": { edge: "injects", weight: 0.9, role: "target" },
      "Inject": { edge: "injects", weight: 0.9, role: "target" },
      "Component": { edge: "related", weight: 0.5 },
      "Service": { edge: "related", weight: 0.5 },
      "Repository": { edge: "related", weight: 0.5 },
      "Controller": { edge: "provides_route", weight: 0.8 },
      "RestController": { edge: "provides_route", weight: 0.8 },
    },
    metaAnnotations: {
      "Service": ["Component"],
      "Repository": ["Component"],
      "Controller": ["Component"],
      "RestController": ["Controller", "Component"],
    },
  },
  {
    id: "dubbo",
    displayName: "Apache Dubbo",
    detectionKeywords: ["dubbo-spring-boot-starter", "org.apache.dubbo"],
    annotations: {
      "DubboService": { edge: "provides_rpc", weight: 0.9 },
      "DubboReference": { edge: "consumes_rpc", weight: 0.9 },
    },
  },
  {
    id: "moa",
    displayName: "MOA RPC",
    detectionKeywords: ["moa-spring-boot-starter"],
    annotations: {
      "MoaProvider": { edge: "provides_rpc", weight: 0.9, extractPath: "uri" },
      "MoaConsumer": { edge: "consumes_rpc", weight: 0.9, extractPath: "serviceUri" },
    },
  },
  {
    id: "feign",
    displayName: "OpenFeign",
    detectionKeywords: ["spring-cloud-starter-openfeign", "feign-core"],
    annotations: {
      "FeignClient": { edge: "consumes_rpc", weight: 0.9, extractPath: "name" },
    },
  },
  {
    id: "grpc",
    displayName: "gRPC",
    detectionKeywords: ["grpc-spring-boot-starter", "io.grpc"],
    annotations: {
      "GrpcService": { edge: "provides_rpc", weight: 0.9 },
      "GrpcClient": { edge: "consumes_rpc", weight: 0.9 },
    },
  },
  {
    id: "kafka",
    displayName: "Apache Kafka",
    detectionKeywords: ["spring-kafka", "kafka-clients"],
    annotations: {
      "KafkaListener": { edge: "subscribes", weight: 0.9 },
      "KafkaTemplate": { edge: "publishes", weight: 0.9 },
    },
  },
  {
    id: "retrofit",
    displayName: "Retrofit",
    detectionKeywords: ["retrofit", "com.squareup.retrofit2"],
    annotations: {
      "GET": { edge: "consumes_api", weight: 0.8 },
      "POST": { edge: "consumes_api", weight: 0.8 },
      "PUT": { edge: "consumes_api", weight: 0.8 },
      "DELETE": { edge: "consumes_api", weight: 0.8 },
    },
  },
  {
    id: "react",
    displayName: "React",
    detectionKeywords: ["react", "react-dom"],
    annotations: {},
  },
  {
    id: "nestjs",
    displayName: "NestJS",
    detectionKeywords: ["@nestjs/core", "@nestjs/common"],
    annotations: {
      "Injectable": { edge: "injects", weight: 0.9 },
      "Controller": { edge: "provides_route", weight: 0.8 },
    },
  },
];

// --- Validation ---

export function validateRuleConfig(config: unknown): asserts config is RuleConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("Config must be an object");
  }
  const c = config as Record<string, unknown>;
  if (typeof c.version !== "number" || c.version < 1) {
    throw new Error("Config must have a 'version' field (number >= 1)");
  }
  if (typeof c.rules !== "object" || c.rules === null) {
    throw new Error("Config must have a 'rules' field");
  }
  const rules = c.rules as Record<string, unknown>;
  if (typeof rules.annotations !== "object" || rules.annotations === null) {
    throw new Error("Config.rules must have an 'annotations' field");
  }
  for (const [name, mapping] of Object.entries(rules.annotations as Record<string, unknown>)) {
    if (typeof mapping !== "object" || mapping === null) {
      throw new Error(`Annotation '${name}' must be an object`);
    }
    const m = mapping as Record<string, unknown>;
    if (typeof m.edge !== "string" || !KNOWN_EDGE_TYPES.has(m.edge)) {
      throw new Error(`Annotation '${name}' has invalid EdgeType: '${m.edge}'`);
    }
    if (m.weight !== undefined && (typeof m.weight !== "number" || m.weight < 0 || m.weight > 1)) {
      throw new Error(`Annotation '${name}' weight must be in [0, 1]`);
    }
  }
}

// --- Framework detection ---

export function detectFrameworks(dependencies: string[]): string[] {
  const depSet = new Set(dependencies);
  const detected: string[] = [];
  for (const rule of BUILTIN_RULES) {
    if (rule.detectionKeywords.some((kw) => depSet.has(kw))) {
      detected.push(rule.id);
    }
  }
  return detected;
}

// Node types (21 total: 5 code + 8 non-code + 3 domain + 5 knowledge)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "flow" | "step"
  | "article" | "entity" | "topic" | "claim" | "source";

// Edge types (39 total in 8 categories: Structural, Behavioral, Data flow, Dependencies, Semantic, Infrastructure/Schema, Domain, Knowledge)
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "provides_rpc" | "consumes_rpc"                                  // RPC (cross-service)
  | "consumes_api"                                                    // API consumption (client→server)
  | "injects"                                                        // Dependency Injection
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"                // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"          // Schema/Data
  | "contains_flow" | "flow_step" | "cross_domain"                  // Domain
  | "cites" | "contradicts" | "builds_on" | "exemplifies" | "categorized_under" | "authored_by"; // Knowledge

// Metadata for consumes_api edges (client function → server endpoint)
export interface ApiCallMeta {
  method: string;   // "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  path: string;     // "/api/orders" or "/api/orders/{id}"
}

// Optional knowledge metadata for article/entity/topic/claim/source nodes
export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
  service?: string;
}

// Wiki output file schemas
export interface WikiDomainState {
  lastGeneratedAt: string;
  nodeCount: number;
  flowCount: number;
}

export interface WikiMeta {
  gitCommitHash: string;
  generatedAt: string;
  version: string;
  outputLanguage: string;
  serviceCount?: number;
  domainStates?: Record<string, WikiDomainState>;
  rpcEdgeHash?: string;
}

export interface WikiIndexEntry {
  id: string;
  name: string;
  type: "overview" | "architecture" | "domain" | "flow" | "step" | "service" | "endpoint";
  service?: string;
  domain?: string;
  summary: string;
}

export interface EndpointMethodSignature {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  description?: string;
  lineRange?: [number, number];
}

export interface ServiceEndpointDoc {
  service: string;
  description: string;
  providers: Array<{
    identifier: string;
    protocol: string;
    framework: string;
    group?: string;
    version?: string;
    methods: EndpointMethodSignature[];
    sourceRef?: { file: string; lineRange?: [number, number] };
  }>;
  consumers: Array<{
    identifier: string;
    protocol: string;
    framework: string;
    targetInterface: string;
    targetService?: string;
    sourceRef?: { file: string; lineRange?: [number, number] };
  }>;
  kafkaTopics: Array<{
    topic: string;
    role: "publisher" | "subscriber";
    handlerMethod?: string;
    sourceRef?: { file: string; lineRange?: [number, number] };
  }>;
}

export interface WikiIndex {
  entries: WikiIndexEntry[];
}

export interface WikiServiceOverview {
  name: string;
  description: string;
  techStack: string[];
  modules: string[];
  entryPoints: string[];
}

export interface WikiFlowStep {
  order: number;
  name: string;
  description: string;
  sourceRef?: { file: string; lineRange?: [number, number] };
}

export interface WikiFlow {
  id: string;
  name: string;
  summary: string;
  steps: WikiFlowStep[];
}

export interface WikiGlossaryEntry {
  term: string;
  definition: string;
}

export interface WikiBusinessRule {
  id: string;
  rule: string;
  enforcement?: string;
  sourceRef?: { file: string; lineRange?: [number, number] };
}

export interface WikiEntity {
  name: string;
  description: string;
  keyFields?: string[];
  lifecycleStates?: string[];
  invariants?: string[];
}

export interface WikiIntegrationPoint {
  source?: string;
  target?: string;
  type: string;
  endpoint: string;
  description: string;
}

export interface WikiIntegrationPoints {
  inbound?: WikiIntegrationPoint[];
  outbound?: WikiIntegrationPoint[];
}

export interface WikiErrorCatalogEntry {
  exception: string;
  trigger: string;
  handling: string;
  severity?: "user_error" | "transient" | "fatal" | string;
}

export interface WikiDomainPage {
  id: string;
  name: string;
  summary: string;
  entities: (string | WikiEntity)[];
  flows: WikiFlow[];
  ubiquitousLanguage?: WikiGlossaryEntry[];
  businessRules?: WikiBusinessRule[];
  integrationPoints?: WikiIntegrationPoints;
  errorCatalog?: WikiErrorCatalogEntry[];
  crossServiceCalls?: CrossServiceCall[];
}

export interface CrossServiceCall {
  caller: {
    service: string;
    node: string;
    file?: string;
    method: string;
  };
  callee: {
    service: string;
    node: string;
    interface?: string;
    method: string;
  };
  type: "moa_rpc" | "dubbo_rpc" | "http" | "kafka" | "database" | "unknown";
  evidence: "script-matched" | "llm-discovered" | "user-override";
  detail?: string;
}

// Parent-level Wiki types (multi-service)
export interface WikiOverview {
  name: string;
  description: string;
  services: Array<{
    name: string;
    description: string;
    domains: string[];
  }>;
  techStack: string[];
}

export interface WikiArchitecture {
  crossServiceCalls: CrossServiceCall[];
  sharedResources: Array<{
    type: "database" | "cache" | "queue" | "storage";
    name: string;
    services: string[];
  }>;
  eventFlows: Array<{
    topic: string;
    publisher: string;
    subscribers: string[];
  }>;
}

export interface WikiCrossDomainStep {
  order: number;
  service: string;
  description: string;
  wikiRef?: string;
  crossServiceCall?: {
    interface: string;
    method: string;
    type: string;
  };
}

export interface WikiCrossDomain {
  id: string;
  name: string;
  summary: string;
  services: string[];
  steps: WikiCrossDomainStep[];
}

export interface WikiSearchResult {
  id: string;
  name: string;
  type: WikiIndexEntry["type"];
  service?: string;
  domain?: string;
  summary: string;
  score: number;
  matchSnippet?: string;
}

export interface WikiTopology {
  hasParentWiki: boolean;
  parentWikiDir: string | null;
  services: Array<{
    name: string;
    wikiDir: string;
    meta: WikiMeta;
  }>;
}

// RPC annotation config
export interface RpcAnnotationConfig {
  provider: string;
  consumer: string;
  type: string;
}

// Extended project config with RPC annotations and Wiki settings
export interface ProjectConfigExtended extends ProjectConfig {
  rpcAnnotations?: RpcAnnotationConfig[];
}

// Optional domain metadata for domain/flow/step nodes
export interface DomainMeta {
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoint?: string;
  entryType?: "http" | "cli" | "event" | "cron" | "manual";
}

// GraphNode with 21 types: 5 code + 8 non-code + 3 domain + 5 knowledge
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
  domainMeta?: DomainMeta;
  knowledgeMeta?: KnowledgeMeta;
}

// GraphEdge with rich relationship modeling
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number; // 0-1
}

// Layer (logical grouping)
export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

// TourStep (for learn mode)
export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// ArtifactProvenance — tracks how an artifact was generated and its completeness
export interface ArtifactProvenance {
  generationMode: "full" | "incremental" | "standalone";
  completedStages: string[];
  degraded: boolean;
  qualityGates?: Record<string, boolean>;
  gitCommitHash: string;
  toolVersion: string;
  analyzedAt: string;
}

// ProjectMeta
export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
  provenance?: ArtifactProvenance;
}

// Root KnowledgeGraph
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge";
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

// Theme configuration (for dashboard customization)
export interface ThemeConfig {
  presetId: string;
  accentId: string;
}

// AnalysisMeta (for persistence)
export interface AnalysisMeta {
  lastAnalyzedAt: string;
  gitCommitHash: string;
  version: string;
  analyzedFiles: number;
  theme?: ThemeConfig;
}

// Project config (for auto-update opt-in and language preference)
export interface ProjectConfig {
  autoUpdate: boolean;
  outputLanguage?: string;
}

// Non-code structural sub-interfaces
export interface SectionInfo {
  name: string;
  level: number;
  lineRange: [number, number];
}

export interface DefinitionInfo {
  name: string;
  /** Parser-reported definition kind. Known values: "table", "view", "index", "message", "enum", "type", "input", "interface", "union", "scalar", "variable", "output", "resource", "data", "section", "target", "stage" */
  kind: string;
  lineRange: [number, number];
  fields: string[];
}

export interface ServiceInfo {
  name: string;
  image?: string;
  ports: number[];
  lineRange?: [number, number];
}

export interface EndpointInfo {
  method?: string;
  path: string;
  lineRange: [number, number];
}

export interface StepInfo {
  name: string;
  lineRange: [number, number];
}

export interface ResourceInfo {
  name: string;
  kind: string;
  lineRange: [number, number];
}

export interface ReferenceResolution {
  source: string;
  target: string;
  referenceType: string; // "file", "image", "schema", "service"
  line?: number;
}

// Plugin interfaces
export interface AnnotationInfo {
  name: string;
  arguments?: Record<string, string>;
}

export interface PropertyInfo {
  name: string;
  type?: string;
  annotations?: AnnotationInfo[];
}

export interface StructuralAnalysis {
  functions: Array<{
    name: string;
    lineRange: [number, number];
    params: Array<string | { name: string; type: string }>;
    returnType?: string;
    annotations?: AnnotationInfo[];
  }>;
  classes: Array<{
    name: string;
    lineRange: [number, number];
    methods: string[];
    properties: string[];
    annotations?: AnnotationInfo[];
    superclass?: string;
    interfaces?: string[];
    typedProperties?: PropertyInfo[];
  }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
  exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }>;
  // Non-code structural data (all optional for backward compat)
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
}

export interface ImportResolution {
  source: string;
  resolvedPath: string;
  specifiers: string[];
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
}

export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
}

// Business-landscape domain matching result
export interface BusinessDomain {
  id: string;
  name: string;
  summary: string;
  facets: string[];
  implType?: "cross-platform" | "platform-specific" | "mixed";
  matchType: "manual" | "auto-api" | "auto-name" | "auto-llm";
  matchConfidence: number;
  detailRef: string;
}

// Cross-facet API endpoint link
export interface CrossFacetLink {
  domain: string;
  serverEndpoints: string[];
  clientApiCalls: Array<{ platform: string; path: string; file: string }>;
  matchDetails: Array<{ serverEndpoint?: string; clientApiCall?: string; matchLayer: number; matchType: string }>;
}

// Business interaction step (DAG node)
export interface InteractionStep {
  id: string;
  facet: string;
  description: string;
  after?: string[];
  branches?: Array<{ condition: string; next: string[]; relatedRules?: string[] }>;
  parallel?: string[];
  terminal?: boolean;
  relatedRules?: string[];
}

// Business interaction flow
export interface BusinessInteraction {
  id: string;
  name: string;
  triggerRules?: string[];
  steps: InteractionStep[];
}

// Business rule
export interface BusinessRule {
  id: string;
  rule: string;
  enforcedBy: string[];
  observedBy?: string[];
  relatedFlows?: string[];
}

# Understand Anything: Universal File Type Support

**Date**: 2026-03-28
**Status**: Approved
**Approach**: Big Bang — all file types in one release

## Goals

1. Extend Understand Anything to analyze **any** file type, not just code
2. Support both holistic project enrichment (non-code files enrich code graphs) and standalone analysis (docs-only repos, SQL schema collections, IaC projects)
3. Maintain backward compatibility with existing code-only analysis

## Supported File Types (26 new)

### Documentation (3)

| Type | Extensions | Parser | Node Types |
|------|-----------|--------|------------|
| Markdown | `.md`, `.mdx` | LLM + regex heading extraction | `document` |
| reStructuredText | `.rst` | LLM | `document` |
| Plain text | `.txt` | LLM | `document` |

### Configuration (5)

| Type | Extensions | Parser | Node Types |
|------|-----------|--------|------------|
| YAML | `.yaml`, `.yml` | `yaml` npm package | `config` |
| JSON | `.json`, `.jsonc` | `JSON.parse` / `jsonc-parser` | `config`, `schema` |
| TOML | `.toml` | `@iarna/toml` or similar | `config` |
| .env | `.env`, `.env.*` | Regex line parser | `config` |
| XML | `.xml` | LLM (optionally `fast-xml-parser`) | `config` |

### Infrastructure & DevOps (7)

| Type | Extensions | Parser | Node Types |
|------|-----------|--------|------------|
| Dockerfile | `Dockerfile`, `Dockerfile.*`, `.dockerfile` | Custom instruction parser | `service`, `pipeline` |
| Docker Compose | `docker-compose.yml`, `compose.yml` | YAML parser + service extraction | `service` |
| Terraform | `.tf`, `.tfvars` | Regex block parser | `resource` |
| Kubernetes | K8s YAML (detected by `apiVersion` field) | YAML + kind detection | `service`, `resource` |
| GitHub Actions | `.github/workflows/*.yml` | YAML + job/step extraction | `pipeline` |
| Jenkinsfile | `Jenkinsfile` | LLM (Groovy DSL) | `pipeline` |
| Makefile | `Makefile`, `*.mk` | Regex target parser | `pipeline` |

### Data & Schema (6)

| Type | Extensions | Parser | Node Types |
|------|-----------|--------|------------|
| SQL | `.sql` | Simple DDL parser | `table`, `endpoint` |
| GraphQL | `.graphql`, `.gql` | Regex type/query parser | `schema`, `endpoint` |
| OpenAPI/Swagger | `openapi.yaml`, `swagger.json` | YAML/JSON + path extraction | `endpoint`, `schema` |
| Protocol Buffers | `.proto` | Regex message/service parser | `schema` |
| JSON Schema | `*.schema.json` | JSON + `$ref`/`$defs` extraction | `schema` |
| CSV/TSV | `.csv`, `.tsv` | Header row extraction | `table` |

### Shell & Scripts (3)

| Type | Extensions | Parser | Node Types |
|------|-----------|--------|------------|
| Shell | `.sh`, `.bash`, `.zsh` | Regex function parser | `file`, `function` |
| PowerShell | `.ps1`, `.psm1` | LLM | `file`, `function` |
| Batch | `.bat`, `.cmd` | LLM | `file` |

### Markup (2)

| Type | Extensions | Parser | Node Types |
|------|-----------|--------|------------|
| HTML | `.html`, `.htm` | LLM (tag structure) | `document` |
| CSS/SCSS/Less | `.css`, `.scss`, `.less` | LLM | `file` |

## Schema Extensions

### New Node Types (8)

Added to the existing `file | function | class | module | concept`:

| Node Type | Purpose | Example |
|-----------|---------|---------|
| `config` | Configuration files and key settings | `package.json`, `tsconfig.json`, env vars |
| `document` | Documentation, prose, guides | `README.md`, API docs |
| `service` | Deployable services/containers | Docker containers, K8s Deployments |
| `table` | Data tables, database objects | SQL tables, CSV datasets |
| `endpoint` | API routes, queries, mutations | REST paths, GraphQL queries |
| `pipeline` | CI/CD workflows, build steps | GitHub Actions jobs, Makefile targets |
| `schema` | Type definitions for data interchange | Protobuf messages, JSON Schema |
| `resource` | Infrastructure resources | Terraform resources, K8s ConfigMaps |

### New Edge Types (8)

Added to the existing 18 edge types:

| Edge Type | Category | Meaning | Example |
|-----------|----------|---------|---------|
| `deploys` | Infrastructure | Service deploys code | Dockerfile -> app source |
| `serves` | Infrastructure | Service exposes endpoint | K8s Service -> API endpoint |
| `migrates` | Data flow | Migration modifies table | SQL migration -> table |
| `documents` | Semantic | Doc describes code | README -> module |
| `provisions` | Infrastructure | IaC creates resource | Terraform -> AWS resource |
| `routes` | Behavioral | Routes traffic to service | nginx config -> service |
| `defines_schema` | Data flow | Defines data shape | Protobuf -> endpoint |
| `triggers` | Behavioral | Triggers pipeline/action | Git push -> GitHub Actions |

### Schema Validation Auto-Fix Aliases

New node type aliases:
- `container` -> `service`, `migration` -> `table`, `workflow` -> `pipeline`
- `route` -> `endpoint`, `doc` -> `document`, `setting` -> `config`, `infra` -> `resource`

New edge type aliases:
- `describes` -> `documents`, `creates` -> `provisions`, `exposes` -> `serves`

## Plugin Architecture Changes

### Generalized AnalyzerPlugin Interface

```typescript
interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];  // Now optional
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];  // NEW
}

interface ReferenceResolution {
  source: string;      // File making the reference
  target: string;      // Referenced file or identifier
  type: string;        // Reference type: "file", "image", "schema", "service"
  line?: number;
}
```

### Extended StructuralAnalysis

```typescript
interface StructuralAnalysis {
  // Existing (unchanged)
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  // New (all optional for backward compat)
  sections?: SectionInfo[];      // Documents: headings, chapters
  definitions?: DefinitionInfo[]; // Schemas: types, messages, tables
  services?: ServiceInfo[];      // Infra: containers, deployments
  endpoints?: EndpointInfo[];    // APIs: routes, queries
  steps?: StepInfo[];            // Pipelines: jobs, stages, targets
  resources?: ResourceInfo[];    // IaC: terraform resources, K8s objects
}
```

### Custom Parsers (12)

All lightweight — mostly regex-based, minimal dependencies:

| Parser | Implementation | Extracts |
|--------|---------------|----------|
| `MarkdownParser` | Regex | Headings, links, code blocks, front matter |
| `YAMLParser` | `yaml` npm | Key hierarchy, anchors, multi-doc |
| `JSONParser` | Built-in `JSON.parse` | Key structure, `$ref`/`$defs` |
| `TOMLParser` | `@iarna/toml` | Section structure |
| `EnvParser` | Regex | Variable names and references |
| `DockerfileParser` | Regex | FROM stages, EXPOSE ports, COPY sources |
| `SQLParser` | Regex | CREATE TABLE/VIEW/INDEX, columns, foreign keys |
| `GraphQLParser` | Regex | Types, queries, mutations, subscriptions |
| `ProtobufParser` | Regex | Messages, services, enums, RPCs |
| `TerraformParser` | Regex | Resources, modules, variables, outputs |
| `MakefileParser` | Regex | Targets, dependencies, variables |
| `ShellParser` | Regex | Functions, sourced files |

## Agent Pipeline Changes

### Project Scanner

1. Scan ALL file types (remove code-only filter)
2. Tag each file with category: `code`, `config`, `docs`, `infra`, `data`, `script`, `markup`
3. Smart batch grouping: keep related files together (e.g., Dockerfile + docker-compose.yml)

### File Analyzer

Type-aware prompt templates by category:

- **Code**: Current behavior (functions, classes, imports, call graph)
- **Config**: Extract key settings, what they configure, which code files they affect
- **Documentation**: Extract sections, key concepts, which code components are documented
- **Infrastructure**: Extract services, ports, volumes, dependencies, which code they deploy
- **Data/Schema**: Extract tables, columns, types, relationships, which code consumes this data
- **Pipelines**: Extract jobs, steps, triggers, which code/infra they build/deploy

### Cross-Type Reference Resolution

Post-analysis step connecting:
- Dockerfile `COPY` -> source code directories
- CI config `run: npm test` -> test files
- K8s manifest `image:` -> Dockerfile
- SQL foreign keys -> other tables
- OpenAPI `$ref` -> schema definitions
- Markdown links -> referenced files

### Architecture Analyzer

New pattern detection:
- Deployment topology: Dockerfile -> compose -> K8s chain
- Data flow: Schema -> migration -> API endpoint -> client code
- Documentation coverage: which modules have docs vs. not
- Configuration dependency: which config files affect which code paths

### Tour Builder

Include non-code tour stops:
- Project README overview
- Dockerfile containerization
- SQL migration database schema
- CI/CD pipeline explanation

## Dashboard Visualization

### New Node Visual Styles

| Node Type | Shape | Color | Icon |
|-----------|-------|-------|------|
| `config` | Rounded rect | Teal (#5eead4) | Gear |
| `document` | Rounded rect | Sky blue (#7dd3fc) | Document |
| `service` | Hexagon | Violet (#a78bfa) | Container/Box |
| `table` | Rectangle | Emerald (#6ee7b7) | Grid |
| `endpoint` | Pill/Stadium | Orange (#fdba74) | Arrow-right |
| `pipeline` | Rounded rect | Rose (#fda4af) | Play/Workflow |
| `schema` | Diamond | Amber (#fcd34d) | Blueprint |
| `resource` | Cloud shape | Indigo (#a5b4fc) | Cloud |

### Graph Layout

1. Layer grouping by category — non-code nodes cluster separately from code nodes
2. Legend update with 8 new node types
3. Filter controls — checkboxes to show/hide each file category

### Sidebar Enhancements

NodeInfo panel updates per node type:
- **Config**: key-value pairs, referencing code files
- **Document**: heading outline, linked code components
- **Service**: ports, volumes, dependencies, deployed code
- **Table**: columns, types, foreign key relationships
- **Endpoint**: HTTP method, path, request/response schema
- **Pipeline**: jobs, triggers, deployed targets
- **Schema**: fields, nested types, consumers
- **Resource**: provider, type, dependencies

ProjectOverview panel: add "File Types" breakdown (code vs. non-code distribution).

## New Dependencies

- `yaml` — YAML parsing (already common, ~50KB)
- `@iarna/toml` — TOML parsing (~30KB)
- `jsonc-parser` — JSON with comments (~20KB)

No tree-sitter WASM additions. All other parsers are regex-based with zero dependencies.

## Backward Compatibility

- All new `StructuralAnalysis` fields are optional
- `resolveImports` becomes optional on `AnalyzerPlugin`
- Existing `LanguageConfig` entries unchanged
- Schema validation auto-fixes new type aliases
- Existing knowledge graphs remain valid (new types are additive)

# Gin (Go) Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Gin is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Gin Project Structure

When analyzing a Gin project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `main.go` | Application entry point — initializes the Gin engine, registers routes, starts the server | `entry-point`, `config` |
| `cmd/*.go`, `cmd/**/*.go` | CLI entry points — multiple binaries in a multi-command project | `entry-point`, `config` |
| `handlers/*.go`, `handler/*.go` | HTTP handlers — process requests with `gin.Context` | `api-handler` |
| `controllers/*.go`, `controller/*.go` | Controllers — alternative naming for HTTP handlers | `api-handler` |
| `routes/*.go`, `router/*.go` | Route definitions — register endpoints and route groups | `routing`, `config` |
| `models/*.go`, `model/*.go` | Data models — struct definitions mapped to database tables | `data-model` |
| `middleware/*.go` | Middleware functions — authentication, logging, CORS, rate limiting | `middleware` |
| `services/*.go`, `service/*.go` | Business logic — domain operations decoupled from HTTP layer | `service` |
| `repository/*.go`, `repo/*.go` | Data access layer — database queries and persistence logic | `data-model`, `service` |
| `config/*.go`, `config.go` | Application configuration — environment loading, struct-based config | `config` |
| `dto/*.go` | Data transfer objects — request and response structs | `type-definition` |
| `utils/*.go`, `pkg/*.go` | Shared utility packages | `utility` |
| `*_test.go` | Unit and integration tests | `test` |

### Edge Patterns to Look For

**Route group registration** — When `r.Group("/api")` creates a route group and registers handlers, create `configures` edges from the route definition file to each handler. Route groups organize endpoints by prefix and shared middleware.

**Handler-to-service calls** — When a handler function calls a service method, create `depends_on` edges from the handler to the service. This represents the separation between HTTP handling and business logic.

**Service-to-repository calls** — When a service calls a repository method for data access, create `depends_on` edges from the service to the repository. This represents the data access abstraction.

**Middleware chaining** — When `r.Use(middleware)` or a route group applies middleware, create middleware edges from the router or group to the middleware function. Middleware executes in registration order.

### Architectural Layers for Gin

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `handlers/`, `controllers/`, HTTP handler functions |
| `layer:data` | Data Layer | `models/`, `repository/`, database access, migrations |
| `layer:service` | Service Layer | `services/`, business logic |
| `layer:middleware` | Middleware Layer | `middleware/`, authentication, logging, rate limiting |
| `layer:config` | Config Layer | `main.go`, `routes/`, `config/`, environment setup |
| `layer:utility` | Utility Layer | `utils/`, `pkg/`, shared helper packages |
| `layer:test` | Test Layer | `*_test.go`, test fixtures, test helpers |

### Notable Patterns to Capture in languageLesson

- **Handler functions with gin.Context**: Every Gin handler receives a `*gin.Context` parameter — it provides request parsing (`c.Bind`, `c.Param`, `c.Query`), response writing (`c.JSON`, `c.HTML`), and control flow (`c.Abort`, `c.Next`)
- **Middleware chain with c.Next()**: Middleware calls `c.Next()` to pass control to the next handler in the chain — code before `c.Next()` runs pre-handler, code after runs post-handler
- **Route grouping for modular APIs**: `r.Group("/v1")` creates modular sub-routers that can have their own middleware stack — enables versioning and access control at the group level
- **Dependency injection via constructors (no framework DI)**: Go has no DI framework — dependencies are passed as constructor parameters (e.g., `NewUserHandler(userService)`) and stored as struct fields
- **Interface-driven design for testability**: Services and repositories are defined as interfaces — handlers depend on the interface, enabling mock implementations in tests
- **Error handling with gin.Error**: Gin collects errors via `c.Error(err)` — middleware can inspect `c.Errors` after handler execution to implement centralized error logging and response formatting

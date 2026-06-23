# Express Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Express is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Express Project Structure

When analyzing an Express project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `app.js`, `app.ts` | Application entry point — creates Express app, mounts middleware and routes | `entry-point`, `config` |
| `server.js`, `server.ts`, `index.js`, `index.ts` | Server bootstrap — starts HTTP listener, may import app | `entry-point`, `config` |
| `routes/*.js`, `routes/*.ts` | Route definitions — map HTTP methods and paths to handlers | `api-handler`, `routing` |
| `controllers/*.js`, `controllers/*.ts` | Request handlers — process requests, orchestrate services, return responses | `api-handler`, `service` |
| `models/*.js`, `models/*.ts` | Data models — Mongoose schemas, Sequelize models, or plain data definitions | `data-model` |
| `middleware/*.js`, `middleware/*.ts` | Middleware functions — authentication, logging, validation, error handling | `middleware` |
| `services/*.js`, `services/*.ts` | Business logic — domain operations decoupled from HTTP layer | `service` |
| `db/*.js`, `db/*.ts`, `database/*.js` | Database connection and configuration | `data-model`, `config` |
| `config/*.js`, `config/*.ts` | Application configuration — environment variables, feature flags | `config` |
| `validators/*.js`, `validators/*.ts` | Request validation schemas (Joi, Zod, express-validator) | `validation`, `utility` |
| `utils/*.js`, `utils/*.ts` | Shared utility functions | `utility` |
| `tests/*.js`, `test/*.js`, `__tests__/*.js` | Unit and integration tests | `test` |

### Edge Patterns to Look For

**Route mounting** — When `app.use('/api/users', usersRouter)` mounts a router, create `depends_on` edges from the main app to the router module. These edges represent the HTTP routing tree.

**Middleware chain** — When `app.use(cors())`, `app.use(authMiddleware)`, or `router.use(validate)` registers middleware, create middleware edges from the app or router to the middleware function. Order matters — middleware executes in registration order.

**Controller-to-service calls** — When a controller imports and calls a service function, create `depends_on` edges from the controller to the service. This represents the separation between HTTP handling and business logic.

**Model relationships** — When models reference each other (Mongoose `ref`, Sequelize associations), create `depends_on` edges between model files with descriptions indicating the relationship type.

### Architectural Layers for Express

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `routes/`, `controllers/`, request validators |
| `layer:data` | Data Layer | `models/`, `db/`, migration files, seeders |
| `layer:service` | Service Layer | `services/`, business logic modules |
| `layer:middleware` | Middleware Layer | `middleware/`, error handlers, authentication, logging |
| `layer:config` | Config Layer | `app.js`, `config/`, environment setup, `server.js` |
| `layer:utility` | Utility Layer | `utils/`, `helpers/`, shared pure functions |
| `layer:test` | Test Layer | `tests/`, `__tests__/`, `*.test.js`, `*.spec.js` |

### Notable Patterns to Capture in languageLesson

- **Middleware chain (req, res, next)**: Express processes requests through a pipeline of middleware functions — each receives the request, response, and a `next()` callback to pass control forward
- **Error-handling middleware (4 params)**: Middleware with signature `(err, req, res, next)` catches errors — must be registered after all routes to act as a global error handler
- **Router modularity**: `express.Router()` creates modular, mountable route handlers that can be composed into the main app at different path prefixes
- **MVC pattern**: Express apps commonly separate concerns into Models (data), Views (response formatting), and Controllers (request handling)
- **Body parsing and validation**: Request body parsing (`express.json()`, `express.urlencoded()`) and validation (Joi, Zod, express-validator) are middleware concerns applied before route handlers

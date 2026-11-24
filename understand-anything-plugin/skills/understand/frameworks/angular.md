# Angular Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Angular is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Angular Project Structure

When analyzing an Angular project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `src/main.ts` | Application bootstrap — calls `bootstrapApplication()` or `platformBrowserDynamic().bootstrapModule()` | `entry-point`, `config` |
| `src/app/app.component.ts` | Root application component — top-level shell and router outlet | `entry-point`, `ui` |
| `src/app/app.config.ts` | Standalone app configuration — providers, router, interceptors, animations | `config` |
| `src/app/app.routes.ts`, `src/app/app-routing.module.ts` | Route definitions — path-to-component mapping, lazy routes, guards | `config`, `routing` |
| `src/app/app.module.ts` | Root NgModule (legacy) — declares bootstrap component, imports feature modules | `config` |
| `**/*.component.ts` | UI components — template, styles, and component class with selector | `ui` |
| `**/*.component.html` | Component templates — declarative view markup bound to the component class | `ui` |
| `**/*.component.scss`, `**/*.component.css` | Component-scoped styles | `ui` |
| `**/*.import.const.ts` | Standalone component import bundles — grouped `imports` arrays for reuse | `config`, `utility` |
| `**/*.service.ts` | Injectable services — business logic, HTTP clients, state, facades | `service` |
| `**/*.guard.ts` | Route guards — `CanActivate`, `CanDeactivate`, `CanMatch` authorization/navigation checks | `middleware`, `routing` |
| `**/*.interceptor.ts` | HTTP interceptors — request/response mutation, auth headers, error handling | `middleware`, `service` |
| `**/*.resolver.ts` | Route resolvers — prefetch data before route activation | `service`, `routing` |
| `**/*.pipe.ts` | Template pipes — synchronous value transformations in templates | `utility` |
| `**/*.directive.ts` | Attribute and structural directives — DOM behavior and template control flow | `utility` |
| `**/*.module.ts` | Feature NgModules (legacy) — group declarations, imports, providers, routing | `config` |
| `**/models/*.ts`, `**/interfaces/*.ts` | Domain models, DTOs, and shared TypeScript interfaces | `type-definition` |
| `environments/*.ts` | Environment-specific configuration (API URLs, feature flags) | `config` |
| `**/*.spec.ts` | Unit and integration tests (Jasmine/Karma or Jest) | `test` |

### Edge Patterns to Look For

**Component composition** — When a parent component template references a child component selector (e.g., `<app-user-card>`), create `contains` edges from the parent component to the child. Check both inline templates and external `.component.html` files. `imports` arrays in standalone components list direct composition dependencies.

**Dependency injection** — When a class constructor or `inject()` call requests a service/token, create `depends_on` edges from the consumer to the provider. Follow `providedIn: 'root'`, route-level `providers`, and `bootstrapApplication({ providers: [...] })` to trace where services are registered. Factory providers and `InjectionToken` bindings are config-to-service edges.

**Input/output bindings** — When a parent passes `[input]` or listens to `(output)` on a child selector, create `depends_on` edges from parent to child. `input()` / `output()` signal-based APIs and legacy `@Input()` / `@Output()` decorators both indicate parent-child data coupling.

**Router configuration** — When `app.routes.ts` or a routing module maps paths to components or `loadChildren`/`loadComponent` lazy imports, create `configures` edges from the router file to each routed component or lazy chunk entry. Guards and resolvers referenced in route definitions add middleware edges.

**NgModule wiring (legacy)** — When an `*.module.ts` file lists components in `declarations` or modules in `imports`, create `contains` and `depends_on` edges reflecting the module graph. `RouterModule.forChild(routes)` links feature modules to their route tables.

**HTTP and state flow** — When a component or resolver calls a service method that returns an `Observable` or `Promise`, create `depends_on` from the consumer to the service. NgRx/store actions, selectors, and effects form a state subgraph: components `dispatch` actions, effects `depend_on` services, selectors `depend_on` state slices.

**Standalone import bundles** — When a `*.import.const.ts` file exports a shared `imports` array consumed by multiple standalone components, create `depends_on` edges from each consumer component to the bundle and from the bundle to its listed dependencies.

### Architectural Layers for Angular

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `*.component.ts`, templates, feature/page components, layouts |
| `layer:service` | Service Layer | `*.service.ts`, facades, API clients, NgRx stores/effects, resolvers |
| `layer:middleware` | Middleware Layer | `*.guard.ts`, `*.interceptor.ts`, route guards, HTTP middleware |
| `layer:config` | Config Layer | `app.config.ts`, `app.module.ts`, `app.routes.ts`, `environments/`, `*.module.ts`, `*.import.const.ts` |
| `layer:utility` | Utility Layer | `*.pipe.ts`, `*.directive.ts`, pure helpers, shared validators |
| `layer:types` | Types Layer | `models/`, `interfaces/`, shared DTOs and type definitions |
| `layer:test` | Test Layer | `*.spec.ts`, test harnesses and mocks |

### Notable Patterns to Capture in languageLesson

- **Standalone components over NgModules**: Modern Angular (v14+) favors `standalone: true` components with explicit `imports` arrays; `bootstrapApplication()` replaces `NgModule`-based bootstrapping in new projects
- **Signals and computed state**: `signal()`, `computed()`, and `effect()` provide fine-grained reactivity — trace signal reads/writes when analyzing component state flow
- **Dependency injection hierarchy**: Services use `@Injectable({ providedIn: 'root' })` for app-wide singletons; feature-scoped providers live on routes or component `providers` arrays
- **RxJS for async streams**: HTTP, router events, and complex async flows use Observables — `subscribe`, `async` pipe, and operators (`map`, `switchMap`, `catchError`) indicate data-flow paths
- **OnPush change detection**: Components with `changeDetection: ChangeDetectionStrategy.OnPush` only re-render when inputs change or events fire — marks performance-sensitive UI
- **Lazy-loaded feature routes**: `loadComponent` and `loadChildren` split the app into lazy chunks — each lazy entry is a feature boundary worth capturing as a module node
- **Control flow syntax**: Built-in `@if`, `@for`, and `@switch` in templates replace structural directives (`*ngIf`, `*ngFor`) — both styles may coexist during migration
- **Import const bundles**: `componentName.import.const.ts` files centralize standalone `imports` for large components — a project-specific composition pattern that reduces duplication across related views

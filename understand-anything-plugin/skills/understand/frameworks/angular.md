# Angular

## Canonical File Roles

| File Pattern | Role |
|---|---|
| `src/app/**/*.component.ts` | Component — UI unit, paired with .html template |
| `src/app/**/*.module.ts` | Module — declares and imports feature scope |
| `src/app/**/*.service.ts` | Service — injectable singleton, business/data logic |
| `src/app/**/*.guard.ts` | Route guard — CanActivate / CanDeactivate |
| `src/app/**/*.interceptor.ts` | HTTP interceptor — request/response transforms |
| `src/app/**/*.pipe.ts` | Pipe — data transformation for templates |
| `src/app/**/*.directive.ts` | Directive — DOM behavior extension |
| `src/app/**/*.resolver.ts` | Resolver — pre-fetches data before route activates |
| `src/app/app-routing.module.ts` | Root route definitions |
| `src/app/**/routing.module.ts` | Feature route definitions |
| `src/environments/environment*.ts` | Environment config |
| `angular.json` | Angular CLI workspace config |

## Edge Patterns

- Component → ChildComponent: `contains`
- Component → Service: `depends_on`
- Component → Store/State: `depends_on`
- Service → Service: `calls`
- Service → HttpClient endpoint: `consumes_api`
- RouterModule route → Component: `routes`
- Guard → Route: `protects`
- Resolver → Route: `resolves`
- Module → Component/Service/Directive: `declares`

## Architectural Layers

Presentation (Components, Directives, Pipes) → Domain (Services, Guards, Resolvers) → Data (HttpClient, State stores) → Config (Modules, RouterModule)

## Notable Patterns

- Dependency injection via constructor parameters — `@Injectable()` services
- Reactive forms: `FormBuilder`, `FormGroup`, `FormControl`
- RxJS Observables for async — `HttpClient` returns `Observable<T>`
- Route guards protecting feature modules: `canActivate: [AuthGuard]`
- Lazy-loaded feature modules: `loadChildren: () => import(...)`
- NgRx or Akita for state management where present
- Standalone components (Angular 14+): no NgModule required

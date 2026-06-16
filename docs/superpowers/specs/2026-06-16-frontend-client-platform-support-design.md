# Frontend As First-Class Web Facet Design

> Date: 2026-06-16
> Status: APPROVED FOR SPEC REVIEW

## Purpose

This design replaces the previous broader "frontend and client platform" draft. The new scope treats `frontend` as a first-class **Web-only** facet, separate from `mobile`.

The system should model these facet categories independently:

- `server` / `backend`: backend services that execute authoritative business rules and persist data.
- `mobile`: Android, iOS, and Flutter applications.
- `frontend`: Web frontend applications such as React, Vue, Next.js, Nuxt, Svelte, Angular, and Vite-based apps.

Electron, mini-apps, uni-app, React Native, and desktop clients are out of scope for this design. They can be added later as separate facet types or explicit extensions.

## Current Problem

The codebase already has partial frontend support:

- `/understand` can analyze TypeScript, JavaScript, TSX, and JSX, and it has React/Vue/Next framework guidance.
- `/understand-domain` can classify frontend projects and has a frontend flow strategy.
- `/understand-wiki` accepts `--repo-type frontend`.
- `understand-business` can detect frontend facets as client facets in scenario detection.

The support is incomplete because frontend is not yet a full independent category:

- Web route/API/store extraction is not deterministic enough.
- `.vue` and Web framework conventions rely too much on LLM interpretation.
- `/understand-wiki --repo-type=frontend` does not produce a stable frontend-specific graph artifact.
- `understand-business` recognizes frontend in scenario detection but downstream association and feature assembly primarily consume mobile data.
- Existing `client-graph.json` semantics are mobile-centric and should not be reused for Web.

## Design Direction

Use a two-phase rollout.

### Phase 1: Extraction Precision + Frontend Graph

Phase 1 improves Web frontend extraction and introduces a stable `frontend-graph.json` artifact. It does not require full business panorama or dashboard integration.

Phase 1 goals:

- `/understand` produces a better `knowledge-graph.json` for Web projects.
- `/understand-domain` produces a better `domain-graph.json` for Web user journeys and feature domains.
- `/understand-wiki --repo-type=frontend` produces normal wiki output plus `frontend-graph.json`.
- `frontend-graph.json` becomes the stable frontend facet artifact for later business aggregation.

### Phase 2: Full Business And Dashboard Integration

Phase 2 consumes `frontend-graph.json` in business panorama and dashboard views.

Phase 2 goals:

- `system.json` treats frontend as an independent facet.
- `check_facets.py` requires `frontend-graph.json` for an available frontend facet.
- `understand-business` reads frontend features and associates them with server domains.
- `business-features.json` supports multiple client layers from frontend and mobile.
- Dashboard and wiki drill-down can navigate from business features to frontend routes/pages and backend domains.

## Command Responsibilities

The three main commands keep the same responsibility boundaries as other project types.

### `/understand`

Output:

```text
.understand-anything/knowledge-graph.json
```

Responsibilities:

- Analyze source and non-source files.
- Detect Web frontend frameworks and conventions.
- Emit file, function, class, endpoint, config, document, and related nodes.
- Emit route/API/store/component edges where supported.

`/understand` must not write `frontend-graph.json`.

### `/understand-domain`

Output:

```text
.understand-anything/domain-graph.json
```

Responsibilities:

- Detect frontend platform type.
- Split frontend code by user-facing feature domain rather than pure technical layer.
- Extract user journeys from route, page, state, API, render, and interaction edges.

`/understand-domain` must not write `frontend-graph.json`.

### `/understand-wiki --repo-type=frontend`

Outputs:

```text
.understand-anything/wiki/
.understand-anything/frontend-graph.json
```

Responsibilities:

- Generate normal wiki files from KG and DG.
- Generate `frontend-graph.json` as the frontend facet aggregation artifact.
- Validate that `frontend-graph.json` has meaningful feature content before marking frontend wiki complete.

## Frontend Graph Artifact

`frontend-graph.json` is a frontend-only artifact. It must not reuse `client-graph.json`, because `client-graph.json` is mobile-centric and represents cross-platform mobile feature parity.

Path:

```text
<frontend-root>/.understand-anything/frontend-graph.json
```

Schema shape:

```json
{
  "version": "1.0.0",
  "facetType": "frontend",
  "project": {
    "name": "admin-web",
    "frameworks": ["React", "Vite"],
    "languages": ["typescript"],
    "provenance": {
      "generationMode": "wiki",
      "degraded": false,
      "generatedAt": "2026-06-16T00:00:00.000Z",
      "gitCommitHash": "c03bfdb"
    }
  },
  "routes": [],
  "pages": [],
  "components": [],
  "stateStores": [],
  "apiCalls": [],
  "features": [],
  "contentHash": "sha256:0123456789abcdef"
}
```

Feature entry shape:

```json
{
  "id": "feature:order-management",
  "name": "Order Management",
  "sourceDomain": "domain:order-management",
  "routes": ["/orders", "/orders/:id"],
  "pages": ["src/pages/orders/List.tsx"],
  "components": ["src/features/orders/OrderTable.tsx"],
  "stateStores": ["src/stores/orderStore.ts"],
  "apiCalls": [
    {
      "method": "GET",
      "path": "/api/orders",
      "source": "src/api/orders.ts",
      "lineRange": [12, 18]
    }
  ],
  "uiRules": [],
  "interactionRules": [],
  "stateTransitions": [],
  "apiSequence": []
}
```

## Frontend Business Semantics

Frontend is not a pure page directory. A frontend domain represents a user-facing business capability.

A frontend domain may include:

- Routes and pages where users enter the capability.
- Feature components that implement the interaction.
- State stores and context providers that hold user-side state.
- API clients and hooks that call backend services.
- UI rules, interaction rules, state transitions, and API call sequences.

Frontend business logic is usually **user-side orchestration and experience logic**, not the final authority for business correctness.

Examples:

- Form required-field checks.
- Button enable/disable rules.
- Role-based menu and action visibility.
- Multi-step wizard ordering.
- Loading, empty, error, retry, and success states.
- Draft state and local cache behavior.
- API request ordering.

Backend services remain the authoritative source for:

- Final validation.
- Permission enforcement.
- Data consistency.
- Persistence.
- Business rule decisions such as refund eligibility or balance checks.

When frontend and backend appear to enforce the same rule, the frontend instance should be labeled as `clientPrecheck` or `uiRule`, not as the authoritative rule.

## Phase 1 Extraction Enhancements

### Route Extraction

Add or improve deterministic extraction for:

- React Router:
  - `<Route path="...">`
  - `createBrowserRouter([...])`
  - `createRoutesFromElements(...)`
- Vue Router:
  - `{ path: "...", component: ... }`
  - router modules under `router/`
- Next.js:
  - `app/**/page.tsx`
  - `app/**/layout.tsx`
  - `pages/**/*.tsx`
- Nuxt:
  - `pages/**/*.vue`
  - `definePageMeta(...)`
- Svelte and Angular:
  - Recognize common route files where practical, with degraded extraction if framework-specific parsing is incomplete.

### API Call Extraction

Add deterministic or lightweight source scanning for:

- `fetch("/api/...")`
- `fetch(url, { method: "POST" })`
- `axios.get/post/put/delete(...)`
- common wrappers such as `request({ url, method })`
- GraphQL client calls at a lightweight level, without requiring full schema analysis in Phase 1

The extractor should emit endpoint nodes and `consumes_api` edges when it can identify method and path. If method is unknown, default to `GET` only when the call form strongly implies a read; otherwise mark method as `UNKNOWN` in frontend-graph and avoid inventing a server contract.

### State And Store Extraction

Recognize common state locations and patterns:

- Redux store and slices.
- Zustand stores.
- Pinia and Vuex stores.
- React Context providers.
- Feature-local hooks or composables that maintain business state.

State artifacts should be linked to pages/features through `depends_on` edges where possible.

### Page And Component Recognition

Recognize:

- `pages/`, `views/`, `routes/`
- `app/**/page.*`
- `features/<feature>/...`
- `components/`
- framework-specific page and layout conventions

Shared `components`, `utils`, `hooks`, and `composables` should not become standalone business domains unless they represent an actual product capability.

## Phase 1 Domain Enhancements

Frontend domain discovery should group by feature/page group:

- `auth`
- `checkout`
- `order-management`
- `dashboard`
- `content-management`

Frontend flow extraction should support these step sources:

- `routes`
- `depends_on`
- `consumes_api`
- `calls`
- `contains`

Flow entry points should usually be route, page, or user interaction, not HTTP endpoint. Valid frontend entry types include:

- `navigation`
- `screen`
- `interaction`
- `api-driven`

Example flow:

```text
Login route -> render LoginForm -> validate credentials -> call POST /api/login -> store token -> navigate to dashboard
```

## Phase 1 Wiki And Frontend Graph Generation

`/understand-wiki --repo-type=frontend` should:

1. Ensure KG exists.
2. Ensure DG exists.
3. Generate wiki pages normally.
4. Build `frontend-graph.json` from:
   - KG route/API/store/page/component nodes and edges.
   - DG domains, flows, and steps.
   - Targeted lightweight source scanning where KG lacks route/API details.
5. Validate `frontend-graph.json`.
6. Mark frontend wiki complete only if wiki and frontend graph pass minimum completeness checks.

Minimum frontend graph completeness:

- `facetType == "frontend"`
- non-empty `features[]`
- each feature has at least one of `routes`, `pages`, `apiCalls`, `stateStores`, or `components`
- project provenance exists
- `contentHash` exists

If routes or API calls are partially missing, the graph may be saved as degraded. If all feature evidence is missing, the wiki run should fail rather than silently claiming complete frontend support.

## Phase 2 Business Integration

Phase 2 extends the business panorama after the frontend artifact is stable.

### `system.json`

Frontend facet example:

```json
{
  "type": "frontend",
  "name": "Web Frontend",
  "path": "frontend",
  "subPaths": ["admin-web", "h5-web"],
  "services": [
    {
      "name": "admin-web",
      "path": "frontend/admin-web",
      "platform": "web",
      "framework": "react",
      "confidence": "high"
    }
  ]
}
```

Mobile remains limited to Android, iOS, and Flutter. React Native, Electron, and mini-apps are not folded into this design.

### Facet Availability

`check_facets.py` should treat frontend as available only when both files exist:

```text
<frontend-facet>/.understand-anything/wiki/meta.json
<frontend-facet>/.understand-anything/frontend-graph.json
```

If wiki exists but frontend graph is missing, status is `degraded`.

### Business Feature Assembly

`understand-business` should:

- Load mobile features from mobile-specific artifacts.
- Load frontend features from `frontend-graph.json`.
- Associate frontend features to server domains through API paths and LLM-assisted association.
- Preserve frontend-only features instead of dropping them.
- Avoid forcing uncertain frontend/mobile merges.

`business-features.json` should evolve from one `clientLayer` to `clientLayers[]`:

```json
{
  "id": "feature:order-management",
  "name": "Order Management",
  "clientLayers": [
    {
      "facetType": "frontend",
      "service": "admin-web",
      "routes": ["/orders"],
      "pages": ["src/pages/orders/List.tsx"],
      "apiCalls": ["GET /api/orders"]
    },
    {
      "facetType": "mobile",
      "service": "ios-app",
      "screens": ["OrderListScreen"]
    }
  ],
  "serverLayer": {
    "primaryDomain": {
      "name": "Order Management",
      "service": "order-service"
    },
    "supportingDomains": []
  }
}
```

Backward compatibility should be preserved by emitting `clientLayer` as a derived field during a transition period. `clientLayer` should point to the first frontend or mobile entry in `clientLayers[]`, while new consumers must read `clientLayers[]`. A later cleanup can remove `clientLayer` after dashboard, query, wiki enrichment, and interaction generation all read the new array form.

### Dashboard And Wiki Drill-Down

Dashboard and parent wiki should:

- Show frontend as its own facet.
- Let users drill from a business feature to frontend route/page/wiki domain.
- Let users drill from the same feature to server domain wiki.
- Render frontend routes/pages differently from mobile screens.

## Error Handling

### Phase 1

- Missing route/API/store extraction does not block `knowledge-graph.json`, but should emit warnings.
- If a frontend project is detected but domains are only shared technical layers such as `components`, `utils`, or `hooks`, mark domain extraction as degraded.
- If wiki generation succeeds but `frontend-graph.json` has no meaningful features, the frontend wiki run should fail.
- If only some route or API evidence is missing, save degraded frontend graph with provenance warnings.

### Phase 2

- If a frontend facet lacks `frontend-graph.json`, mark it as degraded and continue with server/mobile.
- If a frontend feature cannot be associated with a server domain, keep it as a client-only feature.
- If frontend and mobile features look similar but evidence is weak, do not merge them automatically. Record a candidate relation for later review.

## Testing Strategy

### Phase 1 Tests

Fixtures should cover:

- React Router + axios/fetch + Zustand or Redux.
- Vue Router + Pinia + request wrapper.
- Next app router + fetch.
- Nuxt pages + composables + API wrapper.

Tests should verify:

- Route extraction.
- API call extraction.
- Store recognition.
- Domain grouping by feature rather than shared technical directories.
- `frontend-graph.json` schema validation.
- Degraded status when partial frontend evidence is missing.

### Phase 2 Tests

Tests should verify:

- `scenario_detector.py` treats `server + frontend` as `client_server`.
- `check_facets.py` uses `frontend-graph.json` for frontend availability.
- `association_discovery.py` consumes frontend features.
- `assemble_business_features.py` supports `clientLayers[]`.
- frontend-only features are preserved.
- `server + mobile + frontend` does not overwrite or collapse client layers incorrectly.
- existing mobile `client-graph.json` behavior remains unchanged.

## Non-Goals

This design does not include:

- Electron support.
- React Native support.
- uni-app or mini-app support.
- Full GraphQL schema reasoning.
- Full dashboard redesign in Phase 1.
- Treating frontend prechecks as authoritative backend business rules.

## Success Criteria

Phase 1 is successful when:

- Web frontend projects produce useful KG, DG, wiki, and `frontend-graph.json`.
- `frontend-graph.json` captures user-facing features with routes/pages/components/state/API evidence.
- frontend domain extraction models user journeys, not just page folders.
- The artifact is stable enough for Phase 2 business aggregation.

Phase 2 is successful when:

- frontend appears as a first-class facet in `system.json`, business panorama, and dashboard.
- `business-features.json` can represent frontend and mobile as distinct client layers for the same business feature.
- frontend business semantics are represented as user-side orchestration and prechecks, while backend remains the authoritative business execution layer.

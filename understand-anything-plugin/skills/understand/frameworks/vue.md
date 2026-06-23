# Vue Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Vue is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Vue Project Structure

When analyzing a Vue project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `src/App.vue` | Root application component — mounts the top-level layout and router view | `entry-point`, `ui` |
| `src/main.ts`, `src/main.js` | Application bootstrap — creates Vue app instance, registers plugins, mounts to DOM | `entry-point`, `config` |
| `components/*.vue`, `components/**/*.vue` | Reusable UI components | `ui` |
| `views/*.vue`, `pages/*.vue` | Page-level components mapped to routes | `ui`, `routing` |
| `composables/*.ts`, `composables/*.js` | Composable functions — reusable stateful logic using Composition API | `service`, `utility` |
| `store/*.ts`, `stores/*.ts` | State management modules (Pinia stores or Vuex modules) | `service`, `state` |
| `router/*.ts`, `router/index.ts` | Vue Router configuration — route definitions, navigation guards | `config`, `routing` |
| `plugins/*.ts`, `plugins/*.js` | Vue plugin registrations — extend app functionality (i18n, auth, etc.) | `config` |
| `utils/*.ts`, `helpers/*.ts` | Pure utility functions | `utility` |
| `types/*.ts`, `types/*.d.ts` | TypeScript type definitions and interfaces | `type-definition` |
| `api/*.ts`, `services/*.ts` | API client functions and data-fetching logic | `service` |
| `directives/*.ts` | Custom Vue directives | `utility` |
| `tests/*.spec.ts`, `__tests__/*.spec.ts` | Unit and integration tests | `test` |

### Edge Patterns to Look For

**Component parent-child** — When a parent component uses a child component in its `<template>`, create `contains` edges from the parent to the child. Template refs and slot usage further indicate composition relationships.

**Composable usage** — When a component or composable imports and calls a `useX` function, create `depends_on` edges from the consumer to the composable module. Composables are the primary mechanism for shared stateful logic.

**Store actions/getters** — When components or composables import and use a Pinia store (`useXStore()`), create `depends_on` edges from the consumer to the store. Store-to-store dependencies should also be captured.

**Router view mapping** — When `router/index.ts` maps paths to view components, create `configures` edges from the router to each view component. Navigation guards add middleware-like edges.

**Plugin registration** — When `main.ts` calls `app.use(plugin)`, create `configures` edges from the bootstrap file to each plugin.

### Architectural Layers for Vue

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `components/`, `views/`, `pages/`, layout components |
| `layer:service` | Service Layer | `composables/`, `store/`, `stores/`, `api/`, `services/` |
| `layer:config` | Config Layer | `router/`, `plugins/`, `main.ts`, `App.vue`, configuration files |
| `layer:utility` | Utility Layer | `utils/`, `helpers/`, `directives/`, pure functions |
| `layer:test` | Test Layer | `tests/`, `__tests__/`, `*.spec.ts` |

### Notable Patterns to Capture in languageLesson

- **Composition API over Options API**: Modern Vue favors `setup()` and `<script setup>` with composables, replacing the Options API's data/methods/computed separation
- **Pinia for state management**: Pinia stores provide type-safe, modular state with actions and getters — each store is independently defined and can depend on other stores
- **Vue Router with navigation guards**: `beforeEach`, `beforeEnter`, and `afterEach` guards act as middleware for route transitions — used for authentication and data prefetching
- **Single-file components (.vue)**: Each `.vue` file encapsulates template, script, and style in a single file — the `<script setup>` syntax is the recommended concise form
- **Reactive refs and computed properties**: `ref()` and `reactive()` create reactive state; `computed()` derives values that auto-update — understanding reactivity is key to tracing data flow
- **Provide/inject for deep dependency passing**: `provide()` and `inject()` pass values down the component tree without prop drilling — creates implicit dependencies that should be captured as edges

# React Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when React is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## React Project Structure

When analyzing a React project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `src/App.tsx` | Root application component — mounts providers, router, and top-level layout | `entry-point`, `ui` |
| `components/*.tsx`, `components/**/*.tsx` | Reusable UI components | `ui` |
| `hooks/*.ts`, `hooks/*.tsx` | Custom React hooks — encapsulate reusable stateful logic | `service`, `utility` |
| `contexts/*.tsx`, `context/*.tsx` | React Context providers and consumers — shared state across component tree | `service`, `state` |
| `pages/*.tsx`, `views/*.tsx` | Page-level components mapped to routes | `ui`, `routing` |
| `utils/*.ts`, `helpers/*.ts` | Pure utility functions — formatting, validation, transformations | `utility` |
| `types/*.ts`, `types/*.d.ts` | TypeScript type definitions and interfaces | `type-definition` |
| `services/*.ts`, `api/*.ts` | API client functions and data-fetching logic | `service` |
| `store/*.ts`, `slices/*.ts` | State management (Redux, Zustand, etc.) | `service`, `state` |
| `constants/*.ts` | Application-wide constants and enums | `config` |
| `__tests__/*.tsx`, `*.test.tsx`, `*.spec.tsx` | Unit and integration tests | `test` |

### Edge Patterns to Look For

**Component composition** — When a parent component renders a child component in its JSX return, create `contains` edges from the parent to the child. These edges represent the component tree hierarchy.

**Hook usage** — When a component or hook imports and calls a custom hook (`useX`), create `depends_on` edges from the consumer to the hook module. Hooks are the primary mechanism for shared logic in React.

**Context provider/consumer** — When a Context provider wraps components, create `publishes` edges from the provider to the context definition. When components call `useContext` or use a custom context hook, create `subscribes` edges from the consumer to the context.

**Props drilling chains** — When props are passed through multiple component layers without being used, create `depends_on` edges along the chain to surface the coupling depth.

### Architectural Layers for React

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `components/`, `pages/`, `views/`, layout components |
| `layer:service` | Service Layer | `hooks/`, `contexts/`, `services/`, `api/`, `store/` |
| `layer:types` | Types Layer | `types/`, shared TypeScript interfaces and type definitions |
| `layer:utility` | Utility Layer | `utils/`, `helpers/`, pure functions |
| `layer:config` | Config Layer | `App.tsx`, router configuration, provider setup, constants |
| `layer:test` | Test Layer | `__tests__/`, `*.test.tsx`, `*.spec.tsx` |

### Notable Patterns to Capture in languageLesson

- **Component composition over inheritance**: React favors composing components via props and children rather than class inheritance hierarchies
- **Custom hooks for reusable logic**: Hooks prefixed with `use` extract stateful logic into shareable modules without changing the component tree
- **React.memo for performance**: Components wrapped in `React.memo` skip re-renders when props are unchanged — indicates performance-sensitive paths
- **Controlled vs. uncontrolled components**: Controlled components derive state from props; uncontrolled components manage internal state via refs
- **Render props pattern**: Components that accept a function as children or a render prop to delegate rendering decisions to the consumer

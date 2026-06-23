# Next.js Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Next.js is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Next.js Project Structure

When analyzing a Next.js project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `app/layout.tsx` | Root layout — wraps all pages, defines HTML shell and global providers | `entry-point`, `config`, `ui` |
| `app/page.tsx` | Root page component — renders at `/` | `ui`, `routing` |
| `app/**/page.tsx` | Route page components — file path determines URL | `ui`, `routing` |
| `app/**/layout.tsx` | Nested layouts — wrap child routes with shared UI | `ui`, `config` |
| `app/**/loading.tsx` | Loading UI — shown as Suspense fallback during route transitions | `ui` |
| `app/**/error.tsx` | Error boundary — catches errors in the route segment | `ui` |
| `app/**/not-found.tsx` | 404 UI — shown when `notFound()` is called | `ui` |
| `app/api/**/route.ts` | API route handlers — serverless endpoint functions (GET, POST, etc.) | `api-handler` |
| `middleware.ts` | Edge middleware — intercepts requests before they reach routes | `middleware` |
| `lib/*.ts`, `lib/**/*.ts` | Shared server-side utilities, data access, and business logic | `service` |
| `components/*.tsx`, `components/**/*.tsx` | Reusable UI components | `ui` |
| `next.config.js`, `next.config.mjs`, `next.config.ts` | Next.js configuration — redirects, rewrites, env, webpack overrides | `config` |
| `actions/*.ts`, `app/**/actions.ts` | Server Actions — server-side mutation functions callable from client | `service`, `api-handler` |

### Edge Patterns to Look For

**Layout nesting** — When `app/foo/layout.tsx` wraps `app/foo/page.tsx` and `app/foo/bar/page.tsx`, create `contains` edges from the layout to the pages it wraps. Layouts compose via the file-system hierarchy.

**API route handlers** — When a `route.ts` file exports named functions (GET, POST, PUT, DELETE), create edges from consuming components or server actions to the route handler based on fetch calls.

**Server/Client component boundary** — Files with `"use client"` directive at the top are Client Components. All other components in the `app/` directory are Server Components by default. Create `depends_on` edges that cross this boundary and note the boundary in the edge description.

**Parallel routes** — When `app/@slot/page.tsx` patterns appear, create `contains` edges from the parent layout to each parallel slot. These render simultaneously in the same layout.

**Route groups** — Directories wrapped in parentheses `(group)` organize routes without affecting the URL path. Note these in node descriptions.

### Architectural Layers for Next.js

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:ui` | UI Layer | `app/**/page.tsx`, `app/**/layout.tsx`, `components/`, loading/error boundaries |
| `layer:api` | API Layer | `app/api/**/route.ts`, API route handlers |
| `layer:service` | Service Layer | `lib/`, server actions, data-fetching utilities |
| `layer:middleware` | Middleware Layer | `middleware.ts`, edge functions |
| `layer:config` | Config Layer | `next.config.*`, root layout, `tailwind.config.*`, environment setup |
| `layer:test` | Test Layer | `__tests__/`, `*.test.tsx`, `*.spec.tsx`, `e2e/` |

### Notable Patterns to Capture in languageLesson

- **Server Components by default**: Components in the `app/` directory are Server Components — no JavaScript is sent to the client unless `"use client"` is declared
- **Server Actions for mutations**: Functions marked with `"use server"` can be called directly from client components, replacing traditional API routes for form submissions and mutations
- **App Router file conventions**: Special files (`page`, `layout`, `loading`, `error`, `not-found`, `route`) define behavior by naming convention within the file-system router
- **ISR and static generation**: `generateStaticParams` pre-renders pages at build time; revalidation strategies control cache freshness
- **Parallel and intercepting routes**: `@slot` directories enable parallel rendering; `(.)` prefix directories enable route interception for modal patterns

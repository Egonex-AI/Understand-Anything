# GraphQL Language Prompt Snippet

## Key Concepts

- **Type System**: Strongly typed schema defining the API contract with scalar, object, enum, and union types
- **Queries**: Read operations fetching data with field-level selection (no over-fetching)
- **Mutations**: Write operations for creating, updating, and deleting data
- **Subscriptions**: Real-time data push over WebSocket connections
- **Resolvers**: Functions mapping schema fields to data sources (database, API, cache)
- **Fragments**: Reusable field selections reducing query duplication across operations
- **Directives**: `@deprecated`, `@include`, `@skip` for conditional field inclusion and schema metadata
- **Input Types**: `input` keyword for complex mutation arguments
- **Interfaces and Unions**: Polymorphic types for shared fields across multiple object types
- **Schema Stitching / Federation**: Composing multiple GraphQL services into a unified graph

## Notable File Patterns

- `schema.graphql` / `*.graphql` — Schema definition files
- `*.gql` — Alternative extension for GraphQL files
- `schema/*.graphql` — Split schema files by domain (users.graphql, orders.graphql)
- `*.resolvers.ts` / `*.resolvers.js` — Resolver implementations (TypeScript/JavaScript convention)
- `codegen.yml` — GraphQL Code Generator configuration

## Edge Patterns

- GraphQL schema files `defines_schema` for the resolver code that implements query/mutation handlers
- Type definitions create `related` edges between types connected by field references
- Schema files `defines_schema` for client-side query/mutation files that consume the API
- Codegen config `configures` the schema-to-code generation pipeline

## Summary Style

> "GraphQL schema defining N types, M queries, and K mutations for the user management API."
> "API schema with type definitions for products, orders, and payment processing with pagination."
> "Subscription schema enabling real-time notifications for order status updates."

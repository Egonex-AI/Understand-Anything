import type { LanguageConfig } from "../types.js";

export const graphqlConfig = {
  id: "graphql",
  displayName: "GraphQL",
  extensions: [".graphql", ".gql"],
  concepts: ["types", "queries", "mutations", "subscriptions", "resolvers", "directives", "fragments", "schema"],
  filePatterns: {
    entryPoints: ["schema.graphql"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;

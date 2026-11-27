import { describe, it, expect } from "vitest";
import { GraphQLParser } from "./graphql-parser.js";

describe("GraphQLParser braceless definitions", () => {
  const parser = new GraphQLParser();
  const content = [
    "scalar DateTime",
    "",
    "union SearchResult = User | Post",
    "",
    "type User {",
    "  id: ID!",
    "}",
  ].join("\n");

  it("does not borrow the line range of a later type for a scalar", () => {
    const result = parser.analyzeFile("schema.graphql", content);
    const scalar = result.definitions!.find((d) => d.name === "DateTime");
    expect(scalar).toMatchObject({ kind: "scalar", lineRange: [1, 1] });
  });

  it("does not borrow fields of a later type for a union", () => {
    const result = parser.analyzeFile("schema.graphql", content);
    const union = result.definitions!.find((d) => d.name === "SearchResult");
    expect(union).toMatchObject({ kind: "union", lineRange: [3, 3], fields: [] });
  });
});

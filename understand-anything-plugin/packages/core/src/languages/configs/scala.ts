import type { LanguageConfig } from "../types.js";

export const scalaConfig = {
  id: "scala",
  displayName: "Scala",
  extensions: [".scala", ".sc"],
  treeSitter: {
    wasmPackage: "tree-sitter-scala",
    wasmFile: "tree-sitter-scala.wasm",
  },
  concepts: [
    "case classes",
    "pattern matching",
    "traits",
    "implicits / given instances",
    "type classes",
    "higher-kinded types",
    "for-comprehensions",
    "effect systems (Cats Effect, ZIO)",
    "companion objects",
    "sealed hierarchies (ADTs)",
  ],
  filePatterns: {
    entryPoints: ["**/Main.scala", "**/App.scala", "**/*Main.scala", "**/*App.scala"],
    barrels: ["**/package.scala"],
    tests: ["*Spec.scala", "*Suite.scala", "*Test.scala", "*Tests.scala"],
    config: ["build.sbt", "build.sc", "build.mill", "project/build.properties"],
  },
} satisfies LanguageConfig;

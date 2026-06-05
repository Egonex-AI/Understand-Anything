import type { LanguageConfig } from "../types.js";

export const dartConfig = {
  id: "dart",
  displayName: "Dart",
  extensions: [".dart"],
  concepts: [
    "null safety",
    "mixins",
    "extensions",
    "async/await",
    "isolates",
    "streams",
    "generics",
    "factory constructors",
    "named constructors",
    "cascades",
    "records",
    "patterns",
  ],
  filePatterns: {
    entryPoints: ["lib/main.dart", "bin/main.dart"],
    barrels: [],
    tests: ["*_test.dart", "test/**/*.dart"],
    config: ["pubspec.yaml", "analysis_options.yaml"],
  },
} satisfies LanguageConfig;

import type { LanguageConfig } from "../types.js";

export const terraformConfig = {
  id: "terraform",
  displayName: "Terraform",
  extensions: [".tf", ".tfvars"],
  concepts: ["resources", "data sources", "variables", "outputs", "modules", "providers", "state", "workspaces"],
  filePatterns: {
    entryPoints: ["main.tf"],
    barrels: [],
    tests: [],
    config: ["terraform.tfvars", "variables.tf"],
  },
} satisfies LanguageConfig;

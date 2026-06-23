import type { LanguageConfig } from "../types.js";

// TODO: Kubernetes manifests are YAML files with no unique extension or filename.
// Detection requires content-based or path-pattern heuristics (e.g., checking for
// `apiVersion`/`kind` fields in YAML, or matching paths like `k8s/`, `kubernetes/`,
// `deploy/`). Currently these files will match `yamlConfig` by extension (.yaml/.yml).
// A future content-based detection pass could re-classify them as Kubernetes.
export const kubernetesConfig = {
  id: "kubernetes",
  displayName: "Kubernetes",
  extensions: [],
  concepts: ["deployments", "services", "pods", "configmaps", "secrets", "ingress", "volumes", "namespaces"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: ["k8s/*.yaml", "kubernetes/*.yaml"],
  },
} satisfies LanguageConfig;

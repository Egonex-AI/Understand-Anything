import type { LanguageConfig } from "../types.js";

export const xmlConfig = {
  id: "xml",
  displayName: "XML",
  extensions: [".xml", ".xsl", ".xsd", ".svg", ".plist"],
  concepts: ["elements", "attributes", "namespaces", "DTD", "XPath", "XSLT", "schemas"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: ["pom.xml", "web.xml", "AndroidManifest.xml"],
  },
} satisfies LanguageConfig;

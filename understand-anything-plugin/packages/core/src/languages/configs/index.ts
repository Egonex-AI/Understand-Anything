import type { LanguageConfig } from "../types.js";
import { typescriptConfig } from "./typescript.js";
import { javascriptConfig } from "./javascript.js";
import { pythonConfig } from "./python.js";
import { goConfig } from "./go.js";
import { rustConfig } from "./rust.js";
import { javaConfig } from "./java.js";
import { rubyConfig } from "./ruby.js";
import { phpConfig } from "./php.js";
import { swiftConfig } from "./swift.js";
import { kotlinConfig } from "./kotlin.js";
import { cConfig } from "./c.js";
import { cppConfig } from "./cpp.js";
import { dartConfig } from "./dart.js";
import { csharpConfig } from "./csharp.js";
import { luaConfig } from "./lua.js";
import { pascalConfig } from "./pascal.js";
// Non-code language configs
import { markdownConfig } from "./markdown.js";
import { yamlConfig } from "./yaml.js";
import { jsonConfigConfig } from "./json-config.js";
import { tomlConfig } from "./toml.js";
import { envConfig } from "./env.js";
import { xmlConfig } from "./xml.js";
import { dockerfileConfig } from "./dockerfile.js";
import { sqlConfig } from "./sql.js";
import { graphqlConfig } from "./graphql.js";
import { protobufConfig } from "./protobuf.js";
import { terraformConfig } from "./terraform.js";
import { githubActionsConfig } from "./github-actions.js";
import { makefileConfig } from "./makefile.js";
import { shellConfig } from "./shell.js";
import { htmlConfig } from "./html.js";
import { cssConfig } from "./css.js";
import { openapiConfig } from "./openapi.js";
import { kubernetesConfig } from "./kubernetes.js";
import { dockerComposeConfig } from "./docker-compose.js";
import { jsonSchemaConfig } from "./json-schema.js";
import { csvConfig } from "./csv.js";
import { restructuredtextConfig } from "./restructuredtext.js";
import { powershellConfig } from "./powershell.js";
import { batchConfig } from "./batch.js";
import { jenkinsfileConfig } from "./jenkinsfile.js";
import { plaintextConfig } from "./plaintext.js";

export const builtinLanguageConfigs: LanguageConfig[] = [
  // Code languages
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  goConfig,
  rustConfig,
  javaConfig,
  rubyConfig,
  phpConfig,
  swiftConfig,
  kotlinConfig,
  luaConfig,
  pascalConfig,
  cConfig,
  cppConfig,
  dartConfig,
  csharpConfig,
  // Non-code languages
  markdownConfig,
  yamlConfig,
  jsonConfigConfig,
  tomlConfig,
  envConfig,
  xmlConfig,
  dockerfileConfig,
  sqlConfig,
  graphqlConfig,
  protobufConfig,
  terraformConfig,
  githubActionsConfig,
  makefileConfig,
  shellConfig,
  htmlConfig,
  cssConfig,
  openapiConfig,
  kubernetesConfig,
  dockerComposeConfig,
  jsonSchemaConfig,
  csvConfig,
  restructuredtextConfig,
  powershellConfig,
  batchConfig,
  jenkinsfileConfig,
  plaintextConfig,
];

export {
  // Code languages
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  goConfig,
  rustConfig,
  javaConfig,
  rubyConfig,
  phpConfig,
  swiftConfig,
  kotlinConfig,
  luaConfig,
  pascalConfig,
  cConfig,
  cppConfig,
  dartConfig,
  csharpConfig,
  // Non-code languages
  markdownConfig,
  yamlConfig,
  jsonConfigConfig,
  tomlConfig,
  envConfig,
  xmlConfig,
  dockerfileConfig,
  sqlConfig,
  graphqlConfig,
  protobufConfig,
  terraformConfig,
  githubActionsConfig,
  makefileConfig,
  shellConfig,
  htmlConfig,
  cssConfig,
  openapiConfig,
  kubernetesConfig,
  dockerComposeConfig,
  jsonSchemaConfig,
  csvConfig,
  restructuredtextConfig,
  powershellConfig,
  batchConfig,
  jenkinsfileConfig,
  plaintextConfig,
};

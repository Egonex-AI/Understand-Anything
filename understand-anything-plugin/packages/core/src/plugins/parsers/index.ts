export { MarkdownParser } from "./markdown-parser.js";
export { YAMLConfigParser } from "./yaml-parser.js";
export { JSONConfigParser } from "./json-parser.js";
export { TOMLParser } from "./toml-parser.js";
export { EnvParser } from "./env-parser.js";
export { DockerfileParser } from "./dockerfile-parser.js";
export { SQLParser } from "./sql-parser.js";
export { GraphQLParser } from "./graphql-parser.js";
export { ProtobufParser } from "./protobuf-parser.js";
export { TerraformParser } from "./terraform-parser.js";
export { MakefileParser } from "./makefile-parser.js";
export { ShellParser } from "./shell-parser.js";

import type { PluginRegistry } from "../registry.js";
import { MarkdownParser } from "./markdown-parser.js";
import { YAMLConfigParser } from "./yaml-parser.js";
import { JSONConfigParser } from "./json-parser.js";
import { TOMLParser } from "./toml-parser.js";
import { EnvParser } from "./env-parser.js";
import { DockerfileParser } from "./dockerfile-parser.js";
import { SQLParser } from "./sql-parser.js";
import { GraphQLParser } from "./graphql-parser.js";
import { ProtobufParser } from "./protobuf-parser.js";
import { TerraformParser } from "./terraform-parser.js";
import { MakefileParser } from "./makefile-parser.js";
import { ShellParser } from "./shell-parser.js";

/**
 * Register all built-in non-code parsers with a PluginRegistry.
 */
export function registerAllParsers(registry: PluginRegistry): void {
  registry.register(new MarkdownParser());
  registry.register(new YAMLConfigParser());
  registry.register(new JSONConfigParser());
  registry.register(new TOMLParser());
  registry.register(new EnvParser());
  registry.register(new DockerfileParser());
  registry.register(new SQLParser());
  registry.register(new GraphQLParser());
  registry.register(new ProtobufParser());
  registry.register(new TerraformParser());
  registry.register(new MakefileParser());
  registry.register(new ShellParser());
}

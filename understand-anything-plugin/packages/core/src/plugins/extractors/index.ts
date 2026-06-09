export type { LanguageExtractor, TreeSitterNode } from "./types.js";
export { traverse, getStringValue, findChild, findChildren, hasChildOfType } from "./base-extractor.js";
export { TypeScriptExtractor } from "./typescript-extractor.js";
export { PythonExtractor } from "./python-extractor.js";
export { GoExtractor } from "./go-extractor.js";
export { RustExtractor } from "./rust-extractor.js";
export { JavaExtractor } from "./java-extractor.js";
export { RubyExtractor } from "./ruby-extractor.js";
export { PhpExtractor } from "./php-extractor.js";
export { CppExtractor } from "./cpp-extractor.js";
export { CSharpExtractor } from "./csharp-extractor.js";
export { BashExtractor } from "./bash-extractor.js";

import type { LanguageExtractor } from "./types.js";
import { TypeScriptExtractor } from "./typescript-extractor.js";
import { PythonExtractor } from "./python-extractor.js";
import { GoExtractor } from "./go-extractor.js";
import { RustExtractor } from "./rust-extractor.js";
import { JavaExtractor } from "./java-extractor.js";
import { RubyExtractor } from "./ruby-extractor.js";
import { PhpExtractor } from "./php-extractor.js";
import { CppExtractor } from "./cpp-extractor.js";
import { CSharpExtractor } from "./csharp-extractor.js";
import { BashExtractor } from "./bash-extractor.js";

export const builtinExtractors: LanguageExtractor[] = [
  new TypeScriptExtractor(),
  new PythonExtractor(),
  new GoExtractor(),
  new RustExtractor(),
  new JavaExtractor(),
  new RubyExtractor(),
  new PhpExtractor(),
  new CppExtractor(),
  new CSharpExtractor(),
  new BashExtractor(),
];

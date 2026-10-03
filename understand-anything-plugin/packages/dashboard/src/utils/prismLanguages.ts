import { Prism } from "prism-react-renderer";

/**
 * Syntax-highlighting language support for the code viewer.
 *
 * prism-react-renderer bundles only ~15 grammars (JS/TS, Python, Go, Rust,
 * JSON, YAML, Markdown, …). Everything else — Java, C#, Ruby, PHP, shell,
 * TOML, Dockerfiles, … — rendered as plain text. The extra grammars are
 * loaded on demand from `prismjs/components`, which register themselves on
 * a global `Prism`; we point that global at prism-react-renderer's instance
 * so the loaded grammars land where `<Highlight>` looks for them.
 */

/** Extension (lowercase, no dot) → Prism language id. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  // JavaScript / TypeScript
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  // Web
  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",
  svelte: "markup", astro: "markup", xhtml: "markup", plist: "markup",
  css: "css", scss: "scss", sass: "sass", less: "less",
  // Data / config
  json: "json", jsonc: "json", json5: "json", webmanifest: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini",
  conf: "ini", editorconfig: "ini", properties: "properties",
  graphql: "graphql", gql: "graphql", proto: "protobuf", sql: "sql",
  tf: "hcl", tfvars: "hcl", hcl: "hcl", nix: "nix",
  // Docs
  md: "markdown", mdx: "markdown", markdown: "markdown", tex: "latex",
  // Shell
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", env: "bash",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  bat: "batch", cmd: "batch",
  // Systems
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  hxx: "cpp", m: "objectivec", mm: "objectivec", rs: "rust", go: "go",
  zig: "zig", swift: "swift",
  // JVM / .NET
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala",
  groovy: "groovy", gradle: "groovy", cs: "csharp", fs: "fsharp",
  fsx: "fsharp", vb: "vbnet",
  // Scripting
  py: "python", pyi: "python", rb: "ruby", rake: "ruby", gemspec: "ruby",
  php: "php", lua: "lua", pl: "perl", pm: "perl", r: "r", dart: "dart",
  ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang", hs: "haskell",
  clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  ml: "ocaml", mli: "ocaml", jl: "julia", sol: "solidity",
  // Misc
  diff: "diff", patch: "diff", cmake: "cmake", mk: "makefile",
  gitignore: "ignore", dockerignore: "ignore", npmignore: "ignore",
};

/** Exact (lowercase) basename → Prism language id, for extension-less files. */
const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  jenkinsfile: "groovy",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".gitignore": "ignore",
  ".dockerignore": "ignore",
  ".npmignore": "ignore",
  ".env": "bash",
};

/** Map a file path to the Prism language id used to highlight it. */
export function languageForPath(filePath: string | undefined): string {
  if (!filePath) return "text";
  const base = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const byName = LANGUAGE_BY_FILENAME[base];
  if (byName) return byName;
  // `Dockerfile.dev`, `.env.local` — match on the leading name part.
  const stem = base.split(".")[0];
  if (stem === "dockerfile" || stem === "containerfile") return "docker";
  if (base.startsWith(".env")) return "bash";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "text";
  return LANGUAGE_BY_EXTENSION[base.slice(dot + 1)] ?? "text";
}

type Loader = () => Promise<unknown>;

// Grammars that extend another grammar must load after it. Grammars already
// bundled by prism-react-renderer (clike, c, cpp, css, javascript, markup, …)
// are always present and need no entry here.
const LANGUAGE_DEPENDENCIES: Record<string, string[]> = {
  php: ["markup-templating"],
  scala: ["java"],
  vbnet: ["basic"],
};

const LOADERS: Record<string, Loader> = {
  basic: () => import("prismjs/components/prism-basic.js"),
  bash: () => import("prismjs/components/prism-bash.js"),
  batch: () => import("prismjs/components/prism-batch.js"),
  clojure: () => import("prismjs/components/prism-clojure.js"),
  cmake: () => import("prismjs/components/prism-cmake.js"),
  csharp: () => import("prismjs/components/prism-csharp.js"),
  dart: () => import("prismjs/components/prism-dart.js"),
  diff: () => import("prismjs/components/prism-diff.js"),
  docker: () => import("prismjs/components/prism-docker.js"),
  elixir: () => import("prismjs/components/prism-elixir.js"),
  erlang: () => import("prismjs/components/prism-erlang.js"),
  fsharp: () => import("prismjs/components/prism-fsharp.js"),
  groovy: () => import("prismjs/components/prism-groovy.js"),
  haskell: () => import("prismjs/components/prism-haskell.js"),
  hcl: () => import("prismjs/components/prism-hcl.js"),
  ignore: () => import("prismjs/components/prism-ignore.js"),
  ini: () => import("prismjs/components/prism-ini.js"),
  java: () => import("prismjs/components/prism-java.js"),
  julia: () => import("prismjs/components/prism-julia.js"),
  latex: () => import("prismjs/components/prism-latex.js"),
  less: () => import("prismjs/components/prism-less.js"),
  lua: () => import("prismjs/components/prism-lua.js"),
  makefile: () => import("prismjs/components/prism-makefile.js"),
  "markup-templating": () => import("prismjs/components/prism-markup-templating.js"),
  nix: () => import("prismjs/components/prism-nix.js"),
  ocaml: () => import("prismjs/components/prism-ocaml.js"),
  perl: () => import("prismjs/components/prism-perl.js"),
  php: () => import("prismjs/components/prism-php.js"),
  powershell: () => import("prismjs/components/prism-powershell.js"),
  properties: () => import("prismjs/components/prism-properties.js"),
  protobuf: () => import("prismjs/components/prism-protobuf.js"),
  r: () => import("prismjs/components/prism-r.js"),
  ruby: () => import("prismjs/components/prism-ruby.js"),
  sass: () => import("prismjs/components/prism-sass.js"),
  scala: () => import("prismjs/components/prism-scala.js"),
  scss: () => import("prismjs/components/prism-scss.js"),
  solidity: () => import("prismjs/components/prism-solidity.js"),
  toml: () => import("prismjs/components/prism-toml.js"),
  vbnet: () => import("prismjs/components/prism-vbnet.js"),
  zig: () => import("prismjs/components/prism-zig.js"),
};

const pending = new Map<string, Promise<boolean>>();

/** True when `<Highlight>` can tokenize `language` right now. */
export function isPrismLanguageLoaded(language: string): boolean {
  return language in Prism.languages;
}

/**
 * Make sure the grammar for `language` is registered. Resolves to `true`
 * when it is available (already bundled or loaded now), `false` when there
 * is no grammar for it (the caller renders plain text).
 */
export function ensurePrismLanguage(language: string): Promise<boolean> {
  if (isPrismLanguageLoaded(language)) return Promise.resolve(true);
  const loader = LOADERS[language];
  if (!loader) return Promise.resolve(false);
  let promise = pending.get(language);
  if (!promise) {
    promise = (async () => {
      (globalThis as unknown as { Prism: typeof Prism }).Prism = Prism;
      for (const dep of LANGUAGE_DEPENDENCIES[language] ?? []) {
        await ensurePrismLanguage(dep);
      }
      await loader();
      return isPrismLanguageLoaded(language);
    })().catch(() => false);
    pending.set(language, promise);
  }
  return promise;
}

# @understand-anything/dsh — DeepSeek Harness bundle

Install Understand Anything as a [DeepSeek Harness](https://github.com/deepseek-ai/dsh) plugin. This bundle registers the `/understand` skill set (and the Understand Anything agents) inside a DSH profile so you can analyze a codebase and explore its knowledge graph with the full interactive dashboard — right from `dsh`.

## What this bundle provides

- The `/understand` skill set: `understand`, `understand-chat`, `understand-dashboard`, `understand-diff`, `understand-domain`, `understand-explain`, `understand-figma`, `understand-knowledge`, `understand-onboard`.
- A self-contained copy of the built `@understand-anything/core` engine and every tree-sitter grammar (shipped as WASM), so the skills run without a separate build or install step.
- The Understand Anything agents used by the multi-agent analysis pipeline.

## Prerequisites

- A working DeepSeek Harness (`dsh`) install.
- The bundle is a DSH profile plugin ("bundle") — it adds both the plugin and its patch layer to a profile.

## Installation

From any directory, install the bundle into a profile (for example `web` or a profile of your choice):

```bash
# From a packed tarball:
dsh plugin --profile web add /path/to/understand-anything-dsh-2.9.4.tgz

# Or from a local checkout directory:
dsh plugin --profile web add /path/to/understand-anything-plugin/dsh

# Or from an npm registry / git URL once published:
# dsh plugin --profile web add @understand-anything/dsh
```

`dsh plugin` derives the underlying pnpm command from the argument, so the first form is `pnpm add <tarball>`, the second `pnpm add <directory>`, and the third `pnpm add <package-name>`. Any package that declares `dsh.bundle` (this one does) is then activated as a profile layer automatically.

If the profile does not exist yet, `dsh plugin` initializes it first (with the `@deepseek-ai/dsh-base` bundle) and then adds this bundle.

Restart your DSH profile / session so the profile picks up the new bundle.

## Usage

Open a `dsh` session in the project you want to analyze and invoke a skill:

```
/understand --full
```

or ask in plain language:

> Use the understand skill to analyze this project.

`/understand` runs the multi-agent analysis pipeline and writes `knowledge-graph.json` into the project's data directory (`.ua/`, or the legacy `.understand-anything/` when it already exists). Then `/understand-dashboard` launches the interactive dashboard to explore the graph.

## How it works

`dsh` loads bundles as `cordis.patch.yml` patch layers. This bundle's patch inserts a single plugin row (`understand-anything`); the plugin:

1. Links the shipped tree-sitter grammars from `vendor/grammars/` into this bundle's `node_modules/` (npm strips `node_modules/` from tarballs, so the WASM grammars ship under `vendor/grammars/` and are linked lazily on profile boot).
2. Registers every bundled `/understand` skill on `ctx.skills`, reading each `SKILL.md` from this bundle's `skills/` directory.
3. Exposes each skill's scripts through its `resourceBase`, so the skill's `.mjs`/`.py` scripts resolve the bundled core and grammars.

## Building / repacking

The skills, agents, built core, and grammars are mirrored from the parent `understand-anything-plugin` into this bundle by a sync script so there is a single source of truth:

```bash
cd understand-anything-plugin/dsh
pnpm install          # install the bundle's own deps if needed
node scripts/sync-skills.mjs   # mirror skills, agents, core, and grammars
npm pack              # produce understand-anything-dsh-<version>.tgz
```

The `prepack` script runs the sync automatically, so `npm pack` always reflects the current plugin.

## Versioning

This bundle is versioned in lockstep with the rest of Understand Anything — bump `version` here whenever you bump the other plugin manifests (see the repo's [versioning convention](../../README.md)).

## License

MIT.

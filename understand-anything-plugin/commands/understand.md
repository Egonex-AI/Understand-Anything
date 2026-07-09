---
name: understand
description: Generate or update an Understand Anything knowledge graph for a project
---

Use the Understand Anything workflow via its existing skill, but treat this command's CLI-style arguments as the skill's `$ARGUMENTS`.

## Argument forwarding

- Everything after `:understand` is the arguments string.
- While following the underlying skill workflow, interpret `$ARGUMENTS` as that string.

Examples:
- `:understand`
- `:understand --full`
- `:understand --review`
- `:understand ../other-repo --language ja`

## Execute

1. Ensure Understand Anything is installed (the universal plugin root should exist):
   - `$HOME/.understand-anything-plugin`

2. Read and follow the workflow in:
   - `$HOME/.understand-anything-plugin/skills/understand/SKILL.md`

3. When the workflow references helper scripts (e.g. `compute-batches.mjs`, `merge-batch-graphs.py`), prefer running them from the same directory as that `SKILL.md` file (the scripts live alongside it).

4. (Safety) After the workflow completes, ensure the generated graph matches the dashboard schema (fix common legacy field shapes in-place):

   ```bash
   node -e '
   const fs = require("fs");
   const path = require("path");

   function findGraph(startDir) {
     let dir = startDir;
     for (let i = 0; i < 10; i++) {
       const candidate = path.join(dir, ".understand-anything", "knowledge-graph.json");
       if (fs.existsSync(candidate)) return { projectDir: dir, graphPath: candidate };
       const parent = path.dirname(dir);
       if (!parent || parent === dir) break;
       dir = parent;
     }
     return null;
   }

   const startDir = process.env.PROJECT_DIR || process.cwd();
   const found = findGraph(startDir);

   if (!found) {
     console.error("[ua] No knowledge graph found under: " + startDir);
     console.error("[ua] Expected: <project>/.understand-anything/knowledge-graph.json");
     console.error("[ua] Tip: run from your project root, or set PROJECT_DIR=... to the project path");
     process.exit(1);
   }

   const { projectDir, graphPath } = found;

   const g = JSON.parse(fs.readFileSync(graphPath, "utf8"));
   let changed = false;

   // Legacy → current: top-level project fields → project{...}
   if (!g.project || typeof g.project !== "object") {
     const analyzedAt =
       (typeof g.analyzedAt === "string" && g.analyzedAt) ||
       (typeof g.generatedAt === "string" && g.generatedAt) ||
       new Date().toISOString();

     const gitCommitHash =
       (typeof g.gitCommitHash === "string" && g.gitCommitHash) ||
       (typeof g.gitCommit === "string" && g.gitCommit) ||
       "";

     const hasLegacy =
       typeof g.name === "string" ||
       Array.isArray(g.languages) ||
       Array.isArray(g.frameworks) ||
       typeof g.description === "string" ||
       typeof g.generatedAt === "string" ||
       typeof g.gitCommit === "string";

     if (hasLegacy) {
       g.project = {
         name: typeof g.name === "string" && g.name ? g.name : path.basename(projectDir),
         languages: Array.isArray(g.languages) ? g.languages : [],
         frameworks: Array.isArray(g.frameworks) ? g.frameworks : [],
         description: typeof g.description === "string" ? g.description : "",
         analyzedAt,
         gitCommitHash,
       };

       // Keep the file canonical.
       delete g.name;
       delete g.languages;
       delete g.frameworks;
       delete g.description;
       delete g.generatedAt;
       delete g.gitCommit;
       delete g.analyzedAt;
       delete g.gitCommitHash;

       changed = true;
     }
   }

   // Legacy → current: tour step shape
   if (Array.isArray(g.tour)) {
     g.tour = g.tour.map((s) => {
       if (!s || typeof s !== "object") return s;

       if ("step" in s && !("order" in s)) {
         s.order = s.step;
         delete s.step;
         changed = true;
       }

       if ("nodeId" in s && !("nodeIds" in s)) {
         s.nodeIds = [s.nodeId];
         delete s.nodeId;
         changed = true;
       }

       if (typeof s.nodeIds === "string") {
         s.nodeIds = [s.nodeIds];
         changed = true;
       }

       return s;
     });
   }

   if (changed) {
     fs.writeFileSync(graphPath, JSON.stringify(g, null, 2));
     console.log("[ua] Normalized knowledge-graph.json schema (legacy fields migrated)");
   } else {
     console.log("[ua] knowledge-graph.json already matches expected schema");
   }
   '
   ```

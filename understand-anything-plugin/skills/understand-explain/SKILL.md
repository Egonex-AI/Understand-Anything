---
name: understand-explain
description: Use when you need a deep-dive explanation of a specific file, function, or module in the codebase
argument-hint: "[file-path]"
---

# /understand-explain

Provide a thorough, in-depth explanation of a specific code component.

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, contains_flow, flow_step, related, cites
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

## Instructions

1. Check that `.understand-anything/knowledge-graph.json` exists. If not, tell the user to run `/understand` first.

2. **Find the target node** — use Grep to search the knowledge graph for the component: "$ARGUMENTS"
   - For file paths (e.g., `src/auth/login.ts`): search for `"filePath"` matches
   - For function notation (e.g., `src/auth/login.ts:verifyToken`): search for the function name in `"name"` fields filtered by the file path
   - Note the exact node `id`, `type`, `summary`, `tags`, and `complexity`

3. **Find all connected edges** — Grep for the target node's ID in the edges section:
   - `"source"` matches → things this node calls/imports/depends on (outgoing)
   - `"target"` matches → things that call/import/depend on this node (incoming)
   - Note the connected node IDs and edge types

4. **Read connected nodes** — for each connected node ID from step 3, Grep for those IDs in the nodes section to get their `name`, `summary`, and `type`. This builds the component's neighborhood.

5. **Identify the layer** — Grep for the target node's ID in the `"layers"` section to find which architectural layer it belongs to and that layer's description.

6. **Read the actual source file** — Read the source file at the node's `filePath` for the deep-dive analysis.

7. **Explain the component in context**:
   - Its role in the architecture (which layer, why it exists)
   - Internal structure (functions, classes it contains — from `contains` edges)
   - External connections (what it imports, what calls it, what it depends on — from edges)
   - Data flow (inputs → processing → outputs — from source code)
   - Explain clearly, assuming the reader may not know the programming language
   - Highlight any patterns, idioms, or complexity worth understanding

8. **Optional on-demand code guide annotations**:
   - If the user asks for inline guidance, annotated code, comments between source lines, or a guided reading experience in the dashboard, update a scoped JSON file under `.understand-anything/guide-annotations/`, not `knowledge-graph.json`.
   - Do not annotate the whole graph. Keep this lazy and scoped to what the user asked to read.
   - Prefer mirroring the source path and node name, for example `.understand-anything/guide-annotations/src/example.ts/save.json`, using this shape:
     ```json
     {
       "version": 1,
       "nodeId": "function:src/example.ts:save",
       "filePath": "src/example.ts",
       "annotations": [
         {
           "line": 104,
           "anchor": "const nextProgram = assembly.program;",
           "text": "This line starts the save flow by reading the current editor state."
         }
       ]
     }
     ```
   - `nodeId` should be the exact graph node id being annotated. Set `nodeId` and `filePath` at the top level for single-node files, or per annotation only when a file intentionally contains notes for multiple nodes. `line` is a 1-based line number in `filePath`; the dashboard renders the annotation before that source line without changing the source file.
   - Include `anchor` whenever possible, using a short stable snippet from the source line. This lets the dashboard reattach the annotation if edits move the code to a different line. If the same anchor appears multiple times, add optional `before` and `after` snippets from nearby lines to disambiguate.
   - `text` should be 1-2 concise, source-grounded sentences. Prefer explaining intent, data flow, or side effects at that point in the code.
   - Do not put pseudo-code, walkthrough prose, or inline reading notes in `languageNotes`; that field is only for language-specific concepts and idioms.

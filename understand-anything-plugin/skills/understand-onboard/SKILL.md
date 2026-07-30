---
name: understand-onboard
description: Use when you need to generate an onboarding guide for new team members joining a project
disable-model-invocation: true
---

# /understand-onboard

Generate a comprehensive onboarding guide from the project's knowledge graph.

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

### Phase 1: EXTRACT (deterministic)

1. Check that `.understand-anything/knowledge-graph.json` exists. If not, tell the user to run `/understand` first.

2. Run the extraction script to produce structured data:

   ```bash
   python3 <SKILL_DIR>/scripts/extract-structure.py \
     .understand-anything/knowledge-graph.json \
     .understand-anything/intermediate/onboard-structured-data.json
   ```

   Replace `<SKILL_DIR>` with the directory containing this SKILL.md file.

3. Read `.understand-anything/intermediate/onboard-structured-data.json` — this provides node counts, type breakdown, layer names, and top entry points as deterministic context for generation.

### Phase 2: GENERATE (LLM)

4. **Read project metadata** — use Grep or Read with a line limit to extract the `"project"` section (name, description, languages, frameworks).

5. **Read layers** — Grep for `"layers"` to get the full layers array. These define the architecture and will structure the guide.

6. **Read the tour** — Grep for `"tour"` to get the guided walkthrough steps. These provide the recommended learning path.

7. **Read file-level structural nodes only** — use Grep to find nodes with file-level types (`file`, `config`, `document`, `service`, `pipeline`, `table`, `schema`, `resource`, `endpoint`) in the knowledge graph. Skip function-level and class-level nodes to keep the guide high-level. Extract each node's `name`, `filePath`, `summary`, and `complexity`.

8. **Identify complexity hotspots** — from the file-level nodes, find those with the highest `complexity` values. These are areas new developers should approach carefully.

9. **Generate the onboarding guide** using both the structured data from Phase 1 and the graph sections above. Include these sections:
   - **Project Overview**: name, languages, frameworks, description (from project metadata)
   - **Architecture Layers**: each layer's name, description, and key files (from layers + file nodes)
   - **Key Concepts**: important patterns and design decisions (from node summaries and tags)
   - **Guided Tour**: step-by-step walkthrough (from the tour section)
   - **File Map**: what each key file does (from file-level nodes, organized by layer)
   - **Complexity Hotspots**: areas to approach carefully (from complexity values)

### Phase 3: VALIDATE

10. **Verify required sections** — confirm the generated markdown contains:
    - "Project Overview" or "Overview"
    - "Architecture" (may include "Layers")
    - "Key Concepts" or "Key Components"
    - "Getting Started" or "Guided Tour"

    If any required section is missing, re-prompt the LLM with the missing section names and regenerate before proceeding.

11. Format as clean markdown.

12. Offer to save the guide to `docs/ONBOARDING.md` in the project.

13. Suggest the user commit it to the repo for the team.

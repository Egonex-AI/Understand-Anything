# Reference: Phase Output Shapes

> Canonical JSON shapes for `layers[*]`, `tour[*]`, and the assembled `KnowledgeGraph` object that the workflow normalizes to. Referenced from `SKILL.md` Phase 4, Phase 5, and Phase 6.

## `layers[*]` shape (Phase 4)

Each element of the final `layers` array MUST have this shape. All four fields (`id`, `name`, `description`, `nodeIds`) are required.

```json
[
  {
    "id": "layer:<kebab-case-name>",
    "name": "<layer name>",
    "description": "<what belongs in this layer>",
    "nodeIds": ["file:src/App.tsx", "config:tsconfig.json", "document:README.md"]
  }
]
```

## `tour[*]` shape (Phase 5)

Each element of the final `tour` array MUST have this shape. Required fields: `order`, `title`, `description`, `nodeIds`. Preserve optional `languageLesson` when present.

```json
[
  {
    "order": 1,
    "title": "Project Overview",
    "description": "Start with the README to understand the project's purpose and architecture.",
    "nodeIds": ["document:README.md"]
  },
  {
    "order": 2,
    "title": "Application Entry Point",
    "description": "This step explains how the frontend boots and mounts.",
    "nodeIds": ["file:src/main.tsx", "file:src/App.tsx"]
  }
]
```

## Assembled `KnowledgeGraph` shape (Phase 6)

The full top-level shape written to `knowledge-graph.json`:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 3 review>],
  "edges": [<all edges from assembled-graph.json after Phase 3 review>],
  "layers": [<layers from Phase 4>],
  "tour": [<steps from Phase 5>]
}
```

---
name: understand-chat
description: Answer questions using an Understand Anything knowledge graph
---

Use the existing Understand Anything chat skill, but treat this command's CLI-style arguments as the skill's `$ARGUMENTS`.

## Argument forwarding

- Everything after `:understand-chat` is the query string.
- While following the underlying skill workflow, interpret `$ARGUMENTS` as that query string.

Examples:
- `:understand-chat how does auth work?`
- `:understand-chat where is the db connection created?`

## Execute

1. Ensure Understand Anything is installed (the universal plugin root should exist):
   - `$HOME/.understand-anything-plugin`

2. Read and follow the workflow in:
   - `$HOME/.understand-anything-plugin/skills/understand-chat/SKILL.md`

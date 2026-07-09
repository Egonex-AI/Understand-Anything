---
name: understand-explain
description: Deep-dive explain a specific file/function/module using an Understand Anything knowledge graph
---

Use the existing Understand Anything explain skill, but treat this command's CLI-style arguments as the skill's `$ARGUMENTS`.

## Argument forwarding

- Everything after `:understand-explain` is the target string (file path or file:function).
- While following the underlying skill workflow, interpret `$ARGUMENTS` as that target.

Examples:
- `:understand-explain src/auth/login.ts`
- `:understand-explain src/auth/login.ts:verifyToken`

## Execute

1. Ensure Understand Anything is installed (the universal plugin root should exist):
   - `$HOME/.understand-anything-plugin`

2. Read and follow the workflow in:
   - `$HOME/.understand-anything-plugin/skills/understand-explain/SKILL.md`

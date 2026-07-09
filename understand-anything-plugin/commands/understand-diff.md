---
name: understand-diff
description: Analyze git diffs or pull requests using an Understand Anything knowledge graph
---

Use the existing Understand Anything diff skill, but treat the user's invocation text (including any specified base branch / PR context) as the input.

## Usage

Examples:
- `:understand-diff`
- `:understand-diff compare with main`
- `:understand-diff PR #123`

## Execute

1. Ensure Understand Anything is installed (the universal plugin root should exist):
   - `$HOME/.understand-anything-plugin`

2. Read and follow the workflow in:
   - `$HOME/.understand-anything-plugin/skills/understand-diff/SKILL.md`

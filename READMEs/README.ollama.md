# Understand Anything — Local Ollama Backend

> Local-first variant of Understand Anything. Runs the full pipeline against a user-run [Ollama](https://ollama.com) server. No API key, no cloud egress, no host-plugin required.

## Where to look

- **Main README:** [README.md](../README.md) — overview, multi-platform install, dashboard, all skills.
- **Local-only quick start:** [README.md → Run fully locally with Ollama](../README.md#5-run-fully-locally-with-ollama).
- **Skill definition:** [`understand-anything-plugin/skills/understand-ollama/SKILL.md`](../understand-anything-plugin/skills/understand-ollama/SKILL.md) — prerequisites, CLI flags, how the seven phases run against Ollama.
- **Implementation plan:** [`docs/superpowers/plans/2026-06-19-ollama-backend-impl.md`](../docs/superpowers/plans/2026-06-19-ollama-backend-impl.md).
- **Design spec:** [`docs/superpowers/specs/2026-06-19-ollama-backend-design.md`](../docs/superpowers/specs/2026-06-19-ollama-backend-design.md).

## TL;DR

```bash
# One-time setup
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull qwen2.5-coder:7b    # 7B default; works on a 16 GB GPU

# Per project
node understand-anything-plugin/skills/understand-ollama/run-pipeline.mjs \
  --project-root "$(pwd)" \
  --plugin-root "$(pwd)/understand-anything-plugin" \
  --model qwen2.5-coder:7b
```

The script writes the same `.understand-anything/knowledge-graph.json` and `.understand-anything/meta.json` files that the host-plugin path produces. Run any of the standard dashboard / diff / chat skills afterward to explore the result.

## Status

Production-ready. Tested end-to-end against the local Ollama server on the `homepage/` fixture and on the `Understand-Anything` monorepo itself, using the 1.5B default model (small CPU/laptop footprint) and the 7B code model (consumer GPU). Schema validation passes against the dashboard's Zod schema.

## Differences from the host-plugin path

- Project narrative, per-file enrichment, layer detection, and tour generation call Ollama directly. The host-plugin path delegates these to host-platform subagents (Claude Code, Cursor, Copilot).
- `--review` runs structural validation only. The host-plugin path's graph-reviewer subagent is a host-platform LLM call; on the local path the run continues with warnings surfaced.
- Concurrency is bounded by the local model's memory budget. Default is 2 concurrent requests.
- Default model is `qwen2.5-coder:1.5b` (fast, low-memory); switch to `qwen2.5-coder:7b` or `qwen3-coder:30b` for higher-quality output on beefier hardware.

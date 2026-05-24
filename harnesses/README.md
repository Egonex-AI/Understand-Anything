# Harnesses

Platform-specific adapters for running Understand-Anything outside Claude Code.

## Directory Structure

```
harnesses/
├── kiro/
│   └── run-understand.sh    # Standalone pipeline orchestrator
└── litellm/
    ├── llm-client.mjs       # OpenAI-compatible LLM client
    └── .env.example          # Configuration template
```

## Kiro

### Installation

```bash
# From the repo root:
./install.sh kiro

# Or manually:
ln -sfn /path/to/repo/understand-anything-plugin/skills/understand ~/.kiro/skills/understand
ln -sfn /path/to/repo/understand-anything-plugin/skills/understand-dashboard ~/.kiro/skills/understand-dashboard
ln -sfn /path/to/repo/understand-anything-plugin/skills/understand-domain ~/.kiro/skills/understand-domain
# ... etc for each skill
```

After installation, Kiro auto-discovers skills via `.kiro-plugin/plugin.json` when the repo is open, or uses the symlinked skills globally.

### Running the Pipeline

The skills work the same as in Claude Code — Kiro reads the SKILL.md files and executes the instructions. For standalone/scripted usage:

```bash
# Full pipeline with LLM (requires LiteLLM-Proxy running)
./harnesses/kiro/run-understand.sh /path/to/project

# Structure-only (no LLM needed)
./harnesses/kiro/run-understand.sh /path/to/project --no-llm

# Force full rebuild
./harnesses/kiro/run-understand.sh /path/to/project --full

# Use a specific model
./harnesses/kiro/run-understand.sh /path/to/project --model claude-3-5-sonnet
```

## LiteLLM-Proxy Integration

The `litellm/llm-client.mjs` is a thin Node.js client that sends prompts to any OpenAI-compatible endpoint. It's used by the Kiro orchestrator but can also be used standalone.

### Setup

1. Install and run [LiteLLM-Proxy](https://docs.litellm.ai/docs/proxy/quick_start):
   ```bash
   pip install litellm[proxy]
   litellm --model gpt-4o --port 4000
   ```

2. Configure environment:
   ```bash
   cp harnesses/litellm/.env.example .env
   # Edit .env with your endpoint details
   source .env
   ```

### Usage

```bash
# Pipe a prompt
echo "Summarize this code..." | node harnesses/litellm/llm-client.mjs

# Pass prompt as argument
node harnesses/litellm/llm-client.mjs --prompt "What does this function do?"

# Read prompt from file
node harnesses/litellm/llm-client.mjs --prompt-file /tmp/analysis-prompt.txt

# With system message
node harnesses/litellm/llm-client.mjs --prompt "Analyze..." --system "You are a code analyst."
```

### Using with Other Providers

The client works with any OpenAI-compatible API:

| Provider | LITELLM_BASE_URL | Notes |
|----------|-----------------|-------|
| LiteLLM-Proxy | `http://localhost:4000` | Default, routes to any backend |
| OpenAI direct | `https://api.openai.com` | Set LITELLM_API_KEY to your OpenAI key |
| Azure OpenAI | `https://YOUR.openai.azure.com` | Use LiteLLM-Proxy for header translation |
| LM Studio | `http://localhost:1234` | Use `--local` flag |
| Ollama | `http://localhost:11434` | Use `--ollama` flag |
| vLLM | `http://localhost:8000` | Any vLLM-served model |

## Local LLM Inference

### LM Studio

1. Open [LM Studio](https://lmstudio.ai/) and load a model (recommended: any 7B+ instruct model)
2. Start the local server (default port 1234)
3. Run:
   ```bash
   ./harnesses/kiro/run-understand.sh /path/to/project --local
   ```

That's it. The `--local` flag sets `LITELLM_BASE_URL=http://localhost:1234` automatically.

To use a custom port:
```bash
./harnesses/kiro/run-understand.sh /path/to/project --port 8080 --local
```

### Ollama

1. Install [Ollama](https://ollama.ai/) and pull a model:
   ```bash
   ollama pull llama3
   ```

2. Run with the `--ollama` flag:
   ```bash
   # Uses llama3 by default
   ./harnesses/kiro/run-understand.sh /path/to/project --ollama

   # Specify a different model
   ./harnesses/kiro/run-understand.sh /path/to/project --ollama codellama

   # Custom port
   ./harnesses/kiro/run-understand.sh /path/to/project --port 11435 --ollama
   ```

### Other Local Servers (vLLM, llama.cpp, etc.)

Any server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint works:

```bash
export LITELLM_BASE_URL=http://localhost:8000
export LITELLM_MODEL=my-local-model
./harnesses/kiro/run-understand.sh /path/to/project
```

## Codex / Other Platforms

The existing `install.sh` handles Codex, OpenCode, Gemini CLI, etc. via symlinks to `~/.agents/skills/`. Those platforms invoke the SKILL.md instructions directly through their own agent runtimes.

For platforms that need a standalone script (no agent runtime), use the Kiro harness:

```bash
# Works for any platform — just run the shell script
./harnesses/kiro/run-understand.sh .
```

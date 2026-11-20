# EvoLink model provider configuration

Understand Anything uses the model configured in the host AI coding platform
such as Claude Code, Codex, OpenCode, Gemini CLI, Cursor, or Copilot. The plugin
does not call an LLM provider directly, so there is no provider registry to
modify inside this repository.

Use this guide when your host platform supports an OpenAI-compatible or
Anthropic Messages-compatible endpoint and you want to run `/understand` through
EvoLink.

## Endpoint

Set the text-model base URL to:

```text
https://direct.evolink.ai/v1
```

Use bearer token authentication:

```bash
export EVOLINK_API_KEY="your-evolink-api-key"
```

Many tools name the same fields differently. Use the mapping below:

| Field | Value |
| --- | --- |
| API key | `$EVOLINK_API_KEY` |
| Base URL / API base | `https://direct.evolink.ai/v1` |
| OpenAI-compatible path | `/chat/completions` under the configured `/v1` base |
| Anthropic-compatible path | `/messages` under the configured `/v1` base |

## Recommended models

For large `/understand` runs, start with a high-context model. For smaller
follow-up commands such as `/understand-chat`, use the same provider with a
faster model if your platform lets you choose per session.

| Family | Protocol | Model IDs |
| --- | --- | --- |
| GLM 5.2 | OpenAI-compatible | `glm-5.2` |
| DeepSeek V4 | OpenAI-compatible and Anthropic-compatible | `deepseek-v4-flash`, `deepseek-v4-pro` |
| GPT | OpenAI-compatible | `gpt-5.2`, `gpt-5.5` |
| Claude | Anthropic-compatible Messages API | `claude-sonnet-4-6`, `claude-opus-4-8`, `claude-haiku-4-5-20251001` |

The model list changes over time. Check
<https://docs.evolink.ai/llms.txt> before pinning a model in shared
configuration.

## OpenAI-compatible smoke test

Run this before changing your platform settings. A successful response proves
the key, base URL, and model are valid.

```bash
curl -sS https://direct.evolink.ai/v1/chat/completions \
  -H "Authorization: Bearer $EVOLINK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5.2",
    "messages": [
      {
        "role": "user",
        "content": "Reply with exactly: EvoLink ready"
      }
    ]
  }'
```

You can replace `glm-5.2` with `deepseek-v4-flash`, `deepseek-v4-pro`,
`gpt-5.2`, or `gpt-5.5` for the same OpenAI-compatible path.

## Anthropic-compatible smoke test

Use this path for Claude-compatible clients, or for DeepSeek when your host
platform is configured through an Anthropic Messages-compatible provider.

```bash
curl -sS https://direct.evolink.ai/v1/messages \
  -H "Authorization: Bearer $EVOLINK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 64,
    "messages": [
      {
        "role": "user",
        "content": "Reply with exactly: EvoLink ready"
      }
    ]
  }'
```

You can replace `claude-sonnet-4-6` with `claude-opus-4-8`,
`claude-haiku-4-5-20251001`, `deepseek-v4-flash`, or `deepseek-v4-pro` for the
same Messages-compatible path.

## Platform notes

- **Codex / OpenCode / compatible OpenAI clients**: configure the provider with
  the OpenAI-compatible base URL and one of the OpenAI-compatible model IDs.
- **Claude-compatible clients**: configure the provider with the
  Anthropic-compatible base URL and one of the Claude or DeepSeek
  Messages-compatible model IDs.
- **Understand Anything plugin commands**: run `/understand` normally after the
  host platform is configured. The plugin inherits the platform model; no
  additional provider flag is required.

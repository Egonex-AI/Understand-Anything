#!/usr/bin/env node
/**
 * harnesses/litellm/llm-client.mjs
 *
 * Minimal OpenAI-compatible LLM client for Understand-Anything.
 * Routes prompts through LiteLLM-Proxy or any OpenAI-compatible endpoint.
 *
 * Environment variables:
 *   LITELLM_BASE_URL  - Base URL (default: http://localhost:4000)
 *   LITELLM_API_KEY   - API key (default: empty)
 *   LITELLM_MODEL     - Model name (default: gpt-4o)
 *   LITELLM_MAX_TOKENS - Max response tokens (default: 4096)
 *
 * Usage:
 *   echo "prompt text" | node llm-client.mjs
 *   node llm-client.mjs --prompt "prompt text"
 *   node llm-client.mjs --prompt-file /path/to/prompt.txt
 *   node llm-client.mjs --prompt "text" --system "You are a code analyst."
 */

import { readFileSync } from "fs";

const BASE_URL = process.env.LITELLM_BASE_URL || "http://localhost:4000";
const API_KEY = process.env.LITELLM_API_KEY || "";
const MODEL = process.env.LITELLM_MODEL || "gpt-4o";
const MAX_TOKENS = parseInt(process.env.LITELLM_MAX_TOKENS || "4096", 10);

function parseArgs(argv) {
  const args = { prompt: null, system: null, promptFile: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--prompt" && argv[i + 1]) args.prompt = argv[++i];
    else if (argv[i] === "--system" && argv[i + 1]) args.system = argv[++i];
    else if (argv[i] === "--prompt-file" && argv[i + 1]) args.promptFile = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim() || null;
}

async function callLLM(prompt, system) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const body = { model: MODEL, messages, max_tokens: MAX_TOKENS, temperature: 0.1 };

  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LiteLLM request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function main() {
  const args = parseArgs(process.argv);

  let prompt = args.prompt;
  if (!prompt && args.promptFile) {
    prompt = readFileSync(args.promptFile, "utf-8");
  }
  if (!prompt) {
    prompt = await readStdin();
  }
  if (!prompt) {
    console.error("Usage: node llm-client.mjs --prompt 'text' | --prompt-file path | pipe via stdin");
    process.exit(1);
  }

  const result = await callLLM(prompt, args.system);
  process.stdout.write(result);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

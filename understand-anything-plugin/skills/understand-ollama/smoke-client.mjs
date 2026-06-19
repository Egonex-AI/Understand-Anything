// skills/understand-ollama/smoke-client.mjs
// Local smoke test for OllamaClient against a real running Ollama server.
// Run with: pnpm exec node skills/understand-ollama/smoke-client.mjs
import { OllamaClient } from "@understand-anything/core";

const model = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:1.5b";
const baseUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const client = new OllamaClient({ baseUrl, model });

console.log(`[smoke] baseUrl=${baseUrl} model=${model}`);
const health = await client.isHealthy();
console.log("[smoke] isHealthy:", health);
if (!health.ok) {
  console.error(`[smoke] FAIL: server not reachable at ${baseUrl}`);
  process.exit(1);
}

const models = await client.listModels();
const haveModel = models.includes(model);
console.log(`[smoke] ${models.length} models available; ${model} present: ${haveModel}`);
if (!haveModel) {
  console.error(`[smoke] FAIL: model not pulled. Run: ollama pull ${model}`);
  process.exit(1);
}

console.log("[smoke] chat...");
const res = await client.chat({
  messages: [
    { role: "system", content: "Reply with the single word: ok" },
    { role: "user", content: "ping" },
  ],
});
console.log(`[smoke] chat content=${JSON.stringify(res.content.slice(0, 120))}`);
if (!/ok/i.test(res.content)) {
  console.error(`[smoke] FAIL: expected 'ok' in content`);
  process.exit(1);
}

console.log("[smoke] chat with format:json...");
const jsonRes = await client.chat({
  messages: [
    { role: "system", content: "Reply with JSON only: {\"answer\":\"<one word>\"}" },
    { role: "user", content: "ping" },
  ],
  format: "json",
});
console.log(`[smoke] json content=${JSON.stringify(jsonRes.content.slice(0, 120))}`);
const parsed = JSON.parse(jsonRes.content);
if (typeof parsed.answer !== "string") {
  console.error(`[smoke] FAIL: parsed JSON missing 'answer'`);
  process.exit(1);
}

console.log("[smoke] PASS");

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";
const providerId = "openai-compatible-responses-ccf767d6-352f-4817-a8b4-bf4b877f7b3b";

async function probe(model: string) {
  const start = Date.now();
  console.log(`Probing ${model}...`);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: `${providerId}/${model}`,
        messages: [{ role: "user", content: "Halo" }],
        max_tokens: 10,
        stream: false,
      }),
    });
    const elapsed = Date.now() - start;
    const txt = await res.text();
    console.log(`[${model}] (${elapsed}ms) -> HTTP ${res.status}: ${txt.slice(0, 100)}`);
  } catch (e: any) {
    console.log(`[${model}] Error: ${e.message}`);
  }
}

async function main() {
  await probe("gpt-6-astra");
  await probe("gpt-6-luna");
  await probe("claude-opus-5");
  await probe("gpt-6-sol");
}

main().catch(console.error);

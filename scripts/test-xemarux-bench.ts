const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";
const providerId = "openai-compatible-responses-ccf767d6-352f-4817-a8b4-bf4b877f7b3b";

const testModels = [
  "glm-5.3-flash",
  "deepseek-v4.1-flash",
  "kimi-k2.8-preview",
  "gpt-6-sol",
  "claude-sonnet-5",
];

async function main() {
  console.log("=== BENCHMARK MODEL DI XEMARUX VIA 9ROUTER ===");
  for (const m of testModels) {
    const fullModel = `${providerId}/${m}`;
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: fullModel,
          messages: [{ role: "user", content: "Jawab 1 kata: tes." }],
          max_tokens: 20,
          stream: false,
        }),
      });

      const elapsed = Date.now() - start;
      const raw = await res.text();
      if (!res.ok) {
        console.log(`❌ [${m}] (${elapsed}ms) HTTP ${res.status}: ${raw.slice(0, 100)}`);
      } else {
        const json = JSON.parse(raw);
        const ans = json.choices?.[0]?.message?.content || "";
        console.log(`✅ [${m}] (${elapsed}ms) -> "${ans.trim()}"`);
      }
    } catch (e: any) {
      console.log(`❌ [${m}] Error: ${e.message}`);
    }
  }
}

main().catch(console.error);

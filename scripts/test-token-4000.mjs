// scripts/test-token-4000.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

async function testModel4000(model, roleDesc) {
  console.log(`\n================ Testing ${model} (max_tokens: 4000, 30s limit) ================`);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `Kamu adalah ${roleDesc}. Fase reasoning/pemikiran internal dibatasi maksimal 20 detik, langsung keluarkan JSON VALID dengan analisis mendalam, kaya argumen teknis: {"thesis": string, "key_drivers": [string, string], "tactical_edge": string}`,
          },
          {
            role: "user",
            content: "Laga: Arsenal vs Lille. xG Arsenal: 1.42, Lille: 1.50. Lineup belum resmi. Berikan analisis taktis ofensif komprehensif.",
          },
        ],
        max_tokens: 4000,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Status: ${res.status} (${elapsed}s)`);
    let raw = await res.text();
    
    // Clean trailing data: [DONE]
    raw = raw.replace(/data:\s*\[DONE\]\s*$/, "").trim();

    try {
      const json = JSON.parse(raw);
      const content = json.choices?.[0]?.message?.content || "";
      const reasoning = json.choices?.[0]?.message?.reasoning_content || "";
      const finishReason = json.choices?.[0]?.finish_reason || "";
      console.log(`Finish Reason: ${finishReason}`);
      console.log(`Completion tokens:`, json.usage?.completion_tokens);
      console.log(`Reasoning tokens:`, json.usage?.completion_tokens_details?.reasoning_tokens);
      console.log(`Content length:`, content.length);
      console.log(`\n>>> OUTPUT CONTENT <<<\n${content}`);
    } catch (e) {
      console.log(`JSON parse err:`, e.message, `Raw:`, raw.slice(0, 300));
    }
  } catch (err) {
    clearTimeout(timer);
    console.error(`Error:`, err.message);
  }
}

await testModel4000("bai/deepseek-v4.1-flash", "Bull Analyst");
await testModel4000("bai/glm-5.3-flash", "Bull Analyst");

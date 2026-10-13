// scripts/test-token-fix.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

async function testWithHighTokens(model, maxTokens = 1500) {
  console.log(`\n================ Testing ${model} (max_tokens: ${maxTokens}) ================`);
  const start = Date.now();
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
            content: "Kamu adalah analis sepak bola. Analisis laga Arsenal vs Lille secara taktis. Closed-World: Hanya gunakan data xG (Arsenal 1.42 vs Lille 1.50). Lineup belum resmi. Keluarkan JSON VALID: {\"thesis\": string, \"key_drivers\": [string, string], \"tactical_edge\": string}",
          },
          {
            role: "user",
            content: "Laga: Arsenal vs Lille. Berikan analisis ofensif mendalam.",
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Status: ${res.status} (${elapsed}s)`);
    const raw = await res.text();
    
    // Parse response
    let content = "";
    let reasoning = "";
    let finishReason = "";

    try {
      const json = JSON.parse(raw);
      content = json.choices?.[0]?.message?.content || "";
      reasoning = json.choices?.[0]?.message?.reasoning_content || "";
      finishReason = json.choices?.[0]?.finish_reason || "";
      console.log(`Finish Reason: ${finishReason}`);
      console.log(`Usage:`, JSON.stringify(json.usage));
      console.log(`Reasoning tokens preview: ${reasoning.slice(0, 150)}...`);
      console.log(`\n>>> ACTUAL CONTENT OUTPUT <<<\n${content}`);
    } catch {
      console.log(`Raw preview: ${raw.slice(0, 500)}`);
    }
  } catch (err) {
    console.error(`Error:`, err.message);
  }
}

await testWithHighTokens("bai/glm-5.3-flash", 1500);
await testWithHighTokens("bai/deepseek-v4.1-flash", 1500);

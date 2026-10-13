// scripts/diagnose-raw-models.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

async function testModel(model) {
  console.log(`\n================ Testing ${model} ================`);
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
            content: "Kamu adalah analis sepak bola. Analisis laga Arsenal vs Lille secara taktis. Keluarkan JSON VALID: {\"thesis\": string, \"key_drivers\": [string]}",
          },
          {
            role: "user",
            content: "Pertandingan Arsenal vs Lille. Berikan analisis ofensif.",
          },
        ],
        max_tokens: 300,
        temperature: 0.2,
      }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Status: ${res.status} (${elapsed}s)`);
    const raw = await res.text();
    console.log(`Content-Type: ${res.headers.get("content-type")}`);
    console.log(`Raw length: ${raw.length}`);
    console.log(`Raw preview:\n${raw.slice(0, 500)}`);
    if (raw.length > 500) {
      console.log(`...\nRaw end:\n${raw.slice(-300)}`);
    }
  } catch (err) {
    console.error(`Error:`, err.message);
  }
}

await testModel("bai/glm-5.3-flash");
await testModel("bai/deepseek-v4.1-flash");
await testModel("atria/Atria-Dawn-Preview");
await testModel("ag/gemini-3.8-flash-medium");

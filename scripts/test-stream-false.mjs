// scripts/test-stream-false.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

async function testWithStreamFalse(model) {
  console.log(`\n================ Testing ${model} with stream: false ================`);
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
            content: "Kamu adalah analis sepak bola. Analisis taktis ringkas. Keluarkan JSON VALID: {\"thesis\": string, \"verdict\": string}",
          },
          {
            role: "user",
            content: "Arsenal vs Lille. xG: 1.42 vs 1.50.",
          },
        ],
        max_tokens: 1500,
        temperature: 0.2,
        stream: false,
      }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Status: ${res.status} (${elapsed}s)`);
    console.log(`Headers Content-Type:`, res.headers.get("content-type"));
    const text = await res.text();
    console.log(`Length:`, text.length);
    console.log(`Preview:`, text.slice(0, 400));
  } catch (err) {
    console.error(`Error:`, err.message);
  }
}

await testWithStreamFalse("atria/Atria-Dawn-Preview");
await testWithStreamFalse("bai/glm-5.3-flash");

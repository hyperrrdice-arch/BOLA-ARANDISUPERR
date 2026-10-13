// scripts/test-bai-models.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

const testList = [
  "bai/qwen3.8-flash",
  "bai/kimi-k2.8-preview",
  "bai/mimo-v2.6-flash",
  "bai/glm-5.3-flashx"
];

for (const m of testList) {
  const start = Date.now();
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: m,
        messages: [{ role: "user", content: "Jawab dalam 1 kalimat: apa itu xG dalam sepak bola?" }],
        max_tokens: 150,
        stream: false,
      }),
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const json = await res.json();
    console.log(`✅ ${m} (${elapsed}s):`, json.choices?.[0]?.message?.content?.slice(0, 100));
  } catch (err) {
    console.error(`❌ ${m}:`, err.message);
  }
}

// scripts/test-atria-4000.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

async function testAtria() {
  console.log(`\n================ Testing atria/Atria-Dawn-Preview (max_tokens: 4000, 30s limit) ================`);
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
        model: "atria/Atria-Dawn-Preview",
        messages: [
          {
            role: "system",
            content: "Kamu adalah Hakim 2 (Independent Cross-Arbiter). Waktu berpikir maksimal 15 detik, langsung keluarkan JSON VALID: {\"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"alternative_perspective\": string}",
          },
          {
            role: "user",
            content: "Laga: Arsenal vs Lille. Analisis xG: 1.42 vs 1.50. Evaluasi vonis pasar.",
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
    raw = raw.replace(/data:\s*\[DONE\]\s*$/, "").trim();

    try {
      const json = JSON.parse(raw);
      const content = json.choices?.[0]?.message?.content || "";
      const finishReason = json.choices?.[0]?.finish_reason || "";
      console.log(`Finish Reason: ${finishReason}`);
      console.log(`Usage:`, JSON.stringify(json.usage));
      console.log(`Content:\n`, content);
    } catch (e) {
      console.log(`Parse err:`, e.message, `Raw:`, raw.slice(0, 300));
    }
  } catch (err) {
    clearTimeout(timer);
    console.error(`Error:`, err.message);
  }
}

await testAtria();

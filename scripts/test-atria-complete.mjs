// scripts/test-atria-complete.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

async function testAtriaComplete() {
  console.log(`\n================ Testing atria/Atria-Dawn-Preview (max_tokens: 4000, 55s timeout) ================`);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

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
            content: "Kamu adalah Hakim 2 (Independent Cross-Arbiter) Sindikat Olahraga. Berikan vonis independen atas debat dan data Dixon-Coles xG. Keluarkan JSON VALID: {\"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"alternative_perspective\": string}",
          },
          {
            role: "user",
            content: "Laga: Arsenal vs Lille. Dixon-Coles xG: Arsenal 1.42 vs Lille 1.50. Evaluasi vonis pasar.",
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

await testAtriaComplete();

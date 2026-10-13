// scripts/test-full-context.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

const matchContext =
  "Pertandingan: Arsenal vs Lille (UEFA Champions League)\n" +
  "Waktu: 2026-10-13T19:00:00.000Z | Venue: Emirates Stadium\n" +
  "Dixon-Coles xG: Home=1.423 vs Away=1.5\n" +
  "True 1X2 Probs: Home=34% | Draw=28% | Away=38%\n" +
  "Fair 1X2 Odds: Home=2.94 | Draw=3.57 | Away=2.63\n" +
  "Over 2.5 Prob: 56% | BTTS Yes: 60%\n" +
  "Asian Handicap DNB: Home 48% (Fair: 2.1)\n" +
  "Status Lineup: Belum Dirilis (Kolektif Tim)\n" +
  "Form: Kandang=2-1, 2-1 | Tamu=1-0, 2-0";

async function test(model, prompt) {
  console.log(`\nTesting ${model}...`);
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

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
          { role: "system", content: prompt },
          { role: "user", content: matchContext },
        ],
        max_tokens: 3000,
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Status: ${res.status} (${elapsed}s)`);
    const json = await res.json();
    console.log("Usage:", json.usage);
    console.log("Content:\n", json.choices?.[0]?.message?.content?.slice(0, 300) + "...");
  } catch (err) {
    clearTimeout(timer);
    console.error("Error:", err.message);
  }
}

await test(
  "bai/glm-5.3-flash",
  "Kamu adalah Bull Analyst (Taktis Ofensif). Fase reasoning singkat (maksimal 15 detik), langsung keluarkan JSON VALID dengan tesis ofensif mendalam: {\"thesis\": string, \"key_drivers\": [string, string], \"tactical_edge\": string}"
);

await test(
  "atria/Atria-Dawn-Preview",
  "Kamu adalah Hakim 2 (Independent Cross-Arbiter). Fase reasoning singkat (maksimal 15 detik), langsung keluarkan JSON VALID: {\"verdict_summary\": string, \"confidence_tier\": \"B_MODERATE\", \"recommended_market\": string, \"alternative_perspective\": string}"
);

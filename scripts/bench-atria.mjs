// scripts/bench-atria.mjs
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

console.log("Starting Atria benchmark with NO timeout...");
const start = Date.now();
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
          content: "Kamu adalah Hakim 2 (Independent Cross-Arbiter). Langsung keluarkan JSON VALID tanpa basa-basi: {\"verdict_summary\": string, \"confidence_tier\": \"B_MODERATE\", \"recommended_market\": string, \"alternative_perspective\": string}",
        },
        { role: "user", content: matchContext },
      ],
      max_tokens: 3000,
      temperature: 0.2,
      stream: false,
    }),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Status: ${res.status} (${elapsed}s)`);
  const json = await res.json();
  console.log("Usage:", json.usage);
  console.log("Content:\n", json.choices?.[0]?.message?.content);
} catch (e) {
  console.error("Error:", e.message);
}

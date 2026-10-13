// scripts/test-qwen-hakim2.mjs
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

const debateSummary =
  `DATA KUANTITATIF:\n${matchContext}\n\n` +
  `ARGUMEN DEBAT TRI-AGENT:\n` +
  `1. Bull Case (bai/glm-5.3-flash): Potensi gol tinggi dan transisi balik Lille menekan Emirates.\n` +
  `2. Neutral Case (bai/deepseek-v4.1-flash): Ekuilibrium harga pasar tercapai, pasar 1X2 terlalu efisien, pilih margin sempit.\n` +
  `3. Bear Case (ag/gemini-3.8-flash-medium): Bias nama besar Arsenal mengekspos false pricing, Lille unggul metrik xG.\n`;

console.log("Testing bai/qwen3.8-flash as Hakim 2 (Independent Cross-Arbiter)...");
const start = Date.now();
try {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "bai/qwen3.8-flash",
      messages: [
        {
          role: "system",
          content: "Kamu adalah Hakim 2: Independent Synthesizer & Cross-Arbiter. Evaluasi debat secara independen untuk menguji bias kognitif Hakim 1. Fase reasoning maksimal 20 detik. Keluarkan JSON VALID: {\"verdict_summary\": string, \"confidence_tier\": \"A_HIGH_VALUE\" | \"B_MODERATE\" | \"C_LEAN\" | \"PASS_AVOID\", \"recommended_market\": string, \"alternative_perspective\": string}",
        },
        { role: "user", content: debateSummary },
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

import fs from "fs";

const apiKey = "sk-7b18b5c31d5d653c-z0q24f-c3542ecc";
const baseUrl = "http://localhost:20128/v1";
const providerId = "openai-compatible-responses-ccf767d6-352f-4817-a8b4-bf4b877f7b3b";
const targetModel = `${providerId}/gpt-6-sol`;

const matchContext = `
=== KONTEKS PERTANDINGAN SINDICATE FOOTBALL ===
Laga: Arsenal vs Chelsea (Premier League)
Venue: Emirates Stadium | Waktu: 2026-10-18 22:30 WIB
Wasit: Michael Oliver (Rata-rata 3.8 Kartu Kuning, 0.22 Penalti per laga)

BURSA PASAR & ODDS:
- 1X2 Pasar Live (Bet365 / Pinnacle): Home (Arsenal)=1.95 | Draw=3.60 | Away (Chelsea)=3.90
- Over/Under 2.5 Goals: Over=1.80 | Under=2.05
- Asian Handicap: Arsenal -0.5 @ 1.95 | Chelsea +0.5 @ 1.90
- Shin Vig-Stripping True Odds: Home=1.88 | Draw=3.75 | Away=4.10 (Margin Bandar: 4.2%)

MODEL MATEMATIS KUANTITATIF (Dixon-Coles Bivariate Poisson):
- Lambda Home xG: 1.95 vs Mu Away xG: 0.85
- True Probability: Home Win = 58.2% | Draw = 23.8% | Away Win = 18.0%
- Model Fair Odds: Home = 1.72 | Draw = 4.20 | Away = 5.55
- Total Goal Probs: Over 2.5 = 55.4% | BTTS Yes = 48.1%
- Asian Handicap AH 0.0 (Draw No Bet): Home Prob = 76.4% (Fair Odds: 1.31)

VALUE BET EVALUATION & KELLY SIZING:
- [Match Odds 1X2] Arsenal Win @ 1.95 vs Fair 1.72 -> Expected Value (+EV): +13.37% | Half-Kelly Stake: 2.45% Bankroll
- [Asian Handicap -0.5] Arsenal @ 1.95 vs Fair 1.72 -> Expected Value (+EV): +13.37%
- [Asian Handicap 0.0 DNB] Arsenal @ 1.44 vs Fair 1.31 -> Expected Value (+EV): +9.92% | Sizing: 3.10% Bankroll

KONDISI SKUAD & FORM:
- Arsenal: W-W-D-W-L (Home Record: 4W-1D-0L). Lini tengah dominan ball possession 62%. Semua pilar utama fit.
- Chelsea: L-D-W-L-D (Away Record: 1W-2D-2L). Transisi counter attack cepat via sayap, tapi konsesi xGA tinggi pada 20 menit akhir.
`;

const systemPrompt = `
Lo adalah Chief Risk & Quantitative Arbiter di sindikat taruhan bola profesional.
Gaya bahasa lo santai, tajam, profesional, menggunakan bahasa obrolan analis pro (gw/lo).
Dilarang kaku kayak robot, buang semua basa-basi klise ("Berikut adalah analisis..."), dan dilarang hiperbola lebay.

Tugas lo:
1. Bedah data Dixon-Coles xG vs bursa odds pasar live. Apakah harga Arsenal 1.95 merupakan trap bandar atau genuine value?
2. Evaluasi risiko defensif dan skenario kegagalan laga.
3. Buat vonis rekomendasi taruhan final paling masuk akal dengan alokasi Kelly Bankroll yang presisi.

Berikan analisis terstruktur namun mengalir natural.
`;

async function runAnalysis() {
  console.log(`=== RUNNING ANALYSIS DENGAN MODEL [gpt-6-sol] DARI XEMARUX ===`);
  console.log(`Target Model Endpoint: ${targetModel}`);
  console.log(`Mengirim payload analisis pertandingan...`);

  const startTime = Date.now();

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: "system", content: systemPrompt.trim() },
          { role: "user", content: matchContext.trim() },
        ],
        max_tokens: 4096,
        temperature: 0.25,
        stream: false,
      }),
    });

    const latencyMs = Date.now() - startTime;
    const raw = await res.text();

    if (!res.ok) {
      console.error(`❌ HTTP Error ${res.status}: ${raw}`);
      return;
    }

    let json: any = null;
    let content = "";
    let usage: any = null;

    try {
      json = JSON.parse(raw);
      content = json.choices?.[0]?.message?.content || "";
      usage = json.usage;
    } catch {
      // SSE fallback
      const lines = raw.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            const p = JSON.parse(line.slice(6));
            content += p.choices?.[0]?.delta?.content || "";
            if (p.usage) usage = p.usage;
          } catch {}
        }
      }
    }

    console.log(`\n======================================================`);
    console.log(`📊 RINCIAN TOKEN USAGE (gpt-6-sol @ XEMARUX)`);
    console.log(`======================================================`);
    console.log(`• Prompt Tokens (Input)     : ${usage?.prompt_tokens ?? "N/A"} tokens`);
    console.log(`• Completion Tokens (Output): ${usage?.completion_tokens ?? "N/A"} tokens`);
    console.log(`• Total Tokens Sekali Jalan : ${usage?.total_tokens ?? "N/A"} tokens`);
    console.log(`• Waktu Eksekusi / Latensi  : ${(latencyMs / 1000).toFixed(2)} detik (${latencyMs} ms)`);
    console.log(`======================================================\n`);

    console.log(`📝 HASIL ANALISIS GPT-6-SOL:\n`);
    console.log(content.trim());

  } catch (err: any) {
    console.error("Error executing analysis:", err.message);
  }
}

runAnalysis().catch(console.error);
